-- 049_account_prefix_and_identity.sql
-- The canonical customer identifier: a unique 4-digit account prefix.
--
-- Sippy needs one stable identifier that authentication, CLD translation, routing and
-- product selection can all key off. Until now that value was typed into the wizard by
-- an operator ("e.g. 8888"), which makes the customer's identity a free-text field —
-- unenforced, non-unique, and lost if nobody runs the wizard.
--
-- WHY A SEQUENCE, NOT A DERIVED VALUE
-- Company names change; authentication identifiers must not. Deriving the prefix from
-- the name would make a rename silently break authentication for a live customer.
--
-- WHY A SEQUENCE, NOT max(prefix)+1
-- nextval() is atomic, so two companies created at the same moment cannot collide, and
-- it never returns a value twice — so a deleted company's prefix is never reissued to
-- someone else. Reuse is the failure that matters here: the prefix ends up in
-- authentication rules and CLD rules, and handing a retired one to a new customer
-- silently routes their traffic under the old customer's identity.
--
-- The sequence is bounded 1001–9999 and does NOT cycle. At 8999 customers it raises
-- rather than wrapping. That is deliberate: exhausting the space is a real capacity
-- decision (widen to 5 digits), not something to paper over by reissuing prefixes.
--
-- routing_group_id / routing_group_name are added here because they belong to the same
-- identity set, but are left NULL: they resolve from the routing package, which resolves
-- from the provisioning profile. Populating them is part of the preparation work, not
-- this migration.
--
-- Idempotent.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS account_prefix_seq
  START WITH 1001 INCREMENT BY 1 MINVALUE 1001 MAXVALUE 9999 NO CYCLE;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS account_prefix       VARCHAR(4),
  ADD COLUMN IF NOT EXISTS routing_group_id     INTEGER,
  ADD COLUMN IF NOT EXISTS routing_group_name   VARCHAR(128);

COMMENT ON COLUMN companies.account_prefix IS
  'Unique 4-digit customer identifier from account_prefix_seq. Allocated once at company creation and IMMUTABLE — it is embedded in Sippy authentication and CLD rules. Never reissued, including after a company is deleted.';
COMMENT ON COLUMN companies.routing_group_id IS
  'Resolved from the routing package during preparation. NULL until preparation assigns it.';

-- NO company-level cld_translation_rule column, deliberately. A CLD translation rule in
-- this platform is s/^{prefix}{product}{cc}/{product}{cc}/ — a function of the product
-- and destination of each individual authentication rule, not a per-customer constant.
-- Auth Studio generates it per rule (labelled "AUTO-GENERATED" in that UI) and a live
-- account carries one per product x destination: account "flashbee" has twelve, all from
-- the single prefix 5135. Storing one string on the company would be a value that is
-- never sent to Sippy but reads as though it were.
-- The only genuinely per-customer part of that formula is account_prefix, above.

-- Partial unique index: uniqueness applies to allocated prefixes, while companies that
-- predate allocation stay NULL without colliding with each other.
CREATE UNIQUE INDEX IF NOT EXISTS companies_account_prefix_key
  ON companies (account_prefix) WHERE account_prefix IS NOT NULL;

-- ── Backfill ──────────────────────────────────────────────────────────────────
-- TWO POPULATIONS, TWO RULES.
--
--   Already provisioned (sippy_i_account IS NOT NULL) — their prefix is live inside
--   Sippy authentication and CLD rules. It is ADOPTED from the existing trunk
--   configuration, never regenerated. Issuing a new number to a customer carrying
--   traffic would break their authentication the moment the engine pushed rules.
--
--   Everyone else — allocated from the sequence. A draft prefix that never reached
--   Sippy has nothing depending on it, so there is no reason to preserve an
--   operator's typed value over a platform-allocated one.
--
-- Legacy prefixes live in companies.wizard_draft as trunks[].prefix, or embedded in
-- trunks[].cldTranslation as s/^NNNN/. Both are read; only 4-digit values qualify,
-- since that is what the pre-provision duplicate check already treats as a prefix.
--
-- Two live customers can hold the SAME legacy prefix — the pre-provision check exists
-- precisely because that happens. The first keeps it; the rest are left NULL and
-- reported. Renumbering a live customer to resolve a collision is not a migration's
-- decision to make, and silently picking a winner would break the loser's traffic.
DO $$
DECLARE
  r            RECORD;
  legacy       TEXT;
  taken        BOOLEAN;
  candidate    TEXT;
  adopted_n    INTEGER := 0;
  conflict_n   INTEGER := 0;
  alloc_n      INTEGER := 0;
  needed_n     INTEGER := 0;
  reachable_n  INTEGER := 0;
  seq_last     BIGINT;
  seq_called   BOOLEAN;
