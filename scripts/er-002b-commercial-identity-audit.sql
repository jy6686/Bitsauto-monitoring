-- ER-002B — commercial identity duplicates, and the prefix inventory behind them
--
-- Companion to scripts/er-002-legacy-id-audit.sql. ER-002 answers "which id space does each
-- table use". This answers the two questions that gate the commercial picker:
--
--   C. which commercial identities exist more than once?      (what dedup must resolve)
--   D. which prefixes does each identity own?                 (input to destination_prefixes)
--   E. which prefixes are owned by more than one identity?    (routing ambiguity, worse than C)
--
-- Reads `destinations` only. It does NOT depend on destination_id_map or global_destinations,
-- so unlike ER-002 it is meaningful on any database carrying the catalogue.
--
-- ── This script REPORTS. It never merges. ────────────────────────────────────────────
-- Section B normalises names in order to group them. Normalisation is a hypothesis about
-- identity, and 065's governing asymmetry applies unchanged: a wrong guess bills silently, a
-- gap is visible. Every row this groups is a CANDIDATE for a human decision, and section C
-- prints the individual rows behind each group precisely so the grouping can be rejected.
--
-- Two known candidates are already owner decisions and must NOT be auto-merged when they
-- appear here — see docs/DESTINATION-COMMERCIAL-IDENTITY-PRINCIPLES.md:
--   OD-1  `Pakistan Mobile Jazz` x2 (9230, 9232) — one identity or two, is a pricing question
--   OD-2  `Pakistan Mobile SCO` vs `Pakistan SCO` — a taxonomy question


-- ══ A. Which database is this? ═══════════════════════════════════════════════════════
-- Workspace and production are different stores in different migration states (ER-001).
-- No number below travels without this line attached.
SELECT current_database(), current_user, inet_server_addr() AS host,
       (SELECT count(*) FROM destinations) AS destinations_rows;


-- ══ B. Identity resolution ═══════════════════════════════════════════════════════════
-- Country is resolved in a fixed precedence, and what cannot be resolved is REPORTED as
-- unresolved rather than guessed:
--
--   1. tree     — the level-1 ancestor, walked up parent_id. Most reliable.
--   2. token    — EXACT leading-token match on country name, iso3 or iso2, which is 065's
--                 S2 method. Never fuzzy. Needed because ~150k level-2 rows have no parent,
--                 so the tree alone resolves almost nothing on an unrepaired catalogue.
--   3. (none)   — reported in its own bucket.
--
-- The identity key is (country, name-with-the-country-token-stripped, lowercased, whitespace
-- collapsed). That is what collapses `Pakistan Mobile` / `Pakistan MOBILE` / `PAK Mobile`
-- onto one key while leaving `Pakistan Mobile Jazz` distinct from `Pakistan Mobile Zong`.
--
-- Service type is taken from the tree where the tree has it, and left NULL otherwise. It is
-- informational: the duplicate key is (country, identity), because a row whose type node is
-- missing is still a duplicate identity and must not escape section C by having no type.
DROP TABLE IF EXISTS pg_temp.er002b_identity;
CREATE TEMP TABLE er002b_identity AS
WITH RECURSIVE up AS (
  SELECT d.id AS node, d.id AS anc, d.parent_id, d.level AS anc_level, d.name AS anc_name, 0 AS steps
    FROM destinations d
  UNION ALL
  SELECT u.node, p.id, p.parent_id, p.level, p.name, u.steps + 1
    FROM up u JOIN destinations p ON p.id = u.parent_id
   WHERE u.steps < 8            -- cycle guard; a catalogue deeper than 8 is a finding itself
),
chain AS (
  SELECT node,
         min(anc_name) FILTER (WHERE anc_level = 1) AS tree_country,
         -- steps > 0: a node is never its own service type. An unparented level-2 row would
         -- otherwise report its own name as the type and split its own duplicate group.
         min(anc_name) FILTER (WHERE anc_level = 2 AND steps > 0) AS tree_type
    FROM up GROUP BY node
),
tok AS (
  -- Leading-token country match. LEFT JOIN LATERAL so a row matching nothing stays, with NULL.
  SELECT d.id, c.name AS tok_country, c.iso3, c.iso2, c.name AS cname
    FROM destinations d
    LEFT JOIN LATERAL (
      SELECT c.* FROM countries c
       WHERE lower(d.name) LIKE lower(c.name) || ' %'
          OR (c.iso3 IS NOT NULL AND lower(d.name) LIKE lower(c.iso3) || ' %')
          OR lower(d.name) LIKE lower(c.iso2) || ' %'
       ORDER BY length(c.name) DESC   -- longest name first: "United Arab Emirates" beats "U"
       LIMIT 1
    ) c ON TRUE
)
SELECT d.id,
       d.name,
       d.level,
       d.parent_id,
       d.dial_prefix,
       d.commercial_status,
       COALESCE(ch.tree_country, t.tok_country)                       AS country,
       CASE WHEN ch.tree_country IS NOT NULL THEN 'tree'
            WHEN t.tok_country   IS NOT NULL THEN 'token'
            ELSE 'unresolved' END                                     AS country_source,
       ch.tree_type                                                   AS service_type,
       -- the identity key: country token stripped, lowercased, whitespace collapsed
       regexp_replace(
         lower(trim(
           CASE
             WHEN t.cname IS NOT NULL AND lower(d.name) LIKE lower(t.cname) || ' %'
               THEN substr(d.name, length(t.cname) + 2)
             WHEN t.iso3 IS NOT NULL AND lower(d.name) LIKE lower(t.iso3) || ' %'
               THEN substr(d.name, length(t.iso3) + 2)
             WHEN t.iso2 IS NOT NULL AND lower(d.name) LIKE lower(t.iso2) || ' %'
               THEN substr(d.name, length(t.iso2) + 2)
             ELSE d.name
           END
         )), '\s+', ' ', 'g')                                         AS identity_key
  FROM destinations d
  LEFT JOIN chain ch ON ch.node = d.id
  LEFT JOIN tok   t  ON t.id    = d.id;

