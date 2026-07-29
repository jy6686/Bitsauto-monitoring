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

-- ── THIS MIGRATION MUST NEVER HALT THE RUNNER ─────────────────────────────────
-- It adds a NAVIGATION MENU ROW. It originally raised when the target nav group was
-- absent, and on 2026-07-29 that took production down: the runner halts on first failure
-- by design (never apply 045 over a failed 044), so 048 raising meant 049 never added
-- companies.account_prefix — a column the deployed code selects on every request. Result:
-- GET /api/companies returned 500 and the company list rendered empty.
--
-- A cosmetic migration blocking a structural one is an ordering fault, not a data
-- problem. Everything here is now conditional: if the workspace nav is not seeded (031
-- never ran on this database), the menu entry is skipped with a NOTICE and the run
-- continues. The page still works at /schema-migrations — the route exists in App.tsx
-- independently of this row.
DO $$
DECLARE gid INTEGER;
BEGIN
  -- Table-existence guard as well as row-existence: a database that never received the
  -- portal workspace model has no navigation_groups at all, and an unguarded SELECT
  -- against a missing relation raises exactly the way this migration must not.
  IF to_regclass('public.navigation_groups') IS NULL
     OR to_regclass('public.navigation_modules') IS NULL THEN
    RAISE NOTICE 'portal navigation tables absent — skipping the Schema Migrations menu entry.';
    RETURN;
  END IF;

  SELECT id INTO gid FROM navigation_groups
   WHERE domain_id = 'operations' AND label = 'Diagnostics' LIMIT 1;

  IF gid IS NULL THEN
    RAISE NOTICE 'navigation_groups "operations / Diagnostics" not present (migration 031 not seeded here) — skipping the Schema Migrations menu entry. The page remains reachable at /schema-migrations.';
    RETURN;
  END IF;

  -- Kebab key, per the canonical identity established by 032. is_system = TRUE: platform
  -- infrastructure, not a module an operator should be able to move or remove.
  INSERT INTO navigation_modules (module_key, title, icon, route, category, is_system, sort_order, group_id)
  VALUES ('schema-migrations', 'Schema Migrations', 'database', '/schema-migrations', 'operations', TRUE, 90, gid)
  ON CONFLICT (module_key) DO UPDATE SET
    title = EXCLUDED.title, icon = EXCLUDED.icon, route = EXCLUDED.route,
    group_id = EXCLUDED.group_id, is_system = EXCLUDED.is_system;

  -- Migration state is an admin concern; NOC operators cannot act on it.
  BEGIN
    INSERT INTO portal_module_overrides (portal_slug, module_key, visibility, reason)
    VALUES ('noc', 'schema-migrations', 'hidden', 'Platform administration — not NOC scope')
    ON CONFLICT (portal_slug, module_key) DO UPDATE SET
      visibility = EXCLUDED.visibility, reason = EXCLUDED.reason;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'portal_module_overrides not available — NOC visibility override skipped (%)', SQLERRM;
  END;
END $$;

COMMIT;
