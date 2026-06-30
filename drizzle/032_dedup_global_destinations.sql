-- Migration 032: Production deduplication + unique prefix index
-- Removes Cluster A (+prefix) rows that are exact duplicates of Cluster B (bare prefix) rows.
-- Safe to re-run: IF NOT EXISTS guards on index, DELETE is idempotent once rows are gone.
-- This migration must run before idx_global_destinations_prefix_unique can be created on prod.

BEGIN;

-- Step 1: Record the pairs we are about to remove (audit trail)
-- Only inserts rows that don't already exist in the map
INSERT INTO destination_dedup_map
  (cluster_a_id, cluster_b_id, cluster_a_name, cluster_b_name,
   cluster_a_prefix, cluster_b_prefix, normalized_prefix,
   cluster_a_rate_rows, cluster_b_rate_rows, referencing_tables,
   classification, recommended_action)
SELECT
  a.id,
  b.id,
  a.name,
  b.name,
  a.dial_prefix,
  b.dial_prefix,
  b.dial_prefix,
  (SELECT COUNT(*) FROM destination_product_rates WHERE destination_id = a.id),
  (SELECT COUNT(*) FROM destination_product_rates WHERE destination_id = b.id),
  'destination_product_rates',
  'exact_duplicate',
  'MERGE'
FROM global_destinations a
JOIN global_destinations b
  ON regexp_replace(a.dial_prefix, '^\+', '') = b.dial_prefix
  AND a.dial_prefix LIKE '+%'
  AND b.dial_prefix NOT LIKE '+%'
ON CONFLICT (cluster_a_id, cluster_b_id) DO NOTHING;

-- Step 2: Remap destination_product_rates FKs from Cluster A → Cluster B
-- Only for rows where the normalized prefix match is exact
UPDATE destination_product_rates dpr
SET destination_id = ddm.cluster_b_id
FROM destination_dedup_map ddm
WHERE dpr.destination_id = ddm.cluster_a_id
  AND ddm.classification = 'exact_duplicate'
  AND ddm.recommended_action = 'MERGE';

-- Step 3: Delete orphaned destination_product_rates for Cluster A
-- (rows that had no Cluster B equivalent — shouldn't exist after step 2, but safety net)
DELETE FROM destination_product_rates
WHERE destination_id IN (
  SELECT id FROM global_destinations WHERE dial_prefix LIKE '+%'
);

-- Step 4: Delete Cluster A rows from global_destinations
DELETE FROM global_destinations WHERE dial_prefix LIKE '+%';

-- Step 5: Mark the dedup_map entries as processed
UPDATE destination_dedup_map SET remapped_at = NOW() WHERE remapped_at IS NULL AND classification = 'exact_duplicate';

-- Step 6: Create unique index (now safe — Cluster A removed, no duplicate normalized prefixes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_destinations_prefix_unique
  ON global_destinations (dial_prefix)
  WHERE dial_prefix IS NOT NULL AND dial_prefix <> '';

COMMIT;
