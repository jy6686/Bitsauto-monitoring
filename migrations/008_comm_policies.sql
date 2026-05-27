-- Layer: Communication Policies Engine
-- Deterministic communication governance between economics events and draft notifications.
-- Run via: psql $DATABASE_URL -f migrations/008_comm_policies.sql

BEGIN;

-- ── Communication Policies — event-to-draft-notification routing rules ─────────
CREATE TABLE IF NOT EXISTS communication_policies (
  id                SERIAL PRIMARY KEY,
  trigger_type      VARCHAR(64)   NOT NULL,
  severity_filter   VARCHAR(32)   NOT NULL DEFAULT 'all',
  sender_profile_id INTEGER REFERENCES smtp_sender_profiles(id) ON DELETE SET NULL,
  template_type     VARCHAR(64),
  recipient_group   VARCHAR(64)   NOT NULL DEFAULT 'all_clients',
  channel_type      VARCHAR(32)   NOT NULL DEFAULT 'email',
  auto_draft        BOOLEAN       NOT NULL DEFAULT TRUE,
  cooldown_minutes  INTEGER       NOT NULL DEFAULT 0,
  approval_required BOOLEAN       NOT NULL DEFAULT TRUE,
  enabled           BOOLEAN       NOT NULL DEFAULT TRUE,
  description       TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_trigger_type ON communication_policies (trigger_type);
CREATE INDEX IF NOT EXISTS idx_cp_enabled      ON communication_policies (enabled);

COMMENT ON TABLE communication_policies IS
  'Event-to-draft-notification routing rules. When a telecom economics event fires, matching enabled policies auto-create draft commercial notifications for human review.';
COMMENT ON COLUMN communication_policies.auto_draft IS
  'Always TRUE on first deploy — policies create draft notifications only. Human must review and dispatch.';
COMMENT ON COLUMN communication_policies.trigger_type IS
  'rate_change | interval_change | tariff_added | tariff_removed | invoice_generated | reconciliation_drift | qos_advisory | fraud_advisory | executive_report';
COMMENT ON COLUMN communication_policies.severity_filter IS
  'all | minor | major | critical — only triggers when event matches this severity';
COMMENT ON COLUMN communication_policies.recipient_group IS
  'all_clients | management | finance | noc | internal_team';

-- ── Add traceability columns to commercial_notifications ─────────────────────
ALTER TABLE commercial_notifications
  ADD COLUMN IF NOT EXISTS tariff_change_event_id INTEGER REFERENCES tariff_change_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_id              INTEGER REFERENCES communication_policies(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cn_tariff_change_event_id ON commercial_notifications (tariff_change_event_id) WHERE tariff_change_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cn_policy_id              ON commercial_notifications (policy_id)              WHERE policy_id IS NOT NULL;

COMMENT ON COLUMN commercial_notifications.tariff_change_event_id IS
  'Links draft notification to the specific tariff_change_event that triggered it — end-to-end economics→communication traceability.';
COMMENT ON COLUMN commercial_notifications.policy_id IS
  'Links draft notification to the communication_policy rule that auto-created it.';

-- ── Seed default policies ────────────────────────────────────────────────────
-- These are advisory defaults. Operators should configure sender_profile_id
-- by editing the policy and selecting their configured SMTP profile.
INSERT INTO communication_policies
  (trigger_type, severity_filter, template_type, recipient_group, channel_type, auto_draft, cooldown_minutes, description)
VALUES
  ('rate_change',           'all',      'rate_change',     'all_clients',   'email', TRUE, 0,   'Auto-draft rate change notification for all clients when tariff rates are updated'),
  ('interval_change',       'all',      'interval_change', 'all_clients',   'email', TRUE, 0,   'Auto-draft billing interval change notification when intervals are modified'),
  ('tariff_added',          'all',      'rate_change',     'all_clients',   'email', TRUE, 60,  'Auto-draft notification when new destinations are added to a tariff'),
  ('tariff_removed',        'all',      'rate_change',     'all_clients',   'email', TRUE, 60,  'Auto-draft notification when destinations are removed from a tariff'),
  ('reconciliation_drift',  'critical', 'rate_change',     'finance',       'email', TRUE, 0,   'Auto-draft alert to finance team when carrier reconciliation shows critical discrepancy'),
  ('reconciliation_drift',  'major',    'rate_change',     'management',    'email', TRUE, 0,   'Auto-draft alert to management when carrier reconciliation shows major discrepancy'),
  ('invoice_generated',     'all',      'rate_change',     'internal_team', 'email', TRUE, 0,   'Auto-draft internal notification when a new invoice draft is generated'),
  ('executive_report',      'all',      'rate_change',     'management',    'email', TRUE, 0,   'Auto-draft notification to management when monthly executive report is ready')
ON CONFLICT DO NOTHING;

COMMIT;
