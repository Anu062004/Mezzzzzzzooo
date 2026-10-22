import {createWalletClient,http, type Address, type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {subscriptionManagerAbi} from '../../../packages/chain/abi.js';
import {mezoTestnet} from '../../../packages/chain/index.js';
import type {ChainClient} from '../../../packages/chain/client.js';
import type {Database} from '../../../packages/db/index.js';
import type {Config} from '../../api/src/config.js';
export async function runKeeper(db:Database,client:ChainClient,config:Config,manager:Address) {
 if(!process.env.WORKER_PRIVATE_KEY)return;
 const account=privateKeyToAccount(process.env.WORKER_PRIVATE_KEY as Hex);
 const wallet=createWalletClient({account,chain:mezoTestnet,transport:http(config.rpcUrl)});
 for(const row of (await db.query('SELECT id FROM subscriptions')).rows) {
  const id=row.id as Hex;
  const s=await client.readContract({address:manager,abi:subscriptionManagerAbi,functionName:'getSubscription',args:[id]});
  const now=(await client.getBlock()).timestamp;
  if(s.cancelled||s.charges>=s.plan.maxCharges||now<s.nextDue||now>=s.plan.expiresAt)continue;
  await db.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(31613)');
   const previous=(await tx.query('SELECT * FROM billing_attempts WHERE subscription_id=$1 AND period=$2 FOR UPDATE',[id,s.charges.toString()])).rows[0];
   if(previous?.tx_hash){try {const receipt=await client.getTransactionReceipt({hash:previous.tx_hash});if(receipt.status==='success')return;}catch{return;}}
   try {
    const {request}=await client.simulateContract({account,address:manager,abi:subscriptionManagerAbi,functionName:'charge',args:[id]});
    const hash=await wallet.writeContract(request);
    await tx.query("INSERT INTO billing_attempts(subscription_id,period,tx_hash,status,attempts) VALUES($1,$2,$3,'submitted',1) ON CONFLICT(subscription_id,period) DO UPDATE SET tx_hash=excluded.tx_hash,status='submitted',attempts=billing_attempts.attempts+1,updated_at=now()",[id,s.charges.toString(),hash]);
   } catch {await tx.query("INSERT INTO billing_attempts(subscription_id,period,status,attempts) VALUES($1,$2,'retryable',1) ON CONFLICT(subscription_id,period) DO UPDATE SET status='retryable',attempts=billing_attempts.attempts+1,updated_at=now()",[id,s.charges.toString()]);}
  });
 }
}
