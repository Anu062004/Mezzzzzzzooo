import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { verifyMessage, verifyTypedData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildApp, type Verifier } from '../apps/api/src/app.js';
import { configFromEnv, type Config } from '../apps/api/src/config.js';
import { quoteHash, split, typedQuote, ZERO, MUSD } from '../packages/chain/index.js';
import type { Database } from '../packages/db/index.js';

// Deterministic local test accounts only. Never funded or used for deployment.
const merchant = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const stranger = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const router = `0x${'33'.repeat(20)}` as Hex;
const origin = 'http://localhost:3000';
const config = configFromEnv({ DATABASE_URL: 'postgres://unused', PUBLIC_APP_URL: origin, PAYMENT_ROUTER_ADDRESS: router });
const schema = await readFile(new URL('../packages/db/001_initial.sql', import.meta.url), 'utf8');

async function fixture(t: TestContext, verifier?: Verifier, routerConfigured = true, overrides:Partial<Config> = {}) {
  const pg = new PGlite();
  await pg.exec(schema);
  await pg.exec(await readFile(new URL('../packages/db/002_protocol.sql', import.meta.url),'utf8'));
  const db: Database = {
    query: async (sql, params) => pg.query(sql, params),
    transaction: async fn => pg.transaction(async tx => fn({
      query: async (sql, params) => tx.query(sql, params),
      transaction: () => { throw new Error('Nested transaction'); },
    })),
  };
  const app = await buildApp(db, { ...config, router: routerConfigured ? router : undefined, ...overrides }, verifier ?? {
    verifyMessage: input => verifyMessage(input),
    verifyQuote: input => verifyTypedData(input),
  });
  t.after(async () => { await app.close(); await pg.close(); });
  async function login(account = merchant) {
    const challenge = await app.inject({ method: 'POST', url: '/v1/auth/challenge', headers: { origin }, payload: { address: account.address, chainId: 31611 } });
    assert.equal(challenge.statusCode, 200, challenge.body);
    const signature = await account.signMessage({ message: challenge.json().message });
    const result = await app.inject({ method: 'POST', url: '/v1/auth/verify', headers: { origin }, cookies: { ml_challenge: challenge.json().challengeId }, payload: { challengeId: challenge.json().challengeId, signature } });
    assert.equal(result.statusCode, 200, result.body);
    return { ml_session: result.cookies.find(c => c.name === 'ml_session')!.value };
  }
  async function order() {
    const cookies = await login();
    const created = await app.inject({ method: 'POST', url: '/v1/merchants', headers: { origin }, cookies, payload: { name: 'Coffee shop' } });
    assert.equal(created.statusCode, 201, created.body);
    const payload = { merchantId: created.json().id, amountAtomic: '20000000000000000000', partner: stranger.address,
      referralBps: 300, cashbackBps: 500, expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 3600000).toISOString().replace('.000Z','Z') };
    const request = { method: 'POST' as const, url: '/v1/orders', headers: { origin, 'idempotency-key': 'sale-1' }, cookies, payload };
    const response = await app.inject(request);
    assert.equal(response.statusCode, 201, response.body);
    return { cookies, payload, request, order: response.json() };
  }
  async function authorize() {
    const data = await order();
    const signature = await merchant.signTypedData(typedQuote(data.order.terms, router));
    const response = await app.inject({ method: 'POST', url: `/v1/orders/${data.order.id}/authorize`, headers: { origin }, cookies: data.cookies, payload: { signature } });
    assert.equal(response.statusCode, 200, response.body);
    return { ...data, order: response.json(), signature };
  }
  return { app, db, login, order, authorize };
}

test('exact integer splits conserve gross, including rounding and uint256 boundary', () => {
  assert.deepEqual(split('20000000000000000000', 300, 500), { merchantAtomic: '18400000000000000000', referralAtomic: '600000000000000000', cashbackAtomic: '1000000000000000000', feeAtomic: '0' });
  for (const gross of [1n, 3n, 10001n, 2n ** 256n - 1n]) {
    for (const [referral, cashback] of [[0, 0], [300, 500], [3333, 6667], [10000, 0]]) {
      const result = split(gross.toString(), referral, cashback);
      assert.equal(BigInt(result.merchantAtomic) + BigInt(result.referralAtomic) + BigInt(result.cashbackAtomic), gross);
    }
  }
  for (const [amount, referral, cashback] of [['0', 0, 0], ['1', 5001, 5000], ['1', -1, 0], ['1', 0.5, 0], [(2n ** 256n).toString(), 0, 0]] as const) assert.throws(() => split(amount, referral, cashback));
});

