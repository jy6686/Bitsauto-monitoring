-- 064_country_identity_merge.sql
--
-- Plan 063A: one country, one root — for EVERY country, driven by the seeded
-- `countries` reference (file 063). Not Pakistan-specific.
--
-- The catalogue stores most countries twice at level 1: an ISO-coded root
-- (`Pakistan`/PK) and a dial-coded root (`Pakistan`/92), each owning different
-- children. Some countries exist under two NAMES (`UAE`/AE and
-- `United Arab Emirates`/971) — the identity split named in
-- DESTINATION-CATALOGUE-V2's principles. Every consumer has had to bridge this
-- (client twinIds since 6de33bac); this migration makes the bridge unnecessary.
--
-- ── Matching rules ────────────────────────────────────────────────────────────
-- A level-1 root belongs to reference country C when:
--     upper(trim(country_code)) = C.iso2         (ISO identity), or
--     lower(trim(name))         = lower(C.canonical_name)   (exact name)
-- Dial codes are NEVER a matching key on their own: +1 is 25 entries and +7 is
-- two countries, so dial-based matching manufactures NANP merges. Exact-match
-- only, per V2 ("aliases are exact-match only. Never prefix, never fuzzy").
--
-- ── Survivor rule (deterministic) ─────────────────────────────────────────────
-- The ISO-coded root survives; if none, the root with the most children; ties
-- break on lowest id. The survivor is then given BOTH identities as attributes:
-- country_code := iso2, and dial_prefix := reference dial code when it has none.
-- That is V2 063A's three cases in one rule: merge / attach ISO / create dial.
--
-- ── What happens to a losing twin ─────────────────────────────────────────────
-- Its children re-parent to the survivor. Every reference in the six audited
-- destination_id tables (ER-001 / proposal audit) is translated to the
-- survivor, and destination_id_map targets are re-pointed so legacy resolution
-- stays correct. The correspondence is recorded PERMANENTLY in
-- destination_merge_map — the 059 lesson: the map outlives the operation.
-- The loser row itself REMAINS, as an empty husk: no children, no references.
-- Deleting is a separate, later decision; the UI already collapses same-name
-- roots, so a husk is invisible and harmless. product_history is History, not
-- Reference (frozen classification), and is deliberately not translated.
--
-- NO renames. `UAE` keeps its name even as it absorbs `United Arab Emirates` —
-- names feed notifications and workbooks; renaming is its own decision.
--
-- Idempotent: on a second run every candidate set collapses to the survivor
-- alone, every UPDATE is guarded, and the report prints zeros.
--
-- The RAISE NOTICE lines are the report, in two populations kept separate:
--   A — countries (matched / merged / no root)
--   B — references translated, per table

BEGIN;

