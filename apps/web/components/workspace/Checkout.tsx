'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {encodeFunctionData,erc20Abi,type Hex} from 'viem';
import {paymentRouterAbi,subscriptionManagerAbi} from '../../../../packages/chain/abi';
import {MUSD,typedQuote,split} from '../../../../packages/chain/index';
import {planData} from '../../../../packages/chain/terms';
import {useWallet,type Transaction} from './Wallet';
import {Shell,Heading,Panel,Empty,ResourceState,Status,useResource,Copy,WalletHelp} from './UI';
import {usePaymentStatus} from './PaymentStatus';
import {api,post,errorMessage} from '../../lib/api';
import {paymentKey,readPayment,savePayment,type PendingPayment} from '../../lib/payment';
import {money,dateTime,short} from '../../lib/format';
function assertTransaction(actual:Transaction,expected:Transaction){if(actual.chainId!==expected.chainId||actual.to.toLowerCase()!==expected.to.toLowerCase()||actual.data.toLowerCase()!==expected.data.toLowerCase()||actual.value!==expected.value)throw new Error('Prepared transaction does not match the terms you reviewed.');}
const transaction=(to:`0x${string}`,data:`0x${string}`):Transaction=>({chainId:31611,to,data,value:'0'});
export default function Checkout({id,subscription=false}:{id:string;subscription?:boolean}){
 const wallet=useWallet(),[revision,setRevision]=useState(0),[pending,setPending]=useState<PendingPayment|null>(null);
 const [recoveryReady,setRecoveryReady]=useState(false),[recoveryError,setRecoveryError]=useState(''),[storageError,setStorageError]=useState('');
 const [attempt,setAttempt]=useState<{hash:Hex;state:string;retryAllowed:boolean}|null>(null),[attemptError,setAttemptError]=useState(''),[stage,setStage]=useState('');
 const key=paymentKey(id,subscription);
 const record=useResource(subscription?`/subscriptions/plans/${id}`:`/orders/${id}`,revision);
 const paymentStatus=usePaymentStatus(subscription?null:id,revision),status=paymentStatus.data;
 useEffect(()=>{setPending(readPayment(key));setRecoveryReady(true);},[key]);
 // Another tab may submit the same checkout. Keep its transaction visible here.
 useEffect(()=>{const sync=(event:StorageEvent)=>{if(event.key===key)setPending(readPayment(key));};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[key]);
 const order=record.data,terms=order?.terms;
 const settled=status?.settlementVerified===true;
 const currentStatus=status?.status||order?.status;
 const ownPending=pending?.payer.toLowerCase()===wallet.address?.toLowerCase();
 const canRetry=ownPending&&attempt?.hash===pending?.hash&&attempt?.retryAllowed===true&&!attemptError;
 const expired=terms&&Number(subscription?terms.expiresAt:terms.deadline)*1000<=Date.now();
 const waiting=!canRetry&&(Boolean(pending)||['submitted','observed','uncertain'].includes(currentStatus));
 const maximum=terms&&subscription?BigInt(terms.amount)*BigInt(terms.maxCharges):0n;
 const breakdown=terms?split(terms.amount,terms.referralBps,terms.cashbackBps):null;
 function remember(value:PendingPayment){setPending(value);if(!savePayment(key,value))setStorageError('Your browser could not save this transaction. Copy its hash before closing the page.');}
 useEffect(()=>{
  if(subscription||!wallet.address||settled)return;
  let active=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function poll(){
   try{const result=await api(`/orders/${id}/attempt`,{signal:controller.signal});if(active){setAttempt(result.attempt);setAttemptError('');if(result.attempt)setPending(previous=>previous||{hash:result.attempt.hash,payer:result.attempt.payer,registered:true});}}
   catch(e){if(active)setAttemptError(errorMessage(e));}
   if(active)timer=setTimeout(poll,5000);
  }
  void poll();return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[id,subscription,wallet.address,settled,revision]);
 useEffect(()=>{
  if(subscription||!ownPending||!pending||pending.registered||settled)return;
  let active=true;
  post(`/orders/${id}/transactions`,{txHash:pending.hash}).then(()=>{if(active){const saved={...pending,registered:true};setPending(saved);savePayment(key,saved);setRecoveryError('');setRevision(v=>v+1);}}).catch(e=>{if(active)setRecoveryError(errorMessage(e));});
  return()=>{active=false;};
 },[id,subscription,ownPending,pending,settled,revision,key]);
 async function submitted(hash:Hex){
  // Persist immediately after broadcast, before any network request or receipt wait.
  remember({hash,payer:wallet.address!,registered:subscription});setAttempt(null);setStage('Waiting for confirmation');
 }
 async function pay(){
  if(!wallet.network?.settlementEnabled||!wallet.network.router)throw new Error('Payments are not enabled yet.');
  const saved=readPayment(key);if(saved&&saved.hash!==pending?.hash)throw new Error('A payment was submitted in another tab. Refresh its status before continuing.');
  const fresh=await api(subscription?`/subscriptions/plans/${id}`:`/orders/${id}`);
  if(!subscription){
   const recovered=await api(`/orders/${id}/attempt`);
   if(recovered.attempt&&!recovered.attempt.retryAllowed){remember({hash:recovered.attempt.hash,payer:recovered.attempt.payer,registered:true});throw new Error('A previous payment still needs confirmation. Check its transaction before trying again.');}
  }
  if(JSON.stringify(fresh.terms)!==JSON.stringify(terms))throw new Error('The payment terms changed. Refresh and review them again.');
  if(!subscription&&(fresh.router?.toLowerCase()!==wallet.network.router.toLowerCase()||fresh.token?.toLowerCase()!==MUSD||fresh.chainId!==31611))throw new Error('Unexpected payment network or token.');
  const router=wallet.network.router;
  try{
   setStage('Checking payment');
   if(subscription){
    const manager=wallet.network.subscriptionManager;if(!manager)throw new Error('Subscriptions are not enabled.');
    const prepared=await post(`/subscriptions/plans/${id}/subscribe`);
    const expectedApproval=transaction(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,maximum]}));
    const expectedPayment=transaction(manager,encodeFunctionData({abi:subscriptionManagerAbi,functionName:'subscribe',args:[planData(terms,manager).message,fresh.signature]}));
    assertTransaction(prepared.approval,expectedApproval);assertTransaction(prepared.payment,expectedPayment);
    if(prepared.maximumTotalAtomic!==maximum.toString())throw new Error('Unexpected subscription spending limit.');
    setStage('Approve MUSD');await wallet.send(prepared.approval,`Approve a maximum of ${money(maximum)} MUSD`);
    setStage('Authorize subscription');await wallet.send(prepared.payment,`Start ${money(terms.amount)} MUSD recurring payments`,submitted);
   }else{
    let prepared=await post(`/orders/${id}/prepare`);
    const expectedApproval=transaction(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,BigInt(terms.amount)]}));
    const expectedPayment=transaction(router,encodeFunctionData({abi:paymentRouterAbi,functionName:'pay',args:[typedQuote(terms,router).message,fresh.merchantSignature]}));
    assertTransaction(prepared.payment,expectedPayment);
    if(prepared.approval){assertTransaction(prepared.approval,expectedApproval);setStage('Approve MUSD');await wallet.send(prepared.approval,`Approve exactly ${money(terms.amount)} MUSD`);prepared=await post(`/orders/${id}/prepare`);if(prepared.approval)throw new Error('Approval is not visible yet. Wait for confirmation, then try again.');assertTransaction(prepared.payment,expectedPayment);}
    setStage('Confirm payment');await wallet.send(prepared.payment,`Pay ${money(terms.amount)} MUSD`,submitted);
   }
  }finally{setStage('');setRevision(v=>v+1);}
 }
 async function downloadReceipt(){
  const receipt=await api(`/orders/${id}/status`);
  if(!receipt.settlementVerified)throw new Error('This payment is no longer confirmed. Refresh its status before saving a receipt.');
  const blob=new Blob([JSON.stringify({receiptVersion:1,network:'Mezo Testnet',chainId:31611,orderId:id,merchant:order.merchant||{owner_wallet:terms.merchant},token:MUSD,terms,...receipt},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`mezoloop-receipt-${id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const step=settled?3:waiting?2:wallet.address?1:0;
 return <Shell role="customer" tab={subscription?'Subscription review':'Payment review'}><div className="checkout-summary">
  <Heading title={settled?'Payment confirmed.':subscription?'Recurring, on your terms.':order?.merchant?.name?`Pay ${order.merchant.name}`:'Review your payment'} description={subscription?'Review the maximum amount and schedule before giving consent.':'Pay in MUSD on Mezo Testnet. Your cashback returns to your wallet automatically.'}/>
  <ol className="payment-steps" aria-label="Payment progress">{['Connect wallet','Review & authorize','Confirmation'].map((label,index)=><li key={label} data-complete={step>index} aria-current={step===index?'step':undefined}><span>{step>index?'✓':index+1}</span>{label}</li>)}</ol>
  <ResourceState {...record}/>{!order&&pending&&<Panel title="Your submitted transaction" description="The checkout service is unavailable. Your saved transaction reference is still accessible."><p className="address-text">{pending.hash}</p><div className="action-row"><a className="w-button" href={`https://explorer.test.mezo.org/tx/${pending.hash}`} target="_blank" rel="noreferrer">Track transaction ↗</a><Copy text={pending.hash} label="Copy transaction hash"/><button className="w-button" onClick={()=>setRevision(v=>v+1)}>Refresh status</button></div></Panel>}{order&&<Panel title={subscription?'Subscription plan':settled?'Payment receipt':'Your checkout'} description={`Reference ${id}`}>
   {!subscription&&<Status value={currentStatus}/>}<div className="checkout-total">{money(terms.amount)} <small>MUSD{subscription?' / charge':''}</small></div>
   <dl>{order.merchant?.name&&<><dt>Business</dt><dd>{order.merchant.name}</dd></>}<dt>Merchant wallet</dt><dd className="address-text">{terms.merchant}</dd><dt>Network</dt><dd>Mezo Testnet</dd><dt>Merchant receives</dt><dd>{money(breakdown!.merchantAtomic)} MUSD</dd><dt>Referral share</dt><dd>{money(breakdown!.referralAtomic)} MUSD</dd>{terms.referralBps>0&&<><dt>Referral partner</dt><dd className="address-text">{terms.partner}</dd></>}<dt>Your cashback</dt><dd>{money(breakdown!.cashbackAtomic)} MUSD</dd><dt>Platform fee</dt><dd>0 MUSD</dd>{subscription&&<><dt>Billing interval</dt><dd>{Number(terms.interval)/86400} days</dd><dt>Maximum charges</dt><dd>{terms.maxCharges}</dd><dt>Maximum total authorized</dt><dd>{money(maximum)} MUSD</dd><dt>First charge eligible</dt><dd>{dateTime(Number(terms.startsAt))}</dd></>}<dt>{subscription?'Authorization expires':'Checkout expires'}</dt><dd>{dateTime(Number(subscription?terms.expiresAt:terms.deadline))}</dd></dl><div className="w-divider"/>
   {paymentStatus.error&&<div role="alert" className="w-alert">Unable to refresh payment status. {paymentStatus.error} The last known status is shown below.</div>}
   {storageError&&<div role="alert" className="w-alert">{storageError}</div>}
   {settled?<>
    <div role="status" className="w-notice">Payment verified on-chain. {money(status.settlement?.cashbackAtomic||'0')} MUSD cashback was sent to the paying wallet.</div>
    <dl><dt>Paid by</dt><dd className="address-text">{status.settlement?.payer}</dd><dt>Transaction</dt><dd className="address-text">{status.transactionHash}</dd><dt>Block</dt><dd>{status.blockNumber}</dd></dl>
    <div className="action-row">{status.explorerUrl&&<a className="w-button" href={status.explorerUrl} target="_blank" rel="noreferrer">View on-chain receipt ↗</a>}<button className="w-button" disabled={Boolean(wallet.busy)||Boolean(paymentStatus.error)} onClick={()=>void wallet.run('Saving receipt',downloadReceipt)}>Download receipt</button><button className="w-button" disabled={Boolean(paymentStatus.error)} onClick={()=>window.print()}>Print receipt</button></div>
   </>:waiting?<>
    <div role="status" className="w-notice">{subscription?'Subscription transaction submitted. Your subscription appears after indexing.':'Payment is pending confirmation. A submitted transaction is not yet a verified receipt.'} You can return to this link to check progress.</div>
    {pending&&<><p className="muted">{ownPending&&attempt?.hash===pending.hash&&attempt.state==='included'?'Your transaction is included on-chain. Waiting for the payment service to verify settlement.':'Keep this transaction reference until confirmation.'}</p><p className="address-text">{pending.hash}</p><div className="action-row"><a className="w-button" href={`https://explorer.test.mezo.org/tx/${pending.hash}`} target="_blank" rel="noreferrer">Track transaction ↗</a><Copy text={pending.hash} label="Copy transaction hash"/></div></>}
    {recoveryError&&<div role="alert" className="w-alert">Your transaction was submitted, but the payment service has not saved its reference yet. {recoveryError} Use Refresh status to retry recording it; this does not send another payment.</div>}
    {attemptError&&<div role="alert" className="w-alert">Unable to check your wallet transaction. {attemptError}</div>}
    {pending&&!wallet.address&&<button className="w-button primary" onClick={wallet.connect} disabled={Boolean(wallet.busy)}>Reconnect to recover payment</button>}
    {pending&&wallet.address&&!ownPending&&<p className="muted">This browser saved a payment from {short(pending.payer)}. Connect that wallet to recover its submission.</p>}
    {subscription&&<Link className="workspace-link" href="/customer">View your subscriptions ↗</Link>}
   </>:expired?<Empty title="This request has expired">Ask the merchant for a new {subscription?'subscription link':'checkout'}.</Empty>:['cancelled','reverted'].includes(currentStatus)?<div className="w-alert">This checkout is {currentStatus}. Ask the merchant for a new payment request.</div>:<>
    {canRetry&&<div role="status" className="w-notice">Your previous payment reverted on-chain. No MUSD was transferred by that payment. You can review and try again; network fees may still apply.</div>}
    <p>{subscription?'Your wallet may request two confirmations: a bounded MUSD allowance, then subscription consent. Cancel future billing from your subscriptions.':'First, allow this exact amount of MUSD if needed. Then confirm the payment in your wallet. Network fees are paid separately in test BTC.'}</p>
    {stage&&<p role="status" className="payment-stage">{stage}…</p>}
    {wallet.address?<button className="w-button primary" disabled={!recoveryReady||Boolean(wallet.busy)||!wallet.network?.settlementEnabled} onClick={()=>void wallet.run(subscription?'Authorizing subscription':'Processing payment',pay)}>{subscription?'Review and authorize subscription':`Review and pay ${money(terms.amount)} MUSD`}</button>:<button className="w-button primary" disabled={Boolean(wallet.busy)} onClick={wallet.connect}>Connect wallet to continue</button>}
    {wallet.address&&!wallet.network?.settlementEnabled&&<p className="muted">Payments will be available when the testnet contracts are connected.</p>}
    <WalletHelp/>
   </>}
   <div className="action-row"><button className="w-button" onClick={()=>setRevision(v=>v+1)} disabled={Boolean(wallet.busy)}>Refresh status</button><Link className="w-button" href="/customer">Your account ↗</Link></div>
  </Panel>}
 </div></Shell>;
}
export function MerchantStore({id}:{id:string}){const record=useResource(`/merchants/${id}`);return <Shell role="customer" tab="Merchant"><div className="checkout-summary"><Heading title={record.data?.merchant.name||'Merchant checkouts'} description="Choose an available signed checkout. Review the exact payment terms before signing."/><ResourceState {...record}/>{record.data&&<Panel title="Available checkouts" description={`Receiving wallet: ${record.data.merchant.owner_wallet}`}>{record.data.orders.length?record.data.orders.map((o:any)=><article className="receipt-row" key={o.id}><h3>{money(o.terms.amount)} MUSD</h3><p>{o.terms.cashbackBps/100}% cashback · Expires {dateTime(o.expiresAt)}</p><Link className="w-button primary" href={`/pay/${o.id}`}>Review checkout {short(o.id)} ↗</Link></article>):<Empty title="No open checkouts">Ask this merchant to create and sign a checkout for your purchase.</Empty>}</Panel>}</div></Shell>;}
