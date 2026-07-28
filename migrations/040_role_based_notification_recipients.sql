-- 040_role_based_notification_recipients.sql
-- Onboarding 2.0 — corrects the notification recipient model.
--
-- 039 modelled recipients as a per-customer matrix: every new customer needed
-- someone to tick which address receives which event. That recreates the problem this
-- program exists to remove — repeated configuration of something that is the same for
-- almost every customer.
--
-- Corrected model: the Notification Profile maps an event to a contact ROLE. The wizard
-- collects contacts by role. The engine resolves role → address at send time.
--
--   Notification Profile:  rate_notification → kam, primary_contact
--   Wizard:                primary = john@acme.com, billing = sara@acme.com, KAM = Junaid
--   Engine at runtime:     rate_notification → junaid@ichibaanlogic.com, john@acme.com
--
-- company_notification_recipients is therefore NOT the standard path — it becomes the
-- EXCEPTION table, for "this customer wants invoices at finance@ instead of billing@".
--
-- Also adds version stamps to the provisioning snapshot so a historical provisioning
-- decision can be explained by the exact profile AND platform versions in force.
-- Idempotent.

BEGIN;

-- ── Event → contact role ────────────────────────────────────────────────────
-- Comma-separated roles rather than a child table: the set is small, fixed, and always
-- read whole. Splitting it would add a join to every notification lookup for no query
-- that anyone actually runs.
ALTER TABLE notification_profile_events
  ADD COLUMN IF NOT EXISTS recipient_roles VARCHAR(256) NOT NULL DEFAULT 'primary_contact';

COMMENT ON COLUMN notification_profile_events.recipient_roles IS
  'Comma-separated contact roles: primary_contact | technical_contact | billing_contact | kam | noc. Resolved to addresses at send time.';

-- Owner-specified role mapping (2026-07-28).
UPDATE notification_profile_events SET recipient_roles = v.roles
  FROM (VALUES
    ('welcome',             'primary_contact'),
    ('account_provisioned', 'primary_contact,technical_contact'),
    ('rate_notification',   'kam,primary_contact'),
    ('invoice',             'billing_contact'),
    ('invoice_reminder',    'billing_contact'),
    ('balance_alert',       'billing_contact'),
    ('credit_limit',        'billing_contact,kam'),
    ('traffic_trend',       'technical_contact'),
    ('traffic_spike',       'technical_contact,noc'),
    ('fraud_alert',         'technical_contact,noc'),
    ('sip_auth_failure',    'technical_contact'),
    ('dispute_opened',      'billing_contact,technical_contact'),
    ('dispute_updated',     'billing_contact,technical_contact'),
    ('system',              'primary_contact'),
    ('password_reset',      'primary_contact')
  ) AS v(event_key, roles)
 WHERE notification_profile_events.event_key = v.event_key;

-- ── Per-customer overrides only ─────────────────────────────────────────────
-- Present for exceptions, absent for the ~90% of customers who take the profile
-- default. A row here REPLACES the role-resolved recipients for that event.
COMMENT ON TABLE company_notification_recipients IS
  'EXCEPTIONS ONLY. Normal recipients come from notification_profile_events.recipient_roles resolved against the company contacts. A row here overrides the resolved set for one company+event.';

ALTER TABLE company_notification_recipients
  ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- ── Snapshot: version stamps ────────────────────────────────────────────────
-- Which profile versions AND which platform versions were in force. Six months later
-- "why was this customer provisioned differently" needs both.
ALTER TABLE company_provisioning_snapshot
  ADD COLUMN IF NOT EXISTS notification_version INTEGER,
  ADD COLUMN IF NOT EXISTS sippy_version        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS bitsauto_version     VARCHAR(64);

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  unset   INTEGER;
  badrole INTEGER;
BEGIN
  -- An event with no role resolves to no recipients and would send to nobody.
  SELECT COUNT(*) INTO unset FROM notification_profile_events
   WHERE recipient_roles IS NULL OR btrim(recipient_roles) = '';
  IF unset > 0 THEN
    RAISE EXCEPTION '% notification_profile_events have no recipient role', unset;
  END IF;

  -- Guard against a typo silently producing an unresolvable role.
  SELECT COUNT(*) INTO badrole FROM (
    SELECT btrim(unnest(string_to_array(recipient_roles, ','))) AS role
      FROM notification_profile_events
  ) r
   WHERE r.role NOT IN ('primary_contact','technical_contact','billing_contact','kam','noc');
  IF badrole > 0 THEN
    RAISE EXCEPTION '% unrecognised recipient role(s) in notification_profile_events', badrole;
  END IF;
END $$;

COMMIT;
