import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { MUSD, ZERO, mezoTestnet, quoteHash, split, typedQuote, type Quote } from '../../../packages/chain/index.js';
import type { Database } from '../../../packages/db/index.js';
import { registerProtocol } from './protocol.js';
import type { ChainClient } from '../../../packages/chain/client.js';
import type { Config } from './config.js';
import { paymentRouterAbi } from '../../../packages/chain/abi.js';
import { paymentAttempt } from '../../../packages/chain/attempt.js';

export interface Verifier {
  verifyMessage(input: { address: Address; message: string; signature: Hex }): Promise<boolean>;
  verifyQuote(input: ReturnType<typeof typedQuote> & { address: Address; signature: Hex }): Promise<boolean>;
}
export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, public retryable = false) { super(code); }
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const address = z.string().refine(v => isAddress(v)).transform(v => v.toLowerCase() as Address);
const signature = z.string().max(16386).regex(/^0x(?:[0-9a-fA-F]{2})+$/).transform(v => v as Hex);
const uuid = z.uuid();
const orderInput = z.strictObject({
  merchantId: uuid,
  amountAtomic: z.string().max(78).regex(/^[1-9][0-9]*$/)
    .refine(v => v.length <= 78 && /^[1-9][0-9]*$/.test(v) && BigInt(v) < 2n ** 256n),
  partner: address.default(ZERO),
  referralBps: z.number().int().min(0).max(10000).default(0),
  cashbackBps: z.number().int().min(0).max(10000).default(0),
  expiresAt: z.iso.datetime({ precision: 0 }),
}).refine(v => v.referralBps + v.cashbackBps <= 10000, 'Split exceeds gross amount')
  .refine(v => v.referralBps === 0 ? v.partner === ZERO : v.partner !== ZERO, 'Partner must match referral terms');
interface StoredQuote { router: Address; terms: Quote }
// The wallet JSON format uses decimal strings for uint256 values.
const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));

