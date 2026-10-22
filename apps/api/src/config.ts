import { z } from 'zod';
import { isAddress, type Address } from 'viem';
const address = z.string().refine(v => isAddress(v) && !/^0x0{40}$/i.test(v));
export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const values = z.object({
    DATABASE_URL: z.string().min(1), PUBLIC_APP_URL: z.url(),
    MEZO_RPC_HTTP: z.url().default('https://rpc.test.mezo.org'),
    REWARDS_VAULT_ADDRESS: z.preprocess(v => v === '' ? undefined : v, address.optional()),
    PARTNERSHIP_REGISTRY_ADDRESS: z.preprocess(v => v === '' ? undefined : v, address.optional()),
    OFFERS_ADDRESS: z.preprocess(v => v === '' ? undefined : v, address.optional()),
    MEZO_RPC_FALLBACK: z.url().optional(),
    INDEXER_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
    CONFIRMATIONS: z.coerce.number().int().min(1).default(3),
    FINALITY_CONFIRMATIONS: z.coerce.number().int().min(3).default(12),
    PAYMENT_ROUTER_ADDRESS: z.preprocess(v => v === '' ? undefined : v, address.optional()),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('127.0.0.1'), NODE_ENV: z.enum(['development','test','production']).default('development'),
  }).parse(env);
  const origin = new URL(values.PUBLIC_APP_URL);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
    || !['http:', 'https:'].includes(origin.protocol)) throw new Error('PUBLIC_APP_URL must be an HTTP(S) origin');
  if (values.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error('Production requires HTTPS');
  return { databaseUrl: values.DATABASE_URL, origin: origin.origin, rpcUrl: values.MEZO_RPC_HTTP,
    router: values.PAYMENT_ROUTER_ADDRESS?.toLowerCase() as Address | undefined,
    rewardsVault: values.REWARDS_VAULT_ADDRESS?.toLowerCase() as Address | undefined,
    registry: values.PARTNERSHIP_REGISTRY_ADDRESS?.toLowerCase() as Address | undefined,
    offers: values.OFFERS_ADDRESS?.toLowerCase() as Address | undefined,
    rpcFallback: values.MEZO_RPC_FALLBACK, startBlock: BigInt(values.INDEXER_START_BLOCK),
    confirmations: values.CONFIRMATIONS, finality: Math.max(values.CONFIRMATIONS,values.FINALITY_CONFIRMATIONS),
    port: values.PORT, host: values.HOST, secureCookies: values.NODE_ENV === 'production' };
}
export type Config = ReturnType<typeof configFromEnv>;
