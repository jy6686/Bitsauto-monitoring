-- Observability for boot-time rate-push reconciliation (Gate #2).
--
-- A reconcile sweep is otherwise invisible without deployment-log access: on the common state it
-- is a silent no-op that writes nothing and calls Sippy zero times. This table gives each run a
-- durable, browser-readable record so its execution can be verified without the Replit log surface
-- — which is precisely the diagnosability the 10-15 minute objective needs.
--
-- Additive only: one new table plus one index. Written AFTER the sweep establishes its summary, so
-- it never influences a reconciliation decision. Carries provenance (git_commit, deployment_id) so
-- a reader can require it to match /api/build before trusting it; carries no credential or setting.
CREATE TABLE IF NOT EXISTS rate_reconcile_runs (
  id                 SERIAL PRIMARY KEY,
  ran_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  git_commit         VARCHAR(64),
  deployment_id      VARCHAR(128),
  sippy_reachable    BOOLEAN NOT NULL,
  examined           INTEGER NOT NULL,
  success            INTEGER NOT NULL,
  failure            INTEGER NOT NULL,
  indeterminate      INTEGER NOT NULL,
  deferred           INTEGER NOT NULL,
  escalated          INTEGER NOT NULL,
  skipped_no_intent  INTEGER NOT NULL,
  circuit_tripped    BOOLEAN NOT NULL,
  skipped_job_ids    TEXT,
  verdict_job_ids    TEXT
);

CREATE INDEX IF NOT EXISTS rate_reconcile_runs_ran_at_ix ON rate_reconcile_runs (ran_at DESC);
