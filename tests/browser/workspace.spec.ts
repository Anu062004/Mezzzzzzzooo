import {test,expect,type Page} from '@playwright/test';
import {encodeFunctionData,erc20Abi} from 'viem';
import {typedQuote,MUSD,ZERO} from '../../packages/chain/index.js';
import {paymentRouterAbi,subscriptionManagerAbi} from '../../packages/chain/abi.js';
import {planData} from '../../packages/chain/terms.js';
const merchant='0x1111111111111111111111111111111111111111',router='0x3333333333333333333333333333333333333333';
const merchantId='11111111-1111-4111-8111-111111111111',orderId='22222222-2222-4222-8222-222222222222';
const manager='0x4444444444444444444444444444444444444444';
const planTerms={merchant,partner:ZERO,amount:'20000000000000000000',referralBps:0,cashbackBps:500,interval:'2592000',startsAt:String(Math.floor(Date.now()/1000)),expiresAt:String(Math.floor(Date.now()/1000)+90*86400),maxCharges:'3',nonce:`0x${'03'.repeat(32)}`};
const hash=`0x${'ab'.repeat(32)}`;
const safe=(data:any)=>JSON.parse(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v));
function order(){const terms={orderId:`0x${'01'.repeat(32)}` as `0x${string}`,merchant,token:MUSD,amount:'20000000000000000000',partner:ZERO,referralBps:0,cashbackBps:500,deadline:String(Math.floor(Date.now()/1000)+3600)};return {id:orderId,merchantId,chainId:31611,token:MUSD,router,status:'quoted',expiresAt:new Date(Number(terms.deadline)*1000).toISOString(),quoteHash:`0x${'02'.repeat(32)}`,terms,typedData:safe(typedQuote(terms as any,router)),merchantSignature:'0x1234',settlement:{merchantAtomic:'19000000000000000000',cashbackAtomic:'1000000000000000000',referralAtomic:'0'},settlementVerified:false};}
async function fixture(page:Page,{signedIn=true,hasMerchant=true,rejectSignature=false,wrongPayment=false}={}){
 let authenticated=signedIn;let profile=hasMerchant;let current=order();let created=false;let approved=false;let submitted=false;let creates=0;
 await page.addInitScript(({account,txHash,reject})=>{
  const events:Record<string,Function[]>={};
  (window as any).walletCalls=[];(window as any).rejectSignature=reject;
  (window as any).ethereum={on:(e:string,fn:Function)=>(events[e]??=[]).push(fn),removeListener:()=>{},request:async({method,params}:any)=>{
   (window as any).walletCalls.push({method,params});
   if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];if(method==='eth_chainId')return '0x'+(31611).toString(16);
   if(method==='personal_sign')return '0x1234';
   if(method==='eth_signTypedData_v4'){if((window as any).rejectSignature){const e:any=new Error('User rejected request');e.code=4001;throw e;}return '0x1234';}
   if(method==='eth_sendTransaction')return txHash;
   if(method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:txHash};
   if(method==='eth_call'||method==='eth_getBalance')return '0x'+(20n*10n**18n).toString(16);
   throw new Error('Unexpected RPC '+method);
  }};(window as any).changeWallet=()=>events.accountsChanged?.forEach(fn=>fn(['0x2222222222222222222222222222222222222222']));
 },{account:merchant,txHash:hash,reject:rejectSignature});
 await page.route('**/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.replace('/v1',''),method=req.method();const send=(data:any,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(safe(data))});
  if(path==='/network')return send({chainId:31611,token:MUSD,router,subscriptionManager:'0x4444444444444444444444444444444444444444',registry:null,rewardsVault:null,offers:null,settlementEnabled:true});
  if(path==='/auth/session')return authenticated?send({address:merchant,chainId:31611}):send({error:{code:'AUTH_REQUIRED'}},401);
  if(path==='/auth/challenge')return send({challengeId:merchantId,message:`Sign in\nURI: ${new URL(req.url()).origin}\nChain ID: 31611\n`});
  if(path==='/auth/verify'){authenticated=true;return send({address:merchant,chainId:31611});}
  if(path==='/auth/logout'){authenticated=false;return route.fulfill({status:204});}
  if(path==='/merchants'&&method==='POST'){profile=true;return send({id:merchantId,name:req.postDataJSON().name},201);}
  if(path==='/merchants')return send({merchants:profile?[{id:merchantId,name:'Loop Coffee',owner_wallet:merchant}]:[]});
  if(path.endsWith('/analytics'))return send({payments:0,customers:0,gross:'0',revenue:'0',commissions:'0',cashback:'0'});
  if(path===`/merchants/${merchantId}/orders`)return send({orders:created?[current]:[]});
  if(path==='/orders'&&method==='POST'){creates++;const body=req.postDataJSON();current={...current,status:'created',merchantSignature:null as any,terms:{...current.terms,amount:body.amountAtomic,referralBps:body.referralBps,cashbackBps:body.cashbackBps,partner:body.partner}};current.typedData=safe(typedQuote(current.terms as any,router));created=true;return send(current,201);}
  if(path.endsWith('/authorize')){current={...current,status:'quoted',merchantSignature:'0x1234'};return send(current);}
  if(path===`/orders/${orderId}`)return send(current);
  if(path.endsWith('/status'))return send({status:submitted?'submitted':'quoted',settlementVerified:false,settlement:null});
  if(path===`/orders/${orderId}/prepare`){const payment={chainId:31611,to:router,value:'0',data:encodeFunctionData({abi:paymentRouterAbi,functionName:'pay',args:[typedQuote({...current.terms,amount:wrongPayment?'21000000000000000000':current.terms.amount} as any,router).message,'0x1234']})};const approval=approved?null:{chainId:31611,to:MUSD,value:'0',data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,BigInt(current.terms.amount)]})};approved=true;return send({approval,payment,amountAtomic:current.terms.amount});}
  if(path.endsWith('/transactions')){submitted=true;return send({status:'pending',settlementVerified:false},202);}
  if(path===`/subscriptions/plans/${orderId}`)return send({id:orderId,terms:planTerms,signature:'0x1234'});
  if(path===`/subscriptions/plans/${orderId}/subscribe`)return send({maximumTotalAtomic:'60000000000000000000',approval:{chainId:31611,to:MUSD,value:'0',data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,60n*10n**18n]})},payment:{chainId:31611,to:manager,value:'0',data:encodeFunctionData({abi:subscriptionManagerAbi,functionName:'subscribe',args:[planData(planTerms,manager).message,'0x1234']})}});
  if(path==='/receipts')return send({receipts:[]});if(path==='/campaigns')return send({campaigns:[]});if(path==='/subscriptions')return send({subscriptions:[]});if(path==='/offers')return send({offers:[]});if(path==='/partnerships')return send({partnerships:[]});if(path==='/partner/sales')return send({sales:[]});if(path.endsWith('/plans'))return send({plans:[]});if(path==='/webhooks')return send({webhooks:[]});
  return send({error:{code:'NOT_FOUND'}},404);
 });
 return {creates:()=>creates,submitted:()=>submitted};
}
test('merchant onboarding signs in, saves profile, and authorizes a checkout QR',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const state=await fixture(page,{signedIn:false,hasMerchant:false});await page.goto('/merchant');
 await page.getByRole('button',{name:'Connect and sign in'}).click();await page.getByLabel('Business name').fill('Loop Coffee');await page.getByRole('button',{name:'Create merchant',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Checkouts',exact:true}).click();await page.getByLabel('Purchase amount · MUSD').fill('20');await page.getByRole('button',{name:'Create and sign checkout'}).click();
 await expect(page.getByAltText('Checkout QR code')).toBeVisible();await expect(page.getByRole('link',{name:'Open link'})).toHaveAttribute('href',new RegExp(`/pay/${orderId}$`));expect(state.creates()).toBe(1);expect(errors).toEqual([]);
});
test('rejected merchant signature leaves a resumable draft without duplicating the order',async({page})=>{
 const state=await fixture(page,{rejectSignature:true});await page.goto('/merchant');await page.getByRole('navigation').getByRole('button',{name:'Checkouts',exact:true}).click();await page.getByLabel('Purchase amount · MUSD').fill('20');await page.getByRole('button',{name:'Create and sign checkout'}).click();await expect(page.locator('.w-alert[role=alert]')).toContainText('cancelled');
 await page.evaluate(()=>{(window as any).rejectSignature=false;});await page.getByRole('button',{name:'Sign saved checkout'}).click();await expect(page.getByAltText('Checkout QR code')).toBeVisible();expect(state.creates()).toBe(1);
});
test('customer reviews exact approval and payment, then remains pending until reconciliation',async({page})=>{
 const state=await fixture(page);await page.goto(`/pay/${orderId}`);await page.getByRole('button',{name:'Review and pay 20 MUSD'}).click();
 await expect(page.getByRole('dialog')).toContainText('Allow 20 MUSD');await page.getByRole('button',{name:'Continue in wallet'}).click();await expect(page.getByRole('dialog')).toContainText('Pay 20 MUSD');await page.getByRole('button',{name:'Continue in wallet'}).click();
 await expect(page.locator('#workspace-main').getByText('Payment is pending confirmation.',{exact:false})).toBeVisible();expect(state.submitted()).toBe(true);await expect(page.getByRole('heading',{name:'Payment confirmed.'})).toHaveCount(0);
 const calls=await page.evaluate(()=>(window as any).walletCalls.filter((c:any)=>c.method==='eth_sendTransaction'));expect(calls).toHaveLength(2);expect(calls[0].params[0].to.toLowerCase()).toBe(MUSD);expect(calls[1].params[0].to.toLowerCase()).toBe(router);
});
test('tampered prepared calldata cannot reach the wallet',async({page})=>{
 await fixture(page,{wrongPayment:true});await page.goto(`/pay/${orderId}`);await page.getByRole('button',{name:'Review and pay 20 MUSD'}).click();await expect(page.locator('.w-alert[role=alert]')).toContainText('does not match');expect(await page.evaluate(()=>(window as any).walletCalls.filter((c:any)=>c.method==='eth_sendTransaction').length)).toBe(0);
});
test('account changes revoke the visible session; scanner rejects foreign payment links',async({page})=>{
 await fixture(page);await page.goto('/customer');await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();await page.evaluate(()=>(window as any).changeWallet());await expect(page.getByRole('button',{name:'Connect and sign in'})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Pay & scan'}).click();await page.getByLabel('Checkout or subscription link').fill(`https://evil.example/pay/${orderId}`);await page.getByRole('button',{name:'Review link'}).click();await expect(page.locator('.w-alert[role=alert]')).toContainText('from this website');await expect(page).toHaveURL(/\/customer$/);
});
test('workspaces remain usable on narrow screens and show service errors honestly',async({page})=>{
 await page.route('**/v1/**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'API_NOT_CONFIGURED'}})}));
 for(const path of ['/merchant','/customer']){await page.goto(path);await expect(page.locator('.w-alert[role=alert]')).toContainText('not connected yet');for(const width of [320,375,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}}
});

test('all workspace sections load with authenticated data and fit mobile layouts',async({page},info)=>{
 await fixture(page);await page.goto('/merchant');await expect(page.getByText('Loop Coffee',{exact:true})).toBeAttached();
 for(const tab of ['Checkouts','Partners','Rewards','Subscriptions','Offers','Settings']){await page.getByRole('navigation').getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('#workspace-main h1')).toHaveText(tab);await expect(page.locator('.w-loading')).toHaveCount(0);}
 await page.getByRole('navigation').getByRole('button',{name:'Checkouts',exact:true}).click();await page.screenshot({path:info.outputPath('merchant-desktop.png'),fullPage:true});
 for(const width of [320,375,768]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
 await page.setViewportSize({width:375,height:900});await page.screenshot({path:info.outputPath('merchant-mobile.png'),fullPage:true});
 await page.goto('/customer');for(const tab of ['Receipts','Rewards','Subscriptions','Offers','Referrals']){await page.getByRole('navigation').getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('#workspace-main h1')).toHaveText(tab);await expect(page.locator('.w-loading')).toHaveCount(0);}
 await page.getByRole('navigation').getByRole('button',{name:'Overview',exact:true}).click();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:info.outputPath('customer-desktop.png'),fullPage:true});
});

test('transaction review can be cancelled before any wallet broadcast',async({page})=>{
 await fixture(page);await page.goto(`/pay/${orderId}`);await page.getByRole('button',{name:'Review and pay 20 MUSD'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();expect(await page.evaluate(()=>(window as any).walletCalls.filter((c:any)=>c.method==='eth_sendTransaction').length)).toBe(0);
});

test('subscription review requires a bounded total approval before recurring consent',async({page})=>{
 await fixture(page);await page.goto(`/subscribe/${orderId}`);await expect(page.locator('dd').filter({hasText:/^60 MUSD$/})).toBeVisible();await page.getByRole('button',{name:'Review and authorize subscription'}).click();
 await expect(page.getByRole('dialog')).toContainText('Allow 60 MUSD');await page.getByRole('button',{name:'Continue in wallet'}).click();await expect(page.getByRole('dialog')).toContainText('Start 20 MUSD recurring payments');await page.getByRole('button',{name:'Continue in wallet'}).click();await expect(page.locator('#workspace-main').getByText('Subscription transaction submitted.',{exact:false})).toBeVisible();
 const calls=await page.evaluate(()=>(window as any).walletCalls.filter((c:any)=>c.method==='eth_sendTransaction'));expect(calls).toHaveLength(2);expect(calls[1].params[0].to.toLowerCase()).toBe(manager);
});
