-- 061_cli_verification_evidence.sql
--
-- CAP-023 Phase 1 — stop a misattributed CLI signal, and give the correct one
-- somewhere structured to live.
--
-- Numbered 061, not 060: the header of 059 reserves 060 for translating the 52
-- product_destination_assignments rows through destination_id_map. That work is
-- unrelated to this and should keep the number it was promised.
--
-- ── What was wrong ────────────────────────────────────────────────────────────
-- route_test_results.cli_match was populated by services/route-tester.ts, which
-- probes cdrCache for `cli`/`number_a` — the A-number of our OWN originating leg
-- as Sippy recorded it. Sippy records the CLI it received from us and forwarded;
-- it has no feedback path from a vendor's network. The comparison is therefore
-- "what we asked Sippy to send" vs "what Sippy logged we sent".
--
-- That is a real check — it catches rewrites by our own dialplan or by Sippy's
-- translation rules. It is not vendor CLI behaviour and cannot become it.
--
-- The damage was in what consumed it: loadCliHealthSummary() grouped it PER
-- VENDOR over 7 days and route-copilot.ts fed the resulting rate to the copilot
-- as vendor evidence. A vendor could be characterised as rewriting CLI on data
-- that never observed that vendor.
--
-- ── What this migration does ──────────────────────────────────────────────────
-- Renames the column to name the leg it actually observes, and adds a jsonb
-- column for the structured CliComparison from services/cli/normalizer.ts. That
-- record carries an evidence_level (O1 requested / O2 our network / O3
-- terminating endpoint / O4 handset) so no later reader can mistake an
-- origination-side observation for what the subscriber saw.
--
-- Historical rows keep their values. They were correct measurements of the
-- origination leg all along; only the name and the consumers were wrong. No
-- backfill of cli_evidence — those rows genuinely have no structured
-- observation, and inventing one would be the same class of error this fixes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_test_results' AND column_name = 'cli_match'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_test_results' AND column_name = 'origination_cli_match'
  ) THEN
    ALTER TABLE route_test_results RENAME COLUMN cli_match TO origination_cli_match;
  END IF;
END $$;

ALTER TABLE route_test_results
  ADD COLUMN IF NOT EXISTS origination_cli_match varchar(16);

ALTER TABLE route_test_results
  ADD COLUMN IF NOT EXISTS cli_evidence jsonb;

COMMENT ON COLUMN route_test_results.origination_cli_match IS
  'CAP-023 O2-proxy: requested CLI vs the CLI Sippy recorded on our own originating leg. Never vendor behaviour — Sippy has no feedback path from a vendor network.';

COMMENT ON COLUMN route_test_results.cli_evidence IS
  'CAP-023 structured CliComparison: observation (EXACT/LOCALIZED/REWRITTEN/SUPPRESSED/MALFORMED/UNKNOWN), evidence_level (O1-O4), confidence, and both normalizations.';
