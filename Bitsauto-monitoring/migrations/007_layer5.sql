-- Layer 5: Executive Reports (5A), Invoice Engine (5B), Carrier Reconciliation (5C)
-- Run via: psql $DATABASE_URL -f migrations/007_layer5.sql

BEGIN;

-- ── 5A: Monthly Executive Report Jobs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_jobs (
  id              SERIAL PRIMARY KEY,
  report_type     VARCHAR(32)   NOT NULL DEFAULT 'executive_monthly',
  title           VARCHAR(256),
  period_start    VARCHAR(32),
  period_end      VARCHAR(32),
  delivery_status VARCHAR(32)   NOT NULL DEFAULT 'generated',
  recipients_json TEXT,
  html_content    TEXT,
  generated_at    TIMESTAMPTZ   DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rj_report_type     ON report_jobs (report_type);
CREATE INDEX IF NOT EXISTS idx_rj_created_at      ON report_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rj_delivery_status ON report_jobs (delivery_status);

COMMENT ON TABLE report_jobs IS
  'Layer 5A: Executive report generation jobs. Intelligence presentation only — not financial truth.';

-- ── 5B: Invoices ─────────────────────────────────────────────────────────────
-- CRITICAL: Invoices MUST source from invoice_cdr_snapshots only. Never live tariffs.
CREATE TABLE IF NOT EXISTS invoices (
  id               SERIAL PRIMARY KEY,
  invoice_number   VARCHAR(64)   NOT NULL,
  i_tariff         VARCHAR(64),
  customer_name    VARCHAR(256),
  period_start     VARCHAR(32),
  period_end       VARCHAR(32),
  total_reproduced REAL,
  total_actual     REAL,
  total_delta      REAL,
  line_count       INTEGER,
  status           VARCHAR(32)   NOT NULL DEFAULT 'draft',
  generated_at     TIMESTAMPTZ   DEFAULT NOW(),
  approved_at      TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  notes            TEXT,
  html_content     TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_i_tariff    ON invoices (i_tariff);
CREATE INDEX IF NOT EXISTS idx_inv_status      ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_inv_created_at  ON invoices (created_at DESC);

COMMENT ON TABLE invoices IS
  'Layer 5B: Invoices sourced exclusively from invoice_cdr_snapshots. Draft→Review→Approve→Send flow.';
COMMENT ON COLUMN invoices.status IS
  'draft | review | approved | sent | void';

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id               SERIAL PRIMARY KEY,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  snapshot_id      INTEGER REFERENCES invoice_cdr_snapshots(id) ON DELETE SET NULL,
  cdr_call_id      VARCHAR(128),
  prefix           VARCHAR(32),
  duration_secs    INTEGER,
  reproduced_cost  REAL,
  actual_cost      REAL,
  delta            REAL
);

CREATE INDEX IF NOT EXISTS idx_ili_invoice_id  ON invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_ili_snapshot_id ON invoice_line_items (snapshot_id);

COMMENT ON TABLE invoice_line_items IS
  'Per-CDR invoice line items. Each row traces to an immutable invoice_cdr_snapshot.';

-- ── 5C: Carrier Reconciliation ────────────────────────────────────────────────
-- Shadow mode on first deploy: detect discrepancies, produce intelligence, NO auto-actions.
CREATE TABLE IF NOT EXISTS carrier_reconciliations (
  id                         SERIAL PRIMARY KEY,
  carrier_name               VARCHAR(256)  NOT NULL,
  i_tariff                   VARCHAR(64),
  invoice_ref                VARCHAR(128),
  invoice_date               VARCHAR(32),
  period_start               VARCHAR(32),
  period_end                 VARCHAR(32),
  carrier_total              REAL,
  sippy_total                REAL,
  reproduced_total           REAL,
  snapshot_total             REAL,
  delta_carrier_vs_reproduced REAL,
  delta_carrier_vs_sippy     REAL,
  discrepancy_count          INTEGER       DEFAULT 0,
  status                     VARCHAR(32)   NOT NULL DEFAULT 'shadow',
  notes                      TEXT,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cr_carrier_name ON carrier_reconciliations (carrier_name);
CREATE INDEX IF NOT EXISTS idx_cr_i_tariff     ON carrier_reconciliations (i_tariff);
CREATE INDEX IF NOT EXISTS idx_cr_status       ON carrier_reconciliations (status);
CREATE INDEX IF NOT EXISTS idx_cr_created_at   ON carrier_reconciliations (created_at DESC);

COMMENT ON TABLE carrier_reconciliations IS
  'Layer 5C: Carrier invoice vs BitsAuto reproduced cost comparison. Shadow verification mode — discrepancy intelligence only, no automatic accounting actions.';
COMMENT ON COLUMN carrier_reconciliations.status IS
  'shadow | pending | reviewed | resolved | disputed';

COMMIT;
