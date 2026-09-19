-- 525: the client request id on rate_push_jobs.
--
-- A Send Rate push is a long synchronous request on an Autoscale deployment, and the gateway
-- can lose the response while the server is still pushing (2026-09-19: a 504 re-enabled Submit
-- and the second click produced a second batch 9 s behind the first). The response is not a
-- reliable way for the operator's screen to learn what happened; the job row is. This column
-- lets the client name its submit up front, so:
--   - a repeated submit with the same id is answered with the job it already produced (409),
--     never a second job;
--   - a lost response is recovered by looking the job up by id, never by clicking again.
--
-- ADDITIVE: a nullable column and a partial unique index. Every existing row and every caller
-- that sends no id keeps working (NULL is not constrained). Nothing is dropped or rewritten.
BEGIN;

ALTER TABLE rate_push_jobs ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS rate_push_jobs_client_request_id_uq
  ON rate_push_jobs (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
