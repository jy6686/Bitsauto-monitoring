-- 519: per-client, per-department rate-change policy.
--
-- WHY A NEW TABLE RATHER THAN EXTENDING validation_rules.
--
-- `validation_rules` is a platform-wide SINGLETON stack: 6 rules x 3 scopes, no client and no
-- department, with `selected_action NOT NULL DEFAULT 'ignore'`. Two of its properties are wrong
-- for commercial policy and cannot be corrected without changing the meaning of 18 rows a
-- governance review has already approved:
--
--   1. `scope` is not a client. The ratified requirement is explicit that outcomes are per client
--      AND per department, and that a platform-wide rule would be the wrong shape.
--   2. There is no UNSET. Every rule always carries an action and the default is the most
--      permissive one, so an untouched client would silently become the most permissive client on
--      the platform. The validation engine holds the opposite deliberately: absence is undecided.
--
-- `validation_rules` therefore stays exactly as it is, serving the governance screen. This table
-- holds the per-client commercial decision, and the two do not overlap: one is a default stack,
-- the other a declared policy, and no row here means no declared policy.
--
-- THRESHOLDS ARE NOT COPIED HERE. They live in `configuration_values` and are referenced, the same
-- way `validation_rules` references them. Note that the seeded values DISAGREE across categories
-- (`future_effective_date` is 14 for vendor and 15 for client) and which is authoritative is an
-- open business decision. This migration neither normalises them nor picks one.

CREATE TABLE IF NOT EXISTS rate_policy_rules (
  id              SERIAL PRIMARY KEY,

  -- Both required. A policy that names a client but not a department, or the reverse, is not a
  -- policy the old system could express and not one this engine can evaluate.
  client_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  department      TEXT    NOT NULL CHECK (length(trim(department)) > 0),

  -- The six rules, named as the engine names them so the mapping is identity rather than a
  -- translation table somebody has to keep in step.
  rule_key        TEXT    NOT NULL CHECK (rule_key IN (
                    'rate_increase_notice_violation',
                    'suspect_rate_increase',
                    'suspect_rate_decrease',
                    'pending_increases_exceeded',
                    'effective_date_greater_than_limit',
                    'effective_date_older_than_limit')),

  -- NULLABLE, and that is the point. NULL means "considered, not decided" — a deliberate
  -- non-decision that still carries a reason and an author. Together with the absence of a row
  -- entirely, both map to the engine's `undecided`. Neither is IGNORE.
  selected_action TEXT    NULL CHECK (selected_action IN (
                    'IGNORE', 'REJECT_RATE_SHEET', 'REJECT_COUNTRY',
                    'REJECT_DESTINATION', 'APPROVAL_REQD', 'AUTO_ADJUST_EFFECTIVE_DATE')),

  -- AUTO ADJUST EFFECTIVE DATE is offered on the notice rule ONLY. The existing
  -- PATCH /api/validation-rules accepts it for any rule, which lets a writer create a state the
  -- validator declares a configuration error. That mismatch is not inherited: it is refused here,
  -- by the table, so no writer can produce it.
  CONSTRAINT rpr_auto_adjust_only_on_notice CHECK (
    selected_action IS DISTINCT FROM 'AUTO_ADJUST_EFFECTIVE_DATE'
    OR rule_key = 'rate_increase_notice_violation'
  ),

  effective_from  DATE    NOT NULL,
  effective_to    DATE    NULL,
  CONSTRAINT rpr_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- A policy is a commercial claim, so the record says who made it and why — the same reason
  -- eligibility is attributable.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT    NOT NULL CHECK (length(trim(created_by)) > 0),
  updated_at      TIMESTAMPTZ,
  updated_by      TEXT,
  reason          TEXT,

  -- Superseding keeps provenance: a change closes the old row and opens a new one rather than
  -- overwriting, so "who moved the decrease rule to REJECT DESTINATION, when, and why" stays
  -- answerable. That question is currently unanswerable for validation_rules.
  supersedes_id   INTEGER NULL REFERENCES rate_policy_rules(id) ON DELETE SET NULL
);

-- At most ONE open-ended configuration per (client, department, rule). An open-ended row is the
-- one in force from its start date onwards, so two of them would make "what is the policy" have
-- two answers.
CREATE UNIQUE INDEX IF NOT EXISTS rpr_one_open_per_rule_ux
  ON rate_policy_rules (client_id, department, rule_key)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS rpr_lookup_ix
  ON rate_policy_rules (client_id, department, effective_from);

-- No two configurations for the same rule may cover the same day.
--
-- A trigger rather than an EXCLUDE constraint deliberately: EXCLUDE over a daterange needs
-- btree_gist, which is an extension this migration would then require in every environment, and
-- its violation message names an operator class rather than the two dates that clash. An operator
-- reading the error should be told which configuration they collided with.
CREATE OR REPLACE FUNCTION rpr_no_overlap() RETURNS TRIGGER AS $$
DECLARE clash RECORD;
BEGIN
  -- Ordering is checked HERE as well as in rpr_dates_ordered, because a row-level BEFORE trigger
  -- runs ahead of the CHECK constraint: without this, reversed dates surface as Postgres's
  -- "range lower bound must be less than or equal to range upper bound" from the daterange below,
  -- which names neither the column nor the row. The constraint stays as the backstop for any path
  -- that bypasses the trigger.
  IF NEW.effective_to IS NOT NULL AND NEW.effective_to <= NEW.effective_from THEN
    RAISE EXCEPTION
      'effective_to (%) must be after effective_from (%).', NEW.effective_to, NEW.effective_from;
  END IF;

  SELECT id, effective_from, effective_to INTO clash
    FROM rate_policy_rules
   WHERE client_id = NEW.client_id
     AND department = NEW.department
     AND rule_key = NEW.rule_key
     AND id <> COALESCE(NEW.id, -1)
     AND daterange(effective_from, effective_to, '[)')
      && daterange(NEW.effective_from, NEW.effective_to, '[)')
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Policy for rule % already has a configuration covering that period (row %, % to %). Close it before opening another.',
      NEW.rule_key, clash.id, clash.effective_from, COALESCE(clash.effective_to::text, 'open');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rpr_no_overlap_trg ON rate_policy_rules;
CREATE TRIGGER rpr_no_overlap_trg
  BEFORE INSERT OR UPDATE ON rate_policy_rules
  FOR EACH ROW EXECUTE FUNCTION rpr_no_overlap();

DO $$ BEGIN RAISE NOTICE '519: per-client rate policy. Empty, and an empty table means no client has a declared policy — which the engine reads as undecided, never as permission.'; END $$;
