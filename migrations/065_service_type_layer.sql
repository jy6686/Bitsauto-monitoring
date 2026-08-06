-- 065_service_type_layer.sql
--
-- Plan 063B: the service-type tier, for every country. Vocabulary as DATA.
--
-- Creates Country -> Type nodes (Mobile, Fixed, Satellite, ...) lazily — only
-- where a row classifies to them — and parents every stray commercial row
-- beneath the right one. Three sweeps:
--
--   S1  level-1 roots whose whole name is an ISO alpha-3 code (`AFG`, `COL`)
--       are country ALIASES, not operators: absorbed into the country's
--       surviving root exactly as 064 absorbed twins, recorded in
--       destination_merge_map with reason 'iso3_alias'.
--   S2  level-1 orphans (`PAK Mobile MOBLIN`, `BANGLADESH FIXED`,
--       `Ivory Coast Mobile MTN`) resolve their country from the leading
--       token(s) — alpha-3 register first, then EXACT leading-token match on
--       the canonical name; never fuzzy — and their type from the first
--       vocabulary word in the remainder. No type word -> Unclassified.
--       No country -> destination_repair_exceptions, visibly.
--   S3  level-2 children of surviving roots that are not type nodes (`UFONE`,
--       `PAKISTAN MOBILE` 923) classify the same way and move to level 3.
--
-- Rules are rows in service_type_vocabulary, not code: the migration joins
-- against it, and destination-classifier.ts (imports) reads the same table.
-- Every classification writes provenance to destination_classification —
-- a bad rule is a targeted rollback, not a re-derivation (V2 063C design).
--
-- The gap-over-guess asymmetry is unchanged: `Speser`, `Moser`, cities and
-- `Special Services` phrasings carry no whole vocabulary word and land in
-- Unclassified for manual review. A wrong guess bills silently; a gap is
-- visible. Expected placement on production, from the frozen addendum:
-- ~621 Mobile / ~223 Unclassified / ~65 Fixed / ~73 exceptions. Deviation from
-- that is a finding, not a failure.
--
-- No renames, no dedup (066), no status change (067). Idempotent: moved rows
-- leave the sweeps' populations; exceptions and provenance upsert.

BEGIN;

-- iso3 joins the reference (alpha-3 is how legacy rows name countries).
ALTER TABLE countries ADD COLUMN IF NOT EXISTS iso3 CHAR(3);
UPDATE countries c SET iso3 = v.i3
  FROM (VALUES ('AD','AND'),('AE','ARE'),('AF','AFG'),('AG','ATG'),('AI','AIA'),('AL','ALB'),('AM','ARM'),('AO','AGO'),('AR','ARG'),('AS','ASM'),('AT','AUT'),('AU','AUS'),('AZ','AZE'),('BA','BIH'),('BB','BRB'),('BD','BGD'),('BE','BEL'),('BF','BFA'),('BG','BGR'),('BH','BHR'),('BI','BDI'),('BJ','BEN'),('BM','BMU'),('BO','BOL'),('BR','BRA'),('BS','BHS'),('BT','BTN'),('BW','BWA'),('BY','BLR'),('BZ','BLZ'),('CA','CAN'),('CD','COD'),('CH','CHE'),('CL','CHL'),('CM','CMR'),('CN','CHN'),('CO','COL'),('CR','CRI'),('CU','CUB'),('CY','CYP'),('CZ','CZE'),('DE','DEU'),('DK','DNK'),('DM','DMA'),('DO','DOM'),('DZ','DZA'),('EC','ECU'),('EE','EST'),('EG','EGY'),('ER','ERI'),('ES','ESP'),('ET','ETH'),('FI','FIN'),('FR','FRA'),('GB','GBR'),('GD','GRD'),('GE','GEO'),('GH','GHA'),('GM','GMB'),('GN','GIN'),('GR','GRC'),('GT','GTM'),('GU','GUM'),('HK','HKG'),('HR','HRV'),('HU','HUN'),('ID','IDN'),('IE','IRL'),('IL','ISR'),('IN','IND'),('IQ','IRQ'),('IR','IRN'),('IS','ISL'),('IT','ITA'),('JM','JAM'),('JO','JOR'),('JP','JPN'),('KE','KEN'),('KG','KGZ'),('KH','KHM'),('KN','KNA'),('KP','PRK'),('KR','KOR'),('KW','KWT'),('KY','CYM'),('KZ','KAZ'),('LA','LAO'),('LB','LBN'),('LC','LCA'),('LK','LKA'),('LR','LBR'),('LS','LSO'),('LT','LTU'),('LU','LUX'),('LV','LVA'),('LY','LBY'),('MA','MAR'),('MD','MDA'),('ME','MNE'),('MG','MDG'),('MK','MKD'),('ML','MLI'),('MM','MMR'),('MN','MNG'),('MP','MNP'),('MS','MSR'),('MT','MLT'),('MU','MUS'),('MV','MDV'),('MW','MWI'),('MX','MEX'),('MY','MYS'),('MZ','MOZ'),('NA','NAM'),('NE','NER'),('NG','NGA'),('NI','NIC'),('NL','NLD'),('NO','NOR'),('NP','NPL'),('NZ','NZL'),('OM','OMN'),('PA','PAN'),('PE','PER'),('PH','PHL'),('PK','PAK'),('PL','POL'),('PR','PRI'),('PS','PSE'),('PT','PRT'),('PY','PRY'),('QA','QAT'),('RO','ROU'),('RS','SRB'),('RU','RUS'),('RW','RWA'),('SA','SAU'),('SD','SDN'),('SE','SWE'),('SG','SGP'),('SI','SVN'),('SK','SVK'),('SL','SLE'),('SO','SOM'),('SR','SUR'),('SS','SSD'),('SV','SLV'),('SY','SYR'),('SZ','SWZ'),('TC','TCA'),('TH','THA'),('TJ','TJK'),('TM','TKM'),('TN','TUN'),('TR','TUR'),('TT','TTO'),('TW','TWN'),('TZ','TZA'),('UA','UKR'),('UG','UGA'),('US','USA'),('UY','URY'),('UZ','UZB'),('VC','VCT'),('VE','VEN'),('VG','VGB'),('VI','VIR'),('VN','VNM'),('YE','YEM'),('ZA','ZAF'),('ZM','ZMB'),('ZW','ZWE')) AS v(i2, i3)
 WHERE c.iso2 = v.i2 AND c.iso3 IS DISTINCT FROM v.i3;
