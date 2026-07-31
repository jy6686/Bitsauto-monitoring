-- 057_product_rates_effective_now.sql
-- A price with no start date starts today.
--
-- product_rates.effective_from is NOT NULL with no default, so every writer had to supply
-- it and POST /api/product-rates rejected the request outright when it did not:
--
--     400  productId, rate, effectiveFrom required
--
-- A price that was refused is indistinguishable from a price that was never entered, and
-- both look identical to the rate matrix: "no approved destination has a price for any
-- product". Provisioning reported every product unpriced, which was true, and gave no hint
-- that the reason was a rejected form field.
--
-- Entering a rate means "charge this", and the ordinary case is "charge this from now".
-- Scheduling a future price is the deliberate act and stays available by passing the field.
--
-- NOT a backfill. Existing rows keep the dates they were given — this changes what happens
-- when a date is OMITTED, not what any existing price means.
--
-- CURRENT_DATE is the database's date. The application layer sets the value explicitly in
-- UTC to match the readers (rates.step, rate-upload.service, routes-rate-manager all filter
-- on new Date().toISOString().slice(0,10)), so this default only applies to a writer that
-- bypasses the API — a script, a manual INSERT, a bulk load. For those, today in the
-- server's timezone is the right answer and a same-day mismatch is not possible, because
-- nothing schedules against it.
--
-- Idempotent.

BEGIN;

ALTER TABLE product_rates ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;

COMMENT ON COLUMN product_rates.effective_from IS
  'First day this price applies. Defaults to today — an omitted start date means "charge this from now". A future date is a deliberate schedule. Readers filter effective_from <= today AND (effective_to IS NULL OR effective_to >= today).';

DO $$
DECLARE
  d TEXT;
BEGIN
  SELECT column_default INTO d
    FROM information_schema.columns
   WHERE table_name = 'product_rates' AND column_name = 'effective_from';

  IF d IS NULL THEN
    RAISE EXCEPTION 'product_rates.effective_from still has no default';
  END IF;

  RAISE NOTICE 'product_rates.effective_from now defaults to %. Existing rows are untouched — this changes only what an omitted start date means.', d;
END $$;

COMMIT;
