import {createPublicClient, fallback, http, erc20Abi} from 'viem';
import {mezoTestnet,MUSD} from './index.js';
import {paymentRouterAbi,rewardsVaultAbi} from './abi.js';
import type {Config} from '../../apps/api/src/config.js';
export const MEZO='0x7b7c000000000000000000000000000000000001' as const;
export function chainClient(config: Config) {
 const urls=[config.rpcUrl,...(config.rpcFallback?[config.rpcFallback]:[])];
 return createPublicClient({chain:mezoTestnet,transport:fallback(urls.map(url=>http(url,{timeout:10000,retryCount:1})))});
}
export type ChainClient=ReturnType<typeof chainClient>;
export async function validateChain(client:ChainClient,config:Config) {
 if(await client.getChainId()!==31611)throw new Error('Wrong chain');
 if(await client.readContract({address:MUSD,abi:erc20Abi,functionName:'decimals'})!==18)throw new Error('Unexpected MUSD decimals');
 if(!config.router)return null;
 if((await client.readContract({address:config.router,abi:paymentRouterAbi,functionName:'token'})).toLowerCase()!==MUSD)throw new Error('Router token mismatch');
 const subscriptionManager=await client.readContract({address:config.router,abi:paymentRouterAbi,functionName:'subscriptionManager'});
 if(config.rewardsVault) {
  if((await client.readContract({address:config.rewardsVault,abi:rewardsVaultAbi,functionName:'router'})).toLowerCase()!==config.router)throw new Error('Vault router mismatch');
  if((await client.readContract({address:config.rewardsVault,abi:rewardsVaultAbi,functionName:'token'})).toLowerCase()!==MEZO)throw new Error('Vault token mismatch');
 }
 return {subscriptionManager};
}