CREATE INDEX ON er002b_identity (country, identity_key);

-- Resolution coverage. If `unresolved` dominates, sections C-E describe only the part of the
-- catalogue that could be placed, and that limit is the headline finding, not a footnote.
SELECT country_source, count(*) AS rows,
       round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 2) AS pct
  FROM er002b_identity GROUP BY country_source ORDER BY rows DESC;


-- ══ C. Duplicate commercial identities ═══════════════════════════════════════════════
-- The report the picker cannot give you. Anything with n > 1 is a commercial identity stored
-- more than once, and is why breakoutOptions has to append `(9236)` to keep the dropdown
-- unambiguous. Ordered worst-first.
SELECT country,
       identity_key,
       count(*) AS n,
       -- informational only, and deliberately NOT part of the key: a row whose type node is
       -- missing is still a duplicate identity and must not escape this report by having no
       -- type. Several types listed here means the duplicates disagree about their own type.
       string_agg(DISTINCT coalesce(service_type, '(none)'), ', ') AS service_types
  FROM er002b_identity
 WHERE country IS NOT NULL
 GROUP BY country, identity_key
HAVING count(*) > 1
 ORDER BY n DESC, country, identity_key;

-- The rows behind each duplicate, so a grouping can be REJECTED rather than trusted.
-- Distinct prefixes on one identity is the OD-1 shape (Jazz owning 9230 and 9232) and may be
-- correct; identical prefixes on one identity is unambiguous duplication.
SELECT i.country, i.identity_key, i.id, i.name, i.dial_prefix, i.level,
       i.commercial_status, i.country_source
  FROM er002b_identity i
  JOIN (SELECT country, identity_key FROM er002b_identity
         WHERE country IS NOT NULL
         GROUP BY country, identity_key HAVING count(*) > 1) dup
    ON dup.country = i.country AND dup.identity_key = i.identity_key
 ORDER BY i.country, i.identity_key, i.id
 LIMIT 500;


-- ══ D. Prefix inventory per commercial identity ══════════════════════════════════════
-- The input to `destination_prefixes`: one row per commercial identity, every prefix it owns.
-- This is the shape Principle 2 specifies —
--     Pakistan Mobile Jazz -> 9230, 9232
-- and it is produced from the catalogue rather than asserted.
SELECT country,
       identity_key,
       count(DISTINCT ltrim(dial_prefix, '+')) FILTER (WHERE dial_prefix IS NOT NULL) AS n_prefixes,
       string_agg(DISTINCT ltrim(dial_prefix, '+'), ', '
                  ORDER BY ltrim(dial_prefix, '+'))                                   AS prefixes
  FROM er002b_identity
 WHERE country IS NOT NULL
 GROUP BY country, identity_key
 ORDER BY n_prefixes DESC NULLS LAST, country, identity_key
 LIMIT 500;

-- Identities carrying no prefix at all. They cannot be published or rated, and a commercial
-- picker offering them is offering something unsellable.
SELECT country, identity_key, count(*) AS rows
  FROM er002b_identity
 WHERE country IS NOT NULL AND dial_prefix IS NULL
 GROUP BY country, identity_key
 ORDER BY rows DESC
 LIMIT 100;


-- ══ E. Prefixes owned by more than one commercial identity ═══════════════════════════
-- Worse than a duplicate name. A duplicate identity is confusing; a prefix claimed by two
-- different identities means two commercial destinations compete for the same traffic and the
-- rate applied depends on which row a resolver reaches first. The proposal already measured
-- three such prefixes, all approved.
SELECT ltrim(dial_prefix, '+')                                          AS prefix,
       count(DISTINCT country || '|' || identity_key)                   AS n_identities,
       string_agg(DISTINCT country || ' / ' || identity_key, ' ; ')     AS identities
  FROM er002b_identity
 WHERE dial_prefix IS NOT NULL AND country IS NOT NULL
 GROUP BY ltrim(dial_prefix, '+')
HAVING count(DISTINCT country || '|' || identity_key) > 1
 ORDER BY n_identities DESC, prefix
 LIMIT 200;
