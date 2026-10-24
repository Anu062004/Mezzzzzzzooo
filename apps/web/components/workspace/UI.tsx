'use client';
import Link from 'next/link';
import {useEffect,useState,type ReactNode,type FormEvent} from 'react';
import {api,errorMessage} from '../../lib/api';
import {short} from '../../lib/format';
import {useWallet} from './Wallet';
export function useResource<T=any>(path:string|null,revision=0){
 const {address}=useWallet();const key=`${path}:${address}`;
 const [state,setState]=useState<{key:string;data:T|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:false});
 useEffect(()=>{if(!path)return;const controller=new AbortController();setState(previous=>({key,data:previous.key===key?previous.data:null,error:'',loading:true}));api<T>(path,{signal:controller.signal}).then(data=>setState({key,data,error:'',loading:false})).catch(e=>{if(!controller.signal.aborted)setState({key,data:null,error:errorMessage(e),loading:false});});return()=>controller.abort();},[key,path,revision]);
 return state.key===key?{data:state.data,error:state.error,loading:state.loading}:{data:null,error:'',loading:Boolean(path)};
}
export function Shell({role,tab,onTab,tabs,children}:{role:'merchant'|'customer';tab:string;onTab?:(tab:string)=>void;tabs?:string[];children:ReactNode}){
 const wallet=useWallet();
 return <div className="workspace"><a className="skip-link" href="#workspace-main">Skip to workspace</a>
  <aside className="workspace-sidebar"><Link className="workspace-brand" href="/"><img src="/brand/mezoloop-logo.png" alt="" width="52" height="52"/>MezoLoop</Link>
   <div className="workspace-role">{role==='merchant'?'Merchant workspace':'Your MezoLoop'}</div>
   <nav aria-label={`${role} navigation`}>{tabs?.map((item,i)=><button key={item} aria-current={tab===item?'page':undefined} onClick={()=>onTab?.(item)}><span aria-hidden="true">{['◫','↗','◎','◇','↻','⌑','⚙'][i]}</span>{item}</button>)}</nav>
   <div className="sidebar-bottom"><span className="network-badge"><i/>Mezo Testnet</span><p>Payments stay in your wallet.<br/>Value goes further.</p><Link href={role==='merchant'?'/customer':'/merchant'}>{role==='merchant'?'Open customer view':'Open merchant workspace'} ↗</Link><Link href="/">Back to home</Link></div>
  </aside>
  <div className="workspace-body"><header className="workspace-header"><span>{role==='merchant'?'BUSINESS':'PERSONAL'} <b>/</b> {tab}</span><div className="wallet-controls">{wallet.address?<><span className="wallet-address">{short(wallet.address)}</span><button className="w-button" disabled={Boolean(wallet.busy)} onClick={wallet.disconnect}>Sign out</button></>:<button className="w-button primary" disabled={Boolean(wallet.busy)} onClick={wallet.connect}>{wallet.busy==='Connecting wallet'?'Connecting…':'Connect wallet'}</button>}</div></header>
   <main id="workspace-main" className="workspace-content">
    {wallet.error&&<div role="alert" className="w-alert">{wallet.error}<button onClick={()=>{void wallet.run('Checking service',wallet.refresh);}} disabled={Boolean(wallet.busy)}>Retry connection</button></div>}
    {wallet.busy&&<div role="status" className="w-notice">{wallet.busy}… Keep this page open.</div>}
    {wallet.notice&&<div role="status" className="w-notice">{wallet.notice}</div>}
    {wallet.txHash&&<a className="transaction-link" href={`https://explorer.test.mezo.org/tx/${wallet.txHash}`} target="_blank" rel="noreferrer">View latest transaction {short(wallet.txHash)} ↗</a>}
    {children}
   </main><footer className="workspace-footer"><span>MezoLoop · Testnet</span><span>BTC for gas. MUSD for payments.</span></footer>
  </div>
 </div>;
}
export function Heading({title,description,action}:{title:string;description:string;action?:ReactNode}){return <div className="w-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;}
export function Panel({title,description,children,className=''}:{title:string;description?:string;children:ReactNode;className?:string}){return <section className={`w-panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{description&&<p>{description}</p>}</div>{children}</section>;}
export function Empty({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}){return <div className="w-empty"><span aria-hidden="true">↗</span><h3>{title}</h3><p>{children}</p>{action}</div>;}
export function ResourceState({loading,error}:{loading:boolean;error:string}){return error?<div className="w-alert" role="alert">{error}</div>:loading?<div className="w-loading" role="status">Loading the latest records…</div>:null;}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="w-field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function ActionForm({title,description,onSubmit,children,button='Save',disabled=false}:{title:string;description?:string;onSubmit:(data:FormData)=>Promise<void>;children:ReactNode;button?:string;disabled?:boolean}){
 const wallet=useWallet();return <Panel title={title} description={description}><form onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const data=new FormData(e.currentTarget);void wallet.run(button,()=>onSubmit(data));}}><fieldset className="w-form" disabled={disabled||Boolean(wallet.busy)}>{children}<button className="w-button primary" type="submit">{button}</button></fieldset></form></Panel>;
}
export const value=(data:FormData,name:string)=>String(data.get(name)||'').trim();
export function Status({value}:{value:string}){return <span className={`status-pill status-${value}`}>{({created:'Needs signature',quoted:'Ready to pay',submitted:'Pending',observed:'Confirming',confirmed:'Confirmed',final:'Final',cancelled:'Cancelled',expired:'Expired',uncertain:'Checking chain',reverted:'Reverted'} as Record<string,string>)[value]||value}</span>;}
export function Copy({text,label='Copy link'}:{text:string;label?:string}){const [copied,setCopied]=useState(false);const wallet=useWallet();useEffect(()=>{if(copied){const timer=setTimeout(()=>setCopied(false),2500);return()=>clearTimeout(timer);}},[copied]);return <button className="w-button" onClick={()=>{void wallet.run('Copying',async()=>{await navigator.clipboard.writeText(text);setCopied(true);});}}>{copied?'Copied':label}</button>;}
export function Gate({children}:{children:ReactNode}){const wallet=useWallet();return wallet.address?<>{children}</>:<><Empty title="Your wallet is your account" action={<button className="w-button primary" onClick={wallet.connect} disabled={Boolean(wallet.busy)}>Connect and sign in</button>}>Connect an EVM wallet to view your records. The sign-in message does not authorize a payment.</Empty><WalletHelp/></>;}
export function WalletHelp(){return <details className="wallet-help"><summary>First time paying with MezoLoop?</summary><ol><li>Open this link in your EVM wallet’s browser on mobile, or use a browser wallet extension on desktop.</li><li>Connect on Mezo Testnet. The sign-in message only proves that you control your wallet.</li><li>Have enough test MUSD for the purchase and test BTC for network fees. Check the amount and merchant before approving.</li></ol><a className="workspace-link" href="https://testnet.mezo.org/docs/users/getting-started/connect" target="_blank" rel="noreferrer">Mezo wallet setup guide ↗</a><p>This checkout uses test tokens. Keep your recovery phrase in your wallet; MezoLoop never asks for it.</p></details>;}
