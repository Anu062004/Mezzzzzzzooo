import {formatUnits,parseUnits,isAddress} from 'viem';
export const ZERO='0x0000000000000000000000000000000000000000';
export const short=(value:string)=>`${value.slice(0,6)}…${value.slice(-4)}`;
export function atomic(value:string){
 if(!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))throw new Error('Enter a positive amount with at most 18 decimal places.');
 const amount=parseUnits(value,18);if(amount<=0n||amount>=2n**256n)throw new Error('Amount must be greater than zero and within the token limit.');return amount.toString();
}
export function money(value:string|bigint='0'){return formatUnits(BigInt(value),18);}
export function percent(value:string){if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('Use a percentage with at most two decimal places.');const bps=Number(parseUnits(value,2));if(bps>10000)throw new Error('Percentages cannot exceed 100%.');return bps;}
export function walletAddress(value:string){if(!isAddress(value)||value.toLowerCase()===ZERO)throw new Error('Enter a valid, nonzero wallet address.');return value.toLowerCase();}
export const dateTime=(value:string|number)=>new Date(typeof value==='number'?value*1000:value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export const future=(days:number)=>Math.floor(Date.now()/1000)+days*86400;
export function checkoutPath(input:string,origin:string){
 const url=new URL(input,origin);
 if(url.origin!==origin||url.username||url.password||url.search||url.hash||!/^\/(pay|merchant|subscribe)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname))throw new Error('Use a MezoLoop checkout, merchant, or subscription link from this website.');
 return url.pathname;
}
export function downloadCsv(name:string,rows:(string|number)[][]){
 const csv=rows.map(row=>row.map(cell=>`"${String(cell).replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}

export const campaignState=(row:any)=>row.onchain?{merchant:row.onchain[0],reward:row.onchain[1],minimum:row.onchain[2],startsAt:Number(row.onchain[3]),expiresAt:Number(row.onchain[4]),budget:row.onchain[5]}:null;
