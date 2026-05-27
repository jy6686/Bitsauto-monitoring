-- Layer 4C: Immutable Rating Snapshots
-- Creates invoice_cdr_snapshots — permanent, tamper-evident telecom finance truth.
--
-- Design principles:
--   1. Economic fields are NEVER updated after creation.
--   2. snapshot_hash (SHA-256) detects any tampering.
--   3. locked_at is the immutable commit timestamp.
--   4. Both tariff_version_id and rating_verification_id use SET NULL on delete
--      so financial snapshots survive operational cleanup.
--
-- Run via: psql $DATABASE_URL -f migrations/006_rating_snapshots.sql

BEGIN;

CREATE TABLE IF NOT EXISTS invoice_cdr_snapshots (
  id                      SERIAL PRIMARY KEY,
  cdr_id                  VARCHAR(128),
  cdr_start_time          VARCHAR(64),
  callee                  VARCHAR(256),
  duration_secs           INTEGER,
  i_tariff                VARCHAR(64),
  tariff_version_id       INTEGER REFERENCES tariff_versions(id)         ON DELETE SET NULL,
  rating_verification_id  INTEGER REFERENCES rating_verifications(id)    ON DELETE SET NULL,
  reproduced_cost         REAL        NOT NULL,
  actual_cost             REAL,
  delta                   REAL,
  interval_1_used         INTEGER,
  interval_n_used         INTEGER,
  price_1_used            REAL,
  price_n_used            REAL,
  connect_fee_used        REAL,
  grace_period_used       INTEGER,
  free_seconds_used       INTEGER,
  post_call_surcharge_used REAL,
  prefix                  VARCHAR(32),
  verification_status     VARCHAR(32)  NOT NULL DEFAULT 'pending',
  snapshot_hash           VARCHAR(64)  NOT NULL,
  locked_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ics_cdr_id
  ON invoice_cdr_snapshots (cdr_id)
  WHERE cdr_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ics_i_tariff
  ON invoice_cdr_snapshots (i_tariff);

CREATE INDEX IF NOT EXISTS idx_ics_rating_verification_id
  ON invoice_cdr_snapshots (rating_verification_id);

CREATE INDEX IF NOT EXISTS idx_ics_tariff_version_id
  ON invoice_cdr_snapshots (tariff_version_id);

CREATE INDEX IF NOT EXISTS idx_ics_verification_status
  ON invoice_cdr_snapshots (verification_status);

CREATE INDEX IF NOT EXISTS idx_ics_locked_at
  ON invoice_cdr_snapshots (locked_at DESC);

CREATE INDEX IF NOT EXISTS idx_ics_delta
  ON invoice_cdr_snapshots (delta)
  WHERE delta IS NOT NULL AND ABS(delta) > 0.0001;

COMMENT ON TABLE invoice_cdr_snapshots IS
  'Layer 4C: Immutable telecom finance truth. Each row crystallizes a CDR rating, historical tariff, and verification result. Never mutated after creation — snapshot_hash provides tamper detection.';

COMMENT ON COLUMN invoice_cdr_snapshots.snapshot_hash IS
  'SHA-256 of canonical JSON of immutable fields. Re-compute and compare to detect tampering.';

COMMENT ON COLUMN invoice_cdr_snapshots.locked_at IS
  'Immutable commit timestamp. Set once at creation, never updated.';

COMMIT;
