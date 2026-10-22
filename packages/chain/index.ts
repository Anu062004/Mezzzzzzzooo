import { defineChain, hashTypedData, type Address } from 'viem';
export const mezoTestnet = defineChain({
  id: 31611, name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.test.mezo.org' } },
  testnet: true,
});
export const MUSD = '0x118917a40faf1cd7a13db0ef56c86de7973ac503' as Address;
export const ZERO = '0x0000000000000000000000000000000000000000' as Address;
export const quoteTypes = { Quote: [
  { name: 'orderId', type: 'bytes32' }, { name: 'merchant', type: 'address' },
  { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'partner', type: 'address' }, { name: 'referralBps', type: 'uint16' },
  { name: 'cashbackBps', type: 'uint16' }, { name: 'deadline', type: 'uint256' },
] } as const;
export interface Quote {
  orderId: `0x${string}`; merchant: Address; token: Address; amount: string;
  partner: Address; referralBps: number; cashbackBps: number; deadline: string;
}
export function typedQuote(quote: Quote, router: Address) {
  return { domain: { name: 'MezoLoop', version: '1', chainId: 31611, verifyingContract: router },
    types: quoteTypes, primaryType: 'Quote' as const,
    message: { ...quote, amount: BigInt(quote.amount), deadline: BigInt(quote.deadline) } };
}
export function quoteHash(quote: Quote, router: Address) { return hashTypedData(typedQuote(quote, router)); }
export function split(amount: string, referralBps: number, cashbackBps: number) {
  const gross = BigInt(amount);
  if (gross <= 0n || gross >= 2n ** 256n || !Number.isInteger(referralBps) || !Number.isInteger(cashbackBps)
    || referralBps < 0 || cashbackBps < 0 || referralBps + cashbackBps > 10000) throw new Error('Invalid split');
  const referral = gross * BigInt(referralBps) / 10000n;
  const cashback = gross * BigInt(cashbackBps) / 10000n;
  return { merchantAtomic: (gross - referral - cashback).toString(), referralAtomic: referral.toString(), cashbackAtomic: cashback.toString(), feeAtomic: '0' };
}
