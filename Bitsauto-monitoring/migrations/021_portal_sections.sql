-- Portal Sections: DB-driven Level 2 domain navigation tabs per portal
-- Each section groups a set of modules shown in the sidebar when that tab is active

CREATE TABLE IF NOT EXISTS portal_sections (
  id          SERIAL PRIMARY KEY,
  portal_id   TEXT NOT NULL REFERENCES portal_definitions(slug) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title       TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'circle',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (portal_id, section_key)
);

-- ── KAM Portal Sections ────────────────────────────────────────────────────────
INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order) VALUES
  ('kam', 'dashboard',  'Dashboard',  'layout-dashboard', 0),
  ('kam', 'clients',    'Clients',    'users',            1),
  ('kam', 'commercial', 'Commercial', 'send-horizonal',   2),
  ('kam', 'finance',    'Finance',    'banknote',         3)
ON CONFLICT (portal_id, section_key) DO NOTHING;

-- ── NOC Portal Sections ────────────────────────────────────────────────────────
INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order) VALUES
  ('noc', 'monitoring', 'Monitoring',    'monitor',      0),
  ('noc', 'tools',      'Troubleshoot',  'wrench',       1),
  ('noc', 'security',   'Security',      'shield-alert', 2)
ON CONFLICT (portal_id, section_key) DO NOTHING;

-- ── Finance Portal Sections ────────────────────────────────────────────────────
INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order) VALUES
  ('finance', 'billing',        'Billing',        'file-text',        0),
  ('finance', 'collections',    'Collections',    'banknote',         1),
  ('finance', 'reconciliation', 'Reconciliation', 'arrow-right-left', 2),
  ('finance', 'revenue',        'Revenue',        'trending-down',    3)
ON CONFLICT (portal_id, section_key) DO NOTHING;

-- ── Partner Portal Sections ────────────────────────────────────────────────────
INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order) VALUES
  ('partner', 'main', 'Overview', 'layout-dashboard', 0)
ON CONFLICT (portal_id, section_key) DO NOTHING;

-- ── Admin Portal Sections ──────────────────────────────────────────────────────
INSERT INTO portal_sections (portal_id, section_key, title, icon, sort_order) VALUES
  ('admin', 'system',     'Platform',   'settings',     0),
  ('admin', 'governance', 'Governance', 'shield-check', 1)
ON CONFLICT (portal_id, section_key) DO NOTHING;
