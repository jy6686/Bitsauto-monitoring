-- ============================================================
-- Migration 033: Remap references, delete duplicates, create index
-- Phase 2 of 2 — destructive, runs AFTER 032
-- Fully transactional. Aborts if orphaned references remain.
-- Idempotent: no-op on databases already cleaned (dev).
-- ============================================================

BEGIN;

-- 1. Delete Cluster A rate rows (buy_rate=0 placeholder shells)
--    These cannot be remapped — both cluster_a_id and cluster_b_id already have rate rows
--    for the same product_prefix (unique constraint). Old rows are all buy_rate=0.
DELETE FROM destination_product_rates
WHERE destination_id IN (
  SELECT cluster_a_id FROM destination_dedup_map WHERE deleted_at IS NULL
);

-- 2. Remap vendor_rate_normalized_prefixes
UPDATE vendor_rate_normalized_prefixes vrnp
SET destination_id = m.cluster_b_id
FROM destination_dedup_map m
WHERE vrnp.destination_id = m.cluster_a_id
  AND m.deleted_at IS NULL;

-- 3. Remap optional tables (existence-guarded)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'deal_destinations') THEN
    EXECUTE 'UPDATE deal_destinations d SET destination_id = m.cluster_b_id
             FROM destination_dedup_map m
             WHERE d.destination_id = m.cluster_a_id AND m.deleted_at IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_rates') THEN
    EXECUTE 'UPDATE product_rates p SET destination_id = m.cluster_b_id
             FROM destination_dedup_map m
             WHERE p.destination_id = m.cluster_a_id AND m.deleted_at IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_history') THEN
    EXECUTE 'UPDATE product_history p SET destination_id = m.cluster_b_id
             FROM destination_dedup_map m
             WHERE p.destination_id = m.cluster_a_id AND m.deleted_at IS NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_destination_assignments') THEN
    EXECUTE 'UPDATE product_destination_assignments p SET destination_id = m.cluster_b_id
             FROM destination_dedup_map m
             WHERE p.destination_id = m.cluster_a_id AND m.deleted_at IS NULL';
  END IF;
END $$;

-- 4. Mark remapped
UPDATE destination_dedup_map SET remapped_at = NOW()
WHERE remapped_at IS NULL AND deleted_at IS NULL;

-- 5. Assert zero orphaned references before deleting
DO $$
DECLARE
  orphan_rates      INTEGER;
  orphan_normalized INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_rates
  FROM destination_product_rates dpr
  JOIN destination_dedup_map m ON dpr.destination_id = m.cluster_a_id
  WHERE m.deleted_at IS NULL;

  SELECT COUNT(*) INTO orphan_normalized
  FROM vendor_rate_normalized_prefixes vrnp
  JOIN destination_dedup_map m ON vrnp.destination_id = m.cluster_a_id
  WHERE m.deleted_at IS NULL;

  IF orphan_rates > 0 OR orphan_normalized > 0 THEN
    RAISE EXCEPTION
      'Orphaned references remain — aborting. destination_product_rates=%, vendor_rate_normalized_prefixes=%',
      orphan_rates, orphan_normalized;
  END IF;

  RAISE NOTICE 'Orphan check passed. Proceeding to delete duplicate destinations.';
END $$;

-- 6. Delete duplicate global_destinations rows (Cluster A shells)
DELETE FROM global_destinations
WHERE id IN (
  SELECT cluster_a_id FROM destination_dedup_map WHERE deleted_at IS NULL
);

-- 7. Mark deleted
UPDATE destination_dedup_map SET deleted_at = NOW() WHERE deleted_at IS NULL;

-- 8. Strip any remaining leading + from dial_prefix on surviving rows
UPDATE global_destinations
SET dial_prefix = REGEXP_REPLACE(dial_prefix, '^\+', '')
WHERE dial_prefix LIKE '+%';

-- 9. Create unique index — safe now, IF NOT EXISTS for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_destinations_prefix_unique
  ON global_destinations (dial_prefix)
  WHERE dial_prefix IS NOT NULL AND dial_prefix <> '';

-- 10. Final report
DO $$
DECLARE
  total_remaining INTEGER;
  map_deleted     INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_remaining FROM global_destinations;
  SELECT COUNT(*) INTO map_deleted     FROM destination_dedup_map WHERE deleted_at IS NOT NULL;
  RAISE NOTICE 'Migration 033 complete. global_destinations=%, duplicates_removed=%',
    total_remaining, map_deleted;
END $$;

COMMIT;
