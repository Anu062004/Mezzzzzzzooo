import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {PGlite} from '@electric-sql/pglite';
import {createWalletClient,http,erc20Abi,verifyMessage,verifyTypedData,type Address,type Hex} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {buildApp} from '../apps/api/src/app.js';
import {configFromEnv} from '../apps/api/src/config.js';
import {indexContract} from '../apps/worker/src/indexer.js';
import {chainClient} from '../packages/chain/client.js';
import {paymentRouterAbi,partnershipRegistryAbi} from '../packages/chain/abi.js';
import {MUSD,ZERO,mezoTestnet,typedQuote} from '../packages/chain/index.js';
import type {Database} from '../packages/db/index.js';

// All keys are generated in memory and funded only on this disposable local chain.
// No environment file, hosted database, or external RPC is used.
test('local payment settles through API, wallet, contracts and indexer; restart and reorg recover', {timeout:60000},async t=>{
 const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 const node=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31611','--silent'],{stdio:'ignore'});
 let spawnError:Error|undefined;node.on('error',e=>{spawnError=e;});t.after(()=>{node.kill('SIGTERM');});
 const rpcUrl=`http://127.0.0.1:${port}`;
 async function rpc(method:string,params:unknown[]=[]):Promise<any>{const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const result=await response.json() as any;if(result.error)throw new Error(result.error.message);return result.result;}
 let ready=false;for(let i=0;i<100;i++){if(spawnError)throw spawnError;try{await rpc('eth_chainId');ready=true;break;}catch{await delay(50);}}assert.ok(ready,'Local Anvil RPC must start');
 const merchant=privateKeyToAccount(generatePrivateKey()),payer=privateKeyToAccount(generatePrivateKey());
 for(const account of [merchant,payer])await rpc('anvil_setBalance',[account.address,'0x56BC75E2D63100000']);
 const wallet=(account:typeof merchant)=>createWalletClient({account,chain:mezoTestnet,transport:http(rpcUrl)});
 const config=configFromEnv({DATABASE_URL:'postgres://unused',PUBLIC_APP_URL:'http://localhost:3000',MEZO_RPC_HTTP:rpcUrl,CONFIRMATIONS:'3',FINALITY_CONFIRMATIONS:'4'});
 const client=chainClient(config);
 const artifact=async(name:string)=>(JSON.parse(await readFile(new URL(`../contracts/out/${name}.json`,import.meta.url),'utf8')));
 const mock=await artifact('Protocol.t.sol/MockToken');
 const deployedToken=await client.waitForTransactionReceipt({hash:await wallet(merchant).deployContract({abi:mock.abi,bytecode:mock.bytecode.object})});
 const code=await client.getCode({address:deployedToken.contractAddress!});assert.ok(code);
 await rpc('anvil_setCode',[MUSD,code]);
 await client.waitForTransactionReceipt({hash:await wallet(merchant).writeContract({address:MUSD,abi:mock.abi,functionName:'mint',args:[payer.address,100n*10n**18n]})});
 const routerArtifact=await artifact('PaymentRouter.sol/PaymentRouter');
 const deployedRouter=await client.waitForTransactionReceipt({hash:await wallet(merchant).deployContract({abi:routerArtifact.abi,bytecode:routerArtifact.bytecode.object,args:[MUSD]})});
 const router=deployedRouter.contractAddress!.toLowerCase() as Address;config.router=router;config.startBlock=deployedRouter.blockNumber;
 const pg=new PGlite();t.after(()=>pg.close());
 for(const name of ['001_initial','002_protocol'])await pg.exec(await readFile(new URL(`../packages/db/${name}.sql`,import.meta.url),'utf8'));
 // PGlite has one connection; PostgreSQL advisory locks are unnecessary in this test.
 const adapt=(queryable:any):Database=>({query:async(sql,params)=>sql.startsWith('SELECT pg_advisory_xact_lock(')?{rows:[]}:queryable.query(sql,params),transaction:async fn=>pg.transaction(tx=>fn(adapt(tx)))});
 const db=adapt(pg),app=await buildApp(db,config,{verifyMessage,verifyQuote:verifyTypedData},false,client);t.after(()=>app.close());
 const headers={origin:config.origin};
 async function login(account:typeof merchant){const challenge=(await app.inject({method:'POST',url:'/v1/auth/challenge',headers,payload:{address:account.address,chainId:31611}})).json();const result=await app.inject({method:'POST',url:'/v1/auth/verify',headers,cookies:{ml_challenge:challenge.challengeId},payload:{challengeId:challenge.challengeId,signature:await account.signMessage({message:challenge.message})}});assert.equal(result.statusCode,200,result.body);return {ml_session:result.cookies.find(c=>c.name==='ml_session')!.value};}
 const ownerCookies=await login(merchant),payerCookies=await login(payer);
 const business=(await app.inject({method:'POST',url:'/v1/merchants',headers,cookies:ownerCookies,payload:{name:'Local Coffee'}})).json();
 const created=await app.inject({method:'POST',url:'/v1/orders',headers:{...headers,'idempotency-key':'local-sale'},cookies:ownerCookies,payload:{merchantId:business.id,amountAtomic:'20000000000000000000',partner:ZERO,referralBps:0,cashbackBps:500,expiresAt:new Date(Math.floor(Date.now()/1000)*1000+3600000).toISOString().replace('.000Z','Z')}});assert.equal(created.statusCode,201,created.body);
 const order=created.json(),path=`/v1/orders/${order.id}`;
 const authorized=await app.inject({method:'POST',url:`${path}/authorize`,headers,cookies:ownerCookies,payload:{signature:await merchant.signTypedData(typedQuote(order.terms,router))}});assert.equal(authorized.statusCode,200,authorized.body);
 const prepare=async()=>{const result=await app.inject({method:'POST',url:`${path}/prepare`,headers,cookies:payerCookies});assert.equal(result.statusCode,200,result.body);return result.json();};
 const first=await prepare();assert.ok(first.approval);
 const send=async(tx:any)=>{const hash=await wallet(payer).sendTransaction({to:tx.to,data:tx.data,value:0n});await client.waitForTransactionReceipt({hash});return hash;};
 await send(first.approval);const approved=await prepare();assert.equal(approved.approval,null);
 const snapshot=await rpc('evm_snapshot');
 const hash=await send(approved.payment);
 assert.equal((await app.inject({method:'POST',url:`${path}/transactions`,headers,cookies:payerCookies,payload:{txHash:hash}})).statusCode,202);
 const status=async()=>(await app.inject({url:`${path}/status`})).json();
 assert.equal((await status()).settlementVerified,false);
 await indexContract(db,client,config,router,paymentRouterAbi);assert.equal((await status()).status,'observed');
 const attempt=(await app.inject({url:`${path}/attempt`,cookies:payerCookies})).json().attempt;assert.equal(attempt.state,'included');assert.equal(attempt.retryAllowed,false);
 // Scanning a different contract must not promote this payment before checking its chain history.
 await rpc('anvil_mine',['0x2']);
 await indexContract(db,client,config,merchant.address,partnershipRegistryAbi);assert.equal((await status()).status,'observed');
 await indexContract(db,client,config,router,paymentRouterAbi);
 let paid=await status();assert.equal(paid.status,'confirmed');assert.equal(paid.settlementVerified,true);assert.equal(paid.transactionHash,hash);
 assert.equal(await client.readContract({address:MUSD,abi:erc20Abi,functionName:'balanceOf',args:[merchant.address]}),19n*10n**18n);
 assert.equal(await client.readContract({address:MUSD,abi:erc20Abi,functionName:'balanceOf',args:[payer.address]}),81n*10n**18n);
 assert.equal(await client.readContract({address:MUSD,abi:erc20Abi,functionName:'balanceOf',args:[router]}),0n);
 const receipts=(await app.inject({url:'/v1/receipts',cookies:payerCookies})).json().receipts;assert.equal(receipts.length,1);
 await indexContract(db,client,config,router,paymentRouterAbi);assert.equal((await db.query('SELECT * FROM chain_events WHERE canonical')).rows.length,1);
 // Revert the chain, then build a longer replacement branch without the payment.
 await rpc('evm_revert',[snapshot]);
 await assert.rejects(indexContract(db,client,config,router,paymentRouterAbi),/RPC behind indexer cursor/);
 assert.equal((await status()).settlementVerified,true); // lag alone is not evidence of a reorg
 await rpc('evm_increaseTime',[60]);await rpc('anvil_mine',['0x4']);
 await indexContract(db,client,config,router,paymentRouterAbi);
 assert.equal((await status()).settlementVerified,false);assert.equal((await status()).status,'submitted');
 assert.equal((await app.inject({url:'/v1/receipts',cookies:payerCookies})).json().receipts.length,0);
 assert.equal((await db.query('SELECT * FROM chain_events WHERE canonical')).rows.length,0);
 // A new valid inclusion is projected once, with the new block hash.
 const replacement=await send(approved.payment);await rpc('anvil_mine',['0x3']);await indexContract(db,client,config,router,paymentRouterAbi);
 paid=await status();assert.equal(paid.status,'final');assert.equal(paid.transactionHash,replacement);
 assert.equal((await app.inject({url:'/v1/receipts',cookies:payerCookies})).json().receipts.length,1);
});
