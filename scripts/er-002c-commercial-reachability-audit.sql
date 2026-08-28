-- ER-002C — commercial reachability: READY or BROKEN, with the first failing stage
--
-- The certification report before publication. For every commercial identity:
--
--     identity -> prefix -> product rate -> published to Sippy
--
-- and the answer is READY, or BROKEN at the first stage that fails. Not a score, not a
-- percentage — an operator needs to know whether they can sell a destination today and, if
-- not, which single thing to fix.
--
-- ── PRECONDITION: run scripts/er-002b-commercial-identity-audit.sql FIRST, same session ──
-- This deliberately reuses ER-002B's `er002b_identity` temp table rather than re-deriving the
-- identity key. Two copies of "what is a commercial identity" would drift, and the day they
-- disagree is the day both reports become unusable. Running this alone fails loudly below —
-- an immediate error, never a silent wrong answer.
DO $$
BEGIN
  IF to_regclass('pg_temp.er002b_identity') IS NULL THEN
    RAISE EXCEPTION 'ER-002C precondition: run scripts/er-002b-commercial-identity-audit.sql first, in THIS psql session (it builds the er002b_identity temp table this script reads).';
  END IF;
END$$;


-- ══ Stage 1 — the invariant ══════════════════════════════════════════════════════════
-- "Every commercially selectable destination must resolve to EXACTLY ONE canonical identity."
-- Not one-or-more. Not first-match. Exactly one.
--
-- This is stage 1 because it is the precondition for every stage after it: if an identity
-- resolves to two rows, "does it have a rate" has two answers and neither is wrong. Section C
-- of ER-002B lists the offenders; this counts them as a gate.
SELECT count(*) FILTER (WHERE n = 1) AS identities_resolving_to_exactly_one,
       count(*) FILTER (WHERE n > 1) AS identities_violating_the_invariant,
       CASE WHEN count(*) FILTER (WHERE n > 1) = 0 THEN 'INVARIANT HOLDS'
            ELSE 'INVARIANT VIOLATED — publication blocked' END AS verdict
  FROM (SELECT country, identity_key, count(*) AS n
          FROM er002b_identity WHERE country IS NOT NULL
         GROUP BY country, identity_key) g;


-- ══ The reachability report ══════════════════════════════════════════════════════════
-- Rate coverage is computed against BOTH rate tables, separately and on purpose. ADR-001 has
-- not been decided, so "has a product rate" has two possible meanings — and the difference
-- between the two columns is direct evidence for ADR-001's criterion C4 (risk of data loss):
-- an identity rated in one table and not the other is a row that a wrong branch would strand.
--
-- Rates are matched by PREFIX, not by destination_id. ER-001 measured product_rates.destination_id
-- as entirely NULL on the workspace, so an id join would report universal BROKEN and call it a
-- finding. Which key matched is reported, not assumed.
DROP TABLE IF EXISTS pg_temp.er002c_reach;
CREATE TEMP TABLE er002c_reach AS
WITH ident AS (
  SELECT country, identity_key,
         count(*)                                                              AS n_rows,
         count(DISTINCT ltrim(dial_prefix,'+')) FILTER (WHERE dial_prefix IS NOT NULL) AS n_prefixes,
         array_agg(DISTINCT ltrim(dial_prefix,'+')) FILTER (WHERE dial_prefix IS NOT NULL) AS prefixes,
         -- Grouping node or sellable leaf. Does NOT change the verdict — a node with no
         -- prefix is unsellable either way — but 065 created type nodes with no prefix, and
         -- without this column they are indistinguishable from a genuinely broken operator
         -- row and the "no prefix" headline reads as far worse than it is.
         bool_or(EXISTS (SELECT 1 FROM destinations c WHERE c.parent_id = i.id)) AS has_children
    FROM er002b_identity i
   WHERE country IS NOT NULL
   GROUP BY country, identity_key
),
rated AS (
  SELECT i.country, i.identity_key,
         EXISTS (SELECT 1 FROM product_rates pr
                  WHERE ltrim(pr.prefix,'+') = ANY (i.prefixes))               AS in_product_rates,
         EXISTS (SELECT 1 FROM destination_product_rates dpr
                  WHERE ltrim(dpr.dial_prefix,'+') = ANY (i.prefixes))         AS in_destination_product_rates
    FROM ident i
),
published AS (
  SELECT i.country, i.identity_key,
         EXISTS (SELECT 1 FROM rate_push_jobs j
                  WHERE j.status = 'completed'
                    AND j.full_prefix IS NOT NULL
                    AND ltrim(j.full_prefix, COALESCE(j.trunk_prefix,'')) = ANY (i.prefixes))
                                                                               AS pushed
    FROM ident i
)
SELECT i.country, i.identity_key, i.n_rows, i.n_prefixes, i.has_children,
       r.in_product_rates, r.in_destination_product_rates, p.pushed,
       CASE
         WHEN i.n_rows    > 1                                        THEN 'BROKEN: identity not unique'
         WHEN i.n_prefixes = 0                                       THEN 'BROKEN: no prefix'
         WHEN NOT (r.in_product_rates OR r.in_destination_product_rates)
                                                                     THEN 'BROKEN: no product rate'
         WHEN NOT p.pushed                                           THEN 'BROKEN: never published'
         ELSE                                                             'READY'
       END AS status
  FROM ident i
  JOIN rated     r ON r.country = i.country AND r.identity_key = i.identity_key
  JOIN published p ON p.country = i.country AND p.identity_key = i.identity_key;

-- Headline: how much of the catalogue is actually sellable, and where the wall is.
SELECT status,
       count(*)                                  AS identities,
       count(*) FILTER (WHERE NOT has_children)  AS sellable_leaves,
       count(*) FILTER (WHERE has_children)      AS grouping_nodes,
       round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 2) AS pct
  FROM er002c_reach GROUP BY status ORDER BY identities DESC;

-- Per-identity detail, worst stage first.
SELECT country, identity_key, status, n_rows, n_prefixes, has_children,
       in_product_rates, in_destination_product_rates, pushed
  FROM er002c_reach
 ORDER BY CASE status
            WHEN 'BROKEN: identity not unique' THEN 1
            WHEN 'BROKEN: no prefix'           THEN 2
            WHEN 'BROKEN: no product rate'     THEN 3
            WHEN 'BROKEN: never published'     THEN 4
            ELSE 5 END,
          country, identity_key
 LIMIT 500;


-- ══ ADR-001 evidence — rate coverage by table ════════════════════════════════════════
-- Feeds ADR-001 criterion C4 directly. `only_destination_product_rates` is the count of
-- commercial identities that Branch A would strand; `only_product_rates` is what Branch B
-- would strand. C4 is a veto, so a non-zero cell here is not a preference, it is a
-- requirement on whichever branch is chosen to carry those rows across.
SELECT count(*) FILTER (WHERE in_product_rates AND NOT in_destination_product_rates) AS only_product_rates,
       count(*) FILTER (WHERE in_destination_product_rates AND NOT in_product_rates) AS only_destination_product_rates,
       count(*) FILTER (WHERE in_product_rates AND in_destination_product_rates)     AS both,
       count(*) FILTER (WHERE NOT in_product_rates AND NOT in_destination_product_rates) AS neither
  FROM er002c_reach;
