-- Decision A — is `rate_notification_template_destinations` the currently OFFERED rate,
-- or only a template for the next notification?
--
-- READ-ONLY. Every statement is a SELECT. No write, no notification, no Sippy call.
-- Run in the Replit shell against PRODUCTION.
--
-- WHY THE GUARD. This platform's workspace shell has a $PROD_URL that actually points at the DEV
-- database (heliumdb). Reading dev and concluding about production is the specific trap here, and
-- it is silent — the rows look plausible either way. The guard below refuses to proceed rather
-- than letting that happen.

DO $$ BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION
      'REFUSING TO REPORT: current_database() = %, expected neondb. This is not production.',
      current_database();
  END IF;
END$$;

\echo '== 0. Provenance =='
SELECT current_database() AS db, current_user AS usr, now() AS read_at;

\echo ''
\echo '== 1. Is it populated at all? =='
SELECT count(*)                      AS destination_rows,
       count(DISTINCT t.client_name) AS clients,
       count(DISTINCT t.product_id)  AS products,
       count(DISTINCT d.dial_prefix) AS prefixes
  FROM rate_notification_template_destinations d
  JOIN rate_notification_templates t ON t.id = d.template_id;

\echo ''
\echo '== 2. THE DECIDING QUESTION: template, or history? =='
\echo '   one row per (client, product, prefix) => overwritten template, NO history of what was offered'
\echo '   many rows per triple                  => it accumulates, and can answer "what is offered now"'
SELECT rows_per_triple, count(*) AS triples
  FROM (SELECT t.client_name, t.product_id, d.dial_prefix, count(*) AS rows_per_triple
          FROM rate_notification_template_destinations d
          JOIN rate_notification_templates t ON t.id = d.template_id
         GROUP BY 1,2,3) x
 GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== 3. Are activation dates in the PAST (already offered) or the FUTURE (staging a send)? =='
SELECT count(*) FILTER (WHERE activation_date IS NULL OR activation_date = '')            AS no_date,
       count(*) FILTER (WHERE activation_date <= to_char(now(), 'YYYY-MM-DD'))            AS past_or_today,
       count(*) FILTER (WHERE activation_date >  to_char(now(), 'YYYY-MM-DD'))            AS future,
       min(NULLIF(activation_date, '')) AS earliest,
       max(NULLIF(activation_date, '')) AS latest
  FROM rate_notification_template_destinations;

\echo ''
\echo '== 4. rate vs base_rate — is base_rate the ORIGINAL the 50% might measure from? =='
SELECT count(*)                                            AS rows,
       count(*) FILTER (WHERE base_rate IS NULL)           AS base_null,
       count(*) FILTER (WHERE base_rate = rate)            AS base_equals_rate,
       count(*) FILTER (WHERE base_rate IS NOT NULL AND base_rate <> rate) AS base_differs,
       round(avg(CASE WHEN base_rate > 0 AND base_rate <> rate
                      THEN (rate - base_rate) / base_rate * 100 END), 2)   AS avg_pct_rate_vs_base
  FROM rate_notification_template_destinations;

\echo ''
\echo '== 5. Were these templates actually SENT? An unsent template is not an offer. =='
SELECT status, count(*) AS jobs, count(DISTINCT template_id) AS templates
  FROM rate_notification_jobs
 GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '== 6. Sample — what an offered rate actually looks like =='
SELECT t.client_name, t.product_id, d.dial_prefix, d.destination_name,
       d.rate, d.base_rate, d.activation_date
  FROM rate_notification_template_destinations d
  JOIN rate_notification_templates t ON t.id = d.template_id
 ORDER BY t.client_name, d.dial_prefix
 LIMIT 25;

\echo ''
\echo '== 7. Coverage against what a push would target =='
SELECT (SELECT count(DISTINCT dial_prefix) FROM rate_notification_template_destinations) AS offered_prefixes,
       (SELECT count(*) FROM product_rates)                                              AS product_rates_rows,
       (SELECT count(*) FROM product_destination_eligibility WHERE status = 'active')     AS declared_eligibility;
