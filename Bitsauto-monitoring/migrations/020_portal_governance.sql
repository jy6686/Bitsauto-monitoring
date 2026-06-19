-- Portal Governance Framework
-- Three tables: portal_definitions, navigation_modules, portal_module_assignments

CREATE TABLE IF NOT EXISTS portal_definitions (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT 'layout-dashboard',
  theme         TEXT NOT NULL DEFAULT 'neutral',
  layout_type   TEXT NOT NULL DEFAULT 'sidebar-sections',
  default_route TEXT NOT NULL DEFAULT '/',
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS navigation_modules (
  id              SERIAL PRIMARY KEY,
  module_key      TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  icon            TEXT NOT NULL DEFAULT 'circle',
  route           TEXT NOT NULL,
  engine          TEXT,
  adapter_support TEXT[] NOT NULL DEFAULT '{}',
  category        TEXT NOT NULL DEFAULT 'general',
  default_portal  TEXT,
  is_movable      BOOLEAN NOT NULL DEFAULT true,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_module_assignments (
  id            SERIAL PRIMARY KEY,
  portal_id     TEXT NOT NULL REFERENCES portal_definitions(slug) ON DELETE CASCADE,
  module_id     INTEGER NOT NULL REFERENCES navigation_modules(id) ON DELETE CASCADE,
  section       TEXT NOT NULL DEFAULT 'main',
  display_order INTEGER NOT NULL DEFAULT 0,
  display_label TEXT,
  adapter       TEXT,
  visibility    TEXT NOT NULL DEFAULT 'full',
  is_home       BOOLEAN NOT NULL DEFAULT false,
  is_pinned     BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    TEXT,
  UNIQUE (portal_id, module_id)
);

-- ── Portal Definitions ─────────────────────────────────────────────────────────
INSERT INTO portal_definitions (slug, name, icon, theme, default_route, allowed_roles, sort_order) VALUES
  ('kam',     'KAM Portal',     'users',      'purple', '/kam-dashboard',     ARRAY['admin','super_admin','management'], 1),
  ('noc',     'NOC Portal',     'radio',      'blue',   '/',                  ARRAY['admin','super_admin','management','noc_operator','team_lead'], 2),
  ('finance', 'Finance Portal', 'banknote',   'green',  '/invoices',          ARRAY['admin','super_admin','management'], 3),
  ('partner', 'Partner Portal', 'star',       'indigo', '/partner-profiles',  ARRAY['admin','super_admin','management'], 4),
  ('admin',   'Admin Portal',   'settings',   'slate',  '/settings',          ARRAY['admin','super_admin'], 5)
ON CONFLICT (slug) DO NOTHING;

-- ── Navigation Modules Registry ────────────────────────────────────────────────
INSERT INTO navigation_modules (module_key, title, icon, route, engine, adapter_support, category, default_portal, is_movable, is_system) VALUES
  -- KAM primary modules
  ('kam_dashboard',      'KAM Dashboard',      'layout-dashboard',   '/kam-dashboard',            'dashboard',    ARRAY['kam'],                         'dashboard',      'kam',     false, true),
  ('client_accounts',    'Client Accounts',    'users',              '/clients',                  'accounts',     ARRAY['kam','noc','admin'],            'clients',        'kam',     true,  false),
  ('account_health',     'Account Health',     'heart-pulse',        '/bitseye2',                 'bitseye',      ARRAY['kam','noc','finance','client'], 'clients',        'kam',     true,  false),
  ('onboarding_wizard',  'Onboarding Wizard',  'zap',                '/company/onboarding',       'accounts',     ARRAY['kam','admin'],                  'clients',        'kam',     true,  false),
  ('traffic_analytics',  'Traffic Analytics',  'activity',           '/analytics',                'analytics',    ARRAY['kam','noc','finance'],          'clients',        'kam',     true,  false),
  ('asr_acd',            'ASR / ACD',          'bar-chart-3',        '/asr-acd',                  'analytics',    ARRAY['kam','noc'],                    'clients',        'kam',     true,  false),
  ('cdr_viewer',         'CDR Viewer',         'file-text',          '/cdrs',                     'cdr',          ARRAY['kam','noc','finance'],          'clients',        'kam',     true,  false),
  ('balance_monitor',    'Balance Monitor',    'wallet',             '/balance',                  'finance',      ARRAY['kam','finance'],                'clients',        'kam',     true,  false),
  ('send_rate',          'Send Rate',          'send-horizonal',     '/clients?tab=send-rate',    'notification', ARRAY['kam'],                         'commercial',     'kam',     true,  false),
  ('rate_history',       'Rate History',       'git-branch',         '/tariff-versions',          'tariff',       ARRAY['kam','admin'],                  'commercial',     'kam',     true,  false),
  ('commercial_notices', 'Commercial Notices', 'megaphone',          '/commercial-notifications', 'notification', ARRAY['kam'],                         'commercial',     'kam',     true,  false),
  ('whatsapp_alerts',    'WhatsApp Alerts',    'message-square',     '/whatsapp-alerts',          'notification', ARRAY['kam','noc'],                    'commercial',     'kam',     true,  false),
  ('kam_reports',        'Reports',            'bar-chart-2',        '/reports',                  'analytics',    ARRAY['kam','finance','noc'],          'commercial',     'kam',     true,  false),
  ('invoices_read',      'Invoices',           'file-text',          '/invoices',                 'invoice',      ARRAY['kam','finance'],                'finance',        'finance', true,  false),
  ('billing_disputes',   'Disputes',           'clipboard-list',     '/billing-disputes',         'disputes',     ARRAY['kam','finance'],                'finance',        'finance', true,  false),
  ('credit_notes_read',  'Credit Notes',       'receipt-text',       '/credit-notes',             'invoice',      ARRAY['kam','finance'],                'finance',        'finance', true,  false),
  -- NOC modules
  ('live_calls',         'Live Calls',         'phone',              '/calls',                    'live',         ARRAY['noc','admin'],                  'monitoring',     'noc',     true,  false),
  ('alerts',             'Alerts',             'bell',               '/alerts',                   'alerts',       ARRAY['noc','admin'],                  'monitoring',     'noc',     true,  false),
  ('noc_command',        'NOC Command',        'monitor',            '/noc-command',              'live',         ARRAY['noc','admin'],                  'monitoring',     'noc',     true,  false),
  ('live_traffic',       'Live Traffic',       'activity',           '/live-traffic',             'live',         ARRAY['noc','admin'],                  'monitoring',     'noc',     true,  false),
  ('qos_heatmap',        'QoS Heatmap',        'heart-pulse',        '/qos-heatmap',              'analytics',    ARRAY['noc','admin'],                  'monitoring',     'noc',     true,  false),
  ('carrier_scoring',    'Carrier Scoring',    'bar-chart-3',        '/carrier-scoring',          'intelligence', ARRAY['noc','admin'],                  'monitoring',     'noc',     true,  false),
  ('sip_trace',          'SIP Trace',          'git-branch',         '/sip-trace',                'tools',        ARRAY['noc','admin'],                  'tools',          'noc',     true,  false),
  ('rtp_analytics',      'RTP Analytics',      'radio',              '/rtp-analytics',            'tools',        ARRAY['noc','admin'],                  'tools',          'noc',     true,  false),
  ('fraud_engine',       'Fraud Engine',       'shield-alert',       '/fraud',                    'security',     ARRAY['noc','admin'],                  'security',       'noc',     true,  false),
  -- Finance modules
  ('invoices_full',      'Invoices',           'file-text',          '/invoices',                 'invoice',      ARRAY['finance','admin'],              'billing',        'finance', true,  false),
  ('invoice_queue',      'Invoice Queue',      'send-horizonal',     '/invoice-jobs',             'invoice',      ARRAY['finance','admin'],              'billing',        'finance', true,  false),
  ('credit_notes_full',  'Credit Notes',       'receipt-text',       '/credit-notes',             'invoice',      ARRAY['finance','admin'],              'billing',        'finance', true,  false),
  ('credit_control',     'Credit Control',     'shield-check',       '/credit-control',           'finance',      ARRAY['finance','admin'],              'collections',    'finance', true,  false),
  ('collections',        'Collections',        'banknote',           '/billing-disputes',         'finance',      ARRAY['finance','admin'],              'collections',    'finance', true,  false),
  ('carrier_recon',      'Carrier Reconcil.',  'arrow-right-left',   '/carrier-reconciliation',   'finance',      ARRAY['finance','admin'],              'reconciliation', 'finance', true,  false),
  ('client_recon',       'Client Reconcil.',   'arrow-right-left',   '/client-reconciliation',    'finance',      ARRAY['finance','admin'],              'reconciliation', 'finance', true,  false),
  ('dmr',                'DMR',                'file-spreadsheet',   '/dmr',                      'finance',      ARRAY['finance','admin'],              'reconciliation', 'finance', true,  false),
  ('margin_intel',       'Margin Intelligence','trending-down',      '/margin-intelligence',      'finance',      ARRAY['finance','admin'],              'revenue',        'finance', true,  false),
  ('ai_assurance',       'AI Assurance',       'brain-circuit',      '/ai-assurance',             'ai',           ARRAY['finance','admin'],              'revenue',        'finance', true,  false),
  ('exec_reports',       'Executive Reports',  'bar-chart-3',        '/executive-reports',        'analytics',    ARRAY['finance','admin'],              'revenue',        'finance', true,  false),
  -- Admin modules
  ('platform_settings',  'Platform Settings',  'settings',           '/settings',                 'admin',        ARRAY['admin'],                        'system',         'admin',   false, true),
  ('nav_manager',        'Navigation Manager', 'layers',             '/sidebar-settings',         'admin',        ARRAY['admin'],                        'system',         'admin',   false, true),
  ('team_access',        'Team & Access',       'users',              '/team',                     'admin',        ARRAY['admin'],                        'system',         'admin',   false, true),
  ('api_keys',           'API Keys',           'key',                '/api-keys',                 'admin',        ARRAY['admin'],                        'system',         'admin',   false, true),
  ('audit_log',          'Audit Log',          'clipboard-list',     '/audit-log',                'admin',        ARRAY['admin'],                        'governance',     'admin',   false, false),
  ('approval_rules',     'Approval Rules',     'sliders-horizontal', '/approval-settings',        'admin',        ARRAY['admin'],                        'governance',     'admin',   false, false),
  ('vpn_config',         'VPN Config',         'lock',               '/vpn-config',               'admin',        ARRAY['admin'],                        'system',         'admin',   false, false)
ON CONFLICT (module_key) DO NOTHING;

-- ── KAM Portal Assignments ─────────────────────────────────────────────────────
INSERT INTO portal_module_assignments (portal_id, module_id, section, display_order, display_label, adapter, visibility, is_home, is_pinned)
SELECT 'kam', m.id, s.section, s.pos, s.label, s.adapter, s.vis, s.home, s.pinned
FROM (VALUES
  ('kam_dashboard',      'dashboard',   1, 'KAM Dashboard',      'kam', 'full',      true,  true),
  ('client_accounts',    'clients',     1, 'Client Accounts',    'kam', 'full',      false, false),
  ('account_health',     'clients',     2, 'Account Health',     'kam', 'full',      false, false),
  ('onboarding_wizard',  'clients',     3, 'Onboarding Wizard',  'kam', 'full',      false, false),
  ('traffic_analytics',  'clients',     4, 'Traffic Analytics',  'kam', 'full',      false, false),
  ('asr_acd',            'clients',     5, 'ASR / ACD',          'kam', 'full',      false, false),
  ('cdr_viewer',         'clients',     6, 'CDR Viewer',         'kam', 'full',      false, false),
  ('balance_monitor',    'clients',     7, 'Balance Monitor',    'kam', 'full',      false, false),
  ('send_rate',          'commercial',  1, 'Send Rate',          'kam', 'full',      false, true),
  ('rate_history',       'commercial',  2, 'Rate History',       'kam', 'full',      false, false),
  ('commercial_notices', 'commercial',  3, 'Commercial Notices', 'kam', 'full',      false, false),
  ('whatsapp_alerts',    'commercial',  4, 'WhatsApp Alerts',    'kam', 'full',      false, false),
  ('kam_reports',        'commercial',  5, 'Reports',            'kam', 'full',      false, false),
  ('invoices_read',      'finance',     1, 'Invoices',           'kam', 'read_only', false, false),
  ('billing_disputes',   'finance',     2, 'Disputes',           'kam', 'full',      false, false),
  ('credit_notes_read',  'finance',     3, 'Credit Notes',       'kam', 'read_only', false, false)
) AS s(module_key, section, pos, label, adapter, vis, home, pinned)
JOIN navigation_modules m ON m.module_key = s.module_key
ON CONFLICT (portal_id, module_id) DO NOTHING;

-- ── NOC Portal Assignments ─────────────────────────────────────────────────────
INSERT INTO portal_module_assignments (portal_id, module_id, section, display_order, display_label, adapter, visibility, is_home, is_pinned)
SELECT 'noc', m.id, s.section, s.pos, s.label, s.adapter, s.vis, s.home, s.pinned
FROM (VALUES
  ('live_calls',      'monitoring', 1, 'Live Calls',      'noc', 'full', true,  true),
  ('alerts',          'monitoring', 2, 'Alerts',          'noc', 'full', false, false),
  ('noc_command',     'monitoring', 3, 'NOC Command',     'noc', 'full', false, false),
  ('live_traffic',    'monitoring', 4, 'Live Traffic',    'noc', 'full', false, false),
  ('account_health',  'monitoring', 5, 'BitsEye 2',       'noc', 'full', false, false),
  ('qos_heatmap',     'monitoring', 6, 'QoS Heatmap',     'noc', 'full', false, false),
  ('carrier_scoring', 'monitoring', 7, 'Carrier Scoring', 'noc', 'full', false, false),
  ('asr_acd',         'monitoring', 8, 'ASR / ACD',       'noc', 'full', false, false),
  ('sip_trace',       'tools',      1, 'SIP Trace',       'noc', 'full', false, false),
  ('rtp_analytics',   'tools',      2, 'RTP Analytics',   'noc', 'full', false, false),
  ('fraud_engine',    'tools',      3, 'Fraud Engine',    'noc', 'full', false, false)
) AS s(module_key, section, pos, label, adapter, vis, home, pinned)
JOIN navigation_modules m ON m.module_key = s.module_key
ON CONFLICT (portal_id, module_id) DO NOTHING;

-- ── Finance Portal Assignments ─────────────────────────────────────────────────
INSERT INTO portal_module_assignments (portal_id, module_id, section, display_order, display_label, adapter, visibility, is_home, is_pinned)
SELECT 'finance', m.id, s.section, s.pos, s.label, s.adapter, s.vis, s.home, s.pinned
FROM (VALUES
  ('invoices_full',    'billing',         1, 'Invoices',            'finance', 'full', true,  false),
  ('invoice_queue',    'billing',         2, 'Invoice Queue',       'finance', 'full', false, false),
  ('credit_notes_full','billing',         3, 'Credit Notes',        'finance', 'full', false, false),
  ('credit_control',   'collections',     1, 'Credit Control',      'finance', 'full', false, false),
  ('collections',      'collections',     2, 'Collections',         'finance', 'full', false, false),
  ('billing_disputes', 'collections',     3, 'Disputes',            'finance', 'full', false, false),
  ('carrier_recon',    'reconciliation',  1, 'Carrier Reconcil.',   'finance', 'full', false, false),
  ('client_recon',     'reconciliation',  2, 'Client Reconcil.',    'finance', 'full', false, false),
  ('dmr',              'reconciliation',  3, 'DMR',                 'finance', 'full', false, false),
  ('margin_intel',     'revenue',         1, 'Margin Intelligence', 'finance', 'full', false, false),
  ('ai_assurance',     'revenue',         2, 'AI Assurance',        'finance', 'full', false, false),
  ('exec_reports',     'revenue',         3, 'Executive Reports',   'finance', 'full', false, false),
  ('kam_reports',      'revenue',         4, 'Reports',             'finance', 'full', false, false),
  ('cdr_viewer',       'revenue',         5, 'CDR Viewer',          'finance', 'full', false, false),
  ('balance_monitor',  'revenue',         6, 'Balance Monitor',     'finance', 'full', false, false)
) AS s(module_key, section, pos, label, adapter, vis, home, pinned)
JOIN navigation_modules m ON m.module_key = s.module_key
ON CONFLICT (portal_id, module_id) DO NOTHING;

-- ── Admin Portal Assignments ───────────────────────────────────────────────────
INSERT INTO portal_module_assignments (portal_id, module_id, section, display_order, display_label, adapter, visibility, is_home, is_pinned)
SELECT 'admin', m.id, s.section, s.pos, s.label, s.adapter, s.vis, s.home, s.pinned
FROM (VALUES
  ('platform_settings', 'system',     1, 'Platform Settings',  'admin', 'full', true,  true),
  ('nav_manager',       'system',     2, 'Navigation Manager', 'admin', 'full', false, false),
  ('team_access',       'system',     3, 'Team & Access',      'admin', 'full', false, false),
  ('api_keys',          'system',     4, 'API Keys',           'admin', 'full', false, false),
  ('vpn_config',        'system',     5, 'VPN Config',         'admin', 'full', false, false),
  ('audit_log',         'governance', 1, 'Audit Log',          'admin', 'full', false, false),
  ('approval_rules',    'governance', 2, 'Approval Rules',     'admin', 'full', false, false)
) AS s(module_key, section, pos, label, adapter, vis, home, pinned)
JOIN navigation_modules m ON m.module_key = s.module_key
ON CONFLICT (portal_id, module_id) DO NOTHING;
