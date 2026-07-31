-- 053_commercial_destination_nodes.sql
-- Add the commercial-level destinations the catalogue is missing, then finish 052's work.
--
-- THE TWO GRANULARITIES
-- global_destinations models OPERATOR SERIES: 9230, 9231, 92333, 918000, 9178048 — the
-- right level for routing, LCR, fraud scoring and vendor quality. Commercial prices at
-- the BREAKOUT level: "PAKISTAN MOBILE @ 0.0400", one line. Both are correct; they answer
-- different questions.
--
-- 052 required an exact catalogue match and so refused 14 of the 32 priced prefixes —
-- 923, 918, 919, 8801 and the India mobile series. scripts/commercial-coverage.ts then
-- showed every one of them has approved operator children and NONE is genuinely absent.
-- The catalogue is not missing destinations; it is missing the level Commercial prices at.
--
-- WHY NOT SIMPLY DROP THOSE 14 FROM THE PRICE LIST — the answer this migration exists for.
-- An earlier version of the coverage script recommended exactly that, reasoning that
-- Sippy matches longest prefix so a generic entry could never win. That is only true when
-- both are IN THE SAME TARIFF. A generated customer tariff contains only the rows we put
-- in it: 1923 rates every 923xxxxxxx call, and the catalogue's finer entries are nowhere
-- near it. Dropping 923 would leave Pakistan Mobile unpriced. Pricing per operator series
-- instead would mean thousands of rows per customer rather than 128.
--
-- WHAT THIS DOES NOT DO: it does not re-parent the existing operator entries. Their
-- parent_id and level belong to the routing and analytics tree, and rewriting that to
-- satisfy pricing would be pricing reaching into a model it does not own. The new nodes
-- sit alongside; nothing that reads the operator level changes.
--
-- Derived from the data, not a hardcoded list of 14, so it stays correct if the price
-- list or the catalogue changes. Idempotent and additive.

BEGIN;

DO $$
DECLARE
  r        RECORD;
  card_id  INTEGER;
  parent   RECORD;
  new_id   INTEGER;
  added    INTEGER := 0;
BEGIN
  SELECT id INTO card_id FROM rate_cards
   WHERE name = 'Standard Wholesale' AND card_type = 'client' LIMIT 1;
  IF card_id IS NULL THEN
    RAISE NOTICE 'Standard Wholesale client card absent — no commercial price list to reconcile.';
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT e.prefix, e.country, e.breakout
      FROM rate_card_entries e
     WHERE e.rate_card_id = card_id
       AND e.prefix IS NOT NULL
       -- No entry at this exact prefix …
       AND NOT EXISTS (
             SELECT 1 FROM global_destinations d
              WHERE d.dial_prefix = e.prefix AND d.commercial_status = 'approved')
       -- … but operator entries beneath it, which is what makes this a LEVEL gap rather
       -- than a missing destination. Without this guard the migration would invent
       -- catalogue entries for prefixes nobody has ever routed.
       AND EXISTS (
             SELECT 1 FROM global_destinations d
              WHERE d.commercial_status = 'approved'
                AND d.dial_prefix LIKE e.prefix || '%' AND d.dial_prefix <> e.prefix)
     ORDER BY e.prefix
  LOOP
    -- Hang it beneath the nearest approved ancestor if there is one (923 under 92), so the
    -- tree stays navigable. No ancestor is fine — a root-level commercial node still
    -- prices correctly.
    -- country_code comes from the ancestor, never from the rate card. rate_card_entries
    -- .country holds a NAME ("Bangladesh"), country_code is varchar(4) — writing one into
    -- the other is what failed this migration on its first run.
    SELECT id, level, country_code INTO parent FROM global_destinations
     WHERE commercial_status = 'approved'
       AND r.prefix LIKE dial_prefix || '%' AND dial_prefix <> r.prefix
     ORDER BY length(dial_prefix) DESC LIMIT 1;

    INSERT INTO global_destinations
      (parent_id, level, name, country_code, dial_prefix, commercial_status, notes, sort_order)
    VALUES (
      parent.id,
      COALESCE(parent.level, 0) + 1,
      COALESCE(NULLIF(r.breakout, ''), NULLIF(r.country, ''), 'Commercial ' || r.prefix),
      parent.country_code,
      r.prefix,
      'approved',
      'Commercial pricing level (migration 053). Operator-series entries beneath this prefix remain the routing and analytics model; this node exists so the destination can be priced as one breakout.',
      500
    )
    RETURNING id INTO new_id;

    added := added + 1;
    RAISE NOTICE 'commercial node added: % (%) id=% parent=%',
      r.prefix, COALESCE(r.breakout, r.country, '?'), new_id, COALESCE(parent.id::TEXT, 'root');
  END LOOP;

  RAISE NOTICE 'commercial destination nodes added: %', added;
