-- 072_raw_sippy_cdrs.sql
--
-- Permanent repository of every call record fetched from the switch.
--
-- Until now the platform fetched CDRs, verified them, kept the billable ones as
-- snapshots, and discarded the rest. Anything not billed — an unpriceable call,
-- a call from an unbilled account, the raw fields nobody had a column for —
-- existed only until the fetch went out of scope. Answering "what did the
-- switch actually say about this call?" meant asking the switch again, and only
-- for as long as its own retention allowed.
--
-- This table is the system of record for call evidence. Verification, billing,
-- disputes, fraud analysis, margin work and traffic analytics should all read
-- from the same immutable dataset rather than each re-fetching their own copy.
--
-- TWO RULES:
--   1. Append-only. Rows are never edited. A correction is a new fetch.
--   2. Never lose a field. Typed columns exist for what the platform queries;
--      `payload` keeps the complete struct as returned, so a field this schema
--      does not model today is still recoverable tomorrow — including fields a
--      different Sippy build returns that this one does not.
--
-- SIZING: a plain table with the indexes below is comfortable into the low tens
-- of millions of rows. Beyond roughly 50M — sustained six-figure daily call
-- volume — this should become monthly-partitioned on started_at, which is why
-- that column is a real timestamp rather than only the switch's string form.
-- Check actual growth after a week of nightly ingestion (see the row-count and
-- per-day statistics on /api/finance/cdr-repository/stats) and partition on
-- evidence rather than on assumption.
--
-- DEDUP: i_cdr is the switch's own unique CDR identifier and carries a unique
-- index; ingestion inserts with ON CONFLICT DO NOTHING, so re-importing a day is
-- safe and idempotent. Rows arriving without an i_cdr (portal-scraped paths,
-- which are barred from billing anyway) are not protected by that index.

BEGIN;

CREATE TABLE IF NOT EXISTS raw_sippy_cdrs (
  id                 BIGSERIAL PRIMARY KEY,

  -- Identity
  i_cdr              VARCHAR(64),
  i_call             VARCHAR(64),
  cdr_call_id        VARCHAR(255),
  i_account          INTEGER,
  i_customer         INTEGER,
  i_tariff           VARCHAR(64),
  client_name        VARCHAR(256),

  -- Numbers and destination
  caller             VARCHAR(64),
  callee             VARCHAR(64),
  prefix             VARCHAR(32),
  country            VARCHAR(128),
  area_name          VARCHAR(256),
  description        VARCHAR(256),

  -- Timing. started_at is the normalized, indexable form of the switch's
  -- setup time; setup_time_raw preserves exactly what the switch sent.
  started_at         TIMESTAMPTZ,
  setup_time_raw     VARCHAR(64),
  connect_time_raw   VARCHAR(64),
  disconnect_time_raw VARCHAR(64),

  -- Duration
  billed_secs        INTEGER,
  total_secs         INTEGER,
  free_seconds       INTEGER,
  grace_period       INTEGER,
  interval_1         INTEGER,
  interval_n         INTEGER,
  pdd                REAL,

  -- Money, as the switch charged it. This is the CUSTOMER side; vendor cost
  -- comes from vendor CDRs and is not part of this record.
  cost               REAL,
  connect_fee        REAL,
  price_1            REAL,
  price_n            REAL,
  post_call_surcharge REAL,

  -- Disposition and media
  result             VARCHAR(128),
  release_source     VARCHAR(64),
  q850_code          VARCHAR(16),
  remote_ip          VARCHAR(64),
  protocol           VARCHAR(32),
  user_agent         VARCHAR(256),
  vendor             VARCHAR(256),
  i_connection       VARCHAR(64),
  mos_term           REAL,
  mos_orig           REAL,
  jitter             REAL,
  pkt_loss           REAL,

  -- Provenance
  source_method      VARCHAR(32),
  import_run_id      VARCHAR(128),
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload            JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_cdr_i_cdr
  ON raw_sippy_cdrs (i_cdr) WHERE i_cdr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_cdr_account_started
  ON raw_sippy_cdrs (i_account, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_tariff_started
  ON raw_sippy_cdrs (i_tariff, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_started
  ON raw_sippy_cdrs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_call_id
  ON raw_sippy_cdrs (cdr_call_id);

DO $$
BEGIN
  RAISE NOTICE '072: raw_sippy_cdrs created (permanent call-evidence repository).';
END $$;

COMMIT;
