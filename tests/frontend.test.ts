import assert from 'node:assert/strict';
import {test} from 'node:test';
import {atomic,percent,checkoutPath} from '../apps/web/lib/format.js';
test('frontend converts money exactly and rejects rounded or unsafe values',()=>{
 assert.equal(atomic('20.000000000000000001'),'20000000000000000001');
 assert.equal(atomic('0.000000000000000001'),'1');
 for(const value of ['0','-1','1e3','0.0000000000000000001','1.','NaN',(2n**256n).toString()])assert.throws(()=>atomic(value));
 assert.equal(percent('3.25'),325);assert.equal(percent('100'),10000);
 for(const value of ['-1','3.251','100.01','Infinity'])assert.throws(()=>percent(value));
});
test('QR resolver only accepts supported same-origin checkout routes',()=>{
 const origin='https://mezoloop.vercel.app',id='11111111-1111-4111-8111-111111111111';
 for(const kind of ['pay','merchant','subscribe'])assert.equal(checkoutPath(`${origin}/${kind}/${id}`,origin),`/${kind}/${id}`);
 for(const input of [`https://evil.example/pay/${id}`,`https://mezoloop.vercel.app.evil.example/pay/${id}`,`https://name:password@mezoloop.vercel.app/pay/${id}`,`/pay/${id}?to=evil`,`/pay/${id}#evil`,'javascript:alert(1)','/merchant','/pay/not-an-id'])assert.throws(()=>checkoutPath(input,origin));
});
