-- 039_notification_routing_and_snapshot.sql
-- Onboarding 2.0 — Sprint 2.1 + provisioning audit.
--
-- What already exists and is NOT recreated here:
--   smtp_sender_profiles           = sender identities (mailbox, display name, reply-to,
--                                    SMTP credentials, communication_type). The
--                                    Communication Center's "Sender Identities" IS this
--                                    table; a second one would split the credentials.
--   commercial_notification_recipients = per-SEND delivery log (status, tracking, opens).
--                                    A delivery record, not a subscription.
--   notification_profiles          = platform defaults: which events exist / default on.
--
-- What was genuinely missing, added here:
--   company_notification_recipients  who receives which event, per customer
--   notification_event_routing       which sender identity an event is sent from
--   company_provisioning_snapshot    what configuration was actually applied, when
--
-- Spec: docs/capabilities/ONBOARDING-2.0.md §3.1.2. Idempotent.

BEGIN;

-- ── Per-customer subscriptions ──────────────────────────────────────────────
-- The recipient × notification matrix. Modelled as rows so adding a notification
-- type is data, not a schema change and not a new column per type.
CREATE TABLE IF NOT EXISTS company_notification_recipients (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL,
  email             VARCHAR(256) NOT NULL,
  notification_type VARCHAR(64)  NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        VARCHAR(128),
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_notification_recipient
  ON company_notification_recipients (company_id, email, notification_type);
CREATE INDEX IF NOT EXISTS idx_cnr_company ON company_notification_recipients (company_id);

-- ── Event → sender routing ──────────────────────────────────────────────────
-- Maps a business event to a communication_type, NOT to a literal mailbox.
-- smtp_sender_profiles resolves communication_type → actual address, so changing
-- rates@ to pricing@ is one row there and touches no routing and no code.
-- The provisioning engine raises events; it never knows an email address.
CREATE TABLE IF NOT EXISTS notification_event_routing (
  id                 SERIAL PRIMARY KEY,
  event_key          VARCHAR(64) NOT NULL UNIQUE,
  communication_type VARCHAR(64) NOT NULL,
  description        TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO notification_event_routing (event_key, communication_type, description) VALUES
  ('welcome',             'onboarding', 'Customer welcome / account created'),
  ('account_provisioned', 'onboarding', 'Provisioning completed, credentials issued'),
  ('rate_notification',   'rates',      'Rate change or new rate sheet'),
  ('invoice',             'billing',    'Invoice generated'),
  ('invoice_reminder',    'billing',    'Payment reminder'),
  ('balance_alert',       'billing',    'Low balance warning'),
  ('credit_limit',        'billing',    'Credit limit reached'),
  ('traffic_trend',       'noc',        'Traffic trend summary'),
  ('traffic_spike',       'noc',        'Traffic spike detected'),
  ('fraud_alert',         'noc',        'Fraud / FAS / IRSF detection'),
  ('sip_auth_failure',    'noc',        'SIP authentication failures'),
  ('dispute_opened',      'disputes',   'Dispute raised'),
  ('dispute_updated',     'disputes',   'Dispute status change'),
  ('system',              'general',    'System / platform notification'),
  ('password_reset',      'general',    'Password reset')
ON CONFLICT (event_key) DO NOTHING;

-- ── Provisioning snapshot ───────────────────────────────────────────────────
-- The configuration ACTUALLY applied to a customer, captured at provision time.
-- Profiles change; this does not. Without it, "why was this customer given a USD 2
-- credit limit?" is unanswerable once the default moves to USD 5 — and reprovision or
-- clone would silently apply today's defaults to yesterday's customer.
CREATE TABLE IF NOT EXISTS company_provisioning_snapshot (
  id                      SERIAL PRIMARY KEY,
  company_id              INTEGER NOT NULL,
  profile_id              INTEGER REFERENCES provisioning_profiles(id),
  routing_package_id      INTEGER REFERENCES routing_packages(id),
  notification_profile_id INTEGER REFERENCES notification_profiles(id),
  profile_version         INTEGER,
  routing_version         INTEGER,
  -- Full resolved configuration, so the record survives deletion of the source rows.
  snapshot_json           TEXT NOT NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by              VARCHAR(128)
);
CREATE INDEX IF NOT EXISTS idx_cps_company ON company_provisioning_snapshot (company_id);

-- ── Verify ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  routes    INTEGER;
  unmatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO routes FROM notification_event_routing;
  IF routes < 15 THEN
    RAISE EXCEPTION 'notification_event_routing=% (want >=15)', routes;
  END IF;

  -- Every event routed by notification_profile_events must have a sender route, or it
  -- would be raised at provision time with nowhere to send from.
  SELECT COUNT(*) INTO unmatched
    FROM (SELECT DISTINCT event_key FROM notification_profile_events) e
   WHERE NOT EXISTS (
     SELECT 1 FROM notification_event_routing r WHERE r.event_key = e.event_key
   );
  IF unmatched > 0 THEN
    RAISE EXCEPTION '% notification_profile_events event_key(s) have no sender route', unmatched;
  END IF;
END $$;

COMMIT;