END $$;

-- ── Assign the newly-addable destinations to the canonical products ───────────
-- Same rule as 052: canonical four only. The -R variants remain unassigned until someone
-- says whether they are retail equivalents or experiments.
DO $$
DECLARE created INTEGER := 0;
BEGIN
  -- DISTINCT: a prefix can appear on more than one line of the rate card, and the
  -- NOT EXISTS below cannot see rows this same statement is inserting. Without it a
  -- duplicated line would create two assignments for one (product, destination), which
  -- the template would then count twice.
  INSERT INTO product_destination_assignments (product_id, destination_id, status, created_by)
  SELECT DISTINCT p.id, d.id, 'active', 'migration 053'
    FROM global_destinations d
    JOIN rate_card_entries e ON e.prefix = d.dial_prefix
    JOIN rate_cards c        ON c.id = e.rate_card_id AND c.name = 'Standard Wholesale' AND c.card_type = 'client'
   CROSS JOIN product_registry p
   WHERE d.commercial_status = 'approved'
     AND p.code IN ('FC', 'BC', 'SB', 'SC')
     AND NOT EXISTS (
           SELECT 1 FROM product_destination_assignments a
            WHERE a.product_id = p.id AND a.destination_id = d.id);
  GET DIAGNOSTICS created = ROW_COUNT;
  RAISE NOTICE 'product assignments created: %; now active: %',
    created, (SELECT COUNT(*) FROM product_destination_assignments WHERE status = 'active');
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE unpriced INTEGER; dupes INTEGER; dupe_detail TEXT;
BEGIN
  -- Every priced prefix should now resolve. Reported, not fatal: a prefix with no
  -- catalogue children was never this migration's to invent, and halting here would block
  -- every later migration over a commercial data question.
  SELECT COUNT(DISTINCT e.prefix) INTO unpriced
    FROM rate_card_entries e
    JOIN rate_cards c ON c.id = e.rate_card_id
   WHERE c.name = 'Standard Wholesale' AND c.card_type = 'client' AND e.prefix IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM global_destinations d
                      WHERE d.dial_prefix = e.prefix AND d.commercial_status = 'approved');
  IF unpriced > 0 THEN
    RAISE NOTICE 'WARNING: % priced prefix(es) still have no approved catalogue entry — run scripts/commercial-coverage.ts to see which and why.', unpriced;
  END IF;

  -- Two approved entries on one dial_prefix would make "which destination is this" depend
  -- on row order, in a table three subsystems key off.
  --
  -- NAMES THEM. This first raised as "1 dial_prefix value(s) have more than one approved
  -- catalogue entry" and halted 054-057 behind it, leaving an operator a count and no way
  -- to find the row. A migration that blocks a deployment has to say what to go and fix —
  -- the count only conveys how much reading is ahead.
  SELECT COUNT(*) INTO dupes FROM (
    SELECT dial_prefix FROM global_destinations
     WHERE commercial_status = 'approved' AND dial_prefix IS NOT NULL
     GROUP BY dial_prefix HAVING COUNT(*) > 1) d;
  IF dupes > 0 THEN
    SELECT string_agg(detail, E'\n  ' ORDER BY detail) INTO dupe_detail FROM (
      SELECT g.dial_prefix || '  ->  ' ||
             string_agg(g.id || ' ' || COALESCE(g.name,'(unnamed)'), ' | ' ORDER BY g.id) AS detail
        FROM global_destinations g
        JOIN (SELECT dial_prefix FROM global_destinations
               WHERE commercial_status = 'approved' AND dial_prefix IS NOT NULL
               GROUP BY dial_prefix HAVING COUNT(*) > 1) x ON x.dial_prefix = g.dial_prefix
       WHERE g.commercial_status = 'approved'
       GROUP BY g.dial_prefix
       LIMIT 20) s;

    RAISE EXCEPTION E'% dial_prefix value(s) have more than one approved catalogue entry:\n  %\n\nEach prefix must resolve to ONE approved destination — three subsystems key off it. Block or deprecate the duplicates in the Destination Catalogue, then re-deploy. (Approving every destination at once surfaces duplicates that were previously hidden because only one of each pair was approved.)',
      dupes, dupe_detail;
  END IF;
END $$;

COMMIT;
