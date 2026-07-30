-- 054_company_commercial_intent.sql
-- What the customer BOUGHT, recorded against the company rather than the Sippy account.
--
-- THE SEPARATION THIS ENFORCES
-- A company is commercially defined long before a Sippy account exists. Products and
-- markets are agreed when the contract is signed; the account appears at provisioning,
-- possibly weeks later. Storing that intent in customer_product_assignments — which is
-- keyed by i_account — means it cannot be captured until the very step it is supposed to
-- drive, so the wizard had nowhere to put a product selection and would have discarded it
-- on save.
--
--   BitsAuto tables  (here)              what the customer bought
--   Sippy tables     (i_account keyed)   what we built on the switch
--
-- Provisioning becomes a translator between them, and can be re-run from the intent
-- without an operator re-entering anything.
--
-- ONLY TWO TABLES ARE NEW. The rest of the company's commercial configuration already
-- lives on `companies` from migrations 038/044 — provisioning_profile_id,
-- routing_package_id, notification_profile_id and rate_policy. Adding parallel tables for
-- those would create a second place each answer lives.
--
-- Idempotent.

BEGIN;

-- Which products this customer is sold. Drives the rate matrix fan-out (one tariff row
-- per product per destination) and the authentication rules (the product digit inside
-- each incoming CLD).
CREATE TABLE IF NOT EXISTS company_products (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES product_registry(id) ON DELETE RESTRICT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by   VARCHAR(128),
  -- One row per pair. Selling a product twice is not a quantity, it is a duplicate, and
  -- without this the rate matrix would emit the same prefix twice.
  CONSTRAINT uq_company_product UNIQUE (company_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_company_products_company ON company_products (company_id);

COMMENT ON TABLE company_products IS
  'Products this customer buys — BitsAuto commercial intent, recorded at company creation. Distinct from customer_product_assignments, which records what exists on the Sippy account and only after provisioning.';

-- Which destinations this customer is sold. References the catalogue, so a market cannot
-- name a destination that does not exist — the same rule the rate generator enforces.
CREATE TABLE IF NOT EXISTS company_markets (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES global_destinations(id) ON DELETE RESTRICT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by     VARCHAR(128),
  CONSTRAINT uq_company_market UNIQUE (company_id, destination_id)
);
CREATE INDEX IF NOT EXISTS idx_company_markets_company ON company_markets (company_id);

COMMENT ON TABLE company_markets IS
  'Destinations this customer is sold, referencing global_destinations. Empty means the platform default commercial set applies — an explicit narrower list is a deliberate restriction, not an omission.';

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.company_products') IS NULL THEN
    RAISE EXCEPTION 'company_products was not created';
  END IF;
  IF to_regclass('public.company_markets') IS NULL THEN
    RAISE EXCEPTION 'company_markets was not created';
  END IF;
  -- Deliberately no backfill. Existing companies have no recorded product selection, and
  -- inventing one would put commercial intent nobody agreed to into the system. An empty
  -- selection already means "the platform default applies", which is what those companies
  -- are provisioned against today.
  RAISE NOTICE 'company_products and company_markets ready. Existing companies have no explicit selection, which means the platform default set applies — as it does today.';
END $$;

COMMIT;
