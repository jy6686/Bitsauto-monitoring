-- Migration 026: CLI columns for route test engine
-- cli_to_send lets operators specify the outbound CLI used during test calls.
-- cli_sent / cli_match record what was actually sent and whether it matched.

ALTER TABLE route_test_jobs
  ADD COLUMN IF NOT EXISTS cli_to_send VARCHAR(32);

ALTER TABLE route_test_results
  ADD COLUMN IF NOT EXISTS cli_sent  VARCHAR(32),
  ADD COLUMN IF NOT EXISTS cli_match VARCHAR(16);
