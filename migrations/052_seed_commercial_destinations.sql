-- 052_seed_commercial_destinations.sql
-- Give Commercial the destinations BitsAuto actually sells, as product assignments.
--
-- THE PROBLEM THIS SOLVES
-- global_destinations holds ~150,254 rows and essentially all of them are
-- commercial_status='approved' — so "approved" is the operational catalogue's resting
-- state, not a commercial decision. Driving pricing from it produced a template of
-- 150,254 destinations x 8 products.
--
-- The commercial set is product_destination_assignments: Commercial's record of which
-- destinations are offered on which product, maintained by drag-and-drop on the Product
-- Registry page. It is the right table and it is empty, so the pricing pipeline has
-- nothing to work from and every downstream step reports zero.
--
-- WHY NOT A NEW commercial_destinations TABLE
-- It would sit upstream of a table that already expresses exactly this, making curation
-- two steps instead of one and re-pointing an existing foreign key. The gap is not a
-- missing concept — it is missing DATA. Commercial cannot find 32 destinations inside a
-- 150k tree to drag onto, so this seeds the 32 and lets them add and remove from there.
--
-- WHERE THE 32 COME FROM
-- Migration 041, "owner-supplied 2026-07-28": Bangladesh, India and Pakistan breakouts,
-- the destinations this business prices today. They live in rate_card_entries as bare
-- dial prefixes, so each is matched to its catalogue entry by dial_prefix.
--
-- CANONICAL PRODUCTS ONLY (FC/BC/SB/SC). The -R variants exist in product_registry but
-- nobody has said whether they are retail equivalents or experiments, and assigning
-- prices to them on a guess would put 128 rows of invented commercial intent into the
-- system. Commercial adds them by hand if they are real.
--
-- Idempotent. Additive only — it never deactivates an assignment someone made.

BEGIN;

DO $$
DECLARE
  r          RECORD;
  dest_id    INTEGER;
  matched    INTEGER := 0;
  unmatched  INTEGER := 0;
  created    INTEGER := 0;
  card_id    INTEGER;
BEGIN
  SELECT id INTO card_id FROM rate_cards
   WHERE name = 'Standard Wholesale' AND card_type = 'client' LIMIT 1;
  IF card_id IS NULL THEN
    RAISE NOTICE 'Standard Wholesale client rate card not found (migration 041 did not seed here) — nothing to derive the commercial set from.';
    RETURN;
  END IF;

  FOR r IN SELECT DISTINCT prefix, country, breakout FROM rate_card_entries
            WHERE rate_card_id = card_id AND prefix IS NOT NULL ORDER BY prefix
  LOOP
    -- Exact dial_prefix match only. A fuzzy match here would assign a product to the
    -- wrong destination, and every rate and authentication rule downstream would inherit
    -- that mistake — the whole point of catalogue-driven pricing is that the code is
    -- authoritative.
    SELECT id INTO dest_id FROM global_destinations
     WHERE dial_prefix = r.prefix AND commercial_status = 'approved'
     ORDER BY id LIMIT 1;

    IF dest_id IS NULL THEN
      unmatched := unmatched + 1;
      RAISE NOTICE 'no approved catalogue entry for prefix % (% / %) — assign it by hand once the catalogue has one',
        r.prefix, COALESCE(r.country, '?'), COALESCE(r.breakout, '?');
      CONTINUE;
    END IF;
    matched := matched + 1;

    -- Canonical four only, and only if the product exists on this database.
    INSERT INTO product_destination_assignments (product_id, destination_id, status, created_by)
    SELECT p.id, dest_id, 'active', 'migration 052'
      FROM product_registry p
     WHERE p.code IN ('FC', 'BC', 'SB', 'SC')
       AND NOT EXISTS (
             SELECT 1 FROM product_destination_assignments a
              WHERE a.product_id = p.id AND a.destination_id = dest_id);
    GET DIAGNOSTICS created = ROW_COUNT;
  END LOOP;

  RAISE NOTICE 'commercial destinations: % prefix(es) matched to the catalogue, % unmatched', matched, unmatched;
  RAISE NOTICE 'product assignments now active: %',
    (SELECT COUNT(*) FROM product_destination_assignments WHERE status = 'active');
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Deliberately NOT fatal on zero. A database whose catalogue has no matching approved
-- entries is a data state for a human to resolve, not a reason to halt the runner and
-- block every migration after this one — that failure mode cost this project a day.
DO $$
DECLARE n INTEGER; orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM product_destination_assignments WHERE status = 'active';
  IF n = 0 THEN
    RAISE NOTICE 'WARNING: no active product assignments. The rate template will be empty until Commercial assigns destinations on the Product Registry page.';
  END IF;

  -- An assignment pointing at a destination that no longer exists would silently drop out
  -- of every join, making a priced destination look unpriced.
  SELECT COUNT(*) INTO orphans FROM product_destination_assignments a
   WHERE NOT EXISTS (SELECT 1 FROM global_destinations d WHERE d.id = a.destination_id);
  IF orphans > 0 THEN
    RAISE EXCEPTION '% product assignment(s) reference a destination that does not exist', orphans;
  END IF;
END $$;

COMMIT;
