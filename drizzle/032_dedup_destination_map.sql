-- ============================================================
-- Migration 032: Destination dedup map + alias table
-- Phase 1 of 2 — NO DELETIONS, audit only
-- Safe to run on both clean (dev) and dirty (production) DBs
-- IF NOT EXISTS guards make it fully idempotent
-- ============================================================

BEGIN;

-- 1. destination_aliases (may already exist from direct SQL on dev)
CREATE TABLE IF NOT EXISTS destination_aliases (
  id               SERIAL PRIMARY KEY,
  alias_text       TEXT        NOT NULL,
  normalized_alias TEXT GENERATED ALWAYS AS (
                     LOWER(REGEXP_REPLACE(alias_text, '[^a-zA-Z0-9]', '', 'g'))
                   ) STORED,
  alias_type       TEXT        NOT NULL DEFAULT 'vendor_name',
  destination_id   INTEGER     NOT NULL REFERENCES global_destinations(id) ON DELETE CASCADE,
  source           TEXT,
  confidence       INTEGER     NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ,
  created_by       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dest_aliases_unique
  ON destination_aliases (normalized_alias, alias_type);

CREATE INDEX IF NOT EXISTS idx_dest_aliases_dest
  ON destination_aliases (destination_id);

CREATE INDEX IF NOT EXISTS idx_dest_aliases_normalized
  ON destination_aliases (normalized_alias);

-- 2. Dedup map table — persists old->new ID mapping for audit + rollback
CREATE TABLE IF NOT EXISTS destination_dedup_map (
  id                SERIAL      PRIMARY KEY,
  cluster_a_id            INTEGER     NOT NULL,
  cluster_b_id            INTEGER     NOT NULL,
  normalized_prefix TEXT        NOT NULL,
  cluster_a_prefix   TEXT,
  cluster_b_prefix   TEXT,
  remapped_at       TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dedup_map_old_new
  ON destination_dedup_map (cluster_a_id, cluster_b_id);

CREATE INDEX IF NOT EXISTS idx_dedup_map_old ON destination_dedup_map (cluster_a_id);
CREATE INDEX IF NOT EXISTS idx_dedup_map_new ON destination_dedup_map (cluster_b_id);

-- 3. Populate dedup map — idempotent via WHERE NOT EXISTS
--    keeper = highest id per normalized prefix (Cluster B: real rates, bare prefix)
--    old    = lower  id per normalized prefix (Cluster A: buy_rate=0, +prefix shells)
INSERT INTO destination_dedup_map
  (cluster_a_id, cluster_b_id, normalized_prefix, cluster_a_prefix, cluster_b_prefix)
SELECT
  dup.id             AS cluster_a_id,
  keeper.id          AS cluster_b_id,
  keeper.norm        AS normalized_prefix,
  dup.dial_prefix    AS cluster_a_prefix,
  keeper.dial_prefix AS cluster_b_prefix
FROM (
  SELECT DISTINCT ON (REGEXP_REPLACE(dial_prefix, '^\+', ''))
    id,
    dial_prefix,
    REGEXP_REPLACE(dial_prefix, '^\+', '') AS norm
  FROM global_destinations
  WHERE dial_prefix IS NOT NULL AND dial_prefix <> ''
  ORDER BY REGEXP_REPLACE(dial_prefix, '^\+', ''), id DESC
) keeper
JOIN (
  SELECT id, dial_prefix,
         REGEXP_REPLACE(dial_prefix, '^\+', '') AS norm
  FROM global_destinations
  WHERE dial_prefix IS NOT NULL AND dial_prefix <> ''
) dup ON dup.norm = keeper.norm AND dup.id <> keeper.id
WHERE NOT EXISTS (
  SELECT 1 FROM destination_dedup_map m
  WHERE m.cluster_a_id = dup.id AND m.cluster_b_id = keeper.id
);

-- 4. Report — no assertions here (033 will assert before deleting)
DO $$
DECLARE
  map_rows   INTEGER;
  dup_groups INTEGER;
BEGIN
  SELECT COUNT(*) INTO map_rows FROM destination_dedup_map;
  SELECT COUNT(DISTINCT normalized_prefix) INTO dup_groups
  FROM destination_dedup_map WHERE deleted_at IS NULL;
  RAISE NOTICE 'destination_dedup_map: % pairs across % duplicate groups', map_rows, dup_groups;
  RAISE NOTICE 'If both are 0 the database is already clean — 033 will be a no-op.';
END $$;

COMMIT;
