import {decodeEventLog, type Address, type Abi} from 'viem';
import type {Database} from '../../../packages/db/index.js';
import type {ChainClient} from '../../../packages/chain/client.js';
import type {Config} from '../../api/src/config.js';
import {paymentRouterAbi,subscriptionManagerAbi,rewardsVaultAbi,partnershipRegistryAbi,offersRedemptionAbi} from '../../../packages/chain/abi.js';
import {split} from '../../../packages/chain/index.js';
const json=(v:unknown)=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v);
export async function indexContract(db:Database,client:ChainClient,config:Config,contract:Address,abi:Abi) {
 const cursor=(await db.query('SELECT * FROM indexer_cursors WHERE contract=$1',[contract.toLowerCase()])).rows[0];
 const head=await client.getBlockNumber({cacheTime:0});
 if(head<config.startBlock)return;
 let from=cursor?BigInt(cursor.last_block)+1n:config.startBlock;
 if(cursor) {
  // An unavailable or lagging RPC does not prove a reorg.
  if(head<BigInt(cursor.last_block))throw new Error('RPC behind indexer cursor');
  const tip=await client.getBlock({blockNumber:BigInt(cursor.last_block)});
  if(tip.hash!==cursor.last_hash) {
   const checkpoints=await db.query('SELECT number,hash FROM indexed_blocks WHERE contract=$1 AND number<$2 ORDER BY number DESC LIMIT 100',[contract.toLowerCase(),cursor.last_block]);
   from=config.startBlock;
   for(const point of checkpoints.rows)if((await client.getBlock({blockNumber:BigInt(point.number)})).hash===point.hash){from=BigInt(point.number)+1n;break;}
  }
 }
 const to=from>head?head:(from+499n<head?from+499n:head);
 const end=await client.getBlock({blockNumber:to});
 const logs=from<=to?await client.getLogs({address:contract,fromBlock:from,toBlock:to}):[];
 const events: Array<{log: typeof logs[number]; eventName: string; args: unknown}> = [];
 for(const log of logs) {
  if(log.removed || log.blockNumber===null || log.logIndex===null || !log.transactionHash || !log.blockHash)continue;
  const block=await client.getBlock({blockNumber:log.blockNumber});
  if(block.hash!==log.blockHash)throw new Error('Chain changed during scan');
  try {const decoded=decodeEventLog({abi,data:log.data,topics:log.topics});if(typeof decoded.eventName === 'string')events.push({log,eventName:decoded.eventName,args:decoded.args});}catch{ /* other contract events are not protocol evidence */ }
 }
 if((await client.getBlock({blockNumber:to})).hash!==end.hash)throw new Error('Chain changed during scan');
 await db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(31612)');
  const current=(await tx.query('SELECT * FROM indexer_cursors WHERE contract=$1',[contract.toLowerCase()])).rows[0];
  if(current?.last_hash!==cursor?.last_hash || String(current?.last_block)!==String(cursor?.last_block))throw new Error('Concurrent scan; retry');
  if(cursor && from<=BigInt(cursor.last_block)) {
   const removed=await tx.query('UPDATE chain_events SET canonical=false WHERE contract=$1 AND block_number>=$2 AND canonical RETURNING *',[contract.toLowerCase(),from.toString()]);
   for(const event of removed.rows)if(event.event_name==='PaymentSettled')await enqueue(tx,event,'payment.reorged');
   await tx.query('DELETE FROM indexed_blocks WHERE contract=$1 AND number>=$2',[contract.toLowerCase(),from.toString()]);
  }
  for(const {log,eventName,args} of events)await tx.query('INSERT INTO chain_events(chain_id,tx_hash,log_index,contract,block_number,block_hash,event_name,payload,canonical) VALUES(31611,$1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT(chain_id,tx_hash,log_index) DO UPDATE SET block_hash=excluded.block_hash,block_number=excluded.block_number,payload=excluded.payload,canonical=true',[log.transactionHash,log.logIndex,contract.toLowerCase(),String(log.blockNumber),log.blockHash,eventName,json(args)]);
  await tx.query("UPDATE chain_events SET confirmation_state=CASE WHEN block_number<=$1 THEN 'final' WHEN block_number<=$2 THEN 'confirmed' ELSE 'observed' END WHERE canonical AND contract=$3",[(head-BigInt(config.finality)+1n).toString(),(head-BigInt(config.confirmations)+1n).toString(),contract.toLowerCase()]);
  await project(tx);
  await tx.query('INSERT INTO indexed_blocks(contract,number,hash) VALUES($1,$2,$3) ON CONFLICT(contract,number) DO UPDATE SET hash=excluded.hash',[contract.toLowerCase(),to.toString(),end.hash]);
  await tx.query('INSERT INTO indexer_cursors(contract,last_block,last_hash) VALUES($1,$2,$3) ON CONFLICT(contract) DO UPDATE SET last_block=excluded.last_block,last_hash=excluded.last_hash,updated_at=now()',[contract.toLowerCase(),to.toString(),end.hash]);
 });
}
async function enqueue(db:Database,event:Record<string,any>,type:string) {
 const merchant=event.payload.merchant?.toLowerCase(); if(!merchant)return;
 await db.query('INSERT INTO outbox(webhook_id,event_key,payload) SELECT w.id,$1,$2 FROM webhooks w JOIN merchants m ON m.id=w.merchant_id WHERE m.owner_wallet=$3 AND w.active ON CONFLICT DO NOTHING',[`${type}:${event.tx_hash}:${event.log_index}:${event.block_hash}`,json({type,transactionHash:event.tx_hash,blockHash:event.block_hash,data:event.payload}),merchant]);
}
export async function project(db:Database) {
 await db.query("UPDATE orders SET status=CASE WHEN EXISTS(SELECT 1 FROM transactions t WHERE t.order_id=orders.id) THEN 'submitted' ELSE 'quoted' END,settlement=NULL,settlement_tx=NULL,settlement_block=NULL WHERE settlement_tx IS NOT NULL OR status='cancelled'");
 const events=(await db.query('SELECT * FROM chain_events WHERE canonical ORDER BY block_number,log_index')).rows;
 for(const event of events) {
  const p=event.payload;
  if(event.event_name==='PaymentSettled') {
   const orders=await db.query("SELECT * FROM orders WHERE quote_hash=$1 AND lower(quote->>'router')=$2",[p.quoteHash.toLowerCase(),event.contract]);
   const row=orders.rows[0];
   if(row) {
    const q=row.quote.terms; const amounts=split(q.amount,q.referralBps,q.cashbackBps);
    if(q.orderId!==p.orderId || q.merchant!==p.merchant.toLowerCase() || q.partner!==p.partner.toLowerCase() || q.amount!==p.gross || amounts.merchantAtomic!==p.merchantAmount || amounts.referralAtomic!==p.referralAmount || amounts.cashbackAtomic!==p.cashbackAmount)throw new Error('Settlement does not match immutable quote');
    await db.query('UPDATE orders SET status=$1,settlement=$2,settlement_tx=$3,settlement_block=$4 WHERE id=$5',[event.confirmation_state,json({...amounts,payer:p.payer.toLowerCase(),grossAtomic:p.gross,blockHash:event.block_hash}),event.tx_hash,event.block_number,row.id]);
   }
   if(['confirmed','final'].includes(event.confirmation_state))await enqueue(db,event,'payment.confirmed');
  }
  if(event.event_name==='OrderCancelled')await db.query("UPDATE orders SET status='cancelled' WHERE quote->'terms'->>'orderId'=$1 AND quote->'terms'->>'merchant'=$2 AND lower(quote->>'router')=$3 AND settlement_tx IS NULL",[p.orderId,p.merchant.toLowerCase(),event.contract]);
 }
 // Rebuild subscription discovery from canonical logs so a reorg removes orphaned mandates.
 await db.query('DELETE FROM subscriptions');
 for(const event of events)if(event.event_name==='SubscriptionCreated' && ['confirmed','final'].includes(event.confirmation_state))await db.query('INSERT INTO subscriptions(id,customer,merchant,plan_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[event.payload.id,event.payload.customer.toLowerCase(),event.payload.merchant.toLowerCase(),event.payload.planHash]);
}
export function contracts(config:Config,manager:Address) {return [
 {address:config.router!,abi:paymentRouterAbi},{address:manager,abi:subscriptionManagerAbi},
 ...(config.rewardsVault?[{address:config.rewardsVault,abi:rewardsVaultAbi}]:[]),
 ...(config.registry?[{address:config.registry,abi:partnershipRegistryAbi}]:[]),
 ...(config.offers?[{address:config.offers,abi:offersRedemptionAbi}]:[]),
 ];}
