-- 521: per-company authentication planner mode — 'country' (the frozen v1.0 planner) or
-- 'breakout' (rules per priced prefix, derived from the same catalogue expansion as the
-- customer's tariff rows).
--
-- Observed on 2026-09-15, account 1069 (1global): tariff 68 held the Afghanistan First
-- Class prefixes 19370 and 19371 while the account's twelve authentication rules covered
-- only the country codes 880, 91 and 92 — a call to a priced destination failed
-- authentication before it could be rated. The country planner cannot express a breakout;
-- the breakout planner can. It is selected explicitly, per company, so no existing customer's
-- rule set changes until an operator chooses it.
--
-- Default 'country': every existing row keeps the behaviour it has.
BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS auth_rule_mode VARCHAR(16) NOT NULL DEFAULT 'country';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_auth_rule_mode_chk') THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_auth_rule_mode_chk CHECK (auth_rule_mode IN ('country', 'breakout'));
  END IF;
END $$;

COMMIT;
