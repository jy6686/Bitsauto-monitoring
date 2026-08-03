-- CAP-022 §6 — baseline measurement of routing intent vs observed reality.
--
-- Read-only. Answers: how often does LCR route somewhere other than the vendor the
-- route-test job intended, and is that divergence random or systematic?
--
-- Run:  psql "$DATABASE_URL" -f scripts/cap022-vendor-divergence.sql
--
-- Record the output in CAP-022 §6 before ratifying any vendor-targeting option, and
-- again after cutover — on the synthetic account family the rate must be zero.

\echo '== 0. Environment check — is this a populated environment? =='
-- Run this first. Zero route_test_results means the analysis below returns empty sets
-- that must be read as UNKNOWN, never as "0% divergence".
--   jobs > 0, results = 0  -> jobs configured but never executed here (or scheduler idle)
--   jobs = 0, results = 0  -> feature never used in this environment (likely dev/fresh)
--   both > 0               -> proceed; check query 6 for how much carries _vendorMismatch
SELECT
  (SELECT count(*) FROM route_test_jobs)    AS route_test_jobs,
  (SELECT count(*) FROM route_test_results) AS route_test_results,
  (SELECT count(*) FROM governed_calls)     AS governed_calls,
  (SELECT count(*) FROM fas_events)         AS fas_events,
  current_database()                        AS db;

\echo '== 1. Overall divergence rate =='
SELECT
  count(*)                                                              AS runs,
  count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true')     AS mismatches,
  round(100.0 * count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true')
        / nullif(count(*), 0), 1)                                       AS mismatch_pct,
  min(started_at)                                                       AS first_run,
  max(started_at)                                                       AS last_run
FROM route_test_results
WHERE raw_response ? '_vendorMismatch';

\echo '== 2. Intended vs observed vendor — systematic or random? =='
SELECT
  raw_response->>'_targetVendor'  AS intended,
  raw_response->>'_actualVendor'  AS observed,
  count(*)                        AS n
FROM route_test_results
WHERE raw_response ? '_vendorMismatch'
GROUP BY 1, 2
ORDER BY n DESC;

\echo '== 3. Vendors that LCR rarely or never selects =='
-- A vendor with high intended-count and near-zero observed-count has effectively
-- never been tested; every historical result attributed to it is mislabelled.
WITH intended AS (
  SELECT raw_response->>'_targetVendor' AS vendor, count(*) AS n_intended
  FROM route_test_results WHERE raw_response ? '_targetVendor' GROUP BY 1
), observed AS (
  SELECT raw_response->>'_actualVendor' AS vendor, count(*) AS n_observed
  FROM route_test_results WHERE raw_response ? '_actualVendor' GROUP BY 1
)
SELECT
  coalesce(i.vendor, o.vendor)      AS vendor,
  coalesce(i.n_intended, 0)         AS intended,
  coalesce(o.n_observed, 0)         AS observed,
  round(100.0 * coalesce(o.n_observed, 0)
        / nullif(coalesce(i.n_intended, 0), 0), 1) AS reached_pct
FROM intended i
FULL OUTER JOIN observed o ON i.vendor = o.vendor
ORDER BY intended DESC NULLS LAST;

\echo '== 4. Divergence by destination =='
SELECT
  destination,
  count(*)                                                          AS runs,
  count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true') AS mismatches,
  round(100.0 * count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true')
        / nullif(count(*), 0), 1)                                   AS mismatch_pct
FROM route_test_results
WHERE raw_response ? '_vendorMismatch'
GROUP BY 1
ORDER BY mismatches DESC
LIMIT 25;

\echo '== 5. Divergence over time — is routing drifting? =='
SELECT
  date_trunc('week', started_at)::date                              AS week,
  count(*)                                                          AS runs,
  count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true') AS mismatches,
  round(100.0 * count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true')
        / nullif(count(*), 0), 1)                                   AS mismatch_pct
FROM route_test_results
WHERE raw_response ? '_vendorMismatch'
GROUP BY 1
ORDER BY 1;

\echo '== 6. Coverage check — how much history carries the field at all? =='
-- Rows predating the _vendorMismatch instrumentation cannot be assessed either way.
SELECT
  count(*)                                          AS all_results,
  count(*) FILTER (WHERE raw_response ? '_vendorMismatch') AS assessable,
  count(*) FILTER (WHERE raw_response IS NULL)      AS no_raw_response
FROM route_test_results;
