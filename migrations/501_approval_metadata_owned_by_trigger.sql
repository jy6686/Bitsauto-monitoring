-- 501_approval_metadata_owned_by_trigger.sql
--
-- Makes approval metadata atomic. Before this, `approved_at` was whatever the caller
-- remembered to set — and the first bulk approval run by hand set `approval_status` and
-- `approved_by` but not `approved_at`, leaving nine rows reading "approved by junaid" with no
-- timestamp. That is not a caller discipline problem to be solved with a code review; a field
-- that three different callers must remember is a field that will eventually be forgotten.
--
-- After this migration the trigger owns all three, and any caller — SQL, the console API, or
-- something not written yet — produces the same result from `SET approval_status = ...` alone.
--
-- ── The rule for leaving `approved`, stated because it is a choice ─────────────────────
-- `approved_by` / `approved_at` are CLEARED when a destination stops being approved.
--
-- They answer "who currently vouches for this destination", not "was it ever approved" — and
-- a row that is blocked today should not carry a name and a date implying someone stands
-- behind it. The other question already has a home: commercial_destination_approvals keeps
-- every transition with its actor and timestamp, so the first approval remains recoverable
-- after any number of blocks and re-approvals. Two questions, two places, neither guessing.

BEGIN;

CREATE OR REPLACE FUNCTION log_commercial_destination_approval() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    -- Metadata first, so the history row and the destination row cannot disagree.
    IF NEW.approval_status = 'approved' THEN
      NEW.approved_by := COALESCE(NULLIF(NEW.approved_by, ''), current_user);
      NEW.approved_at := COALESCE(NEW.approved_at, NOW());
    ELSE
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;

    INSERT INTO commercial_destination_approvals (destination_id, from_status, to_status, actor)
    VALUES (OLD.id, OLD.approval_status, NEW.approval_status,
            COALESCE(NEW.approved_by, OLD.approved_by, current_user));

    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END$fn$;

-- Repair the rows approved before this trigger existed. Their timestamp is recoverable from
-- the history table rather than invented — the transition was recorded even when the
-- destination row was not updated.
UPDATE commercial_destinations d
   SET approved_at = a.changed_at
  FROM (SELECT DISTINCT ON (destination_id) destination_id, changed_at
          FROM commercial_destination_approvals
         WHERE to_status = 'approved'
         ORDER BY destination_id, changed_at DESC) a
 WHERE a.destination_id = d.id
   AND d.approval_status = 'approved'
   AND d.approved_at IS NULL;

DO $$
DECLARE n_bad INTEGER;
BEGIN
  SELECT count(*) INTO n_bad FROM commercial_destinations
   WHERE approval_status = 'approved' AND (approved_at IS NULL OR approved_by IS NULL);
  IF n_bad > 0 THEN
    RAISE NOTICE '501: % approved row(s) still lack approved_by/approved_at and have no history entry to recover one from. They predate the history trigger; re-approve them to stamp the metadata.', n_bad;
  END IF;
  SELECT count(*) INTO n_bad FROM commercial_destinations
   WHERE approval_status <> 'approved' AND (approved_at IS NOT NULL OR approved_by IS NOT NULL);
  IF n_bad > 0 THEN
    RAISE EXCEPTION '501: % non-approved row(s) carry approval metadata. The trigger should have cleared these.', n_bad;
  END IF;
  RAISE NOTICE '501: approval metadata is now trigger-owned. Callers set approval_status only.';
END$$;

COMMIT;
