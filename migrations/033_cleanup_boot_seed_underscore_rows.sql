-- 033_cleanup_boot_seed_underscore_rows.sql
-- Remove underscore-keyed navigation_modules rows re-inserted by the legacy
-- db.ts boot block AFTER migration 032 had renamed all module_keys to kebab.
--
-- Root cause timeline
-- -------------------
--   1. 031+032 applied → all module_key values kebab-case (certified).
--   2. Server restarted while still running pre-Phase-2A db.ts.
--   3. Boot block INSERT ... ON CONFLICT (module_key) DO NOTHING found no
--      underscore keys left → re-inserted ~126 underscore rows (new serial ids).
--   4. Phase 2A (748dd7d7) removed the boot block → no further re-inserts.
--   This migration removes the orphaned re-inserts.
--
-- Safety
-- ------
--   * DELETE is restricted to underscore rows whose kebab twin exists — the
--     exact boot re-insert signature. Original rows were renamed IN PLACE by
--     032 (ids preserved), so they never match this predicate.
--   * Any underscore row WITHOUT a kebab twin is renamed, not deleted
--     (032 rule).
--   * This is bug remediation, NOT a module exclusion. The frozen
--     no-exclusions-before-module-review rule does not apply.
--
-- Idempotency: re-running deletes/renames nothing; verification still passes.

BEGIN;

-- ── 1. Delete boot re-inserts (underscore row whose kebab twin exists) ────────
DELETE FROM navigation_modules u
 WHERE u.module_key LIKE '%\_%' ESCAPE '\'
   AND EXISTS (
     SELECT 1 FROM navigation_modules k
      WHERE k.module_key = replace(u.module_key, '_', '-')
   );

-- ── 2. Rename any twinless underscore rows (none expected) ────────────────────
UPDATE navigation_modules
   SET module_key = replace(module_key, '_', '-')
 WHERE module_key LIKE '%\_%' ESCAPE '\';

-- ── 3. Sync bare-TEXT reference fields (no-ops if already clean) ──────────────
UPDATE portal_workspace
   SET home_module = replace(home_module, '_', '-')
 WHERE home_module IS NOT NULL
   AND home_module LIKE '%\_%' ESCAPE '\';

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
      'boot-seed cleanup incomplete: navigation_modules=%, portal_workspace=%, user_favorites=%',
      nm_count, pw_count, uf_count;
  END IF;
END $$;

COMMIT;
