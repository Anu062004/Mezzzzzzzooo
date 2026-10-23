import assert from 'node:assert/strict';
import {test} from 'node:test';
import {forwardApi} from '../apps/web/lib/api-proxy.js';
test('same-origin API proxy preserves auth cookies and browser origin without trusting arbitrary headers',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async(input:URL,options:RequestInit)=>{
  assert.equal(String(input),'https://api.example/v1/auth/verify');
  const headers=new Headers(options.headers);assert.equal(headers.get('origin'),'https://mezoloop.vercel.app');assert.equal(headers.get('cookie'),'ml_challenge=challenge');assert.equal(headers.get('authorization'),null);assert.equal(headers.get('idempotency-key'),'request-1');assert.equal(options.redirect,'manual');
  return new Response('{"address":"verified"}',{headers:{'content-type':'application/json','set-cookie':'__Host-ml_session=session; Secure; HttpOnly; SameSite=Strict; Path=/'}});
 });
 const request=new Request('https://mezoloop.vercel.app/v1/auth/verify',{method:'POST',headers:{Origin:'https://mezoloop.vercel.app',Cookie:'ml_challenge=challenge',Authorization:'untrusted','Idempotency-Key':'request-1'},body:'{}'});
 const response=await forwardApi(request,['auth','verify'],'https://api.example');assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')!,/HttpOnly/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(fetch.mock.callCount(),1);
});
test('API proxy fails closed for missing deployment config, oversized bodies, and path traversal',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Should not be called');});
 assert.equal((await forwardApi(new Request('https://app.example/v1/network'),['network'],null)).status,503);
 assert.equal((await forwardApi(new Request('https://app.example/v1/network'),['..','secrets'],'https://api.example')).status,400);
 assert.equal((await forwardApi(new Request('https://app.example/v1/orders',{method:'POST',body:'x'.repeat(32769)}),['orders'],'https://api.example')).status,413);
 assert.equal(fetch.mock.callCount(),0);
});
test('API proxy does not turn a foreign origin into an allowed origin or follow an upstream redirect',async t=>{
 t.mock.method(globalThis,'fetch',async(_input:URL,options:RequestInit)=>{assert.equal(new Headers(options.headers).get('origin'),'https://evil.example');return new Response('{"error":{"code":"ORIGIN_NOT_ALLOWED"}}',{status:403});});
 const response=await forwardApi(new Request('https://app.example/v1/orders',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}),['orders'],'https://api.example');assert.equal(response.status,403);
});