test('wallet challenge is origin-bound, single use, expiring and session is revocable', async t => {
  const { app, db } = await fixture(t);
  const bad = await app.inject({ method: 'POST', url: '/v1/auth/challenge', headers: { origin: 'https://evil.example' }, payload: { address: merchant.address, chainId: 31611 } });
  assert.equal(bad.statusCode, 403);
  const result = await app.inject({ method: 'POST', url: '/v1/auth/challenge', headers: { origin }, payload: { address: merchant.address, chainId: 31611 } });
  const challenge = result.json();
  assert.match(challenge.message, /Chain ID: 31611/);
  const request = { method: 'POST' as const, url: '/v1/auth/verify', headers: { origin }, cookies: { ml_challenge: challenge.challengeId }, payload: { challengeId: challenge.challengeId, signature: await merchant.signMessage({ message: challenge.message }) } };
  assert.equal((await app.inject({ ...request, cookies: {} })).statusCode, 401);
  assert.equal((await app.inject({ ...request, payload: { ...request.payload, signature: await stranger.signMessage({ message: challenge.message }) } })).statusCode, 401);
  const login = await app.inject(request);
  assert.equal(login.statusCode, 200, login.body);
  const session = login.cookies.find(c => c.name === 'ml_session')!;
  assert.equal(session.httpOnly, true);
  assert.equal(session.sameSite, 'Strict');
  assert.equal((await app.inject(request)).statusCode, 401);
  const cookies = { ml_session: session.value };
  assert.equal((await app.inject({ url: '/v1/auth/session', cookies })).statusCode, 200);
  const stored = await db.query('SELECT token_hash FROM sessions');
  assert.notEqual(stored.rows[0].token_hash, session.value);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { origin }, cookies })).statusCode, 204);
  assert.equal((await app.inject({ url: '/v1/auth/session', cookies })).statusCode, 401);
});

test('expired sessions and challenges, wrong chain and RPC uncertainty fail closed', async t => {
  const { app, db, login } = await fixture(t);
  const cookies = await login();
  await db.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await app.inject({ url: '/v1/auth/session', cookies })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/challenge', headers: { origin }, payload: { address: merchant.address, chainId: 31612 } })).statusCode, 400);
  const response = await app.inject({ method: 'POST', url: '/v1/auth/challenge', headers: { origin }, payload: { address: merchant.address, chainId: 31611 } });
  const challenge = response.json();
  await db.query("UPDATE challenges SET expires_at=now()-interval '1 second'");
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/verify', headers: { origin }, cookies: { ml_challenge: challenge.challengeId }, payload: { challengeId: challenge.challengeId, signature: await merchant.signMessage({ message: challenge.message }) } })).statusCode, 401);
  const isolated = await fixture(t, { verifyMessage: async () => { throw new Error('RPC timeout'); }, verifyQuote: async () => false });
  const challenge2 = (await isolated.app.inject({ method: 'POST', url: '/v1/auth/challenge', headers: { origin }, payload: { address: merchant.address, chainId: 31611 } })).json();
  const failed = await isolated.app.inject({ method: 'POST', url: '/v1/auth/verify', headers: { origin }, cookies: { ml_challenge: challenge2.challengeId }, payload: { challengeId: challenge2.challengeId, signature: '0x1234' } });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().error.retryable, true);
  assert.equal((await isolated.db.query('SELECT * FROM sessions')).rows.length, 0);
});

test('order creation is idempotent, normalized, authorized and financial terms immutable', async t => {
  const { app, db, order, login } = await fixture(t);
  const data = await order();
  const duplicate = await app.inject(data.request);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().id, data.order.id);
  assert.equal((await app.inject({ ...data.request, payload: { ...data.payload, amountAtomic: '21' } })).statusCode, 409);
  const otherCookies = await login(stranger);
  assert.equal((await app.inject({ ...data.request, cookies: otherCookies })).statusCode, 403);
  assert.equal((await app.inject({ url: `/v1/orders/${data.order.id}` })).statusCode, 401);
  assert.equal((await app.inject({ url: `/v1/orders/${data.order.id}/qr`, cookies: data.cookies })).statusCode, 409);
  await assert.rejects(db.query("UPDATE orders SET quote=jsonb_set(quote,'{terms,amount}','\"1\"') WHERE id=$1", [data.order.id]), /immutable/);
  assert.equal((await db.query('SELECT * FROM order_events')).rows.length, 1);
  const newRequest = { ...data.request, headers: { ...data.request.headers, 'idempotency-key': 'concurrent-sale' } };
  const concurrent = await Promise.all([app.inject(newRequest), app.inject(newRequest)]);
  assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 201]);
  assert.equal(concurrent[0].json().id, concurrent[1].json().id);
  assert.equal((await db.query('SELECT * FROM orders')).rows.length, 2);
});

