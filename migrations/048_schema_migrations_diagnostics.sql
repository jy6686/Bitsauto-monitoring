-- 048_schema_migrations_diagnostics.sql
-- Registers the Schema Migrations diagnostics page in the workspace navigation.
--
-- The page (/schema-migrations, admin + super_admin only) shows the schema_migrations
-- ledger written by runFileMigrations(): what was applied, what is pending, and any
-- checksum drift between the database and the repository. It exists so drift is an
-- operational fact an operator can see, not something found by grepping logs.
--
-- Placed in operations / Diagnostics. Note this migration is itself the first one the
-- new runner applies from a clean ledger, which makes it a live proof of the path.
--
-- Prerequisites: 031 (workspace model), 032 (kebab keys).
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE; re-run is safe.

BEGIN;

-- ── 1. Pre-flight: the target group must exist ────────────────────────────────
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM navigation_groups
        WHERE domain_id = 'operations' AND label = 'Diagnostics') <> 1 THEN
    RAISE EXCEPTION 'missing navigation_groups row: operations / Diagnostics — run 031 first';
  END IF;
END $$;

-- ── 2. The module ─────────────────────────────────────────────────────────────
-- Kebab key, per the canonical identity established by 032. is_system = TRUE: this is
-- platform infrastructure, not a module an operator should be able to move or remove.
INSERT INTO navigation_modules (module_key, title, icon, route, category, is_system, sort_order, group_id)
VALUES (
  'schema-migrations', 'Schema Migrations', 'database', '/schema-migrations', 'operations', TRUE, 90,
  (SELECT id FROM navigation_groups WHERE domain_id = 'operations' AND label = 'Diagnostics')
)
ON CONFLICT (module_key) DO UPDATE SET
  title      = EXCLUDED.title,
  icon       = EXCLUDED.icon,
  route      = EXCLUDED.route,
  group_id   = EXCLUDED.group_id,
  is_system  = EXCLUDED.is_system;

-- ── 3. Hide it from the NOC portal ────────────────────────────────────────────
-- Migration state is an admin concern. NOC operators run the network; showing them a
-- page they cannot act on adds noise to a workspace that was deliberately curated.
INSERT INTO portal_module_overrides (portal_slug, module_key, visibility, reason) VALUES
  ('noc', 'schema-migrations', 'hidden', 'Platform administration — not NOC scope')
ON CONFLICT (portal_slug, module_key) DO UPDATE SET
  visibility = EXCLUDED.visibility,
  reason     = EXCLUDED.reason;

-- ── 4. Verify ─────────────────────────────────────────────────────────────────
DO $$
DECLARE grouped INTEGER;
BEGIN
  SELECT COUNT(*) INTO grouped
    FROM navigation_modules m
    JOIN navigation_groups g ON g.id = m.group_id
   WHERE m.module_key = 'schema-migrations'
     AND g.domain_id = 'operations';
  IF grouped <> 1 THEN
    RAISE EXCEPTION 'schema-migrations module not attached to the operations domain';
  END IF;
END $$;

COMMIT;
