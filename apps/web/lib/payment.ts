import type {Hex} from 'viem';

export type PendingPayment={hash:Hex;payer:string;registered:boolean};
export const paymentKey=(id:string,subscription=false)=>`mezoloop:${subscription?'subscription':'payment'}:${id}`;
export function readPayment(key:string):PendingPayment|null{
 try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&/^0x[0-9a-f]{64}$/i.test(value.hash)&&/^0x[0-9a-f]{40}$/i.test(value.payer)&&typeof value.registered==='boolean'?value:null;}catch{return null;}
}
// Public transaction metadata only. Storage may be disabled in private browsing.
export function savePayment(key:string,value:PendingPayment):boolean{
 try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}
}
