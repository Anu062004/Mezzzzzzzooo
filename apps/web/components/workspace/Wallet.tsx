'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createWalletClient,custom,decodeFunctionData,erc20Abi,isAddress,type Address,type EIP1193Provider,type Hex} from 'viem';
import {mezoTestnet,MUSD,quoteTypes} from '../../../../packages/chain/index';
import {planTypes,offerTypes} from '../../../../packages/chain/terms';
import {paymentRouterAbi,subscriptionManagerAbi,rewardsVaultAbi,partnershipRegistryAbi,offersRedemptionAbi} from '../../../../packages/chain/abi';
import {api,post,ApiError,errorMessage} from '../../lib/api';
import {money,short} from '../../lib/format';
export type Network={chainId:number;token:Address;router:Address|null;subscriptionManager:Address|null;registry:Address|null;rewardsVault:Address|null;offers:Address|null;settlementEnabled:boolean};
export type Transaction={chainId:number;to:Address;data:Hex;value:string};
type Provider=EIP1193Provider&{on?:(event:string,listener:(value:any)=>void)=>void;removeListener?:(event:string,listener:(value:any)=>void)=>void};
declare global{interface Window{ethereum?:Provider}}
type Review={title:string;transaction:Transaction;method:string;approval?:string;resolve:(yes:boolean)=>void};
type WalletContext={address:Address|null;network:Network|null;busy:string;error:string;notice:string;txHash:Hex|null;connect:()=>void;disconnect:()=>void;refresh:()=>Promise<void>;run:(label:string,work:()=>Promise<void>)=>Promise<void>;sign:(data:any)=>Promise<Hex>;send:(transaction:Transaction,title:string,onSubmitted?:(hash:Hex)=>Promise<void>)=>Promise<Hex>};
const Context=createContext<WalletContext|null>(null);
export const useWallet=()=>{const ctx=useContext(Context);if(!ctx)throw new Error('Wallet provider missing');return ctx;};
export function WalletProvider({children}:{children:ReactNode}){
 const [address,setAddress]=useState<Address|null>(null),[network,setNetwork]=useState<Network|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[txHash,setTxHash]=useState<Hex|null>(null),[review,setReview]=useState<Review|null>(null);
 const lock=useRef(false),generation=useRef(0),dialog=useRef<HTMLDialogElement>(null);
 const provider=()=>{if(!window.ethereum)throw new Error('Open this page in an EVM wallet browser, or install a browser wallet such as MetaMask.');return window.ethereum;};
 const client=()=>createWalletClient({chain:mezoTestnet,transport:custom(provider())});
 async function refresh(){
  const next=await api<Network>('/network');
  if(next.chainId!==31611||next.token.toLowerCase()!==MUSD)throw new Error('The payment service returned an unsupported network.');
  setNetwork(next);
 }
 useEffect(()=>{
  let mounted=true;
  refresh().then(async()=>{
   try{const session=await api<{address:Address}>('/auth/session');const accounts=await window.ethereum?.request({method:'eth_accounts'});const chain=await window.ethereum?.request({method:'eth_chainId'});if(mounted&&accounts?.[0]?.toLowerCase()===session.address.toLowerCase()&&Number(chain)===31611)setAddress(session.address);}catch(e){if(mounted&&!(e instanceof ApiError&&e.status===401))setError(errorMessage(e));}
  }).catch(e=>{if(mounted)setError(errorMessage(e));});
  const reset=()=>{generation.current++;setAddress(null);setNotice('Wallet changed. Reconnect to sign in with the current account.');setReview(old=>{old?.resolve(false);return null;});};
  const p=window.ethereum;p?.on?.('accountsChanged',reset);p?.on?.('chainChanged',reset);
  return()=>{mounted=false;p?.removeListener?.('accountsChanged',reset);p?.removeListener?.('chainChanged',reset);};
 },[]);
 useEffect(()=>{if(review)dialog.current?.showModal();else dialog.current?.close();},[review]);
 async function run(label:string,work:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(label);setError('');setNotice('');
  try{await work();}catch(e){if(e instanceof ApiError&&e.status===401)setAddress(null);const code=(e as {code?:number}).code;setError(code===4001||/rejected|denied/i.test(errorMessage(e))?'Request cancelled in your wallet. No new action was authorized.':errorMessage(e));}
  finally{lock.current=false;setBusy('');}
 }
 function connect(){void run('Connecting wallet',async()=>{
  await refresh();const wallet=client();const [account]=await wallet.requestAddresses();if(!account)throw new Error('Select an account in your wallet.');
  if(await wallet.getChainId()!==31611){try{await wallet.switchChain({id:31611});}catch(e){if((e as {code?:number}).code!==4902)throw e;await wallet.addChain({chain:mezoTestnet});await wallet.switchChain({id:31611});}}
  const version=generation.current;
  const challenge=await post('/auth/challenge',{address:account,chainId:31611});
  if(!challenge.message.includes(`URI: ${window.location.origin}\n`)||!challenge.message.includes('Chain ID: 31611\n'))throw new Error('The login request does not match this website.');
  const signature=await wallet.signMessage({account,message:challenge.message});
  if(version!==generation.current)throw new Error('Wallet changed during sign-in. Please reconnect.');
  const session=await post('/auth/verify',{challengeId:challenge.challengeId,signature});
  if(session.address.toLowerCase()!==account.toLowerCase())throw new Error('Wallet session mismatch.');setAddress(session.address);setNotice('Wallet connected. Your keys stay in your wallet.');
 });}
 async function checkedAccount(){
  if(!address)throw new Error('Connect your wallet before continuing.');
  const p=provider();const accounts=await p.request({method:'eth_accounts'}),chain=await p.request({method:'eth_chainId'});
  if(accounts[0]?.toLowerCase()!==address.toLowerCase()||Number(chain)!==31611){setAddress(null);throw new Error('Wallet account or network changed. Reconnect on Mezo Testnet.');}return address;
 }
 async function sign(data:any):Promise<Hex>{
  const account=await checkedAccount();
  const specs:any={Quote:{name:'MezoLoop',target:network?.router,types:quoteTypes},Plan:{name:'MezoLoopSubscriptions',target:network?.subscriptionManager,types:planTypes},Offer:{name:'MezoLoopOffers',target:network?.offers,types:offerTypes}};
  const expected=specs[data.primaryType];
  if(!expected?.target||data.domain?.chainId!==31611||data.domain?.name!==expected.name||data.domain?.version!=='1'||data.domain?.verifyingContract?.toLowerCase()!==expected.target.toLowerCase()||JSON.stringify(data.types)!==JSON.stringify(expected.types)||data.message?.merchant?.toLowerCase()!==account.toLowerCase())throw new Error('The signing request does not match the configured contract or merchant.');
  return client().signTypedData({...data,account});
 }
 async function send(transaction:Transaction,title:string,onSubmitted?:(hash:Hex)=>Promise<void>){
  await checkedAccount();
  if(transaction.chainId!==31611||transaction.value!=='0'||!isAddress(transaction.to))throw new Error('Unexpected transaction network or native value.');
  const target=transaction.to.toLowerCase();const token=target===MUSD||target==='0x7b7c000000000000000000000000000000000001';
  const abi=token?erc20Abi:target===network?.router?.toLowerCase()?paymentRouterAbi:target===network?.subscriptionManager?.toLowerCase()?subscriptionManagerAbi:target===network?.registry?.toLowerCase()?partnershipRegistryAbi:target===network?.rewardsVault?.toLowerCase()?rewardsVaultAbi:target===network?.offers?.toLowerCase()?offersRedemptionAbi:null;
  if(!abi)throw new Error('This transaction targets an unrecognized contract.');
  const decoded=decodeFunctionData({abi,data:transaction.data});let approval:string|undefined;
  if(token){const [spender,amount]=decoded.args as [Address,bigint];if(decoded.functionName!=='approve'||spender.toLowerCase()!==(target===MUSD?network?.router?.toLowerCase():network?.rewardsVault?.toLowerCase())||amount<=0n||amount===2n**256n-1n)throw new Error('Unexpected token approval.');approval=`Allow ${money(amount)} ${target===MUSD?'MUSD':'MEZO'} for ${short(spender)}. This does not transfer tokens.`;}
  const accepted=await new Promise<boolean>(resolve=>setReview({title,transaction,method:decoded.functionName,approval,resolve}));
  if(!accepted)throw new Error('Transaction review cancelled.');
  const account=await checkedAccount();const version=generation.current;
  const hash=await client().sendTransaction({account,to:transaction.to,data:transaction.data,value:0n});setTxHash(hash);setNotice('Transaction submitted. Waiting for on-chain inclusion.');
  if(onSubmitted)await onSubmitted(hash);
  for(let attempt=0;attempt<45;attempt++){
   if(version!==generation.current)throw new Error('Wallet changed after submission. The transaction may still complete; check its explorer link.');
   const receipt=await provider().request({method:'eth_getTransactionReceipt',params:[hash]}).catch(()=>null);
   if(receipt){if(receipt.status==='0x0')throw new Error('The transaction reverted. Check the explorer for details.');setNotice('Transaction included on-chain. Payment confirmation appears after reconciliation.');return hash;}
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Transaction is still pending or the RPC is unavailable. Check the explorer before submitting again.');
 }
 const finish=(yes:boolean)=>{review?.resolve(yes);setReview(null);};
 return <Context.Provider value={{address,network,busy,error,notice,txHash,refresh,connect,disconnect:()=>{void run('Signing out',async()=>{await post('/auth/logout');setAddress(null);setTxHash(null);generation.current++;});},run,sign,send}}>
  {children}
  <dialog ref={dialog} className="workspace-dialog" onCancel={e=>{e.preventDefault();finish(false);}} onClick={e=>{if(e.target===dialog.current)finish(false);}} aria-labelledby="transaction-title">
   <h2 id="transaction-title">{review?.title}</h2><p>{review?.approval||'Review the terms shown in the workspace, then authorize this action in your wallet.'}</p>
   <dl><dt>Network</dt><dd>Mezo Testnet · BTC gas</dd><dt>Contract</dt><dd className="address-text">{review?.transaction.to}</dd><dt>Action</dt><dd>{review?.method}</dd></dl>
   <p className="muted">Your wallet shows the network fee before you confirm.</p><div className="action-row"><button className="w-button primary" onClick={()=>finish(true)}>Continue in wallet</button><button className="w-button" onClick={()=>finish(false)}>Cancel</button></div>
  </dialog>
 </Context.Provider>;
}
