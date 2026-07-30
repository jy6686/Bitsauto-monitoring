-- 051_repair_account_prefix_sequence.sql
-- Rewind account_prefix_seq, and finish the backfill 049 could not.
--
-- WHY THIS EXISTS RATHER THAN A FIX INSIDE 049
-- 049 originally advanced the sequence past the highest ADOPTED prefix:
--     setval('account_prefix_seq', GREATEST(last_value, max_adopted, 1000))
-- Adopted prefixes are sparse. "calling" carries the legacy prefix 9989, so the sequence
-- jumped to 9989 and left ten values under the 9999 NO CYCLE ceiling. Two different
-- outcomes followed, depending on the database:
--
--   * Where 049 needed more than ten allocations it raised mid-migration, rolled back,
--     and the runner — which halts on first failure by design — never applied 050.
--   * Where it needed fewer, 049 COMMITTED and left the sequence parked near 9999.
--     Every allocateAccountPrefix() afterwards then failed with
--     PrefixSpaceExhaustedError, which company creation catches and logs, leaving each
--     new company with a NULL prefix. Silently, because the catch is non-fatal.
--
-- 049 has been fixed to skip taken values instead of jumping past them, which prevents
-- the first case. It cannot repair the second: the runner records 049 as applied and
-- reports the edited file as DRIFT without re-running it, which is the correct rule —
-- re-running an applied migration is not automatically safe.
--
-- So the repair is a new file. Idempotent, and safe on a database that never had the
-- problem: it only ever moves the sequence DOWN to the lowest free value, and only
-- allocates to companies that have no prefix at all.
--
-- WHAT IS DELIBERATELY NOT DONE: no existing prefix is changed. Once a customer is
-- provisioned the value is inside their Sippy authentication and CLD rules, and rewriting
-- it would authenticate their traffic under a number the switch does not know.

BEGIN;

-- Belt and braces: 049 may have rolled back on this database, taking the sequence with
-- it. Same definition as 049 so the two cannot drift.
CREATE SEQUENCE IF NOT EXISTS account_prefix_seq
  START WITH 1001 INCREMENT BY 1 MINVALUE 1001 MAXVALUE 9999 NO CYCLE;

DO $$
DECLARE
  r          RECORD;
  candidate  TEXT;
  lowest     INTEGER;
  before_val BIGINT;
  needed     INTEGER;
  reachable  INTEGER;
  alloc_n    INTEGER := 0;
BEGIN
  SELECT last_value INTO before_val FROM account_prefix_seq;

  -- The lowest number not currently held by any company. Gaps left by earlier allocation
  -- are reusable ONLY because nothing was ever issued from them — a value that reached a
  -- company is in the companies table and is therefore excluded here. The sequence's
  -- never-reissue guarantee is about live identities, and those are exactly what this
  -- SELECT skips.
  SELECT MIN(g) INTO lowest
    FROM generate_series(1001, 9999) g
   WHERE lpad(g::TEXT, 4, '0') NOT IN (
           SELECT account_prefix FROM companies WHERE account_prefix IS NOT NULL);

  IF lowest IS NULL THEN
    RAISE EXCEPTION 'account_prefix space 1001-9999 is fully allocated — widen the prefix format; do not reissue';
  END IF;

  -- REWIND ONLY WHEN THE SEQUENCE CANNOT SERVE THIS BACKFILL.
  --
  -- The condition is the actual failure, not a threshold: how many prefixes must be
  -- allocated, against how many the sequence can still produce before the 9999 ceiling.
  -- If it can serve them, it is left alone and this migration only allocates. If it
  -- cannot, the backfill would raise and roll back, which is the state that has been
  -- blocking every deploy — so the rewind is the only alternative to failing.
  --
  -- Stated this way there is no number anyone has to justify later, and the migration
  -- cannot pull a healthy sequence backwards: a healthy sequence, by definition, has
  -- enough values left for the work in front of it.
  --
  -- WHY THE RESTRAINT MATTERS. Reusing a gap is not unconditionally safe. A gap usually
  -- means a value was drawn and never persisted — harmless, it never reached Sippy. But
  -- it can also mean a company was DELETED while its prefix remains in authentication and
  -- CLD rules on the switch, and handing that number to a new customer routes their
  -- traffic under a retired identity. That is the failure 049's header exists to prevent,
  -- and deleted companies are not in `companies`, so the exclusion below does not catch
  -- them. Hence: only when the alternative is not allocating at all.
  SELECT COUNT(*) INTO needed
    FROM companies WHERE account_prefix IS NULL AND sippy_i_account IS NULL;
  reachable := 9999 - before_val;

  IF needed > reachable AND before_val > lowest THEN
    -- is_called = false so the NEXT nextval() returns `lowest` itself, not lowest+1.
    PERFORM setval('account_prefix_seq', lowest, false);
    RAISE NOTICE 'account_prefix_seq rewound from % to %: % company(ies) need a prefix and only % value(s) remained below the ceiling. Gaps are now reusable — verify none belonged to a DELETED company still referenced in Sippy.',
      before_val, lowest, needed, reachable;
  ELSE
    RAISE NOTICE 'account_prefix_seq at % — % value(s) reachable, % needed. No rewind.',
      before_val, reachable, needed;
  END IF;

  -- Finish what 049 could not: any company with no prefix that is NOT already provisioned.
  -- A provisioned company with a NULL prefix is a legacy collision 049 deliberately left
  -- for a human — it carries traffic under a prefix only its Sippy auth rules know, and
  -- guessing one here would be a second wrong answer.
  FOR r IN
    SELECT id, name FROM companies
     WHERE account_prefix IS NULL AND sippy_i_account IS NULL
     ORDER BY id
  LOOP
    LOOP
      candidate := lpad(nextval('account_prefix_seq')::TEXT, 4, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE account_prefix = candidate);
    END LOOP;
    UPDATE companies SET account_prefix = candidate WHERE id = r.id;
    alloc_n := alloc_n + 1;
    RAISE NOTICE 'account_prefix allocated: % → company % ("%")', candidate, r.id, r.name;
  END LOOP;

  RAISE NOTICE 'account_prefix repair: % allocated; % provisioned company(ies) still unresolved (legacy collisions, assign from the company card)',
    alloc_n,
    (SELECT COUNT(*) FROM companies WHERE account_prefix IS NULL AND sippy_i_account IS NOT NULL);
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE missing INTEGER; dupes INTEGER; malformed INTEGER; headroom INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing
    FROM companies WHERE account_prefix IS NULL AND sippy_i_account IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION '% unprovisioned companies still have no account_prefix', missing;
  END IF;

  SELECT COUNT(*) INTO malformed FROM companies
   WHERE account_prefix IS NOT NULL AND account_prefix !~ '^[0-9]{4}$';
  IF malformed > 0 THEN
    RAISE EXCEPTION '% companies have a non 4-digit account_prefix', malformed;
  END IF;

  SELECT COUNT(*) INTO dupes FROM (
    SELECT account_prefix FROM companies
     WHERE account_prefix IS NOT NULL GROUP BY account_prefix HAVING COUNT(*) > 1) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION '% duplicate account_prefix values', dupes;
  END IF;

  -- Not a failure, but the number worth seeing: this is how many companies can still be
  -- created before the 4-digit space needs widening. It read as 10 before this migration.
  SELECT 9999 - (SELECT last_value FROM account_prefix_seq) INTO headroom;
  RAISE NOTICE 'account_prefix headroom: % value(s) remain below the 9999 ceiling', headroom;
END $$;

COMMIT;
