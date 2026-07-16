-- 022_seed_portal_assignments.sql
-- Portal framework seed (ADR-006). Model A (navigation_modules + portal_sections +
-- portal_module_assignments) is the single source of truth consumed by the Portal
-- Configuration Service. Idempotent.
--
-- Scope: complete the 4-portal data model (NOC / Commercial / Finance / Admin) and
-- fully enable NOC (Phase 1). Other portals' module assignments are added as each
-- portal is implemented (keys reserved in docs .../MODULE-REGISTRY.md).
--
-- Module keys are standardized to kebab-case here (the permanent identity used in
-- URL/DB/registry/permissions/audit). Legacy underscore keys from 020 are RENAMED —
-- there is no second naming convention.

BEGIN;

-- ── 0. Ensure the unique index this seed's upserts depend on (idempotent) ───────
-- shared/schema.ts now declares uq_portal_module / uq_portal_section, but a database
-- created by `drizzle-kit push` BEFORE that fix (e.g. the current deployment) has
-- neither — so 029's ON CONFLICT clauses would fail and roll the whole seed back → 0
-- rows. Same index names as the schema, so a schema-fixed DB is a no-op; a bare DB
-- gets it created. (ON CONFLICT tolerates multiple arbiter indexes, so a DB that also
-- has the migration-020/021 constraint is unaffected.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_module  ON portal_module_assignments (portal_id, module_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_section ON portal_sections           (portal_id, section_key);

-- ── 1. Standardize legacy underscore module keys → kebab (idempotent) ───────────
UPDATE navigation_modules SET module_key = 'live-calls'
  WHERE module_key = 'live_calls'
    AND NOT EXISTS (SELECT 1 FROM navigation_modules WHERE module_key = 'live-calls');
UPDATE navigation_modules SET module_key = 'live-traffic'
  WHERE module_key = 'live_traffic'
    AND NOT EXISTS (SELECT 1 FROM navigation_modules WHERE module_key = 'live-traffic');
UPDATE navigation_modules SET module_key = 'noc-command'
  WHERE module_key = 'noc_command'
    AND NOT EXISTS (SELECT 1 FROM navigation_modules WHERE module_key = 'noc-command');

-- ── 2. Ensure the 6 NOC Phase-1 modules exist (kebab keys, bare routes) ─────────
-- route stays bare (main-platform route); portal-relative href is derived from the
-- module key by the config service (/:portal/:moduleKey).
INSERT INTO navigation_modules (module_key, title, icon, route, category, default_portal, is_movable, is_system) VALUES
  ('live-calls',    'Live Calls',    'phone',            '/calls',            'monitoring', 'noc', true, false),
  ('live-traffic',  'Live Traffic',  'activity',         '/live-traffic',     'monitoring', 'noc', true, false),
  ('traffic-map',   'Traffic Map',   'map',              '/traffic-map',      'monitoring', 'noc', true, false),
  ('noc-dashboard', 'NOC Dashboard', 'layout-dashboard', '/noc-dashboard',    'monitoring', 'noc', true, false),
  ('noc-command',   'NOC Command',   'monitor',          '/noc-command',      'monitoring', 'noc', true, false),
  ('ops-console',   'Ops Console',   'layout-grid',      '/ops-console',      'monitoring', 'noc', true, false)
ON CONFLICT (module_key) DO UPDATE
  SET title = EXCLUDED.title, icon = EXCLUDED.icon, route = EXCLUDED.route,
      category = EXCLUDED.category, default_portal = EXCLUDED.default_portal;

-- ── 3. Complete the 4-portal definition set (add Commercial; others from 020) ────
INSERT INTO portal_definitions (slug, name, icon, theme, default_route, allowed_roles, sort_order) VALUES
  ('commercial', 'Commercial Portal', 'briefcase', 'purple', '/commercial',
   ARRAY['admin','super_admin','management'], 6)
ON CONFLICT (slug) DO NOTHING;

-- ── 4. NOC sections (Level-2 tabs) ──────────────────────────────────────────────
-- Dashboard is its own top section (operators land on the real NOC dashboard, which
-- is the is_home module below). DO UPDATE so re-running re-asserts titles/ordering.
INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order) VALUES
  ('noc', 'dashboard',       'Dashboard',       'layout-dashboard', 0),
  ('noc', 'live-operations', 'Live Operations', 'activity',         1),
  ('noc', 'command-center',  'Command Center',  'monitor',          2)
ON CONFLICT (portal_id, section_key) DO UPDATE
  SET title = EXCLUDED.title, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order;

-- ── 4b. Remove non-Phase-1 NOC assignments from the 020 seed ────────────────────
-- Phase 1 exposes only the 6 registered modules. Others (alerts, qos_heatmap, …) are
-- not yet bound in the client module registry and would 404; re-add them when their
-- components are registered. Keeps the DB source of truth to what actually renders.
DELETE FROM portal_module_assignments
 WHERE portal_id = 'noc'
   AND module_id NOT IN (
     SELECT id FROM navigation_modules WHERE module_key IN
       ('live-calls','live-traffic','traffic-map','noc-dashboard','noc-command','ops-console')
   );

-- ── 5. NOC module assignments (Model A: portal × module → section/order/flags) ──
INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
VALUES
  ('noc', (SELECT id FROM navigation_modules WHERE module_key='live-calls'),    'live-operations', 1, 'full', false, true),
  ('noc', (SELECT id FROM navigation_modules WHERE module_key='live-traffic'),  'live-operations', 2, 'full', false, true),
  ('noc', (SELECT id FROM navigation_modules WHERE module_key='traffic-map'),   'live-operations', 3, 'full', false, false),
  ('noc', (SELECT id FROM navigation_modules WHERE module_key='noc-dashboard'), 'dashboard',       1, 'full', true,  true),
  ('noc', (SELECT id FROM navigation_modules WHERE module_key='noc-command'),   'command-center',  1, 'full', false, false),
  ('noc', (SELECT id FROM navigation_modules WHERE module_key='ops-console'),   'command-center',  2, 'full', false, false)
ON CONFLICT (portal_id, module_id) DO UPDATE
  SET section = EXCLUDED.section, display_order = EXCLUDED.display_order,
      visibility = EXCLUDED.visibility, is_home = EXCLUDED.is_home, is_pinned = EXCLUDED.is_pinned;

COMMIT;
