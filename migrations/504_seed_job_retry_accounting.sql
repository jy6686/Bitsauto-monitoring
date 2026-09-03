-- Where a collection job's wall clock actually went.
--
-- On 2026-09-03 a job ran 1h30m, reached 33 of 48 slices, fetched nothing and
-- was still going when the process died. The panel showed "33/48 · 0 stored ·
-- 1h 30m" and an operator had no way to tell ninety minutes of work from
-- ninety minutes of retry backoff. Those need opposite responses: one is a
-- large account, the other is a switch answering intermittently.
--
-- The retries were only ever in the logs, and the logs on this deployment
-- carry no timestamps. So the accounting moves into the job row, where the
-- panel can read it.
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS retries_total  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS backoff_ms     BIGINT  NOT NULL DEFAULT 0;
-- The budget verdict at the point the job stopped, when one was reached.
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS pace_verdict   VARCHAR(16);
