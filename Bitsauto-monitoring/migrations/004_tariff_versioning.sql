-- Layer 4A: Tariff Versioning
-- Run via: psql $DATABASE_URL -f migrations/004_tariff_versioning.sql

BEGIN;

CREATE TABLE IF NOT EXISTS tariff_versions (
  id             SERIAL PRIMARY KEY,
  i_tariff       VARCHAR(64)  NOT NULL,
  tariff_name    VARCHAR(256),
  source         VARCHAR(32)  NOT NULL DEFAULT 'manual',
  snapshot_json  TEXT         NOT NULL,
  rate_count     INTEGER      DEFAULT 0,
  effective_from TIMESTAMPTZ,
  effective_to   TIMESTAMPTZ,
  notes          TEXT,
  created_by     VARCHAR(128),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tariff_versions_i_tariff    ON tariff_versions (i_tariff);
CREATE INDEX IF NOT EXISTS idx_tariff_versions_created_at  ON tariff_versions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tariff_versions_source      ON tariff_versions (source);

COMMENT ON TABLE tariff_versions IS
  'Immutable point-in-time snapshots of Sippy tariff rate lists. Required for Layer 4B rating verification and Layer 5 invoice automation.';

COMMENT ON COLUMN tariff_versions.snapshot_json IS
  'Full JSON array of rate rows. Never mutated after insert.';

COMMENT ON COLUMN tariff_versions.source IS
  'manual | auto_snapshot | pre_change | post_change | morocco_workflow';

CREATE TABLE IF NOT EXISTS tariff_change_events (
  id                 SERIAL PRIMARY KEY,
  tariff_version_id  INTEGER      NOT NULL REFERENCES tariff_versions(id) ON DELETE CASCADE,
  i_tariff           VARCHAR(64)  NOT NULL,
  prefix             VARCHAR(32),
  destination        VARCHAR(256),
  change_type        VARCHAR(32)  NOT NULL,
  old_interval_1     INTEGER,
  new_interval_1     INTEGER,
  old_interval_n     INTEGER,
  new_interval_n     INTEGER,
  old_price_1        REAL,
  new_price_1        REAL,
  old_price_n        REAL,
  new_price_n        REAL,
  old_connect_fee    REAL,
  new_connect_fee    REAL,
  old_grace_period   INTEGER,
  new_grace_period   INTEGER,
  old_surcharge      REAL,
  new_surcharge      REAL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tariff_change_events_version_id ON tariff_change_events (tariff_version_id);
CREATE INDEX IF NOT EXISTS idx_tariff_change_events_i_tariff   ON tariff_change_events (i_tariff);
CREATE INDEX IF NOT EXISTS idx_tariff_change_events_prefix     ON tariff_change_events (prefix);
CREATE INDEX IF NOT EXISTS idx_tariff_change_events_change_type ON tariff_change_events (change_type);

COMMENT ON TABLE tariff_change_events IS
  'Field-level delta records for each tariff version. Supports change type filtering for reconciliation engine.';

COMMENT ON COLUMN tariff_change_events.change_type IS
  'added | removed | interval_changed | rate_changed | surcharge_changed | modified';

COMMIT;
