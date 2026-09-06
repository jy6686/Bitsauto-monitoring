-- What the last scheduled invoice run decided, in the billing chain's words.
--
-- Both live schedules ran on 2026-08-31 and produced no invoice. The chain
-- refused them — correctly — and said so in one console.warn line. This table
-- recorded only last_run_at, so Finance saw "ran" beside no invoice and could
-- not answer "why not?" without asking Engineering. The scheduler does not
-- retry a refused period (its clock advances once per run and the next run
-- asks only for the newest closed period), so a refusal nobody sees is a
-- period nobody invoices.
--
-- One JSONB column, rewritten by every run — scheduled or Run now — holding
-- the account the gates were scoped to, each period's verdict with the
-- chain's own reason and what to do next, and a one-line headline.
--
-- Nullable and unwritten by older rows: a schedule that has not run since
-- this column existed has no outcome, and must say so rather than report an
-- empty success. Same rule as 507, 508, 509.

BEGIN;

ALTER TABLE invoice_schedules ADD COLUMN IF NOT EXISTS last_run_outcome JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'invoice_schedules' AND column_name = 'last_run_outcome') THEN
    RAISE EXCEPTION '510: invoice_schedules.last_run_outcome missing after apply.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'invoice_schedules' AND column_name = 'last_run_outcome'
                AND (is_nullable <> 'YES' OR column_default IS NOT NULL)) THEN
    RAISE EXCEPTION '510: last_run_outcome must be nullable with no default — a schedule '
                    'that has not run must not read as a run that decided nothing.';
  END IF;
  RAISE NOTICE '510: a scheduled invoice run now leaves its verdict on the schedule row.';
END$$;

COMMIT;
