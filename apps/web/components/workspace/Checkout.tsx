'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {encodeFunctionData,erc20Abi} from 'viem';
import {paymentRouterAbi,subscriptionManagerAbi} from '../../../../packages/chain/abi';
import {MUSD,typedQuote,split} from '../../../../packages/chain/index';
import {planData} from '../../../../packages/chain/terms';
import {useWallet,type Transaction} from './Wallet';
import {Shell,Heading,Panel,Empty,ResourceState,Status,useResource} from './UI';
import {api,post} from '../../lib/api';
import {money,dateTime,short} from '../../lib/format';
function assertTransaction(actual:Transaction,expected:Transaction){if(actual.chainId!==expected.chainId||actual.to.toLowerCase()!==expected.to.toLowerCase()||actual.data.toLowerCase()!==expected.data.toLowerCase()||actual.value!==expected.value)throw new Error('Prepared transaction does not match the terms you reviewed.');}
const transaction=(to:`0x${string}`,data:`0x${string}`):Transaction=>({chainId:31611,to,data,value:'0'});
export default function Checkout({id,subscription=false}:{id:string;subscription?:boolean}){
 const wallet=useWallet(),[revision,setRevision]=useState(0),[submitted,setSubmitted]=useState(false),[status,setStatus]=useState<any>(null);
 const record=useResource(subscription?`/subscriptions/plans/${id}`:`/orders/${id}`,revision);
 useEffect(()=>{if(subscription)return;let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const result=await api(`/orders/${id}/status`);if(active)setStatus(result);}catch{}if(active)timer=setTimeout(poll,5000);}void poll();return()=>{active=false;clearTimeout(timer);};},[id,subscription,revision]);
 const order=record.data,terms=order?.terms;
 const settled=status?.settlementVerified===true;
 const currentStatus=status?.status||order?.status;
 const expired=terms&&Number(subscription?terms.expiresAt:terms.deadline)*1000<=Date.now();
 const maximum=terms&&subscription?BigInt(terms.amount)*BigInt(terms.maxCharges):0n;
 const breakdown=terms?split(terms.amount,terms.referralBps,terms.cashbackBps):null;
 async function pay(){
  if(!wallet.network?.settlementEnabled||!wallet.network.router)throw new Error('Payments are not enabled yet.');
  const fresh=await api(subscription?`/subscriptions/plans/${id}`:`/orders/${id}`);
  if(JSON.stringify(fresh.terms)!==JSON.stringify(terms))throw new Error('The payment terms changed. Refresh and review them again.');
  if(!subscription&&(fresh.router?.toLowerCase()!==wallet.network.router.toLowerCase()||fresh.token?.toLowerCase()!==MUSD||fresh.chainId!==31611))throw new Error('Unexpected payment network or token.');
  const router=wallet.network.router;
  if(subscription){
   const manager=wallet.network.subscriptionManager;if(!manager)throw new Error('Subscriptions are not enabled.');
   const prepared=await post(`/subscriptions/plans/${id}/subscribe`);
   const expectedApproval=transaction(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,maximum]}));
   const expectedPayment=transaction(manager,encodeFunctionData({abi:subscriptionManagerAbi,functionName:'subscribe',args:[planData(terms,manager).message,fresh.signature]}));
   assertTransaction(prepared.approval,expectedApproval);assertTransaction(prepared.payment,expectedPayment);
   if(prepared.maximumTotalAtomic!==maximum.toString())throw new Error('Unexpected subscription spending limit.');
   await wallet.send(prepared.approval,`Approve a maximum of ${money(maximum)} MUSD`);
   await wallet.send(prepared.payment,`Start ${money(terms.amount)} MUSD recurring payments`,async()=>setSubmitted(true));
  }else{
   let prepared=await post(`/orders/${id}/prepare`);
   const expectedApproval=transaction(MUSD,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[router,BigInt(terms.amount)]}));
   const expectedPayment=transaction(router,encodeFunctionData({abi:paymentRouterAbi,functionName:'pay',args:[typedQuote(terms,router).message,fresh.merchantSignature]}));
   assertTransaction(prepared.payment,expectedPayment);
   if(prepared.approval){assertTransaction(prepared.approval,expectedApproval);await wallet.send(prepared.approval,`Approve exactly ${money(terms.amount)} MUSD`);prepared=await post(`/orders/${id}/prepare`);if(prepared.approval)throw new Error('Approval is not visible yet. Wait for confirmation, then try again.');assertTransaction(prepared.payment,expectedPayment);}
   await wallet.send(prepared.payment,`Pay ${money(terms.amount)} MUSD`,async hash=>{setSubmitted(true);await post(`/orders/${id}/transactions`,{txHash:hash});});
  }
  setRevision(v=>v+1);
 }
 return <Shell role="customer" tab={subscription?'Subscription review':'Payment review'}><div className="checkout-summary"><Heading title={settled?'Payment confirmed.':subscription?'Recurring, on your terms.':'A clear payment. A shared return.'} description={subscription?'Review the maximum amount and schedule before giving consent.':'Review the merchant, amount, and exact split before your wallet signs.'}/><ResourceState {...record}/>{order&&<Panel title={subscription?'Subscription plan':'Your checkout'} description={`Reference ${id}`}>
  {!subscription&&<Status value={currentStatus}/>}<div className="checkout-total">{money(terms.amount)} <small>MUSD{subscription?' / charge':''}</small></div><dl><dt>Merchant wallet</dt><dd className="address-text">{terms.merchant}</dd><dt>Network</dt><dd>Mezo Testnet</dd><dt>Merchant receives</dt><dd>{money(breakdown!.merchantAtomic)} MUSD</dd><dt>Referral share</dt><dd>{money(breakdown!.referralAtomic)} MUSD</dd>{terms.referralBps>0&&<><dt>Referral partner</dt><dd className="address-text">{terms.partner}</dd></>}<dt>Your cashback</dt><dd>{money(breakdown!.cashbackAtomic)} MUSD</dd><dt>Platform fee</dt><dd>0 MUSD</dd>{subscription?<><dt>Billing interval</dt><dd>{Number(terms.interval)/86400} days</dd><dt>Maximum charges</dt><dd>{terms.maxCharges}</dd><dt>Maximum total authorized</dt><dd>{money(maximum)} MUSD</dd><dt>First charge eligible</dt><dd>{dateTime(Number(terms.startsAt))}</dd></>:null}<dt>{subscription?'Authorization expires':'Checkout expires'}</dt><dd>{dateTime(Number(subscription?terms.expiresAt:terms.deadline))}</dd></dl><div className="w-divider"/>
  {settled?<><div role="status" className="w-notice">The indexer has verified this payment on-chain.</div>{status.explorerUrl&&<a className="w-button" href={status.explorerUrl} target="_blank" rel="noreferrer">View on-chain receipt ↗</a>}</>:expired?<Empty title="This request has expired">Ask the merchant for a new {subscription?'subscription link':'checkout'}.</Empty>:submitted||['submitted','observed','uncertain'].includes(currentStatus)?<div role="status" className="w-notice">{subscription?'Subscription transaction submitted. Your subscription appears after indexing.':'Payment is pending confirmation. A submitted transaction is not yet a verified receipt.'}</div>:['cancelled','reverted'].includes(currentStatus)?<div className="w-alert">This checkout is {currentStatus}. Ask the merchant for a new payment request.</div>:<>
   <p>{subscription?'Your wallet may request two confirmations: a bounded MUSD allowance, then subscription consent. Cancel future billing from your subscriptions.':'Your wallet may request two confirmations: an exact MUSD allowance, then the payment. Network fees are paid separately in test BTC.'}</p>
   {wallet.address?<button className="w-button primary" disabled={Boolean(wallet.busy)||!wallet.network?.settlementEnabled} onClick={()=>{void wallet.run(subscription?'Authorizing subscription':'Processing payment',pay);}}>{subscription?'Review and authorize subscription':`Review and pay ${money(terms.amount)} MUSD`}</button>:<button className="w-button primary" disabled={Boolean(wallet.busy)} onClick={wallet.connect}>Connect wallet to continue</button>}
   {wallet.address&&!wallet.network?.settlementEnabled&&<p className="muted">Payments will be available when the testnet contracts are connected.</p>}
  </>}
  <div className="action-row"><button className="w-button" onClick={()=>setRevision(v=>v+1)} disabled={Boolean(wallet.busy)}>Refresh status</button><Link className="w-button" href="/customer">Your account ↗</Link></div>
 </Panel>}</div></Shell>;
}
export function MerchantStore({id}:{id:string}){const record=useResource(`/merchants/${id}`);return <Shell role="customer" tab="Merchant"><div className="checkout-summary"><Heading title={record.data?.merchant.name||'Merchant checkouts'} description="Choose an available signed checkout. Review the exact payment terms before signing."/><ResourceState {...record}/>{record.data&&<Panel title="Available checkouts" description={`Receiving wallet: ${record.data.merchant.owner_wallet}`}>{record.data.orders.length?record.data.orders.map((o:any)=><article className="receipt-row" key={o.id}><h3>{money(o.terms.amount)} MUSD</h3><p>{o.terms.cashbackBps/100}% cashback · Expires {dateTime(o.expiresAt)}</p><Link className="w-button primary" href={`/pay/${o.id}`}>Review checkout {short(o.id)} ↗</Link></article>):<Empty title="No open checkouts">Ask this merchant to create and sign a checkout for your purchase.</Empty>}</Panel>}</div></Shell>;}