test('unsigned, wrong-recipient, wrong-token, altered-domain and tampered quotes are rejected', async t => {
  const { app, order } = await fixture(t);
  const data = await order();
  const path = `/v1/orders/${data.order.id}/authorize`;
  const original = typedQuote(data.order.terms, router);
  for (const signingData of [
    { ...original, message: { ...original.message, amount: 1n } },
    { ...original, message: { ...original.message, merchant: stranger.address } },
    { ...original, message: { ...original.message, token: ZERO } },
    { ...original, message: { ...original.message, referralBps: 1000 } },
    { ...original, domain: { ...original.domain, chainId: 31612 } },
    { ...original, domain: { ...original.domain, verifyingContract: stranger.address } },
  ]) {
    const signature = await merchant.signTypedData(signingData);
    assert.equal((await app.inject({ method: 'POST', url: path, headers: { origin }, cookies: data.cookies, payload: { signature } })).statusCode, 401);
  }
  const wrongSigner = await stranger.signTypedData(original);
  assert.equal((await app.inject({ method: 'POST', url: path, headers: { origin }, cookies: data.cookies, payload: { signature: wrongSigner } })).statusCode, 401);
  assert.equal(data.order.quoteHash, quoteHash(data.order.terms, router));
  assert.equal(data.order.terms.token, MUSD);
});

test('signed quotes resolve to canonical QR links; tx hints never mark payments confirmed', async t => {
  const { app, db, authorize } = await fixture(t);
  const data = await authorize();
  const url = `/v1/orders/${data.order.id}`;
  assert.equal((await app.inject({ url })).json().status, 'quoted');
  const qr = await app.inject({ url: `${url}/qr` });
  assert.equal(qr.json().qrPayload, `${origin}/pay/${data.order.id}`);
  const request = { method: 'POST' as const, url: `${url}/transactions`, headers: { origin }, cookies: data.cookies, payload: { txHash: `0x${'aa'.repeat(32)}` } };
  assert.equal((await app.inject(request)).statusCode, 202);
  assert.equal((await app.inject(request)).statusCode, 202);
  assert.equal((await db.query('SELECT * FROM transactions')).rows.length, 1);
  const status = (await app.inject({ url: `${url}/status` })).json();
  assert.equal(status.status, 'submitted');
  assert.equal(status.settlementVerified, false);
  assert.equal(status.settlement, null);
  assert.equal((await app.inject({ ...request, payload: { ...request.payload, status: 'confirmed' } })).statusCode, 400);
});

test('boundary validation rejects floats, split overflow, invalid expiry and wallet changes', async t => {
  const { app, order } = await fixture(t);
  const data = await order();
  for (const extra of [
    { amountAtomic: 20 }, { amountAtomic: '1.5' }, { amountAtomic: '0' },
    { amountAtomic: (2n ** 256n).toString() }, { referralBps: 10000, cashbackBps: 1 },
    { referralBps: 0.5 }, { partner: ZERO }, { token: ZERO },
    { expiresAt: '2000-01-01T00:00:00Z' }, { expiresAt: '2099-01-01T00:00:00Z' },
  ]) assert.equal((await app.inject({ ...data.request, headers: { ...data.request.headers, 'idempotency-key': 'new' }, payload: { ...data.payload, ...extra } })).statusCode, 400);
  assert.equal((await app.inject({ ...data.request, headers: { origin } })).statusCode, 400);
  const change = await app.inject({ method: 'PATCH', url: `/v1/merchants/${data.payload.merchantId}`, headers: { origin }, cookies: data.cookies, payload: { name: 'Other', receivingWallet: stranger.address } });
  assert.equal(change.statusCode, 400);
});

