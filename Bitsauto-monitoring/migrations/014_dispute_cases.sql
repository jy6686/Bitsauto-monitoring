-- Finance Governance Phase 2: Formal Dispute Workflow
-- dispute_cases governs the dispute lifecycle with assignment, SLA, and timeline.
-- dispute_case_events is an append-only audit trail.
-- Run via: psql $DATABASE_URL -f migrations/014_dispute_cases.sql

BEGIN;

CREATE TABLE IF NOT EXISTS dispute_cases (
  id                SERIAL PRIMARY KEY,
  reference_id      VARCHAR(32)   NOT NULL UNIQUE,  -- DSP-YYYY-NNN
  dispute_type      VARCHAR(32)   NOT NULL,
  -- billing_dispute | rate_dispute | qos_dispute | routing_dispute | reconciliation_dispute
  client_id         VARCHAR(128),
  client_name       VARCHAR(256)  NOT NULL,
  billing_period    VARCHAR(7),
  invoice_id        INTEGER,
  reconciliation_id INTEGER,
  assigned_to       VARCHAR(128),
  severity          VARCHAR(16)   NOT NULL DEFAULT 'medium',
  status            VARCHAR(32)   NOT NULL DEFAULT 'OPEN',
  -- OPEN | INVESTIGATING | CUSTOMER_PENDING | RESOLVED | CREDIT_ISSUED | REJECTED | CLOSED
  disputed_amount   REAL,
  resolved_amount   REAL,
  description       TEXT,
  internal_notes    TEXT,
  sla_hours         INTEGER       NOT NULL DEFAULT 72,
  sla_due_at        TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispute_case_events (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER       NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  event_type  VARCHAR(32)   NOT NULL,
  -- status_change | note | assignment | escalation
  from_status VARCHAR(32),
  to_status   VARCHAR(32),
  message     TEXT,
  actor_name  VARCHAR(128),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dc_status       ON dispute_cases (status);
CREATE INDEX IF NOT EXISTS idx_dc_client_name  ON dispute_cases (client_name);
CREATE INDEX IF NOT EXISTS idx_dc_severity     ON dispute_cases (severity);
CREATE INDEX IF NOT EXISTS idx_dc_assigned_to  ON dispute_cases (assigned_to);
CREATE INDEX IF NOT EXISTS idx_dc_opened_at    ON dispute_cases (opened_at);
CREATE INDEX IF NOT EXISTS idx_dce_case_id     ON dispute_case_events (case_id);

COMMENT ON TABLE dispute_cases IS
  'Formal dispute lifecycle management. Each row is a governed case with SLA tracking, assignment, and linked finance evidence (invoice, reconciliation).';
COMMENT ON TABLE dispute_case_events IS
  'Immutable event timeline for dispute cases. Every status change, note, and assignment is appended here.';

COMMIT;
