CREATE TABLE wallets (
  address text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL DEFAULT 31611 CHECK (chain_id = 31611)
);
CREATE TABLE challenges (
  id uuid PRIMARY KEY, address text NOT NULL, message text NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, address text NOT NULL REFERENCES wallets(address),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE merchants (
  id uuid PRIMARY KEY, name text NOT NULL, owner_wallet text NOT NULL REFERENCES wallets(address),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE merchant_members (
  merchant_id uuid REFERENCES merchants(id), address text REFERENCES wallets(address),
  role text NOT NULL CHECK (role IN ('owner')), PRIMARY KEY(merchant_id,address)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES merchants(id),
  idempotency_key text NOT NULL, request_hash text NOT NULL,
  quote jsonb NOT NULL, quote_hash text NOT NULL UNIQUE, signature text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','quoted','submitted','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(merchant_id,idempotency_key)
);
CREATE TABLE order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id), event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE transactions (
  chain_id integer NOT NULL CHECK (chain_id=31611), tx_hash text NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id), submitted_by text NOT NULL REFERENCES wallets(address),
  confirmation_state text NOT NULL DEFAULT 'pending' CHECK (confirmation_state IN ('pending','observed','confirmed','final','reverted','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chain_id,tx_hash)
);
CREATE FUNCTION protect_order_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote IS DISTINCT FROM OLD.quote OR NEW.quote_hash IS DISTINCT FROM OLD.quote_hash
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Order financial terms are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_order BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_order_terms();
