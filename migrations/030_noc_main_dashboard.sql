-- 030_noc_main_dashboard.sql
-- Registers module key "dashboard" (main platform DashboardPage, route /dashboard)
-- and assigns it to the NOC portal's dashboard section as the home module.
-- noc-dashboard moves to display_order 1 (still accessible as the specialized view).
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_module  ON portal_module_assignments (portal_id, module_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_section ON portal_sections           (portal_id, section_key);

INSERT INTO navigation_modules
  (module_key, title, icon, route, category, default_portal, is_movable, is_system)
VALUES
  ('dashboard', 'Dashboard', 'layout-dashboard', '/dashboard', 'core', NULL, false, true)
ON CONFLICT (module_key) DO UPDATE
  SET title = EXCLUDED.title, icon = EXCLUDED.icon, route = EXCLUDED.route;

UPDATE portal_module_assignments
   SET display_order = 1, is_home = false
 WHERE portal_id = 'noc'
   AND module_id = (SELECT id FROM navigation_modules WHERE module_key = 'noc-dashboard');

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
VALUES
  ('noc', (SELECT id FROM navigation_modules WHERE module_key = 'dashboard'),
   'dashboard', 0, 'full', true, true)
ON CONFLICT (portal_id, module_id) DO UPDATE
  SET section='dashboard', display_order=0, is_home=true, is_pinned=true;

COMMIT;
