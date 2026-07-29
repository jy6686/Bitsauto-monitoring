-- 030_noc_main_dashboard.sql
-- Registers the main platform DashboardPage (route /dashboard) as a portal
-- module and assigns it to the NOC portal's "dashboard" section as the home
-- module. The component is resolved via moduleRegistry["dashboard"] in
-- client/src/portals/registry/module-registry.ts — no second component to
-- maintain. Any enhancement to the main dashboard appears automatically here.
--
-- Ordering: display_order 0 for the main dashboard (home), noc-dashboard moves
-- to display_order 1 (remains available as the specialized NOC monitoring view).

BEGIN;

-- ── 1. Ensure unique index (idempotent — same guard as 029) ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_module  ON portal_module_assignments (portal_id, module_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_section ON portal_sections           (portal_id, section_key);

-- ── 2. Register the "dashboard" module (main platform DashboardPage) ─────────
INSERT INTO navigation_modules
  (module_key, title, icon, route, category, default_portal, is_movable, is_system)
VALUES
  ('dashboard', 'Dashboard', 'layout-dashboard', '/dashboard', 'core', NULL, false, true)
ON CONFLICT (module_key) DO UPDATE
  SET title  = EXCLUDED.title,
      icon   = EXCLUDED.icon,
      route  = EXCLUDED.route;

-- ── 3. Assign to NOC portal → dashboard section (is_home = true) ─────────────
-- Demote noc-dashboard to display_order 1 so the main dashboard is the landing.
UPDATE portal_module_assignments
   SET display_order = 1,
       is_home       = false
 WHERE portal_id = 'noc'
   AND module_id = (SELECT id FROM navigation_modules WHERE module_key = 'noc-dashboard');

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
VALUES
  ('noc',
   (SELECT id FROM navigation_modules WHERE module_key = 'dashboard'),
   'dashboard', 0, 'full', true, true)
ON CONFLICT (portal_id, module_id) DO UPDATE
  SET section       = 'dashboard',
      display_order = 0,
      visibility    = 'full',
      is_home       = true,
      is_pinned     = true;

COMMIT;