CREATE TABLE IF NOT EXISTS destination_merge_map (
  old_id     INTEGER PRIMARY KEY,
  new_id     INTEGER NOT NULL,
  iso2       CHAR(2),
  reason     VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE destination_merge_map IS
  'Level-1 country twin merges, written by migration 064. Kept permanently: the only way to resolve a merged root id after the husk is eventually archived.';

DO $$
DECLARE
  c            RECORD;
  survivor     RECORD;
  loser        RECORD;
  n            INTEGER;
  absorbed     INTEGER;
  -- Population A
  a_one        INTEGER := 0;   -- countries already single-rooted
  a_merged     INTEGER := 0;   -- countries where >=2 roots merged
  a_absorbed   INTEGER := 0;   -- loser roots absorbed
  a_none       INTEGER := 0;   -- reference countries with no catalogue root
  a_iso_fixed  INTEGER := 0;   -- survivors given their ISO identity
  a_dial_fixed INTEGER := 0;   -- survivors given their dial identity
  -- Population B
  b_children   INTEGER := 0;
  b_assign     INTEGER := 0;
  b_rates      INTEGER := 0;
  b_markets    INTEGER := 0;
  b_deals      INTEGER := 0;
  b_dpr        INTEGER := 0;
  b_vrnp       INTEGER := 0;
  b_map        INTEGER := 0;
BEGIN
  IF to_regclass('public.countries') IS NULL THEN
    RAISE EXCEPTION '064: `countries` does not exist — 063 has not run. The runner applies files in order, so this should be impossible; refusing rather than guessing.';
  END IF;

  FOR c IN SELECT id, canonical_name, iso2, dial_code FROM countries
            WHERE classification IN ('country','territory') AND iso2 IS NOT NULL
            ORDER BY canonical_name
  LOOP
    -- Candidate roots for this country, by ISO identity or exact name only.
    SELECT d.id, d.country_code, d.dial_prefix,
           (SELECT count(*) FROM destinations ch WHERE ch.parent_id = d.id) AS children,
           (upper(trim(d.country_code)) = c.iso2) AS is_iso
      INTO survivor
      FROM destinations d
     WHERE d.level = 1
       AND NOT EXISTS (SELECT 1 FROM destination_merge_map mm WHERE mm.old_id = d.id)
       AND ( upper(trim(d.country_code)) = c.iso2
          OR lower(trim(d.name)) = lower(c.canonical_name) )
     ORDER BY (upper(trim(d.country_code)) = c.iso2) DESC,
              (SELECT count(*) FROM destinations ch WHERE ch.parent_id = d.id) DESC,
              d.id
     LIMIT 1;

    IF survivor.id IS NULL THEN
      a_none := a_none + 1;
      CONTINUE;
    END IF;

    -- Give the survivor both identities, guarded.
    UPDATE destinations SET country_code = c.iso2, updated_at = now()
     WHERE id = survivor.id AND country_code IS DISTINCT FROM c.iso2;
    GET DIAGNOSTICS n = ROW_COUNT; a_iso_fixed := a_iso_fixed + n;

    UPDATE destinations SET dial_prefix = c.dial_code, updated_at = now()
     WHERE id = survivor.id AND dial_prefix IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; a_dial_fixed := a_dial_fixed + n;

    -- Absorb every other candidate root.
    absorbed := 0;
    FOR loser IN
      SELECT d.id
        FROM destinations d
       WHERE d.level = 1 AND d.id <> survivor.id
         AND NOT EXISTS (SELECT 1 FROM destination_merge_map mm WHERE mm.old_id = d.id)
         AND ( upper(trim(d.country_code)) = c.iso2
            OR lower(trim(d.name)) = lower(c.canonical_name) )
    LOOP
      absorbed := absorbed + 1;

      UPDATE destinations SET parent_id = survivor.id, updated_at = now()
       WHERE parent_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_children := b_children + n;

      UPDATE product_destination_assignments SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_assign := b_assign + n;

      UPDATE product_rates SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_rates := b_rates + n;

      UPDATE company_markets SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_markets := b_markets + n;

      UPDATE deal_destinations SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_deals := b_deals + n;

      UPDATE destination_product_rates SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_dpr := b_dpr + n;

      UPDATE vendor_rate_normalized_prefixes SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_vrnp := b_vrnp + n;

      UPDATE destination_id_map SET destination_id = survivor.id
       WHERE destination_id = loser.id;
      GET DIAGNOSTICS n = ROW_COUNT; b_map := b_map + n;

      INSERT INTO destination_merge_map (old_id, new_id, iso2, reason)
      VALUES (loser.id, survivor.id, c.iso2, 'country_twin')
      ON CONFLICT (old_id) DO NOTHING;
    END LOOP;

    IF absorbed > 0 THEN
      a_merged   := a_merged + 1;
      a_absorbed := a_absorbed + absorbed;
    ELSE
      a_one := a_one + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '064 A (countries): % single-rooted, % merged (% root(s) absorbed), % with no catalogue root; % survivor(s) given ISO identity, % given dial identity.',
               a_one, a_merged, a_absorbed, a_none, a_iso_fixed, a_dial_fixed;
  RAISE NOTICE '064 B (references): % children re-parented; translated — assignments %, product_rates %, company_markets %, deal_destinations %, destination_product_rates %, vendor_rate_normalized_prefixes %, destination_id_map %.',
               b_children, b_assign, b_rates, b_markets, b_deals, b_dpr, b_vrnp, b_map;
END $$;

-- ── Verify: no reference country should have two matched roots left ───────────
DO $$
DECLARE r RECORD; bad INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.canonical_name, c.iso2, count(d.id) AS roots
      FROM countries c
      JOIN destinations d
        ON d.level = 1
       AND ( upper(trim(d.country_code)) = c.iso2
          OR lower(trim(d.name)) = lower(c.canonical_name) )
      LEFT JOIN destination_merge_map m ON m.old_id = d.id
     WHERE c.iso2 IS NOT NULL AND m.old_id IS NULL   -- husks don't count
     GROUP BY c.canonical_name, c.iso2
    HAVING count(d.id) > 1
  LOOP
    bad := bad + 1;
    RAISE NOTICE '064 EXCEPTION: % (%) still has % unmerged roots.', r.canonical_name, r.iso2, r.roots;
  END LOOP;
  IF bad = 0 THEN
    RAISE NOTICE '064: verify clean — every matched country resolves to one live root.';
  END IF;
END $$;

COMMIT;
