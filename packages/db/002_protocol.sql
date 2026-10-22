ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN ('created','quoted','submitted','observed','confirmed','final','reverted','uncertain','cancelled'));
ALTER TABLE orders ADD COLUMN settlement jsonb;
ALTER TABLE orders ADD COLUMN settlement_tx text;
ALTER TABLE orders ADD COLUMN settlement_block bigint;
CREATE TABLE chain_events (
 chain_id integer NOT NULL, tx_hash text NOT NULL, log_index integer NOT NULL,
 contract text NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
 confirmation_state text NOT NULL DEFAULT 'observed', event_name text NOT NULL, payload jsonb NOT NULL, canonical boolean NOT NULL DEFAULT true,
 PRIMARY KEY(chain_id,tx_hash,log_index)
);
CREATE INDEX chain_events_block ON chain_events(chain_id,contract,block_number);
CREATE TABLE indexer_cursors(contract text PRIMARY KEY,last_block bigint NOT NULL,last_hash text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE indexed_blocks(contract text NOT NULL,number bigint NOT NULL,hash text NOT NULL,PRIMARY KEY(contract,number));
CREATE TABLE partnerships(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES merchants(id),partner text NOT NULL,bps integer NOT NULL CHECK(bps BETWEEN 0 AND 10000),expires_at timestamptz NOT NULL,nonce text NOT NULL,onchain_id text,created_at timestamptz DEFAULT now());
CREATE TABLE campaigns(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES merchants(id),name text NOT NULL,nonce text NOT NULL,terms jsonb NOT NULL,onchain_id text,created_at timestamptz DEFAULT now());
CREATE TABLE subscription_plans(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES merchants(id),terms jsonb NOT NULL,signature text,created_at timestamptz DEFAULT now());
CREATE TABLE subscriptions(id text PRIMARY KEY,customer text NOT NULL,merchant text NOT NULL,plan_hash text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE billing_attempts(subscription_id text NOT NULL,period bigint NOT NULL,tx_hash text,status text NOT NULL,attempts integer NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now(),PRIMARY KEY(subscription_id,period));
CREATE TABLE webhooks(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES merchants(id),url text NOT NULL,secret text NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now());
CREATE TABLE outbox(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,webhook_id uuid NOT NULL REFERENCES webhooks(id),event_key text NOT NULL,payload jsonb NOT NULL,attempts integer NOT NULL DEFAULT 0,next_attempt timestamptz DEFAULT now(),delivered_at timestamptz,UNIQUE(webhook_id,event_key));
CREATE TABLE offers(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES merchants(id),terms jsonb NOT NULL,signature text,created_at timestamptz DEFAULT now());
CREATE INDEX orders_merchant_created ON orders(merchant_id,created_at DESC);
CREATE INDEX outbox_due ON outbox(next_attempt) WHERE delivered_at IS NULL;
