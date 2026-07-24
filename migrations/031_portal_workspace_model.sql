-- 031_portal_workspace_model.sql
-- Portal Workspace Model — canonical navigation registry (NAV-A/NAV-B).
-- Extracted verbatim from server/db.ts runSafeMigrations() so schema+seed live in a
-- numbered migration instead of app boot (governance: no migration/seed logic in boot).
-- Fully idempotent (IF NOT EXISTS / ON CONFLICT). Apply manually like 029:
--   psql "$PROD_DATABASE_URL" -f migrations/031_portal_workspace_model.sql
-- After this is applied to every environment, the matching block is removed from db.ts.

BEGIN;

-- ── Portal Workspace Model — canonical navigation registry ──────────────────
-- navigation_domains: the 11 top-level domain tabs
CREATE TABLE IF NOT EXISTS navigation_domains (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  icon_key      TEXT NOT NULL DEFAULT 'circle',
  color_class   TEXT NOT NULL DEFAULT 'text-muted-foreground',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- navigation_groups: 38 groups across 11 domains
CREATE TABLE IF NOT EXISTS navigation_groups (
  id            SERIAL PRIMARY KEY,
  domain_id     TEXT NOT NULL REFERENCES navigation_domains(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  description   TEXT,
  icon_key      TEXT NOT NULL DEFAULT 'circle',
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (domain_id, label)
);

-- Add group_id FK to navigation_modules (NULL = ungrouped)
ALTER TABLE navigation_modules ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES navigation_groups(id) ON DELETE SET NULL;

-- portal_domain_assignments: which domains appear in a portal's cascade nav
CREATE TABLE IF NOT EXISTS portal_domain_assignments (
  portal_slug   TEXT NOT NULL REFERENCES portal_definitions(slug) ON DELETE CASCADE,
  domain_id     TEXT NOT NULL REFERENCES navigation_domains(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (portal_slug, domain_id)
);

-- portal_workspace: one row per portal — home module, search scope, layout
CREATE TABLE IF NOT EXISTS portal_workspace (
  portal_slug      TEXT PRIMARY KEY REFERENCES portal_definitions(slug) ON DELETE CASCADE,
  home_module      TEXT,
  default_domain   TEXT REFERENCES navigation_domains(id),
  search_scope     TEXT NOT NULL DEFAULT 'portal',
  sidebar_style    TEXT NOT NULL DEFAULT 'compact',
  dashboard_layout TEXT NOT NULL DEFAULT 'grid',
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed navigation_domains (11 domains matching DOMAINS[] in app-nav-shell)
INSERT INTO navigation_domains (id, label, icon_key, color_class, display_order) VALUES
  ('live-network', 'Live Network',  'radio',        'text-emerald-400',  1),
  ('company',      'Clients',       'building-2',   'text-amber-400',    2),
  ('operations',   'Operations',    'wifi',         'text-blue-400',     3),
  ('telemetry',    'BitsEye',       'telescope',    'text-cyan-400',     4),
  ('analytics',    'Analytics',     'bar-chart-2',  'text-indigo-400',   5),
  ('intelligence', 'Intelligence',  'brain',        'text-fuchsia-400',  6),
  ('security',     'Security',      'shield-alert', 'text-rose-400',     7),
  ('finance',      'Finance',       'banknote',     'text-emerald-400',  8),
  ('products',     'Products',      'package',      'text-violet-400',   9),
  ('trading',      'Voice Trading', 'briefcase',    'text-amber-400',   10),
  ('platform',     'Platform',      'settings',     'text-slate-400',   11)
ON CONFLICT (id) DO NOTHING;

-- Seed navigation_groups (38 groups across 11 domains)
INSERT INTO navigation_groups (domain_id, label, description, icon_key, display_order) VALUES
  -- live-network (3 groups)
  ('live-network', 'Live Operations', 'Active calls, alerts and real-time traffic',                           'phone',            1),
  ('live-network', 'Command Centre',  'NOC dashboards, incident management and ops console',                  'monitor',          2),
  ('live-network', 'Infrastructure',  'Server health, SBC, topology and performance charts',                  'server',           3),
  -- company (3 groups)
  ('company', 'Account Management', 'Client accounts, portals and resellers',                                 'users',            1),
  ('company', 'Onboarding',         'Account provisioning and organisation management',                       'zap',              2),
  ('company', 'Assets & Numbers',   'DID inventory and account naming',                                       'phone',            3),
  -- operations (4 groups)
  ('operations', 'Carriers',    'Carrier accounts, SLA scoring, stability and balances',                      'wifi',             1),
  ('operations', 'Routing',     'Routing groups, LCR analysis, simulators and route testing',                 'git-branch',       2),
  ('operations', 'Messaging',   'BhaooSMS gateway, SMS delivery monitoring and A2P operations',               'message-square',   3),
  ('operations', 'Diagnostics', 'SIP tracing, session replay, test suites and engineering tools',             'wrench',           4),
  -- telemetry (3 groups)
  ('telemetry', 'Telemetry Platform',                    'Concurrent snapshot engine, live traffic and geo-plotted call flows',         'cpu',          1),
  ('telemetry', 'Historical Warehouse',                  'Time-series telemetry: LIVE · DAILY · WEEKLY spans across all KPIs',          'clock',        2),
  ('telemetry', 'Comparative & Intelligence Views',      'Vendor vs vendor, today vs yesterday, Q-Score arc drill-down and RCA foundation', 'git-compare', 3),
  -- analytics (3 groups)
  ('analytics', 'Traffic & Quality',      'Call traffic, QoS and codec analytics',                           'activity',         1),
  ('analytics', 'Reports & Forecasting',  'Revenue reports, traffic forecasting and executive summaries',     'trending-down',    2),
  ('analytics', 'CDR Records',            'Call detail records and rerate engine',                            'history',          3),
  -- intelligence (3 groups)
  ('intelligence', 'AI Operations',        'Anomaly detection, AI decisions and data quality',                'bot',              1),
  ('intelligence', 'Carrier Intelligence', 'Vendor RCA, prefix signals and route intelligence',               'search',           2),
  ('intelligence', 'Optimisation',         'Route and cost optimisation, traffic steering and simulation',    'trending-down',    3),
  -- security (3 groups)
  ('security', 'Fraud & Detection',    'FAS/IRSF detection, firewall, SLA breaches and call attestation',    'shield-alert',     1),
  ('security', 'Approvals & Access',   'Pending approvals, governance rules and permissions',                 'lock',             2),
  ('security', 'Compliance & Audit',   'Audit trail, compliance rules and call recordings',                   'clipboard-list',   3),
  -- finance (7 groups)
  ('finance', 'Dashboard',            'Finance operations overview and KPI summary',                          'layout-dashboard', 1),
  ('finance', 'Accounts Receivable',  'Invoices, billing, credit and payment management',                     'file-text',        2),
  ('finance', 'Accounts Payable',     'Vendor bills, verification, approval, payments and statements',        'wallet',           3),
  ('finance', 'Treasury',             'Bank accounts, wallets, payment runs, reconciliation and cash position','landmark',        4),
  ('finance', 'Revenue Assurance',    'Reconciliation, margin intelligence, DMR and AI assurance',            'brain',            5),
  ('finance', 'Disputes',             'Billing disputes, case tracking and defense toolkit',                  'shield',           6),
  ('finance', 'Finance Settings',     'Invoice templates, schedules and billing configuration',               'file-spreadsheet', 7),
  -- products (3 groups)
  ('products', 'Product Registry', 'Product definitions, destinations, and assignment management',            'package',          1),
  ('products', 'Rate Operations',  'Rate management, push workflow, and notification engine',                 'bar-chart-2',      2),
  ('products', 'Catalog Tools',    'Routing templates, tariff versions, pricing policies, and assignment history', 'layers',      3),
  -- trading (1 group)
  ('trading', 'Deals', 'Commercial deal lifecycle — simulator, approvals, and board',                         'briefcase',        1),
  -- platform (5 groups)
  ('platform', 'Diagnostics',   'Reconciliation and diagnostic tools (Admin only)',                           'flask-conical',    1),
  ('platform', 'Configuration', 'Operational parameters, thresholds and governance values',                   'sliders-horizontal', 2),
  ('platform', 'System',        'System configuration, workspaces, VPN and navigation',                      'settings',         3),
  ('platform', 'Team & Access', 'Team roles, access control and API keys',                                    'users',            4),
  ('platform', 'Notifications', 'WhatsApp, email and platform notification configuration',                    'mail',             5)
ON CONFLICT (domain_id, label) DO NOTHING;

-- Seed / update ALL navigation_modules with group_id (ON CONFLICT updates group_id for existing rows)
-- Each module uses a subquery to resolve group_id from (domain_id, label).
INSERT INTO navigation_modules (module_key, title, icon, route, category, is_system, sort_order, group_id)
VALUES
  -- live-network / Live Operations
  ('live_calls',       'Live Calls',        'phone',           '/calls',            'live',        TRUE,  1,  (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Live Operations')),
  ('alerts',           'Alerts',            'zap',             '/alerts',           'live',        FALSE, 2,  (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Live Operations')),
  ('live_traffic',     'Live Traffic',      'activity',        '/live-traffic',     'live',        TRUE,  3,  (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Live Operations')),
  ('traffic_map',      'Traffic Map',       'globe',           '/traffic-map',      'live',        FALSE, 4,  (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Live Operations')),
  ('call_governance',  'Call Governance',   'shield',          '/call-governance',  'live',        FALSE, 5,  (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Live Operations')),
  -- live-network / Command Centre
  ('noc_dashboard',    'NOC Dashboard',     'monitor',         '/noc-dashboard',    'live',        TRUE,  10, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Command Centre')),
  ('noc_incidents',    'Incident Command',  'shield-alert',    '/noc-incidents',    'live',        FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Command Centre')),
  ('noc_command',      'NOC Command',       'monitor',         '/noc-command',      'live',        TRUE,  12, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Command Centre')),
  ('ops_console',      'Ops Console',       'sliders-horizontal', '/ops-console',   'live',        TRUE,  13, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Command Centre')),
  -- live-network / Infrastructure
  ('server_monitoring','Server Monitor',    'server',          '/server-monitoring','live',        FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Infrastructure')),
  ('sbc_monitor',      'SBC Monitor',       'hard-drive',      '/sbc-monitor',      'live',        FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Infrastructure')),
  ('network_topology', 'Network Topology',  'network',         '/network-topology', 'live',        FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Infrastructure')),
  ('live_traffic_map', 'Live Traffic Map',  'globe',           '/live-traffic-map', 'live',        FALSE, 23, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Infrastructure')),
  ('graphs',           'Graphs',            'line-chart',      '/graphs',           'live',        FALSE, 24, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Infrastructure')),
  ('multi_switch',     'Multi-Switch',      'layers',          '/multi-switch',     'live',        FALSE, 25, (SELECT id FROM navigation_groups WHERE domain_id='live-network' AND label='Infrastructure')),
  -- company / Account Management
  ('clients',          'Accounts',          'users',           '/clients',          'company',     FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Account Management')),
  ('client_portal',    'Client Portal',     'globe',           '/client-portal',    'company',     FALSE, 2,  (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Account Management')),
  ('client_identity',  'Client Identity',   'shield',          '/client-identity',  'company',     FALSE, 3,  (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Account Management')),
  ('kam_dashboard',    'KAM Dashboard',     'layout-dashboard','/kam-dashboard',    'company',     FALSE, 4,  (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Account Management')),
  ('reseller',         'Resellers',         'star',            '/reseller',         'company',     FALSE, 5,  (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Account Management')),
  ('company_list',     'Company List',      'building-2',      '/company/list',     'company',     FALSE, 6,  (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Account Management')),
  -- company / Onboarding
  ('client_wizard',        'Account Wizard',    'user-plus',  '/client/wizard',       'company',   FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Onboarding')),
  ('company_onboarding',   'Onboarding Wizard', 'zap',        '/company/onboarding',  'company',   FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Onboarding')),
  ('company_profile',      'Org Management',    'building-2', '/company-profile',     'company',   FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Onboarding')),
  -- company / Assets & Numbers
  ('dids',             'DID Management',    'phone',           '/dids',             'company',     FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Assets & Numbers')),
  ('account_names',    'Account Names',     'file-text',       '/account-names',    'company',     FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='company' AND label='Assets & Numbers')),
  -- operations / Carriers
  ('vendors',          'Vendor List',       'wifi',            '/vendors',          'operations',  FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Carriers')),
  ('balance_monitor',  'Balance Monitor',   'wallet',          '/balance',          'operations',  FALSE, 2,  (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Carriers')),
  ('sla_scorecard',    'SLA Scorecard',     'heart-pulse',     '/vendor-sla-scorecard','operations',FALSE,3,  (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Carriers')),
  ('carrier_scoring',  'Carrier Scoring',   'bar-chart-3',     '/carrier-scoring',  'operations',  FALSE, 4,  (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Carriers')),
  ('vendor_health',    'Health Engine',     'heart-pulse',     '/vendor-health',    'operations',  FALSE, 5,  (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Carriers')),
  -- operations / Routing
  ('routing_manager',  'Routing Manager',   'git-branch',      '/routing-manager',  'operations',  FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  ('auth_studio',      'Auth Studio',       'shield-check',    '/auth-studio',      'operations',  FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  ('lcr_analyser',     'LCR Analyser',      'calculator',      '/lcr-analyser',     'operations',  FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  ('route_tester',     'Route Tester',      'phone-call',      '/test-call',        'operations',  FALSE, 13, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  ('route_simulator',  'Route Simulator',   'arrow-right-left','/call-flow-simulator','operations',FALSE, 14, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  ('self_heal',        'Self-Heal',         'heart-pulse',     '/self-heal',        'operations',  FALSE, 15, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  ('route_testing',    'Route Testing',     'flask-conical',   '/route-testing',    'operations',  FALSE, 16, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Routing')),
  -- operations / Messaging
  ('sms_monitor',              'SMS Monitor',         'message-square',    '/sms-monitor',              'operations', FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Messaging')),
  ('voice_otp',                'Voice OTP',           'phone',             '/voice-otp',                'operations', FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Messaging')),
  ('comm_policies',            'Comm Policies',       'sliders-horizontal','/communication-policies',   'operations', FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Messaging')),
  ('commercial_notifications', 'Commercial Notifs',   'bell',              '/commercial-notifications', 'operations', FALSE, 23, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Messaging')),
  ('sender_profiles',          'Sender Profiles',     'mail',              '/sender-profiles',          'operations', FALSE, 24, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Messaging')),
  ('termination_chains',       'Termination Chains',  'git-branch',        '/termination-chains',       'operations', FALSE, 25, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Messaging')),
  -- operations / Diagnostics
  ('sip_trace',        'SIP Trace',         'mic',             '/sip-trace',        'operations',  FALSE, 30, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Diagnostics')),
  ('replay_engine',    'Replay Engine',     'rewind',          '/replay',           'operations',  FALSE, 31, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Diagnostics')),
  ('test_campaigns',   'Test Campaigns',    'flask-conical',   '/test-campaigns',   'operations',  FALSE, 32, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Diagnostics')),
  ('tools',            'Tools',             'wrench',          '/tools',            'operations',  FALSE, 33, (SELECT id FROM navigation_groups WHERE domain_id='operations' AND label='Diagnostics')),
  -- telemetry / Telemetry Platform
  ('bitseye',          'BitsEye 2.0',       'telescope',       '/bitseye2',         'analytics',   FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Telemetry Platform')),
  ('bitseye_classic',  'BitsEye Classic',   'eye',             '/bitseye',          'analytics',   FALSE, 2,  (SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Telemetry Platform')),
  -- telemetry / Historical Warehouse
  ('rtp_analytics',    'RTP / MOS History', 'activity',        '/rtp-analytics',    'analytics',   FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Historical Warehouse')),
  ('qos_heatmap',      'QoS Heatmap',       'heart-pulse',     '/qos-heatmap',      'analytics',   FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Historical Warehouse')),
  ('codec_analytics',  'Codec Analytics',   'route',           '/codec-analytics',  'analytics',   FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Historical Warehouse')),
  -- telemetry / Comparative & Intelligence Views
  ('vendor_stability_timeline','Stability Timeline','activity',  '/vendor-stability-timeline','analytics',FALSE,20,(SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Comparative & Intelligence Views')),
  ('asr_acd',          'ASR / ACD',         'bar-chart-3',     '/asr-acd',          'analytics',   FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='telemetry' AND label='Comparative & Intelligence Views')),
  -- analytics / Traffic & Quality
  ('analytics',        'Traffic Analytics', 'activity',        '/analytics',        'analytics',   FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='Traffic & Quality')),
  -- analytics / Reports & Forecasting
  ('reports',          'Reports',           'bar-chart-2',     '/reports',          'analytics',   FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='Reports & Forecasting')),
  ('executive_reports','Executive Reports', 'star',            '/executive-reports','analytics',   FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='Reports & Forecasting')),
  ('traffic_forecast', 'Traffic Forecast',  'trending-down',   '/traffic-forecast', 'analytics',   FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='Reports & Forecasting')),
  ('revenue_heatmap',  'Revenue Heatmap',   'map',             '/revenue-heatmap',  'analytics',   FALSE, 13, (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='Reports & Forecasting')),
  -- analytics / CDR Records
  ('cdrs',             'CDR Viewer',        'history',         '/cdrs',             'analytics',   FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='CDR Records')),
  ('cdr_rerate',       'CDR Rerate',        'arrow-right-left','/cdr-rerate',       'analytics',   FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='analytics' AND label='CDR Records')),
  -- intelligence / AI Operations
  ('ai_ops',                  'AI Ops Center',      'bot',          '/ai-ops',                  'intelligence', FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='AI Operations')),
  ('intelligence_hub',        'Intelligence Hub',   'brain',        '/intelligence',             'intelligence', FALSE, 2,  (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='AI Operations')),
  ('intelligence_validation', 'Validation Console', 'shield',       '/intelligence-validation',  'intelligence', FALSE, 3,  (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='AI Operations')),
  -- intelligence / Carrier Intelligence
  ('carrier_intelligence',    'Carrier Intelligence','brain',       '/carrier-intelligence',     'intelligence', FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Carrier Intelligence')),
  ('vendor_rca',              'Vendor RCA',         'search',       '/vendor-rca',               'intelligence', FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Carrier Intelligence')),
  ('prefix_intelligence',     'Prefix Intelligence','globe',        '/vendor-prefix-intelligence','intelligence', FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Carrier Intelligence')),
  ('route_intelligence',      'Route Intelligence', 'route',        '/route-intelligence',       'intelligence', FALSE, 13, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Carrier Intelligence')),
  ('routing_intelligence',    'Routing Engine',     'git-branch',   '/routing-intelligence',     'intelligence', FALSE, 14, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Carrier Intelligence')),
  -- intelligence / Optimisation
  ('cost_optimisation',   'Cost Optimisation',  'trending-down',   '/cost-optimisation',   'intelligence', FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Optimisation')),
  ('route_optimisation',  'Route Optimisation', 'brain-circuit',   '/route-optimisation',  'intelligence', FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Optimisation')),
  ('traffic_steering',    'Traffic Steering',   'arrow-right-left','/traffic-steering',    'intelligence', FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Optimisation')),
  ('simulation_sandbox',  'Simulation Sandbox', 'flask-conical',   '/simulation-sandbox',  'intelligence', FALSE, 23, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Optimisation')),
  ('number_intelligence', 'Number Intel',       'phone',           '/number-intelligence', 'intelligence', FALSE, 24, (SELECT id FROM navigation_groups WHERE domain_id='intelligence' AND label='Optimisation')),
  -- security / Fraud & Detection
  ('fraud',        'Fraud Engine',   'shield-alert',  '/fraud',        'security', FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Fraud & Detection')),
  ('firewall',     'Firewall',       'shield',        '/firewall',     'security', FALSE, 2,  (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Fraud & Detection')),
  ('security_ops', 'Security Ops',   'monitor',       '/security-ops', 'security', FALSE, 3,  (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Fraud & Detection')),
  ('sla_breaches', 'SLA Breaches',   'zap',           '/sla-breaches', 'security', FALSE, 4,  (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Fraud & Detection')),
  ('stir_shaken',  'STIR/SHAKEN',    'lock',          '/stir-shaken',  'security', FALSE, 5,  (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Fraud & Detection')),
  -- security / Approvals & Access
  ('approvals',        'Approval Queue',    'file-text',       '/approvals',        'security', FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Approvals & Access')),
  ('approval_settings','Approval Rules',    'sliders-horizontal','/approval-settings','security',FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Approvals & Access')),
  ('rbac',             'Permission Matrix', 'lock',            '/rbac',             'security', FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Approvals & Access')),
  ('mfa_setup',        'MFA / 2FA',         'shield',          '/mfa-setup',        'security', FALSE, 13, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Approvals & Access')),
  -- security / Compliance & Audit
  ('compliance',     'Compliance',   'clipboard-list', '/compliance',     'security', FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Compliance & Audit')),
  ('audit_log',      'Audit Log',    'file-text',      '/audit-log',      'security', FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Compliance & Audit')),
  ('call_recordings','Recordings',   'mic',            '/call-recordings','security', FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='security' AND label='Compliance & Audit')),
  -- finance / Dashboard
  ('finance_cockpit', 'Finance Cockpit', 'layout-dashboard', '/finance-cockpit', 'finance', FALSE, 1, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Dashboard')),
  -- finance / Accounts Receivable
  ('billing',           'Billing Overview',  'wallet',       '/billing',           'finance', FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  ('invoices',          'Invoices',          'file-text',    '/invoices',          'finance', FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  ('invoice_jobs',      'Invoice Queue',     'clipboard-list','/invoice-jobs',     'finance', FALSE, 12, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  ('credit_notes',      'Credit Notes',      'history',      '/credit-notes',      'finance', FALSE, 13, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  ('credit_control',    'Credit Control',    'banknote',     '/credit-control',    'finance', FALSE, 14, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  ('payment_reminders', 'Payment Reminders', 'bell',         '/payment-reminders', 'finance', FALSE, 15, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  ('account_statement', 'Account Statement', 'file-text',    '/account-statement', 'finance', FALSE, 16, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Receivable')),
  -- finance / Accounts Payable
  ('business_partners',  'Business Partners',  'building-2',    '/finance/business-partners',  'finance', FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  ('vendor_bills',       'Vendor Bills',        'file-text',     '/finance/vendor-bills',       'finance', FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  ('vendor_verification','Vendor Verification', 'shield-check',  '/finance/vendor-verification','finance', FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  ('vendor_approval',    'Vendor Approval',     'check-circle',  '/finance/vendor-approval',    'finance', FALSE, 23, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  ('vendor_payments',    'Vendor Payments',     'credit-card',   '/finance/vendor-payments',    'finance', FALSE, 24, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  ('vendor_adjustments', 'Vendor Adjustments',  'calculator',    '/finance/vendor-adjustments', 'finance', FALSE, 25, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  ('vendor_statement',   'Vendor Statement',    'file-spreadsheet','/finance/vendor-statement', 'finance', FALSE, 26, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Accounts Payable')),
  -- finance / Treasury
  ('bank_accounts',    'Bank Accounts',    'landmark',       '/finance/bank-accounts',    'finance', FALSE, 30, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Treasury')),
  ('wallets',          'Wallets',          'wallet',         '/finance/wallets',          'finance', FALSE, 31, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Treasury')),
  ('payment_runs',     'Payment Runs',     'send-horizontal','/finance/payment-runs',     'finance', FALSE, 32, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Treasury')),
  ('bank_reconciliation','Bank Reconciliation','scale',       '/finance/bank-reconciliation','finance',FALSE,33, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Treasury')),
  ('cash_position',    'Cash Position',    'pie-chart',      '/finance/cash-position',    'finance', FALSE, 34, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Treasury')),
  -- finance / Revenue Assurance
  ('client_reconciliation', 'Client Reconciliation', 'arrow-right-left','/client-reconciliation',  'finance', FALSE, 40, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  ('carrier_reconciliation','Carrier Reconciliation','arrow-right-left','/carrier-reconciliation', 'finance', FALSE, 41, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  ('cdr_reconciliation',    'CDR Reconciliation',    'arrow-right-left','/cdr-reconciliation',     'finance', FALSE, 42, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  ('dmr',                   'Daily Minutes Report',  'activity',         '/dmr',                   'finance', FALSE, 43, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  ('unbilled_usage',        'Unbilled Usage',        'wallet',           '/unbilled-usage',         'finance', FALSE, 44, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  ('margin_intelligence',   'Margin Intelligence',   'trending-down',    '/margin-intelligence',    'finance', FALSE, 45, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  ('ai_assurance',          'AI Assurance',          'brain-circuit',    '/ai-assurance',           'finance', FALSE, 46, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Revenue Assurance')),
  -- finance / Disputes
  ('billing_disputes', 'Billing Disputes', 'shield',         '/billing-disputes', 'finance', FALSE, 50, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Disputes')),
  ('dispute_cases',    'Dispute Cases',    'clipboard-list', '/dispute-cases',    'finance', FALSE, 51, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Disputes')),
  ('dispute_defense',  'Dispute Defense',  'shield-alert',   '/dispute-defense',  'finance', FALSE, 52, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Disputes')),
  -- finance / Finance Settings
  ('invoice_templates', 'Invoice Templates',    'file-spreadsheet', '/invoice-templates',   'finance', FALSE, 60, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  ('invoice_schedules', 'Invoice Schedules',    'history',          '/invoice-schedules',   'finance', FALSE, 61, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  ('payment_terms',     'Payment Terms',        'clock',            '/payment-terms',       'finance', FALSE, 62, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  ('numbering_prefixes','Numbering & Prefixes', 'hash',             '/numbering-prefixes',  'finance', FALSE, 63, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  ('reminder_rules',    'Reminder Rules',       'bell',             '/reminder-rules',      'finance', FALSE, 64, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  ('currency_settings', 'Currency',             'banknote',         '/currency-settings',   'finance', FALSE, 65, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  ('tax_vat',           'Tax / VAT',            'file-text',        '/tax-vat',             'finance', FALSE, 66, (SELECT id FROM navigation_groups WHERE domain_id='finance' AND label='Finance Settings')),
  -- products / Product Registry
  ('product_registry', 'Product Registry', 'package', '/product-registry', 'products', FALSE, 1,  (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Product Registry')),
  -- products / Rate Operations
  ('rate_manager',      'Rate Manager',      'bar-chart-2',     '/rate-manager',       'products', FALSE, 10, (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Rate Operations')),
  ('client_rate_report','Client Rate Report','file-spreadsheet','/client-rate-report', 'products', FALSE, 11, (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Rate Operations')),
  -- products / Catalog Tools
  ('destination_catalog','Destination Catalog','globe',           '/destination-catalog','products', FALSE, 20, (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Catalog Tools')),
  ('tariff_profiles',   'Tariff Profiles',    'file-spreadsheet','/tariff-profiles',    'products', FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Catalog Tools')),
  ('tariff_versions',   'Tariff Versions',    'history',         '/tariff-versions',    'products', FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Catalog Tools')),
  ('rate_editor',       'Rate Editor',        'file-spreadsheet','/rate-editor',        'products', FALSE, 23, (SELECT id FROM navigation_groups WHERE domain_id='products' AND label='Catalog Tools')),
  -- trading / Deals
  ('deals', 'Deal Workspace', 'briefcase', '/deals', 'trading', FALSE, 1, (SELECT id FROM navigation_groups WHERE domain_id='trading' AND label='Deals')),
  -- platform / Diagnostics
  ('recon_lab', 'Reconciliation Lab', 'flask-conical', '/recon-lab', 'platform', FALSE, 1, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Diagnostics')),
  -- platform / Configuration
  ('configuration_values','Configuration Values','sliders-horizontal','/configuration-values','platform',FALSE,10,(SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Configuration')),
  ('validation_rules',    'Validation Rules',   'shield',            '/validation-rules',    'platform',FALSE,11,(SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Configuration')),
  ('governance_review',   'Governance Review',  'shield-check',      '/governance-review',   'platform',FALSE,12,(SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Configuration')),
  -- platform / System
  ('settings',              'Platform Settings',  'settings',          '/settings',              'platform', TRUE,  20, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  ('workspace_settings',    'Workspace Settings', 'layers',            '/workspace-settings',    'platform', FALSE, 21, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  ('navigation_manager',    'Navigation Manager', 'sliders-horizontal','/navigation-manager',    'platform', FALSE, 22, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  ('governance',            'Governance Console', 'shield',            '/governance',            'platform', FALSE, 23, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  ('navigation_governance', 'Nav Governance',     'monitor',           '/navigation-governance', 'platform', FALSE, 24, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  ('platform_console',      'Platform Console',   'database',          '/console',               'platform', FALSE, 25, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  ('vpn_config',            'VPN Config',         'lock',              '/vpn-config',            'platform', FALSE, 26, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='System')),
  -- platform / Team & Access
  ('team',     'Team & KAM', 'users',           '/team',     'platform', FALSE, 30, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Team & Access')),
  ('api_keys', 'API Keys',   'key',             '/api-keys', 'platform', FALSE, 31, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Team & Access')),
  -- platform / Notifications
  ('notification_centre', 'Notification Centre', 'bell',          '/notification-centre', 'platform', FALSE, 40, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Notifications')),
  ('email_centre',        'Email Centre',        'mail',          '/email-centre',        'platform', FALSE, 41, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Notifications')),
  ('whatsapp_alerts',     'WhatsApp Alerts',     'message-square','/whatsapp-alerts',     'platform', FALSE, 42, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Notifications')),
  ('team_chat',           'Team Chat',           'message-square','/chat',                'platform', FALSE, 43, (SELECT id FROM navigation_groups WHERE domain_id='platform' AND label='Notifications'))
ON CONFLICT (module_key) DO UPDATE SET group_id = EXCLUDED.group_id;

-- ── Identity merge: kebab-case is the permanent module identity (frozen rule; 029) ──
-- The module seed above re-creates underscore-key rows for the 6 NOC modules that 029
-- renamed to kebab (live-calls, live-traffic, traffic-map, noc-dashboard, noc-command,
-- ops-console). Without this merge BOTH variants exist: the workspace tree serves the
-- underscore key while the module registry / Model A / URLs use kebab — and NAV-C
-- module resolution breaks. Merge: the kebab row (canonical, FK-referenced by
-- portal_module_assignments) absorbs the underscore row's group_id; the underscore row
-- is deleted. Idempotent: no-op when no dup pairs exist.
UPDATE navigation_modules k
SET group_id = u.group_id
FROM navigation_modules u
WHERE k.module_key = replace(u.module_key, '_', '-')
  AND k.module_key <> u.module_key
  AND u.group_id IS NOT NULL;

DELETE FROM navigation_modules u
USING navigation_modules k
WHERE k.module_key = replace(u.module_key, '_', '-')
  AND k.module_key <> u.module_key;

-- Seed NOC portal domain assignments (4 domains for the NOC portal cascade)
INSERT INTO portal_domain_assignments (portal_slug, domain_id, display_order) VALUES
  ('noc', 'live-network', 1),
  ('noc', 'operations',   2),
  ('noc', 'telemetry',    3),
  ('noc', 'analytics',    4)
ON CONFLICT (portal_slug, domain_id) DO NOTHING;

-- Seed NOC portal workspace config (home module = kebab key, matching the registry)
INSERT INTO portal_workspace (portal_slug, home_module, default_domain, search_scope, sidebar_style, dashboard_layout)
VALUES ('noc', 'noc-dashboard', 'live-network', 'portal', 'compact', 'grid')
ON CONFLICT (portal_slug) DO NOTHING;

-- Repair any pre-existing row seeded with the underscore key (boot-seeded dev DBs)
UPDATE portal_workspace SET home_module = replace(home_module, '_', '-')
WHERE home_module LIKE '%\_%' ESCAPE '\';

COMMIT;
