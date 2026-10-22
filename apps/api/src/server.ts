import { chainClient, validateChain } from '../../../packages/chain/client.js';
import { mezoTestnet } from '../../../packages/chain/index.js';
import { postgres } from '../../../packages/db/index.js';
import { configFromEnv } from './config.js';
import { buildApp } from './app.js';
const config = configFromEnv();
const { db, close } = postgres(config.databaseUrl);
const client = chainClient(config);
await validateChain(client,config);
const app = await buildApp(db, config, {
  verifyMessage: async input => {
    if (await client.getChainId() !== mezoTestnet.id) throw new Error('Wrong RPC chain');
    return client.verifyMessage(input);
  },
  verifyQuote: async input => {
    if (await client.getChainId() !== mezoTestnet.id) throw new Error('Wrong RPC chain');
    return client.verifyTypedData(input);
  },
}, true, client);
app.addHook('onClose', close);
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void app.close(); });
await app.listen({ port: config.port, host: config.host });
