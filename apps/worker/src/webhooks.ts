import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {resolve4} from 'node:dns/promises';
import https from 'node:https';
import type {Database} from '../../../packages/db/index.js';
export function webhookUrl(input:string) {
 const url=new URL(input);
 if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || url.hash || url.hostname.length>253)throw new Error('Webhook must use a public HTTPS URL on port 443');
 return url;
}
export function publicIPv4(ip:string) {
 const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const [a,b]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);
}
function key(){const value=process.env.WEBHOOK_ENCRYPTION_KEY;if(!value||!/^[a-f0-9]{64}$/i.test(value))throw new Error('WEBHOOK_ENCRYPTION_KEY must contain 32 random bytes in hex');return Buffer.from(value,'hex');}
export function encryptSecret(secret:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(v=>v.toString('hex')).join('.');}
function decryptSecret(value:string){const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'hex'));const cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString();}
async function deliver(urlString:string,secret:string,payload:unknown,id:string){
 const url=webhookUrl(urlString);const addresses=await resolve4(url.hostname);if(!addresses.length||addresses.some(ip=>!publicIPv4(ip)))throw new Error('Non-public webhook destination');
 const body=JSON.stringify(payload);const timestamp=String(Math.floor(Date.now()/1000));const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
 await new Promise<void>((resolve,reject)=>{
  const req=https.request(url,{method:'POST',timeout:10000,lookup:(_hostname,_options,callback)=>callback(null,addresses[0],4),headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'x-mezoloop-id':id,'x-mezoloop-timestamp':timestamp,'x-mezoloop-signature':signature}},res=>{res.resume();res.statusCode&&res.statusCode>=200&&res.statusCode<300?resolve():reject(new Error('Webhook rejected'));});
  req.on('timeout',()=>req.destroy(new Error('Webhook timeout')));req.on('error',reject);req.end(body);
 });
}
export async function dispatchWebhooks(db:Database){
 if(!process.env.WEBHOOK_ENCRYPTION_KEY)return;
 for(let i=0;i<10;i++) {
  const found=await db.transaction(async tx=>{
   const row=(await tx.query('SELECT o.*,w.url,w.secret FROM outbox o JOIN webhooks w ON w.id=o.webhook_id WHERE o.delivered_at IS NULL AND o.attempts<10 AND o.next_attempt<=now() AND w.active ORDER BY o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1')).rows[0];
   if(!row)return false;
   try {await deliver(row.url,decryptSecret(row.secret),row.payload,String(row.id));await tx.query('UPDATE outbox SET delivered_at=now(),attempts=attempts+1 WHERE id=$1',[row.id]);}
   catch {await tx.query("UPDATE outbox SET attempts=attempts+1,next_attempt=now()+($2 * interval '1 second') WHERE id=$1",[row.id,Math.min(3600,2**row.attempts*30)]);}
   return true;
  });if(!found)break;
 }
}
