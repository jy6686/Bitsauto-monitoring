SELECT
  COUNT(*)                                          AS total_rows,
  COUNT(*) FILTER (WHERE code IS NOT NULL)          AS code_populated,
  COUNT(*) FILTER (WHERE lifecycle_state IS NULL)   AS lifecycle_nulls,
  COUNT(*) FILTER (WHERE commercial_status IS NULL) AS status_nulls,
  COUNT(*) FILTER (WHERE name IS NULL OR name = '') AS name_nulls
FROM destinations;

CREATE OR REPLACE VIEW destinations_v AS
SELECT
  id, parent_id, level, name, country_code, dial_prefix,
  operator_name, commercial_status, sort_order, notes, blocked_reason
FROM destinations;

SELECT COUNT(*) AS destinations_v_count FROM destinations_v;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'destinations_v'
ORDER BY ordinal_position;

SELECT 'destinations_v' AS source, id, name, dial_prefix, commercial_status
FROM destinations_v ORDER BY id LIMIT 5;

SELECT 'global_destinations' AS source, id, name, dial_prefix, commercial_status
FROM global_destinations ORDER BY id LIMIT 5;

SELECT COUNT(*) AS lifecycle_state_in_view
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'destinations_v' AND column_name = 'lifecycle_state';
