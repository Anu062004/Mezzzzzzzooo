# Protocol reference

## Trust boundaries

MezoLoop separates wallet authorization, blockchain settlement, and application state. The API holds operational metadata and hashed login sessions. Customers and merchants retain their own payment keys. An optional keeper key can pay transaction gas and trigger already-authorized subscription charges; it cannot change the mandate.

The chain is authoritative. Submitted transaction hashes are hints, while canonical contract events provide settlement evidence. The indexer records block hashes, confirmation states, and recovery cursors before projecting payments into the database.

## Signed checkout

The receiver and financial signer are the merchant owner's authenticated wallet. An authenticated session prepares an order; the owner then signs its exact EIP-712 terms.

Domain:

| Field | Value |
| --- | --- |
| `name` | `MezoLoop` |
| `version` | `1` |
| `chainId` | `31611` |
| `verifyingContract` | The order's deployed PaymentRouter address |

```solidity
Quote(bytes32 orderId,address merchant,address token,uint256 amount,address partner,uint16 referralBps,uint16 cashbackBps,uint256 deadline)
```

`orderId` is the Keccak-256 hash of the UTF-8 order UUID. Deadlines are Unix seconds. Token amounts use exact integer atomic units. Each order stores its router address so an environment change cannot silently alter its signature domain.

Referral and cashback shares are rounded down using full-precision multiplication/division. The merchant receives the remainder. Their sum always equals the gross MUSD amount. Platform fees are zero.

The payer is the wallet executing the transaction. The quote itself is a bearer checkout and does not bind a particular customer. The router validates the merchant's signature, token, deadline, split bounds, and scoped order replay flag before transferring tokens. Required transfers succeed atomically or revert together.

## Cancellation and refunds

A merchant cancels an order with an on-chain router transaction. A database change alone does not revoke a signed quote.

Refunds are separate merchant-authorized token transfers linked to an original quote hash. Cumulative refunds cannot exceed its original gross amount. Refunds do not claw back previously distributed referral commissions, cashback, or campaign rewards; the merchant funds the refund.

## Referral agreements

PartnershipRegistry records merchant-approved partner addresses, rates, and expiry, and allows the merchant to revoke an agreement. Checkout authorization remains the merchant's signed quote. Registry revocation does not retroactively invalidate an independently signed quote; cancel that order through the router when needed.

## Reward campaigns

RewardsVault maintains a separate budget per merchant campaign. A campaign fixes its reward, minimum purchase, start time, and expiry. Funding checks the received token balance delta. A customer can claim against a qualifying router payment once per campaign, subject to available funding and campaign expiry. Only the campaign merchant can reclaim its remaining budget after expiry.

Rewards are a separate claim transaction. Checkout settlement does not guarantee an unconditional MEZO reward or reserve a reward budget. The MEZO precompile's real testnet compatibility still needs integration verification before enabling public reward campaigns.

## Recurring consent

SubscriptionManager is created by PaymentRouter and is the only caller allowed to invoke its recurring settlement path. Merchants sign a plan defining the receiver, partner, amount, rates, interval, start, expiry, maximum charge count, and nonce. The customer authorizes the plan through a wallet transaction.

The contract limits successful charges, enforces expiry and cancellation, and schedules the next charge at least one full interval after the previous one. Missed charges do not accumulate into an immediate catch-up burst. The customer can cancel future billing on-chain. Approvals prepared by the API are bounded to the plan's maximum aggregate amount.

## Offer redemption

OffersRedemption verifies merchant-signed, customer-specific discount commitments with an amount, deadline, and single-use ID. Redemption records the commitment; it does not automatically reduce a separate checkout quote. The merchant must issue the intended discounted quote for payment.

## Authentication and storage

Sessions use random 256-bit bearer tokens stored as SHA-256 hashes. Challenge consumption and session creation occur atomically. Login messages bind the domain, URI, chain, nonce, issuance time, and expiry. A challenge cookie binds verification to the requesting browser.

Order idempotency is scoped to merchant and key. Matching requests return the existing order; conflicting reuse returns 409. Inputs normalize address case and defaults before hashing. Database constraints resolve concurrent inserts, and a PostgreSQL trigger protects immutable financial terms.

Production cookies are HTTP-only, Secure, host-only, and SameSite=Strict. Mutating requests require an exact Origin match. Multiple API replicas require shared rate limiting and deliberate trusted-proxy configuration.

## Indexing and callbacks

The worker scans bounded block ranges, validates log block hashes, commits event projections with its cursor, and reconciles canonical history when a stored checkpoint changes. Confirmation and finality labels are configurable application policies, not an assertion of irreversible chain consensus.

Payment events are matched against stored quote hashes and financial terms. Browser callbacks cannot independently mark an order paid. Canonical subscription events drive keeper discovery; the manager contract independently checks every charge.

Webhook registration requires merchant authorization. Delivery secrets use AES-256-GCM encryption at rest. Requests include an HMAC-SHA256 signature over `timestamp.body`, a delivery ID, and timestamp. Consumers should verify signatures, enforce timestamp tolerance, and deduplicate delivery IDs. Deliveries use retries and may be repeated. Destination validation and pinned public IPv4 resolution protect delivery against private-network targeting and DNS rebinding.

## Verification boundaries

The repository includes backend integration tests and Foundry unit/fuzz tests. These checks cover the asserted behaviors in their test files; they are not an independent security audit.

A disposable local Anvil integration test covers settlement, restart, confirmation isolation, and reorg rollback. A guarded contract deployment script, Docker image, and worker health probe are included. Remaining deployment-level work includes actual Mezo Testnet MUSD and MEZO transfers, hosted monitoring, and an end-to-end receipt matched to a public testnet transaction. No mainnet readiness or completed hosted deployment is claimed.

The landing page remains a presentation layer with a local payment-split illustration. Separate merchant/customer workspaces connect injected EVM wallets to the protocol API and contracts; see [frontend integration](frontend.md). Browser tests use controlled fixtures, not funded live transactions.
