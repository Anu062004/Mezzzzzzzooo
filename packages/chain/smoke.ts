import assert from 'node:assert/strict';
import { createPublicClient, erc20Abi, getAddress, http } from 'viem';
import { mezoTestnet, MUSD } from './index.js';

// Read-only: this script never sends a transaction or loads a private key.
const client = createPublicClient({ chain: mezoTestnet,
  transport: http(process.env.MEZO_RPC_HTTP || mezoTestnet.rpcUrls.default.http[0], { timeout: 10000, retryCount: 1 }) });
assert.equal(await client.getChainId(), mezoTestnet.id, 'RPC must be Mezo Testnet');
const code = await client.getCode({ address: MUSD });
assert.ok(code && code !== '0x', 'MUSD bytecode is missing');
const decimals = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: 'decimals' });
assert.equal(decimals, 18, 'Unexpected MUSD decimals');
const router = process.env.PAYMENT_ROUTER_ADDRESS;
if (router) {
  const routerCode = await client.getCode({ address: getAddress(router) });
  assert.ok(routerCode && routerCode !== '0x', 'Router bytecode is missing');
}
console.log(JSON.stringify({ chainId: mezoTestnet.id, block: String(await client.getBlockNumber()),
  token: MUSD, decimals, routerBytecodeChecked: Boolean(router), settlementTested: false }));