test('router is unset by default and production requires HTTPS', async t => {
  const { app, login } = await fixture(t, undefined, false);
  const cookies = await login();
  const merchantResponse = await app.inject({ method: 'POST', url: '/v1/merchants', headers: { origin }, cookies, payload: { name: 'Test' } });
  const result = await app.inject({ method: 'POST', url: '/v1/orders', headers: { origin, 'idempotency-key': 'key' }, cookies, payload: { merchantId: merchantResponse.json().id, amountAtomic: '1', expiresAt: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z') } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().error.code, 'ROUTER_NOT_CONFIGURED');
  assert.equal((await app.inject({ url: '/health/ready' })).json().payments, 'not_enabled');
  assert.throws(() => configFromEnv({ DATABASE_URL: 'postgres://unused', PUBLIC_APP_URL: origin, NODE_ENV: 'production' }), /HTTPS/);
});

test('expired quotes reject new authorization but accept delayed transaction recovery', async t => {
  const { app, authorize } = await fixture(t);
  const data = await authorize();
  t.mock.method(Date, 'now', () => Date.parse(data.payload.expiresAt) + 1000);
  const url = `/v1/orders/${data.order.id}`;
  assert.equal((await app.inject({ url })).json().status, 'expired');
  assert.equal((await app.inject({ url: `${url}/qr` })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `${url}/authorize`, headers: { origin }, cookies: data.cookies, payload: { signature: data.signature } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `${url}/transactions`, headers: { origin }, cookies: data.cookies, payload: { txHash: `0x${'aa'.repeat(32)}` } })).statusCode, 202);
  const retry = await app.inject(data.request);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().id, data.order.id);
  assert.equal(retry.json().status, 'submitted');
});

test('merchant plan lists enforce ownership and preserve unsigned drafts for retry',async t=>{
 const {app,db,order,login}=await fixture(t);const data=await order();
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await db.query('INSERT INTO subscription_plans(id,merchant_id,terms) VALUES($1,$2,$3)',[id,data.order.merchantId,JSON.stringify({amount:'20',merchant:merchant.address.toLowerCase()})]);
 const url=`/v1/merchants/${data.order.merchantId}/plans`;
 assert.equal((await app.inject({url})).statusCode,401);
 assert.equal((await app.inject({url,cookies:await login(stranger)})).statusCode,403);
 const result=await app.inject({url,cookies:data.cookies});assert.equal(result.statusCode,200);assert.equal(result.json().plans[0].id,id);assert.equal(result.json().plans[0].signature,null);
});

test('campaign creation can be retried from stored terms only by the owning merchant',async t=>{
 const {app,db,order,login}=await fixture(t,undefined,true,{rewardsVault:router});const data=await order();
 const created=await app.inject({method:'POST',url:'/v1/campaigns',headers:{origin},cookies:data.cookies,payload:{merchantId:data.order.merchantId,name:'Return visit',rewardAtomic:'10',minimumPurchaseAtomic:'20',startsAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+86400}});
 assert.equal(created.statusCode,200,created.body);const url=`/v1/campaigns/${created.json().id}/create`;
 const request={method:'POST' as const,url,headers:{origin},cookies:data.cookies};
 const retry=await app.inject(request);assert.equal(retry.statusCode,200,retry.body);assert.deepEqual(retry.json(),created.json().transaction);
 assert.equal((await app.inject({...request,cookies:await login(stranger)})).statusCode,403);
 await db.query("UPDATE campaigns SET terms=jsonb_set(terms,'{expiresAt}','1') WHERE id=$1",[created.json().id]);assert.equal((await app.inject(request)).statusCode,409);
});


test('payment recovery is wallet-scoped and late callbacks preserve confirmed settlement',async t=>{
 const {app,db,authorize,login}=await fixture(t);const data=await authorize();const url=`/v1/orders/${data.order.id}`;
 const txHash=`0x${'ab'.repeat(32)}`;
 const request={method:'POST' as const,url:`${url}/transactions`,headers:{origin},cookies:data.cookies,payload:{txHash}};
 assert.equal((await app.inject({url})).json().merchant.name,'Coffee shop');
 assert.equal((await app.inject(request)).statusCode,202);
 assert.equal((await app.inject({url:`${url}/attempt`})).statusCode,401);
 assert.equal((await app.inject({url:`${url}/attempt`,cookies:await login(stranger)})).json().attempt,null);
 const attempt=(await app.inject({url:`${url}/attempt`,cookies:data.cookies})).json().attempt;
 assert.equal(attempt.hash,txHash);assert.equal(attempt.retryAllowed,false);
 await db.query("UPDATE orders SET status='confirmed',settlement_tx=$1,settlement_block=10 WHERE id=$2",[txHash,data.order.id]);
 assert.equal((await app.inject(request)).statusCode,202);
 assert.equal((await app.inject({...request,payload:{txHash:`0x${'bc'.repeat(32)}`}})).statusCode,202);
 const status=(await app.inject({url:`${url}/status`})).json();assert.equal(status.status,'confirmed');assert.equal(status.transactionHash,txHash);assert.equal(status.blockNumber,10);
});
