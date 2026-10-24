# Run and deploy MezoLoop

The frontend, API, worker, and PostgreSQL database run as separate services. The repository includes an API/worker Docker image, a local Compose stack, and a Mezo Testnet contract deployment script. These files do not deploy infrastructure automatically.

## Run locally

Use Node.js 24, Docker Compose, and Foundry. Install dependencies with `npm ci`. If `.env` does not already exist, copy `.env.example` to `.env`; keep existing credentials and contract addresses intact.

```sh
# Starts PostgreSQL, runs migrations, and starts the API.
docker compose --profile backend up --build -d api
npm run web:dev
```

Open `http://localhost:3000`. The Compose stack is for local development: it binds PostgreSQL and the API to localhost and uses development database credentials. It overrides `DATABASE_URL` inside containers to reach the `db` service. Do not use this Compose file as an Internet-facing production database configuration.

The API validates the RPC network and MUSD interface at startup. Payment creation requires a deployed router. After configuring the contract addresses and deployment block in `.env`, start the worker:

```sh
docker compose --profile backend up --build -d worker
docker compose --profile backend logs --tail=100 api worker
```

For a host-based development setup, use `docker compose up -d db`, `npm run db:migrate`, `npm run dev`, and `npm run worker` in separate terminals.

## Deploy contracts when ready

`contracts/script/Deploy.s.sol` accepts only chain ID **31611**, checks MUSD's 18-decimal interface, and deploys the payment router, referral registry, and offers contract. The router creates its subscription manager. Rewards are optional: `DEPLOY_REWARDS=true` also checks the MEZO interface and deploys a rewards vault bound to the router.

Use a gas-funded testnet wallet stored in an encrypted Foundry keystore. Import it interactively rather than placing a private key in a command, source file, or README:

```sh
cast wallet import mezoloop-deployer --interactive

# Simulation only; review the results before broadcasting.
forge script --root contracts script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.test.mezo.org \
  --account mezoloop-deployer --chain 31611

# Run this command yourself when ready to deploy.
forge script --root contracts script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.test.mezo.org \
  --account mezoloop-deployer --chain 31611 --broadcast
```

Set `PAYMENT_ROUTER_ADDRESS`, `PARTNERSHIP_REGISTRY_ADDRESS`, and `OFFERS_ADDRESS` from the resulting deployment. Set `REWARDS_VAULT_ADDRESS` only if deployed. Set `INDEXER_START_BLOCK` to the earliest contract deployment block from the broadcast receipts, then run `npm run chain:smoke`. Foundry broadcast files are ignored by Git; retain them privately to support resuming interrupted deployments. Do not rerun a fresh deployment to recover an interrupted one without checking the existing receipts.

The optional rewards tests use a local ERC-20 substitute. They do not establish that MEZO precompile reward transfers work on the hosted testnet.

## Host the API and worker

Build the shared image from the repository root:

```sh
docker build -t mezoloop-backend .
```

The build context allows only package manifests, backend source, and shared packages. Private `.env` files and keys are excluded. Both services run as the unprivileged `node` user.

Create a production PostgreSQL database and inject configuration through your hosting provider's environment/secret settings:

| Setting | API | Worker | Web frontend |
| --- | --- | --- | --- |
| `DATABASE_URL` | Required | Required, same database | — |
| `PUBLIC_APP_URL` | Exact HTTPS frontend origin | Same origin | — |
| `NODE_ENV` | `production` | `production` | Platform-managed |
| `HOST` | `0.0.0.0` | — | — |
| `PORT` | Platform port, default `3001` | — | Platform-managed |
| `MEZO_RPC_HTTP` | Verified testnet RPC | Same network | — |
| Contract addresses | Deployed addresses | Same addresses | Loaded through API |
| `INDEXER_START_BLOCK` | Deployment block | Deployment block | — |
| `CONFIRMATIONS` / `FINALITY_CONFIRMATIONS` | Same policy | Same policy | — |
| `API_ORIGIN` | — | — | HTTPS API origin, server-only |
| `PUBLIC_SITE_URL` | — | — | Public frontend origin |
| `WEBHOOK_ENCRYPTION_KEY` | Required for webhook registration | Same key for delivery | — |
| `WORKER_PRIVATE_KEY` | — | Optional subscription keeper only | — |

Run the migration command once as a release job before starting either service. Migrations are transactional and protected by a PostgreSQL advisory lock.

| Process | Command |
| --- | --- |
| Release migration | `node --import tsx packages/db/migrate.ts` |
| API | `node --import tsx apps/api/src/server.ts` |
| Worker | `node --import tsx apps/worker/src/server.ts` |
| Worker health probe | `node --import tsx apps/worker/src/health.ts` |

The Docker image defaults to the API command and checks `/health/ready`. Override both the command and health probe for a worker service. The worker does not listen on an HTTP port. Its probe fails when no successful indexing cycle has completed within three minutes; this indicates indexing activity, not complete catch-up to the chain head. Start with one worker instance. Leave the keeper key unset if recurring charges will not be executed automatically.

Expose the API behind your host's HTTPS endpoint. Configure `API_ORIGIN` on Vercel, then rebuild/redeploy the frontend. Browser requests continue through the frontend's same-origin `/v1` proxy. `PUBLIC_APP_URL` must match the exact frontend origin; preview deployments with another hostname need their own API configuration. Never add a `NEXT_PUBLIC_` prefix to secrets or the backend connection URL.

## Verify after your deployment

1. Confirm `/health/live` and `/health/ready` respond successfully. Readiness checks the database; `payments: not_enabled` means the router is unset.
2. Run `npm run chain:smoke` using the deployed configuration. Inspect `/v1/operations` while signed in to confirm indexer cursors advance.
3. Create a small signed checkout from the merchant interface. Open the QR/link with another test wallet holding MUSD and test BTC.
4. Review the exact approval and payment. Confirm that both customer and merchant screens remain pending until the worker verifies settlement.
5. Check the explorer, merchant/payer token balances, receipt download, and any configured webhook. Test interrupted callbacks and refresh recovery.

Only this deployment-level exercise establishes that your hosted services and actual testnet assets work together.

## Local verification without deploying

```sh
npm run contracts:build
npm run contracts:test
npm run typecheck
npm run web:typecheck
npm test
npm run test:payments
npm run web:build
npx playwright install chromium
CI=1 npm run web:test
```

`test:payments` creates a disposable local Anvil chain and embedded PostgreSQL database. It generates temporary in-memory wallets, installs a local test token at the expected MUSD address, and exercises real contract transactions through the API and indexer. It verifies exact transfers, confirmation depth, isolated contract confirmation updates, restart idempotency, lagging RPC handling, reorg rollback, and replacement settlement. It uses no `.env`, external RPC, hosted database, or real funds.

The browser tests use controlled wallet/API responses and cover the interfaces separately. The local chain test is not a public Mezo testnet deployment.
