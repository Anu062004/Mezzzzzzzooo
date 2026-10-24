import {encodeFunctionData,type Hex} from 'viem';
import {paymentRouterAbi} from './abi.js';
import {typedQuote} from './index.js';
import type {ChainClient} from './client.js';

// A wallet callback is only a hint. Check the exact signed call and canonical
// inclusion before permitting a retry after a reverted payment.
export async function paymentAttempt(client:ChainClient,order:Record<string,any>,hash:Hex,payer:string,confirmations:number){
 try{
  const transaction=await client.getTransaction({hash});
  const expected=encodeFunctionData({abi:paymentRouterAbi,functionName:'pay',args:[typedQuote(order.quote.terms,order.quote.router).message,order.signature]});
  if(transaction.from.toLowerCase()!==payer.toLowerCase()||transaction.to?.toLowerCase()!==order.quote.router.toLowerCase()||transaction.input.toLowerCase()!==expected.toLowerCase()||transaction.value!==0n)return {state:'unrelated',retryAllowed:false};
  const receipt=await client.getTransactionReceipt({hash});
  const [block,head]=await Promise.all([client.getBlock({blockNumber:receipt.blockNumber}),client.getBlockNumber({cacheTime:0})]);
  if(block.hash!==receipt.blockHash||head<receipt.blockNumber)return {state:'uncertain',retryAllowed:false};
  const depth=head-receipt.blockNumber+1n;
  if(receipt.status==='reverted')return {state:depth>=BigInt(confirmations)?'reverted':'confirming_revert',retryAllowed:depth>=BigInt(confirmations)};
  return {state:'included',retryAllowed:false};
 }catch{return {state:'pending',retryAllowed:false};}
}
