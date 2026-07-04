SELECT COUNT(*) AS global_destinations_source_count FROM global_destinations;
SELECT COUNT(*) AS destinations_current_count FROM destinations;
SELECT commercial_status, COUNT(*) AS row_count
FROM global_destinations GROUP BY commercial_status ORDER BY row_count DESC;

BEGIN;

INSERT INTO destinations (
  id, parent_id, level, name, country_code, dial_prefix,
  operator_name, commercial_status, sort_order, notes, blocked_reason,
  lifecycle_state
)
SELECT
  id, parent_id, level, name, country_code, dial_prefix,
  operator_name, commercial_status, sort_order, notes, blocked_reason,
  CASE commercial_status
    WHEN 'approved' THEN 'approved'
    WHEN 'blocked'  THEN 'blocked'
    ELSE                 'draft'
  END AS lifecycle_state
FROM global_destinations
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  parent_id         = EXCLUDED.parent_id,
  level             = EXCLUDED.level,
  country_code      = EXCLUDED.country_code,
  dial_prefix       = EXCLUDED.dial_prefix,
  operator_name     = EXCLUDED.operator_name,
  commercial_status = EXCLUDED.commercial_status,
  sort_order        = EXCLUDED.sort_order,
  notes             = EXCLUDED.notes,
  blocked_reason    = EXCLUDED.blocked_reason,
  lifecycle_state   = EXCLUDED.lifecycle_state,
  updated_at        = NOW();

SELECT setval(
  pg_get_serial_sequence('destinations', 'id'),
  COALESCE((SELECT MAX(id) FROM destinations), 1)
);

COMMIT;

SELECT id, name FROM global_destinations EXCEPT SELECT id, name FROM destinations;
SELECT id, name FROM destinations EXCEPT SELECT id, name FROM global_destinations;
SELECT g.id, g.name AS legacy_name, d.name AS canonical_name
FROM global_destinations g JOIN destinations d ON g.id = d.id WHERE g.name <> d.name;
SELECT g.id, g.dial_prefix AS legacy, d.dial_prefix AS canonical
FROM global_destinations g JOIN destinations d ON g.id = d.id
WHERE g.dial_prefix IS DISTINCT FROM d.dial_prefix;
SELECT g.id, g.commercial_status AS legacy, d.commercial_status AS canonical
FROM global_destinations g JOIN destinations d ON g.id = d.id
WHERE g.commercial_status IS DISTINCT FROM d.commercial_status;
SELECT
  (SELECT COUNT(*) FROM global_destinations) AS source_count,
  (SELECT COUNT(*) FROM destinations)        AS canonical_count,
  (SELECT COUNT(*) FROM global_destinations) = (SELECT COUNT(*) FROM destinations) AS counts_match;
SELECT d.lifecycle_state, g.commercial_status AS source_status, COUNT(*) AS row_count
FROM destinations d JOIN global_destinations g ON d.id = g.id
GROUP BY d.lifecycle_state, g.commercial_status ORDER BY d.lifecycle_state, row_count DESC;
