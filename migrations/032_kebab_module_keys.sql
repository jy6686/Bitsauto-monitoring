-- 032_kebab_module_keys.sql
-- Standardise ALL module_key values to kebab-case — the single canonical identity.
--
-- Context
-- -------
-- Migration 031 seeds navigation_modules with underscore-style keys (live_calls, etc.)
-- and includes an identity-merge step that handles the 6 specific keys renamed by 029
-- (live-calls, live-traffic, traffic-map, noc-dashboard, noc-command, ops-console):
-- those had both a legacy kebab row and a freshly-seeded underscore row, and 031 merges
-- them. This migration renames the remaining ~119 underscore-keyed rows that were never
-- converted. Run 031 first, then 032.
--
-- The invariant (frozen, NAV-WORKSPACE-MODEL §4 rule):
--   module_key is the canonical identifier everywhere:
--   DB · workspace API · React registry · router · audit · permissions ·
--   favorites · quick-actions · portal_module_overrides
--   No translation layer. No aliases. No underscore variants.
--
-- Tables updated
-- --------------
-- navigation_modules.module_key  — primary source of truth
-- portal_workspace.home_module   — bare TEXT field (no FK); must stay in sync
-- user_favorites.module_key      — bare TEXT field (no FK); must stay in sync
--
-- NOT updated: portal_module_assignments.module_id — integer FK, unaffected by rename.
--
-- Idempotency
-- -----------
-- replace(key, '_', '-') on a key that already has no underscores is a no-op.
-- Re-running is always safe; the final DO $$ block will still report 0 remaining.

BEGIN;

-- ── 1. navigation_modules: rename underscore keys to kebab ────────────────────
UPDATE navigation_modules
   SET module_key = replace(module_key, '_', '-')
 WHERE module_key LIKE '%\_%' ESCAPE '\';

-- ── 2. portal_workspace.home_module: keep in sync ────────────────────────────
UPDATE portal_workspace
   SET home_module = replace(home_module, '_', '-')
 WHERE home_module IS NOT NULL
   AND home_module LIKE '%\_%' ESCAPE '\';

-- ── 3. user_favorites.module_key: keep in sync ───────────────────────────────
UPDATE user_favorites
   SET module_key = replace(module_key, '_', '-')
 WHERE module_key LIKE '%\_%' ESCAPE '\';

-- ── 4. Verify — fail the transaction if any underscore keys remain ────────────
DO $$
DECLARE
  nm_count INT;
  pw_count INT;
  uf_count INT;
BEGIN
  SELECT COUNT(*) INTO nm_count
    FROM navigation_modules
   WHERE module_key LIKE '%\_%' ESCAPE '\';

  SELECT COUNT(*) INTO pw_count
    FROM portal_workspace
   WHERE home_module IS NOT NULL
     AND home_module LIKE '%\_%' ESCAPE '\';

  SELECT COUNT(*) INTO uf_count
    FROM user_favorites
   WHERE module_key LIKE '%\_%' ESCAPE '\';

  IF nm_count > 0 OR pw_count > 0 OR uf_count > 0 THEN
    RAISE EXCEPTION
      'kebab standardisation incomplete: navigation_modules=%, portal_workspace=%, user_favorites=%',
      nm_count, pw_count, uf_count;
  END IF;
END $$;

COMMIT;
