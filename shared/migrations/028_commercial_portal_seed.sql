-- ============================================================
-- Migration 028: Commercial Portal — Sections & Module Seed
-- CAP-004 Phase 1 — Commercial Portal
--
-- Adds 10 navigation_modules for commercial pages,
-- 4 portal_sections, and 10 portal_module_assignments
-- for the existing portal_definition (slug = 'commercial').
--
-- Safe to re-run: all INSERTs use ON CONFLICT DO NOTHING.
-- ============================================================

-- ── 1. Navigation Modules ────────────────────────────────────────────────────
-- One row per commercial page. module_key is the stable URL/DB identity.

INSERT INTO navigation_modules
  (module_key, title, icon, route, category, default_portal, is_movable, is_system, sort_order)
VALUES
  ('kam-dashboard',            'KAM Dashboard',           'bar-chart-2',   '/kam-dashboard',            'commercial', 'commercial', true, false, 1),
  ('clients',                  'Clients',                 'users',          '/clients',                  'commercial', 'commercial', true, false, 2),
  ('partner-profiles',         'Partner Profiles',        'handshake',      '/partner-profiles',         'commercial', 'commercial', true, false, 3),
  ('deals',                    'Deals',                   'briefcase',      '/deals',                    'commercial', 'commercial', true, false, 4),
  ('rate-manager',             'Rate Manager',            'table-2',        '/rate-manager',             'commercial', 'commercial', true, false, 5),
  ('destination-catalog',      'Destination Catalog',     'globe',          '/destination-catalog',      'commercial', 'commercial', true, false, 6),
  ('product-registry',         'Product Registry',        'package',        '/product-registry',         'commercial', 'commercial', true, false, 7),
  ('invoices',                 'Invoices',                'file-text',      '/invoices',                 'commercial', 'commercial', true, false, 8),
  ('commercial-notifications', 'Commercial Notifications','bell',           '/commercial-notifications', 'commercial', 'commercial', true, false, 9),
  ('margin-intelligence',      'Margin Intelligence',     'trending-up',    '/margin-intelligence',      'commercial', 'commercial', true, false, 10)
ON CONFLICT (module_key) DO NOTHING;

-- ── 2. Portal Sections ───────────────────────────────────────────────────────
-- Four logical groups shown as Level-2 nav tabs in the Commercial portal.

INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order, is_active)
VALUES
  ('commercial', 'clients',      'Clients & Partners',   'users',       1, true),
  ('commercial', 'pricing',      'Rates & Pricing',      'table-2',     2, true),
  ('commercial', 'billing',      'Billing & Invoicing',  'file-text',   3, true),
  ('commercial', 'intelligence', 'Intelligence',         'trending-up', 4, true)
ON CONFLICT (portal_id, section_key) DO NOTHING;

-- ── 3. Portal Module Assignments ─────────────────────────────────────────────
-- One row per module. Uses a sub-SELECT to resolve module_id from module_key
-- so the INSERT never relies on hard-coded IDs.
--
-- isHome = TRUE  → /commercial redirects straight to /commercial/kam-dashboard
-- isPinned = TRUE → appears in the portal Quick Actions bar

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'clients', 0, 'full', TRUE,  TRUE
FROM navigation_modules WHERE module_key = 'kam-dashboard'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'clients', 1, 'full', FALSE, TRUE
FROM navigation_modules WHERE module_key = 'clients'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'clients', 2, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'partner-profiles'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'clients', 3, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'deals'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'pricing', 0, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'rate-manager'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'pricing', 1, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'destination-catalog'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'pricing', 2, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'product-registry'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'billing', 0, 'full', FALSE, TRUE
FROM navigation_modules WHERE module_key = 'invoices'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'billing', 1, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'commercial-notifications'
ON CONFLICT (portal_id, module_id) DO NOTHING;

INSERT INTO portal_module_assignments
  (portal_id, module_id, section, display_order, visibility, is_home, is_pinned)
SELECT 'commercial', id, 'intelligence', 0, 'full', FALSE, FALSE
FROM navigation_modules WHERE module_key = 'margin-intelligence'
ON CONFLICT (portal_id, module_id) DO NOTHING;
