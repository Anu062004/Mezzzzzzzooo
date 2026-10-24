# Merchant and customer interfaces

The web application shares MezoLoop's graphite/cobalt identity and exposes the existing protocol API through a same-origin Next.js route handler. Browser wallets sign messages and transactions directly. Private keys never enter the application.

## Routes

| Route | Purpose |
| --- | --- |
| `/merchant` | Merchant onboarding, chain-derived analytics, signed checkout creation, QR/link sharing, cancellation/refunds, referral agreements, funded rewards, subscription plans, offers, profile and webhook settings |
| `/customer` | Wallet balances, QR scanning, receipts, reward claims, subscription cancellation, personal offers, referral earnings |
| `/pay/:id` | Review and pay an immutable signed order |
| `/merchant/:id` | Public merchant profile and available signed checkouts |
| `/subscribe/:id` | Review recurring terms, maximum aggregate allowance, and subscription consent |

## Local setup

Copy `.env.example` to `.env` if you do not already have a private environment file. Start PostgreSQL, apply migrations, and start the API and web app in separate terminals:

```sh
docker compose up -d db
npm run db:migrate
npm run dev
npm run web:dev
```

Open `http://localhost:3000/merchant` or `http://localhost:3000/customer`. The browser origin must exactly match the API's `PUBLIC_APP_URL`. The web launcher reads only `API_ORIGIN` and `PUBLIC_SITE_URL` from the root `.env`; it does not load keeper keys or webhook encryption keys into the web build.

Set `API_ORIGIN` to the API's reachable origin (locally `http://127.0.0.1:3001`). It is server-only and must not use a `NEXT_PUBLIC_` prefix. The proxy preserves the browser's Origin and session cookies; the API checks authorization and origin independently. It forwards no arbitrary authentication headers and never follows upstream redirects.

Connect an injected EVM wallet on Mezo Testnet. Sign-in requires a message signature, not a transaction. Account or network changes clear the visible session and require sign-in again. Checkout, reward and subscription actions are available only when their contracts are configured.

## Deployment

The app now requires the Next.js runtime for dynamic checkout routes and the API proxy; static export is no longer used. Deploy from the repository root using `vercel --prod`.

On Vercel, configure `API_ORIGIN` to the independently hosted API's HTTPS origin. On the API service, configure `PUBLIC_APP_URL=https://mezoloop.vercel.app`, `NODE_ENV=production`, PostgreSQL credentials, and verified contract addresses. Run the worker separately for indexing and recurring execution. No public endpoint or deployment address is fabricated when infrastructure is missing: the interface shows an unavailable state and prevents live actions.

## Financial behavior

- Amounts use decimal strings and integer atomic units; excess decimal precision is rejected.
- Merchant checkouts use stable idempotency keys when a create request is retried. Rejected signatures leave a saved draft that can be signed from checkout history.
- Customer checkout calldata is reconstructed locally and compared against the API response before requesting wallet authorization.
- Approval amounts are bounded to the payment or subscription maximum. The wallet review shows the allowance, target contract and action.
- After approval inclusion, checkout preparation runs again to revalidate allowance and simulate payment.
- A submitted transaction remains pending. Only a canonical, confirmed indexer result marks a payment confirmed.
- Public transaction references are saved in browser storage immediately after broadcast. If the callback fails, reconnecting and refreshing retries recording the same hash without broadcasting another payment. Signed-order callbacks are accepted after expiry so delayed recovery does not discard a valid submission.
- One-off payment retries are offered only after the API verifies the exact payer, target, calldata, native value, and a canonical reverted receipt at the configured confirmation depth. Missing receipts and RPC errors remain pending.
- Merchant checkout details poll every five seconds. Customer checkout status errors are visible, and a pending submission takes precedence over an expired link.
- Confirmed receipts show the merchant, payer, split, block, and transaction; receipt downloads recheck confirmation before saving. Printed/downloaded receipts are snapshots and may become outdated after a reorg.
- Refunds are merchant-funded and do not recover previously distributed cashback or referral shares.
- Discounts do not automatically alter another quote. The merchant must create the intended discounted checkout.
- QR scanning accepts only supported checkout, merchant and subscription URLs on the current website's origin. Camera access is requested on demand and stopped when leaving the scanner.

## Verification limits

The browser suite uses controlled API/wallet fixtures for transaction flows; it does not broadcast funded transactions. Unit tests verify exact amounts and QR URL restrictions. Backend tests cover real signatures, session handling and merchant ownership, and proxy tests cover cookie/origin forwarding and failure behavior. Live Mezo testnet settlement, MEZO precompile reward transfers, and hosted indexer recovery still need deployment-level verification. A separate local Anvil/PostgreSQL integration test now exercises real contract settlement, restart, confirmation isolation, and reorg rollback. See [deployment and verification](deployment.md).