export async function buildApp(db: Database, config: Config, verifier: Verifier, logging = false, client?: ChainClient) {
  const app = Fastify({ bodyLimit: 32768, logger: logging ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] } : false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const cookieOptions = { httpOnly: true, secure: config.secureCookies, sameSite: 'strict' as const, path: '/' };
  const sessionName = config.secureCookies ? '__Host-ml_session' : 'ml_session';
  const challengeName = config.secureCookies ? '__Host-ml_challenge' : 'ml_challenge';

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.origin) {
      throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
    }
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'INVALID_INPUT', retryable: false, issues: error.issues.map(v => ({ path: v.path, message: v.message })) } });
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, retryable: error.retryable } });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) return reply.code(error.statusCode).send({ error: { code: 'REQUEST_REJECTED', retryable: error.statusCode === 429 } });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', retryable: true } });
  });

  async function currentWallet(request: FastifyRequest): Promise<Address> {
    const token = request.cookies[sessionName];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'AUTH_REQUIRED');
    const result = await db.query('SELECT address FROM sessions WHERE token_hash=$1 AND expires_at>now()', [sha256(token)]);
    if (!result.rows[0]) throw new ApiError(401, 'SESSION_EXPIRED');
    return result.rows[0].address;
  }
  async function merchantFor(wallet: Address, id: string, tx = db) {
    const result = await tx.query('SELECT m.* FROM merchants m JOIN merchant_members mm ON mm.merchant_id=m.id WHERE m.id=$1 AND mm.address=$2', [id, wallet]);
    if (!result.rows[0]) throw new ApiError(403, 'MERCHANT_ACCESS_DENIED');
    return result.rows[0];
  }
  async function getOrder(id: string, tx = db, lock = false) {
    const result = await tx.query(`SELECT * FROM orders WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!result.rows[0]) throw new ApiError(404, 'ORDER_NOT_FOUND');
    return result.rows[0];
  }
  function viewOrder(row: Record<string, any>) {
    const stored = row.quote as StoredQuote;
    const status = ['created', 'quoted'].includes(row.status) && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : row.status;
    return { id: row.id, merchantId: row.merchant_id, chainId: 31611, token: MUSD, router: stored.router,
      status, expiresAt: new Date(row.expires_at).toISOString(), quoteHash: row.quote_hash,
      terms: stored.terms, typedData: jsonSafe(typedQuote(stored.terms, stored.router)),
      merchantSignature: row.signature, settlement: split(stored.terms.amount, stored.terms.referralBps, stored.terms.cashbackBps),
      settlementVerified: ['confirmed','final'].includes(row.status) };
  }
  async function readableOrder(request: FastifyRequest) {
    const { id } = z.object({ id: uuid }).parse(request.params);
    const row = await getOrder(id);
    if (!row.signature) await merchantFor(await currentWallet(request), row.merchant_id);
    return row;
  }
  async function verified(check: () => Promise<boolean>) {
    try { return await check(); }
    catch { throw new ApiError(503, 'SIGNATURE_VERIFICATION_UNAVAILABLE', true); }
  }

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await db.query('SELECT 1 FROM orders LIMIT 1'); }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
    return { status: 'ok', payments: client && config.router ? 'enabled' : 'not_enabled', routerConfigured: Boolean(config.router) };
  });
  app.get('/v1/network', async () => ({ chainId: mezoTestnet.id, token: MUSD, symbol: 'MUSD',
    subscriptionManager: client && config.router ? await client.readContract({address:config.router,abi:paymentRouterAbi,functionName:'subscriptionManager'}) : null,
    router: config.router ?? null, explorerUrl: mezoTestnet.blockExplorers.default.url,
    rewardsVault: config.rewardsVault ?? null, registry: config.registry ?? null, offers: config.offers ?? null, rpcUrl: config.rpcUrl, settlementEnabled: Boolean(client && config.router) }));

  app.post('/v1/auth/challenge', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = z.strictObject({ address: address.refine(v => v !== ZERO), chainId: z.literal(31611) }).parse(request.body);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const message = `${new URL(config.origin).host} wants you to sign in with your Ethereum account:\n${getAddress(input.address)}\n\nSign in to MezoLoop. This does not authorize payments.\n\nURI: ${config.origin}\nVersion: 1\nChain ID: 31611\nNonce: ${randomBytes(16).toString('hex')}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expiresAt.toISOString()}\nRequest ID: ${id}`;
    await db.query('INSERT INTO challenges(id,address,message,expires_at) VALUES ($1,$2,$3,$4)', [id, input.address, message, expiresAt]);
    reply.setCookie(challengeName, id, { ...cookieOptions, maxAge: 300 });
    return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
  });
  app.post('/v1/auth/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = z.strictObject({ challengeId: uuid, signature }).parse(request.body);
    if (request.cookies[challengeName] !== input.challengeId) throw new ApiError(401, 'INVALID_CHALLENGE');
    const challenge = (await db.query('SELECT * FROM challenges WHERE id=$1 AND used_at IS NULL AND expires_at>now()', [input.challengeId])).rows[0];
    if (!challenge) throw new ApiError(401, 'INVALID_CHALLENGE');
    if (!await verified(() => verifier.verifyMessage({ address: challenge.address, message: challenge.message, signature: input.signature }))) throw new ApiError(401, 'INVALID_SIGNATURE');
    const token = randomBytes(32).toString('hex');
    await db.transaction(async tx => {
      const consumed = await tx.query('UPDATE challenges SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at>now() RETURNING id', [input.challengeId]);
      if (!consumed.rows.length) throw new ApiError(401, 'INVALID_CHALLENGE');
      await tx.query('INSERT INTO wallets(address) VALUES ($1) ON CONFLICT DO NOTHING', [challenge.address]);
      await tx.query("INSERT INTO sessions(token_hash,address,expires_at) VALUES ($1,$2,now()+interval '12 hours')", [sha256(token), challenge.address]);
    });
    reply.clearCookie(challengeName, cookieOptions);
    reply.setCookie(sessionName, token, { ...cookieOptions, maxAge: 43200 });
    return { address: challenge.address, chainId: 31611 };
  });
  app.post('/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionName];
    if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
    reply.clearCookie(sessionName, cookieOptions);
    return reply.code(204).send();
  });
  app.get('/v1/auth/session', async request => ({ address: await currentWallet(request), chainId: 31611 }));

  app.post('/v1/merchants', async (request, reply) => {
    const wallet = await currentWallet(request);
    const { name } = z.strictObject({ name: z.string().trim().min(1).max(100) }).parse(request.body);
    const id = randomUUID();
    await db.transaction(async tx => {
      await tx.query('INSERT INTO merchants(id,name,owner_wallet) VALUES ($1,$2,$3)', [id, name, wallet]);
      await tx.query("INSERT INTO merchant_members(merchant_id,address,role) VALUES ($1,$2,'owner')", [id, wallet]);
    });
    return reply.code(201).send({ id, name, receivingWallet: wallet });
  });
  app.patch('/v1/merchants/:id', async request => {
    const wallet = await currentWallet(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const { name } = z.strictObject({ name: z.string().trim().min(1).max(100) }).parse(request.body);
    await merchantFor(wallet, id);
    await db.query('UPDATE merchants SET name=$1 WHERE id=$2', [name, id]);
    return { id, name };
  });

  app.post('/v1/orders', async (request, reply) => {
    const wallet = await currentWallet(request);
    const input = orderInput.parse(request.body);
    const key = z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/).parse(request.headers['idempotency-key']);
    const requestHash = sha256(JSON.stringify(input));
    const result = await db.transaction(async tx => {
      const merchant = await merchantFor(wallet, input.merchantId, tx);
      const previous = (await tx.query('SELECT * FROM orders WHERE merchant_id=$1 AND idempotency_key=$2', [input.merchantId, key])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { row: previous, created: false };
      }
      if (!config.router) throw new ApiError(503, 'ROUTER_NOT_CONFIGURED', true);
      const deadline = Date.parse(input.expiresAt);
      if (deadline <= Date.now() || deadline > Date.now() + 86400000) throw new ApiError(400, 'INVALID_ORDER_EXPIRY');
      const id = randomUUID();
      const terms: Quote = { orderId: keccak256(stringToHex(id)), merchant: merchant.owner_wallet,
        token: MUSD, amount: input.amountAtomic, partner: input.partner,
        referralBps: input.referralBps, cashbackBps: input.cashbackBps, deadline: String(Math.floor(deadline / 1000)) };
      const quote = { router: config.router, terms };
      const inserted = await tx.query('INSERT INTO orders(id,merchant_id,idempotency_key,request_hash,quote,quote_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (merchant_id,idempotency_key) DO NOTHING RETURNING *',
        [id, input.merchantId, key, requestHash, JSON.stringify(quote), quoteHash(terms, config.router), input.expiresAt]);
      const row = inserted.rows[0] ?? (await tx.query('SELECT * FROM orders WHERE merchant_id=$1 AND idempotency_key=$2', [input.merchantId, key])).rows[0];
      if (row.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
      if (inserted.rows.length) await tx.query("INSERT INTO order_events(order_id,event_type) VALUES ($1,'created')", [id]);
      return { row, created: inserted.rows.length > 0 };
    });
    return reply.code(result.created ? 201 : 200).send(viewOrder(result.row));
  });
  app.post('/v1/orders/:id/authorize', async request => {
    const wallet = await currentWallet(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const input = z.strictObject({ signature }).parse(request.body);
    const row = await getOrder(id);
    await merchantFor(wallet, row.merchant_id);
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ApiError(409, 'ORDER_EXPIRED');
    const { terms, router } = row.quote as StoredQuote;
    if (!await verified(() => verifier.verifyQuote({ ...typedQuote(terms, router), address: terms.merchant, signature: input.signature }))) throw new ApiError(401, 'INVALID_SIGNATURE');
    const updated = await db.transaction(async tx => {
      const current = await getOrder(id, tx, true);
      if (new Date(current.expires_at).getTime() <= Date.now()) throw new ApiError(409, 'ORDER_EXPIRED');
      if (current.signature) return current;
      const result = await tx.query("UPDATE orders SET signature=$1,status='quoted' WHERE id=$2 RETURNING *", [input.signature, id]);
      await tx.query("INSERT INTO order_events(order_id,event_type) VALUES ($1,'authorized')", [id]);
      return result.rows[0];
    });
    return viewOrder(updated);
  });
  app.get('/v1/orders/:id', async request => {
    const row=await readableOrder(request);
    const merchant=(await db.query('SELECT id,name,owner_wallet FROM merchants WHERE id=$1',[row.merchant_id])).rows[0];
    return {...viewOrder(row),merchant};
  });
  app.get('/v1/orders/:id/qr', async request => {
    const row = await readableOrder(request);
    if (!row.signature) throw new ApiError(409, 'ORDER_NOT_AUTHORIZED');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ApiError(409, 'ORDER_EXPIRED');
    const url = `${config.origin}/pay/${row.id}`;
    return { orderId: row.id, chainId: 31611, checkoutUrl: url, qrPayload: url };
  });
  app.post('/v1/orders/:id/transactions', async (request, reply) => {
    const wallet = await currentWallet(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const input = z.strictObject({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase()) }).parse(request.body);
    await db.transaction(async tx => {
      const order = await getOrder(id, tx, true);
      if (!order.signature) throw new ApiError(409, 'ORDER_NOT_AUTHORIZED');
      // Delayed callbacks may arrive after expiry or indexing. Recording a hint
      // neither authorizes a new payment nor overwrites canonical settlement.
      const inserted = await tx.query('INSERT INTO transactions(chain_id,tx_hash,order_id,submitted_by) VALUES (31611,$1,$2,$3) ON CONFLICT DO NOTHING RETURNING tx_hash', [input.txHash, id, wallet]);
      if (!inserted.rows.length) {
        const existing = (await tx.query('SELECT order_id,submitted_by FROM transactions WHERE chain_id=31611 AND tx_hash=$1', [input.txHash])).rows[0];
        if (existing.order_id !== id || existing.submitted_by !== wallet) throw new ApiError(409, 'TRANSACTION_CONFLICT');
      } else {
        await tx.query("UPDATE orders SET status='submitted' WHERE id=$1 AND status IN ('quoted','created','submitted','uncertain','reverted')", [id]);
        await tx.query("INSERT INTO order_events(order_id,event_type) VALUES ($1,'transaction_submitted')", [id]);
      }
    });
    return reply.code(202).send({ orderId: id, txHash: input.txHash, status: 'pending', settlementVerified: false });
  });
  app.get('/v1/orders/:id/attempt', async request => {
    const wallet=await currentWallet(request);
    const {id}=z.object({id:uuid}).parse(request.params);
    const order=await getOrder(id);
    const attempt=(await db.query('SELECT tx_hash FROM transactions WHERE order_id=$1 AND submitted_by=$2 ORDER BY created_at DESC,tx_hash DESC LIMIT 1',[id,wallet])).rows[0];
    if(!attempt)return {attempt:null};
    const result=client?await paymentAttempt(client,order,attempt.tx_hash,wallet,config.confirmations):{state:'pending',retryAllowed:false};
    return {attempt:{hash:attempt.tx_hash,payer:wallet,...result}};
  });
  app.get('/v1/orders/:id/status', async request => {
    const row = await readableOrder(request);
    const settled = ['confirmed','final'].includes(row.status);
    return { orderId: row.id, status: viewOrder(row).status, settlementVerified: settled,
      settlement: settled ? row.settlement : null, transactionHash:row.settlement_tx, blockNumber:row.settlement_block,
      explorerUrl: row.settlement_tx ? `${mezoTestnet.blockExplorers.default.url}/tx/${row.settlement_tx}` : null,
      reason: client ? null : 'CHAIN_RECONCILIATION_NOT_ENABLED' };
  });
  await registerProtocol(app,{db,config,client,verifier,currentWallet,merchantFor,getOrder,viewOrder});
  return app;
}