CREATE UNIQUE INDEX IF NOT EXISTS countries_iso3_idx ON countries (iso3) WHERE iso3 IS NOT NULL;

-- The classification rules, as data. Whole-word, lower-case terms.
CREATE TABLE IF NOT EXISTS service_type_vocabulary (
  term         VARCHAR(32) PRIMARY KEY,
  service_type VARCHAR(32) NOT NULL
);
INSERT INTO service_type_vocabulary (term, service_type) VALUES
  ('mobile','Mobile'), ('fixed','Fixed'), ('landline','Fixed'),
  ('satellite','Satellite'), ('premium','Premium'), ('voip','VoIP'),
  ('paging','Paging')
ON CONFLICT (term) DO NOTHING;

-- Per-destination provenance: which rule classified it, when.
CREATE TABLE IF NOT EXISTS destination_classification (
  destination_id INTEGER PRIMARY KEY,
  rule           VARCHAR(40) NOT NULL,
  classification VARCHAR(32) NOT NULL,
  confidence     VARCHAR(16) NOT NULL DEFAULT 'deterministic',
  classified_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The visible worklist for rows the rules cannot place.
CREATE TABLE IF NOT EXISTS destination_repair_exceptions (
  destination_id INTEGER PRIMARY KEY,
  name           VARCHAR(256) NOT NULL,
  reason         VARCHAR(40) NOT NULL,
  detail         VARCHAR(256),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $body$
DECLARE
  r          RECORD;
  cref       RECORD;
  root_id    INTEGER;
  type_id    INTEGER;
  toks       TEXT[];
  stype      TEXT;
  lead       TEXT;
  k          INTEGER;
  i          INTEGER;
  n          INTEGER;
  s1_alias   INTEGER := 0;
  s1_refs    INTEGER := 0;
  s2_typed   INTEGER := 0;
  s2_unclass INTEGER := 0;
  s2_exc     INTEGER := 0;
  s3_moved   INTEGER := 0;
  nodes_new  INTEGER := 0;
BEGIN
  IF to_regclass('public.destination_merge_map') IS NULL THEN
    RAISE EXCEPTION '065: destination_merge_map missing — 064 has not run.';
  END IF;

  -- ── S1: alpha-3 alias roots absorb into the survivor ─────────────────────
  FOR r IN
    SELECT d.id, d.name FROM destinations d
     WHERE d.level = 1 AND d.country_code IS NULL
       AND NOT EXISTS (SELECT 1 FROM destination_merge_map m WHERE m.old_id = d.id)
       AND trim(d.name) ~ '^[A-Za-z]{3}$'
  LOOP
    SELECT * INTO cref FROM countries WHERE iso3 = upper(trim(r.name));
    IF cref.id IS NULL THEN CONTINUE; END IF;   -- e.g. `FROM` — S2 reports it

    SELECT d2.id INTO root_id FROM destinations d2
     WHERE d2.level = 1 AND upper(trim(d2.country_code)) = cref.iso2
       AND NOT EXISTS (SELECT 1 FROM destination_merge_map m WHERE m.old_id = d2.id)
     ORDER BY d2.id LIMIT 1;
    IF root_id IS NULL THEN
      INSERT INTO destination_repair_exceptions (destination_id, name, reason, detail)
      VALUES (r.id, r.name, 'alias_without_root', cref.iso2)
      ON CONFLICT (destination_id) DO NOTHING;
      CONTINUE;
    END IF;

    UPDATE destinations SET parent_id = root_id, updated_at = now() WHERE parent_id = r.id;
    UPDATE product_destination_assignments SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;
    UPDATE product_rates SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;
    UPDATE company_markets SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;
    UPDATE deal_destinations SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;
    UPDATE destination_product_rates SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;
    UPDATE vendor_rate_normalized_prefixes SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;
    UPDATE destination_id_map SET destination_id = root_id WHERE destination_id = r.id;
    GET DIAGNOSTICS n = ROW_COUNT; s1_refs := s1_refs + n;

    INSERT INTO destination_merge_map (old_id, new_id, iso2, reason)
    VALUES (r.id, root_id, cref.iso2, 'iso3_alias')
    ON CONFLICT (old_id) DO NOTHING;
    s1_alias := s1_alias + 1;
  END LOOP;

  -- ── S2: classify the level-1 orphans ─────────────────────────────────────
  FOR r IN
    SELECT d.id, d.name FROM destinations d
     WHERE d.level = 1 AND d.country_code IS NULL
       AND NOT EXISTS (SELECT 1 FROM destination_merge_map m WHERE m.old_id = d.id)
  LOOP
    toks := regexp_split_to_array(trim(r.name), '\s+');
    k := 0;

    -- Country from token 1 via alpha-3 …
    SELECT * INTO cref FROM countries WHERE iso3 = upper(toks[1]);
    IF cref.id IS NOT NULL THEN
      k := 1;
    ELSE
      -- … or from the leading tokens, exact match on the canonical name only.
      FOR i IN REVERSE LEAST(3, array_length(toks,1))..1 LOOP
        lead := lower(array_to_string(toks[1:i], ' '));
        SELECT * INTO cref FROM countries WHERE lower(canonical_name) = lead;
        IF cref.id IS NOT NULL THEN k := i; EXIT; END IF;
      END LOOP;
    END IF;

    IF cref.id IS NULL THEN
      INSERT INTO destination_repair_exceptions (destination_id, name, reason, detail)
      VALUES (r.id, r.name, 'unknown_country', toks[1])
      ON CONFLICT (destination_id) DO NOTHING;
      s2_exc := s2_exc + 1;
      CONTINUE;
    END IF;

    SELECT d2.id INTO root_id FROM destinations d2
     WHERE d2.level = 1 AND upper(trim(d2.country_code)) = cref.iso2
       AND NOT EXISTS (SELECT 1 FROM destination_merge_map m WHERE m.old_id = d2.id)
     ORDER BY d2.id LIMIT 1;
    IF root_id IS NULL THEN
      INSERT INTO destination_repair_exceptions (destination_id, name, reason, detail)
      VALUES (r.id, r.name, 'country_without_root', cref.iso2)
      ON CONFLICT (destination_id) DO NOTHING;
      s2_exc := s2_exc + 1;
      CONTINUE;
    END IF;

    -- Type from the first vocabulary word after the country tokens.
    stype := NULL;
    IF array_length(toks,1) > k THEN
      SELECT v.service_type INTO stype
        FROM unnest(toks[k+1:array_length(toks,1)]) WITH ORDINALITY AS t(tok, ord)
        JOIN service_type_vocabulary v ON v.term = lower(t.tok)
       ORDER BY t.ord LIMIT 1;
    END IF;
    IF stype IS NULL THEN stype := 'Unclassified'; s2_unclass := s2_unclass + 1;
    ELSE s2_typed := s2_typed + 1; END IF;

    -- Ensure the type node, lazily.
    SELECT d3.id INTO type_id FROM destinations d3
     WHERE d3.parent_id = root_id AND lower(trim(d3.name)) = lower(stype)
     ORDER BY d3.id LIMIT 1;
    IF type_id IS NULL THEN
      INSERT INTO destinations (parent_id, level, name, sort_order, lifecycle_state,
                                commercial_status, created_at, updated_at)
      VALUES (root_id, 2, stype, 0, 'approved', 'approved', now(), now())
      RETURNING id INTO type_id;
      nodes_new := nodes_new + 1;
    END IF;

    UPDATE destinations SET parent_id = type_id, level = 3, updated_at = now()
     WHERE id = r.id;
    INSERT INTO destination_classification (destination_id, rule, classification)
    VALUES (r.id, CASE WHEN k = 1 AND cref.iso3 = upper(toks[1]) THEN 'iso3+vocab' ELSE 'name+vocab' END, stype)
    ON CONFLICT (destination_id) DO NOTHING;
  END LOOP;

  -- ── S3: non-type level-2 children of surviving roots ─────────────────────
  FOR r IN
    SELECT d.id, d.name, d.parent_id AS root_id FROM destinations d
      JOIN destinations p ON p.id = d.parent_id AND p.level = 1 AND p.country_code IS NOT NULL
     WHERE d.level = 2
       AND lower(trim(d.name)) NOT IN
           (SELECT DISTINCT lower(service_type) FROM service_type_vocabulary
            UNION SELECT 'unclassified' UNION SELECT 'toll free' UNION SELECT 'shared cost'
            UNION SELECT 'personal number' UNION SELECT 'services' UNION SELECT 'special services')
       AND NOT EXISTS (SELECT 1 FROM destination_merge_map m WHERE m.old_id = p.id)
  LOOP
    toks := regexp_split_to_array(trim(r.name), '\s+');
    SELECT v.service_type INTO stype
      FROM unnest(toks) WITH ORDINALITY AS t(tok, ord)
      JOIN service_type_vocabulary v ON v.term = lower(t.tok)
     ORDER BY t.ord LIMIT 1;
    IF stype IS NULL THEN stype := 'Unclassified'; END IF;

    SELECT d3.id INTO type_id FROM destinations d3
     WHERE d3.parent_id = r.root_id AND lower(trim(d3.name)) = lower(stype)
       AND d3.id <> r.id
     ORDER BY d3.id LIMIT 1;
    IF type_id IS NULL THEN
      INSERT INTO destinations (parent_id, level, name, sort_order, lifecycle_state,
                                commercial_status, created_at, updated_at)
      VALUES (r.root_id, 2, stype, 0, 'approved', 'approved', now(), now())
      RETURNING id INTO type_id;
      nodes_new := nodes_new + 1;
    END IF;

    UPDATE destinations d4 SET parent_id = type_id, level = 3, updated_at = now()
     WHERE d4.id = r.id;
    UPDATE destinations SET level = 4, updated_at = now()
     WHERE parent_id = r.id AND level <> 4;
    INSERT INTO destination_classification (destination_id, rule, classification)
    VALUES (r.id, 'level2+vocab', stype)
    ON CONFLICT (destination_id) DO NOTHING;
    s3_moved := s3_moved + 1;
  END LOOP;

  RAISE NOTICE '065 S1 (aliases): % alpha-3 root(s) absorbed, % reference(s) translated.', s1_alias, s1_refs;
  RAISE NOTICE '065 S2 (level-1 orphans): % typed, % to Unclassified, % exception(s).', s2_typed, s2_unclass, s2_exc;
  RAISE NOTICE '065 S3 (level-2 strays): % moved under their type.', s3_moved;
  RAISE NOTICE '065: % type node(s) created.', nodes_new;
END $body$;

-- ── Placement report, from provenance ─────────────────────────────────────────
DO $rep$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT classification, count(*) AS n FROM destination_classification
            GROUP BY classification ORDER BY n DESC
  LOOP
    RAISE NOTICE '065 placement: % -> % row(s)', r.classification, r.n;
  END LOOP;
  FOR r IN SELECT reason, count(*) AS n FROM destination_repair_exceptions
            GROUP BY reason ORDER BY n DESC
  LOOP
    RAISE NOTICE '065 exceptions: % -> % row(s)', r.reason, r.n;
  END LOOP;
END $rep$;

COMMIT;
