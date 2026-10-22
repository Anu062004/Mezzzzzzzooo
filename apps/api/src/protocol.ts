import {randomUUID,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {encodeFunctionData,erc20Abi,isAddress,keccak256,stringToHex,encodeAbiParameters,parseAbiParameters,type Address,type Hex} from 'viem';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Database} from '../../../packages/db/index.js';
import type {ChainClient} from '../../../packages/chain/client.js';
import {MEZO} from '../../../packages/chain/client.js';
import {paymentRouterAbi,subscriptionManagerAbi,rewardsVaultAbi,partnershipRegistryAbi,offersRedemptionAbi} from '../../../packages/chain/abi.js';
import {MUSD,ZERO,typedQuote} from '../../../packages/chain/index.js';
import {planData,offerData,jsonSafe} from '../../../packages/chain/terms.js';
import {encryptSecret,webhookUrl} from '../../worker/src/webhooks.js';
import {ApiError,type Verifier} from './app.js';
import type {Config} from './config.js';
const address=z.string().refine(v=>isAddress(v)).transform(v=>v.toLowerCase() as Address);
const amount=z.string().max(78).regex(/^[1-9][0-9]*$/).refine(v=>/^[1-9][0-9]*$/.test(v)&&v.length<=78&&BigInt(v)<2n**256n);
const sig=z.string().max(16386).regex(/^0x(?:[a-fA-F0-9]{2})+$/).transform(v=>v as Hex);
const hash=z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v.toLowerCase() as Hex);
const idOf=(request:FastifyRequest)=>z.object({id:z.uuid()}).parse(request.params).id;
const chainIdOf=(request:FastifyRequest)=>z.object({id:hash}).parse(request.params).id;
const now=()=>Math.floor(Date.now()/1000);
const tx=(to:Address,data:Hex)=>({chainId:31611,to,data,value:'0'});
interface Context {db:Database;config:Config;client?:ChainClient;verifier:Verifier;currentWallet(r:FastifyRequest):Promise<Address>;merchantFor(w:Address,id:string,db?:Database):Promise<any>;getOrder(id:string,db?:Database,lock?:boolean):Promise<any>;viewOrder(row:any):any}
export async function registerProtocol(app:FastifyInstance,c:Context){
 const {db,config,currentWallet,merchantFor,getOrder,viewOrder}=c;
 const chain=()=>{if(!c.client||!config.router)throw new ApiError(503,'CHAIN_NOT_CONFIGURED',true);return c.client;};
 const manager=()=>chain().readContract({address:config.router!,abi:paymentRouterAbi,functionName:'subscriptionManager'});
 const owned=async(r:FastifyRequest,table:string)=>{const row=(await db.query(`SELECT * FROM ${table} WHERE id=$1`,[idOf(r)])).rows[0];if(!row)throw new ApiError(404,'NOT_FOUND');await merchantFor(await currentWallet(r),row.merchant_id);return row;};
 app.get('/v1/merchants',async r=>({merchants:(await db.query('SELECT m.* FROM merchants m JOIN merchant_members mm ON mm.merchant_id=m.id WHERE mm.address=$1 ORDER BY m.created_at DESC',[await currentWallet(r)])).rows}));
 app.get('/v1/merchants/:id',async r=>{
  const id=idOf(r);const merchant=(await db.query('SELECT id,name,owner_wallet FROM merchants WHERE id=$1',[id])).rows[0];if(!merchant)throw new ApiError(404,'NOT_FOUND');
  const orders=(await db.query("SELECT * FROM orders WHERE merchant_id=$1 AND signature IS NOT NULL AND expires_at>now() AND status='quoted' ORDER BY created_at DESC LIMIT 50",[id])).rows.map(viewOrder);
  return {merchant,orders,checkoutUrl:`${config.origin}/merchant/${id}`};
 });
 app.get('/v1/merchants/:id/orders',async r=>{const id=idOf(r);await merchantFor(await currentWallet(r),id);return {orders:(await db.query('SELECT * FROM orders WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100',[id])).rows.map(viewOrder)};});
 app.get('/v1/merchants/:id/analytics',async r=>{
  const m=await merchantFor(await currentWallet(r),idOf(r));
  const result=await db.query("SELECT count(*)::integer AS payments,coalesce(sum((payload->>'gross')::numeric),0)::text AS gross,coalesce(sum((payload->>'merchantAmount')::numeric),0)::text AS revenue,coalesce(sum((payload->>'referralAmount')::numeric),0)::text AS commissions,coalesce(sum((payload->>'cashbackAmount')::numeric),0)::text AS cashback,count(DISTINCT lower(payload->>'payer'))::integer AS customers FROM chain_events WHERE canonical AND confirmation_state IN ('confirmed','final') AND event_name='PaymentSettled' AND lower(payload->>'merchant')=$1",[m.owner_wallet]);return result.rows[0];
 });
 app.get('/v1/receipts',async r=>({receipts:(await db.query("SELECT * FROM chain_events WHERE canonical AND confirmation_state IN ('confirmed','final') AND event_name='PaymentSettled' AND lower(payload->>'payer')=$1 ORDER BY block_number DESC LIMIT 100",[await currentWallet(r)])).rows}));
 app.get('/v1/partner/sales',async r=>({sales:(await db.query("SELECT * FROM chain_events WHERE canonical AND confirmation_state IN ('confirmed','final') AND event_name='PaymentSettled' AND lower(payload->>'partner')=$1 ORDER BY block_number DESC LIMIT 100",[await currentWallet(r)])).rows}));
 app.get('/v1/operations',async r=>{await currentWallet(r);return {indexers:(await db.query('SELECT * FROM indexer_cursors')).rows,chainId:31611};});
 app.post('/v1/orders/:id/prepare',async r=>{
  const payer=await currentWallet(r);const order=await getOrder(idOf(r));const {terms,router}=order.quote;
  if(!order.signature||['cancelled','observed','confirmed','final'].includes(order.status)||BigInt(terms.deadline)<=BigInt(now()))throw new ApiError(409,'ORDER_NOT_PAYABLE');
  if(router!==config.router)throw new ApiError(409,'ROUTER_CHANGED');
  if(!await c.verifier.verifyQuote({...typedQuote(terms,router),address:terms.merchant,signature:order.signature}))throw new ApiError(409,'SIGNATURE_REVOKED');
  const [balance,allowance]=await Promise.all([chain().readContract({address:MUSD,abi:erc20Abi,functionName:'balanceOf',args:[payer]}),chain().readContract({address:MUSD,abi:erc20Abi,functionName:'allowance',args:[payer,router]})]);
  const q=typedQuote(terms,router).message;
  if(balance<q.amount)throw new ApiError(409,'INSUFFICIENT_MUSD');
  const approval=allowance<q.amount?tx(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,q.amount]})):null;
  if(!approval)await chain().simulateContract({account:payer,address:router,abi:paymentRouterAbi,functionName:'pay',args:[q,order.signature]});
  return {approval,payment:tx(router,encodeFunctionData({abi:paymentRouterAbi,functionName:'pay',args:[q,order.signature]})),amountAtomic:terms.amount};
 });
 app.post('/v1/orders/:id/cancel',async r=>{const row=await getOrder(idOf(r));await merchantFor(await currentWallet(r),row.merchant_id);return tx(row.quote.router,encodeFunctionData({abi:paymentRouterAbi,functionName:'cancel',args:[row.quote.terms.orderId]}));});
 app.post('/v1/orders/:id/refund',async r=>{
  const row=await getOrder(idOf(r));const wallet=await currentWallet(r);await merchantFor(wallet,row.merchant_id);
  const input=z.strictObject({amountAtomic:amount}).parse(r.body);if(!['confirmed','final'].includes(row.status))throw new ApiError(409,'PAYMENT_NOT_CONFIRMED');
  const refunded=await chain().readContract({address:row.quote.router,abi:paymentRouterAbi,functionName:'refunded',args:[row.quote_hash]});
  if(BigInt(input.amountAtomic)>BigInt(row.quote.terms.amount)-refunded)throw new ApiError(400,'REFUND_EXCEEDS_PAYMENT');
  return {approval:tx(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[row.quote.router,BigInt(input.amountAtomic)]})),payment:tx(row.quote.router,encodeFunctionData({abi:paymentRouterAbi,functionName:'refund',args:[row.quote_hash,BigInt(input.amountAtomic)]}))};
 });
 app.post('/v1/partnerships',async r=>{
  const wallet=await currentWallet(r);const input=z.strictObject({merchantId:z.uuid(),partner:address.refine(v=>v!==ZERO),bps:z.number().int().min(0).max(10000),expiresAt:z.number().int().positive()}).parse(r.body);
  if(wallet!==input.partner)await merchantFor(wallet,input.merchantId);if(input.expiresAt<=now())throw new ApiError(400,'EXPIRED');
  const id=randomUUID(),nonce=keccak256(stringToHex(id));await db.query('INSERT INTO partnerships(id,merchant_id,partner,bps,expires_at,nonce) VALUES($1,$2,$3,$4,$5,$6)',[id,input.merchantId,input.partner,input.bps,new Date(input.expiresAt*1000),nonce]);return {id};
 });
 app.get('/v1/partnerships',async r=>({partnerships:(await db.query('SELECT p.*,m.name FROM partnerships p JOIN merchants m ON m.id=p.merchant_id WHERE p.partner=$1 OR m.owner_wallet=$1 ORDER BY p.created_at DESC',[await currentWallet(r)])).rows}));
 app.post('/v1/partnerships/:id/accept',async r=>{if(!config.registry)throw new ApiError(503,'REGISTRY_NOT_CONFIGURED');const row=await owned(r,'partnerships');return tx(config.registry,encodeFunctionData({abi:partnershipRegistryAbi,functionName:'approve',args:[row.nonce,row.partner,row.bps,BigInt(Math.floor(new Date(row.expires_at).getTime()/1000))]}));});
 app.post('/v1/partnerships/:id/revoke',async r=>{if(!config.registry)throw new ApiError(503,'REGISTRY_NOT_CONFIGURED');const row=await owned(r,'partnerships');const m=await merchantFor(await currentWallet(r),row.merchant_id);const id=keccak256(encodeAbiParameters(parseAbiParameters('address,bytes32'),[m.owner_wallet,row.nonce]));return tx(config.registry,encodeFunctionData({abi:partnershipRegistryAbi,functionName:'revoke',args:[id]}));});
 app.post('/v1/campaigns',async r=>{
  if(!config.rewardsVault)throw new ApiError(503,'VAULT_NOT_CONFIGURED');
  const input=z.strictObject({merchantId:z.uuid(),name:z.string().trim().min(1).max(100),rewardAtomic:amount,minimumPurchaseAtomic:amount,startsAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive()}).parse(r.body);
  const m=await merchantFor(await currentWallet(r),input.merchantId);if(input.expiresAt<=Math.max(now(),input.startsAt))throw new ApiError(400,'INVALID_EXPIRY');
  const id=randomUUID(),nonce=keccak256(stringToHex(id)),onchainId=keccak256(encodeAbiParameters(parseAbiParameters('address,bytes32'),[m.owner_wallet,nonce]));
  await db.query('INSERT INTO campaigns(id,merchant_id,name,nonce,terms,onchain_id) VALUES($1,$2,$3,$4,$5,$6)',[id,input.merchantId,input.name,nonce,JSON.stringify(input),onchainId]);
  return {id,onchainId,transaction:tx(config.rewardsVault,encodeFunctionData({abi:rewardsVaultAbi,functionName:'create',args:[nonce,BigInt(input.rewardAtomic),BigInt(input.minimumPurchaseAtomic),BigInt(input.startsAt),BigInt(input.expiresAt)]}))};
 });
 app.get('/v1/campaigns',async r=>{
  await currentWallet(r);const rows=(await db.query('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100')).rows;
  return {campaigns:await Promise.all(rows.map(async row=>({...row,onchain:config.rewardsVault?jsonSafe(await chain().readContract({address:config.rewardsVault,abi:rewardsVaultAbi,functionName:'campaigns',args:[row.onchain_id]})):null})))};
 });
 app.post('/v1/campaigns/:id/fund',async r=>{if(!config.rewardsVault)throw new ApiError(503,'VAULT_NOT_CONFIGURED');const row=await owned(r,'campaigns');const input=z.strictObject({amountAtomic:amount}).parse(r.body);return {approval:tx(MEZO,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[config.rewardsVault,BigInt(input.amountAtomic)]})),payment:tx(config.rewardsVault,encodeFunctionData({abi:rewardsVaultAbi,functionName:'fund',args:[row.onchain_id,BigInt(input.amountAtomic)]}))};});
 app.post('/v1/campaigns/:id/reclaim',async r=>{if(!config.rewardsVault)throw new ApiError(503,'VAULT_NOT_CONFIGURED');const row=await owned(r,'campaigns');return tx(config.rewardsVault,encodeFunctionData({abi:rewardsVaultAbi,functionName:'reclaim',args:[row.onchain_id]}));});
 app.post('/v1/campaigns/:id/claim',async r=>{if(!config.rewardsVault)throw new ApiError(503,'VAULT_NOT_CONFIGURED');const wallet=await currentWallet(r);const input=z.strictObject({quoteHash:hash}).parse(r.body);const row=(await db.query('SELECT * FROM campaigns WHERE id=$1',[idOf(r)])).rows[0];if(!row)throw new ApiError(404,'NOT_FOUND');await chain().simulateContract({account:wallet,address:config.rewardsVault,abi:rewardsVaultAbi,functionName:'claim',args:[row.onchain_id,input.quoteHash]});return tx(config.rewardsVault,encodeFunctionData({abi:rewardsVaultAbi,functionName:'claim',args:[row.onchain_id,input.quoteHash]}));});
 app.post('/v1/subscriptions/prepare',async r=>{
  const input=z.strictObject({merchantId:z.uuid(),amountAtomic:amount,partner:address.default(ZERO),referralBps:z.number().int().min(0).max(10000).default(0),cashbackBps:z.number().int().min(0).max(10000).default(0),interval:z.number().int().min(60).max(31536000),startsAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive(),maxCharges:z.number().int().min(1).max(10000)}).parse(r.body);
  const m=await merchantFor(await currentWallet(r),input.merchantId);
  if(input.referralBps+input.cashbackBps>10000||((input.referralBps===0)!==(input.partner===ZERO))||input.expiresAt<=Math.max(now(),input.startsAt)||BigInt(input.amountAtomic)*BigInt(input.maxCharges)>=2n**256n)throw new ApiError(400,'INVALID_PLAN');
  const id=randomUUID(),terms={merchant:m.owner_wallet,partner:input.partner,amount:input.amountAtomic,referralBps:input.referralBps,cashbackBps:input.cashbackBps,interval:String(input.interval),startsAt:String(input.startsAt),expiresAt:String(input.expiresAt),maxCharges:String(input.maxCharges),nonce:keccak256(stringToHex(id))};
  const typedData=planData(terms,await manager());await db.query('INSERT INTO subscription_plans(id,merchant_id,terms) VALUES($1,$2,$3)',[id,input.merchantId,JSON.stringify(terms)]);return {id,terms,typedData:jsonSafe(typedData)};
 });
 app.post('/v1/subscriptions/plans/:id/authorize',async r=>{const row=await owned(r,'subscription_plans');const {signature}=z.strictObject({signature:sig}).parse(r.body);if(!await chain().verifyTypedData({...planData(row.terms,await manager()),address:row.terms.merchant,signature}))throw new ApiError(401,'INVALID_SIGNATURE');await db.query('UPDATE subscription_plans SET signature=$1 WHERE id=$2',[signature,row.id]);return {id:row.id,subscriptionUrl:`${config.origin}/subscribe/${row.id}`};});
 app.get('/v1/subscriptions/plans/:id',async r=>{const row=(await db.query('SELECT * FROM subscription_plans WHERE id=$1 AND signature IS NOT NULL',[idOf(r)])).rows[0];if(!row)throw new ApiError(404,'NOT_FOUND');return row;});
 app.post('/v1/subscriptions/plans/:id/subscribe',async r=>{
  await currentWallet(r);const row=(await db.query('SELECT * FROM subscription_plans WHERE id=$1 AND signature IS NOT NULL',[idOf(r)])).rows[0];if(!row)throw new ApiError(404,'NOT_FOUND');if(BigInt(row.terms.expiresAt)<=BigInt(now()))throw new ApiError(409,'PLAN_EXPIRED');const target=await manager();const terms=planData(row.terms,target).message;
  return {maximumTotalAtomic:(BigInt(terms.amount)*BigInt(terms.maxCharges)).toString(),approval:tx(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[config.router!,BigInt(terms.amount)*BigInt(terms.maxCharges)]})),payment:tx(target,encodeFunctionData({abi:subscriptionManagerAbi,functionName:'subscribe',args:[terms,row.signature]}))};
 });
 app.get('/v1/subscriptions',async r=>{const wallet=await currentWallet(r);const rows=(await db.query('SELECT * FROM subscriptions WHERE customer=$1 OR merchant=$1',[wallet])).rows;return {subscriptions:await Promise.all(rows.map(async row=>({...row,onchain:jsonSafe(await chain().readContract({address:await manager(),abi:subscriptionManagerAbi,functionName:'getSubscription',args:[row.id]}))})))};});
 app.post('/v1/subscriptions/:id/cancel',async r=>{const wallet=await currentWallet(r),id=chainIdOf(r),target=await manager();const s=await chain().readContract({address:target,abi:subscriptionManagerAbi,functionName:'getSubscription',args:[id]});if(s.customer.toLowerCase()!==wallet)throw new ApiError(403,'SUBSCRIPTION_ACCESS_DENIED');return tx(target,encodeFunctionData({abi:subscriptionManagerAbi,functionName:'cancel',args:[id]}));});
 app.post('/v1/subscriptions/:id/charge',async r=>{await currentWallet(r);return tx(await manager(),encodeFunctionData({abi:subscriptionManagerAbi,functionName:'charge',args:[chainIdOf(r)]}));});
 app.post('/v1/offers',async r=>{if(!config.offers)throw new ApiError(503,'OFFERS_NOT_CONFIGURED');const input=z.strictObject({merchantId:z.uuid(),customer:address,discountAtomic:amount,deadline:z.number().int().positive()}).parse(r.body);const m=await merchantFor(await currentWallet(r),input.merchantId);if(input.deadline<=now())throw new ApiError(400,'EXPIRED');const id=randomUUID(),terms={id:keccak256(stringToHex(id)),merchant:m.owner_wallet,customer:input.customer,discountAtomic:input.discountAtomic,deadline:String(input.deadline)};await db.query('INSERT INTO offers(id,merchant_id,terms) VALUES($1,$2,$3)',[id,input.merchantId,JSON.stringify(terms)]);return {id,terms,typedData:jsonSafe(offerData(terms,config.offers))};});
 app.post('/v1/offers/:id/authorize',async r=>{if(!config.offers)throw new ApiError(503,'OFFERS_NOT_CONFIGURED');const row=await owned(r,'offers');const {signature}=z.strictObject({signature:sig}).parse(r.body);if(!await chain().verifyTypedData({...offerData(row.terms,config.offers),address:row.terms.merchant,signature}))throw new ApiError(401,'INVALID_SIGNATURE');await db.query('UPDATE offers SET signature=$1 WHERE id=$2',[signature,row.id]);return {id:row.id};});
 app.get('/v1/offers',async r=>({offers:(await db.query("SELECT * FROM offers WHERE terms->>'customer'=$1 OR terms->>'merchant'=$1",[await currentWallet(r)])).rows}));
 app.post('/v1/offers/:id/redeem',async r=>{if(!config.offers)throw new ApiError(503,'OFFERS_NOT_CONFIGURED');const wallet=await currentWallet(r);const row=(await db.query('SELECT * FROM offers WHERE id=$1',[idOf(r)])).rows[0];if(!row||!row.signature||row.terms.customer!==wallet)throw new ApiError(403,'OFFER_ACCESS_DENIED');const terms=offerData(row.terms,config.offers).message;await chain().simulateContract({account:wallet,address:config.offers,abi:offersRedemptionAbi,functionName:'redeem',args:[terms,row.signature]});return tx(config.offers,encodeFunctionData({abi:offersRedemptionAbi,functionName:'redeem',args:[terms,row.signature]}));});
 app.post('/v1/webhooks',async r=>{
  if(!process.env.WEBHOOK_ENCRYPTION_KEY)throw new ApiError(503,'WEBHOOKS_NOT_CONFIGURED');const input=z.strictObject({merchantId:z.uuid(),url:z.url(),deadline:z.number().int(),nonce:z.uuid(),signature:sig}).parse(r.body);const wallet=await currentWallet(r);await merchantFor(wallet,input.merchantId);
  try{webhookUrl(input.url);}catch{throw new ApiError(400,'INVALID_WEBHOOK_URL');}if(input.deadline<now()||input.deadline>now()+600)throw new ApiError(400,'INVALID_DEADLINE');
  const message=`MezoLoop webhook\nChain: 31611\nMerchant: ${input.merchantId}\nURL: ${input.url}\nNonce: ${input.nonce}\nDeadline: ${input.deadline}`;
  if(!await c.verifier.verifyMessage({address:wallet,message,signature:input.signature}))throw new ApiError(401,'INVALID_SIGNATURE');
  const secret=randomBytes(32).toString('hex');const result=await db.query('INSERT INTO webhooks(id,merchant_id,url,secret) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[input.nonce,input.merchantId,input.url,encryptSecret(secret)]);if(!result.rows.length)throw new ApiError(409,'NONCE_USED');return {id:input.nonce,secret};
 });
 app.get('/v1/webhooks',async r=>({webhooks:(await db.query('SELECT w.id,w.url,w.active,w.merchant_id FROM webhooks w JOIN merchants m ON m.id=w.merchant_id WHERE m.owner_wallet=$1',[await currentWallet(r)])).rows}));
 app.delete('/v1/webhooks/:id',async r=>{const row=await owned(r,'webhooks');await db.query('UPDATE webhooks SET active=false WHERE id=$1',[row.id]);return {id:row.id,active:false};});
}