BEGIN
  -- Pass 1 — adopt, oldest account first so the longest-standing customer wins a clash.
  FOR r IN
    SELECT id, name, wizard_draft
      FROM companies
     WHERE account_prefix IS NULL
       AND sippy_i_account IS NOT NULL
       AND wizard_draft IS NOT NULL
     ORDER BY sippy_i_account, id
  LOOP
    legacy := NULL;
    BEGIN
      SELECT COALESCE(
               (SELECT t->>'prefix'
                  FROM jsonb_array_elements((r.wizard_draft::jsonb)->'trunks') t
                 WHERE t->>'prefix' ~ '^[0-9]{4}$' LIMIT 1),
               (SELECT substring(t->>'cldTranslation' FROM '\^([0-9]{4})')
                  FROM jsonb_array_elements((r.wizard_draft::jsonb)->'trunks') t
                 WHERE substring(t->>'cldTranslation' FROM '\^([0-9]{4})') IS NOT NULL LIMIT 1))
        INTO legacy;
    EXCEPTION WHEN others THEN
      -- Unparseable draft: not a migration failure, just no legacy prefix to adopt.
      legacy := NULL;
    END;

    IF legacy IS NULL THEN CONTINUE; END IF;

    SELECT EXISTS (SELECT 1 FROM companies WHERE account_prefix = legacy) INTO taken;
    IF taken THEN
      conflict_n := conflict_n + 1;
      RAISE NOTICE 'account_prefix conflict: company % ("%") uses legacy prefix % which is already adopted — left unset for a human to resolve', r.id, r.name, legacy;
      CONTINUE;
    END IF;

    UPDATE companies SET account_prefix = legacy WHERE id = r.id;
    adopted_n := adopted_n + 1;
  END LOOP;

  -- DO NOT advance the sequence past the highest adopted value.
  --
  -- This originally did `setval(GREATEST(last_value, max_adopted, 1000))`, reasoning that
  -- starting above every adopted number made a collision impossible. It does — by burning
  -- the entire space below it. On production, "calling" carries the legacy prefix 9989, so
  -- the sequence jumped to 9989 and left ten slots under the 9999 ceiling for sixteen
  -- unprovisioned companies. The eleventh nextval() raised "reached maximum value of
  -- sequence", the whole migration rolled back, and because the runner halts on first
  -- failure, 050 never applied either. Every republish failed identically and silently.
  -- Adopted prefixes are SPARSE: one high legacy value must not consume the range.
  --
  -- Skipping taken values gives the same guarantee for the cost of a lookup, and keeps
  -- what the sequence is actually for — nextval() is atomic under concurrency and never
  -- returns a number twice, so two simultaneous boots cannot collide and a deleted
  -- company's prefix is never reissued.
  --
  -- No setval at all now: the sequence is left exactly where it is. Calling it here would
  -- also mark 1001 as consumed on a fresh sequence, quietly skipping the first prefix.

  -- ── Repair the sequence before drawing from it ─────────────────────────────
  -- SEQUENCES ARE NOT TRANSACTIONAL, and that is why removing the setval above was
  -- not enough to unblock a database the original version had already run on.
  --
  -- When the first version failed with "reached maximum value of sequence", the
  -- ROLLBACK undid the companies updates and left no ledger row — so the file counts
  -- as never applied. It did NOT undo the setval that pushed account_prefix_seq to
  -- 9989, nor the ten nextval() calls that finished it at 9999. The database was left
  -- with 049 unapplied AND its sequence exhausted, which is a state no amount of
  -- fixing the allocation logic can escape: every later boot re-ran this file, raised
  -- on the very first nextval(), and halted the runner again. On the deployment
  -- database that left EIGHT migrations pending behind it (050-056) and provisioning
  -- failing on a column that migration 055 adds.
  --
  -- Migration 051 exists to repair exactly this and can never help, because the
  -- runner halts here. A file that can leave the database in a state only a LATER
  -- file can fix has to be able to fix it itself.
  --
  -- REWINDING IS SAFE, and only because Pass 2 checks every candidate. A value below
  -- the current position is either free — which is precisely what we want — or taken,
  -- in which case the loop skips it. No prefix can be reissued, which is the property
  -- that matters: these numbers are live inside Sippy authentication and CLD rules.
  --
  -- Conditional, not unconditional. On a healthy database the sequence position is the
  -- record of what has been handed out; resetting it for no reason would make nextval()
  -- re-offer numbers the skip-loop then has to walk past, one lookup at a time.
  SELECT count(*) INTO needed_n
    FROM companies
   WHERE account_prefix IS NULL AND sippy_i_account IS NULL;

  SELECT last_value, is_called INTO seq_last, seq_called FROM account_prefix_seq;
  reachable_n := 9999 - (CASE WHEN seq_called THEN seq_last ELSE seq_last - 1 END);

  -- `reachable_n <= 0` is checked on its own, not folded into the comparison. A sequence
  -- with nothing left is dead for RUNTIME allocation too, not just for this backfill —
  -- account-prefix.ts would fall back to a generate_series scan on every company created
  -- from then on, correct but silently degraded. Rewinding costs nothing here.
  IF reachable_n <= 0 OR needed_n > reachable_n THEN
    -- 1001 is the sequence's own MINVALUE. `false` for is_called so the very first
    -- nextval() returns 1001 itself rather than 1002 — otherwise the lowest prefix in
    -- the range is silently unusable.
    PERFORM setval('account_prefix_seq', 1001, false);
    RAISE NOTICE 'account_prefix_seq was at % with % value(s) left but % companies need a prefix — rewound to 1001. Taken values are skipped during allocation, so nothing is reissued.',
                 seq_last, GREATEST(reachable_n, 0), needed_n;
  END IF;

  -- Pass 2 — allocate for everyone else, row by row: nextval() in a set-returning
  -- UPDATE has no guaranteed ordering, and these values are permanent.
  FOR r IN SELECT id FROM companies WHERE account_prefix IS NULL ORDER BY id LOOP
    -- A conflicted company from pass 1 must NOT be allocated a fresh number here: it is
    -- live under its legacy prefix, and a new one would be a second wrong answer.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM companies c WHERE c.id = r.id AND c.sippy_i_account IS NOT NULL
    );

    -- Draw until the value is free. An adopted prefix occupies a number the sequence will
    -- still hand out, so the candidate is checked rather than assumed. Bounded by the
    -- sequence's own NO CYCLE ceiling: if the space is genuinely exhausted nextval()
    -- raises, which is the correct outcome — widening to five digits is a capacity
    -- decision, not something to paper over by reissuing a live customer's identity.
    LOOP
      candidate := lpad(nextval('account_prefix_seq')::TEXT, 4, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE account_prefix = candidate);
    END LOOP;

    UPDATE companies SET account_prefix = candidate WHERE id = r.id;
    alloc_n := alloc_n + 1;
  END LOOP;

  -- Every provisioned company still without a prefix is named. Some are conflicts
  -- reported above; the rest carry traffic under a prefix this migration could not find
  -- in their trunk configuration. Both need a human, and an unnamed count would leave an
  -- operator to work out which customers those are.
  FOR r IN
    SELECT id, name FROM companies
     WHERE account_prefix IS NULL AND sippy_i_account IS NOT NULL ORDER BY id
  LOOP
    RAISE NOTICE 'account_prefix UNRESOLVED: company % ("%") is provisioned but has no recorded prefix — read it from its Sippy auth rules and set it manually', r.id, r.name;
  END LOOP;

  RAISE NOTICE 'account_prefix backfill: % adopted, % allocated, % conflict(s); % provisioned company(ies) left unresolved',
    adopted_n, alloc_n, conflict_n,
    (SELECT COUNT(*) FROM companies WHERE account_prefix IS NULL AND sippy_i_account IS NOT NULL);
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE unprovisioned_missing INTEGER; malformed INTEGER; dupes INTEGER;
BEGIN
  -- A NULL prefix is tolerated ONLY for an already-provisioned company whose legacy
  -- prefix collided — that is a pre-existing data problem this migration reports rather
  -- than resolves. Any UNPROVISIONED company without a prefix means allocation failed,
  -- which is this migration's own bug.
  SELECT COUNT(*) INTO unprovisioned_missing
    FROM companies WHERE account_prefix IS NULL AND sippy_i_account IS NULL;
  IF unprovisioned_missing > 0 THEN
    RAISE EXCEPTION '% unprovisioned companies have no account_prefix after backfill', unprovisioned_missing;
  END IF;

  SELECT COUNT(*) INTO malformed FROM companies
   WHERE account_prefix IS NOT NULL AND account_prefix !~ '^[0-9]{4}$';
  IF malformed > 0 THEN
    RAISE EXCEPTION '% companies have a non 4-digit account_prefix', malformed;
  END IF;

  SELECT COUNT(*) INTO dupes FROM (
    SELECT account_prefix FROM companies
     WHERE account_prefix IS NOT NULL
     GROUP BY account_prefix HAVING COUNT(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION '% duplicate account_prefix values', dupes;
  END IF;
END $$;

COMMIT;
