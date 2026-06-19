-- 025_rbac_matrix.sql
-- Granular action-level permission system: roles → permissions → scopes

CREATE TABLE IF NOT EXISTS rbac_permissions (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(80)  NOT NULL UNIQUE,
  domain      VARCHAR(40)  NOT NULL,
  label       VARCHAR(120) NOT NULL,
  description TEXT,
  risk_level  VARCHAR(20)  NOT NULL DEFAULT 'low',
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  id             SERIAL PRIMARY KEY,
  role           VARCHAR(40) NOT NULL,
  permission_key VARCHAR(80) NOT NULL REFERENCES rbac_permissions(key) ON DELETE CASCADE,
  granted        BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by     VARCHAR(255),
  granted_at     TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(role, permission_key)
);

CREATE TABLE IF NOT EXISTS rbac_user_permission_overrides (
  id             SERIAL PRIMARY KEY,
  user_id        VARCHAR(255) NOT NULL,
  permission_key VARCHAR(80)  NOT NULL REFERENCES rbac_permissions(key) ON DELETE CASCADE,
  granted        BOOLEAN NOT NULL,
  scope          VARCHAR(40)  DEFAULT 'all',
  reason         TEXT,
  granted_by     VARCHAR(255) NOT NULL,
  granted_at     TIMESTAMP DEFAULT NOW() NOT NULL,
  expires_at     TIMESTAMP,
  UNIQUE(user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS rbac_permission_audit_events (
  id             SERIAL PRIMARY KEY,
  event_type     VARCHAR(60)  NOT NULL,
  actor_id       VARCHAR(255) NOT NULL,
  target_user_id VARCHAR(255),
  target_role    VARCHAR(40),
  permission_key VARCHAR(80),
  before_value   JSONB,
  after_value    JSONB,
  ip_address     VARCHAR(45),
  user_agent     TEXT,
  created_at     TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rbac_role_perms_role ON rbac_role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_rbac_overrides_user  ON rbac_user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor     ON rbac_permission_audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_created   ON rbac_permission_audit_events(created_at DESC);

-- ── Permission seed ────────────────────────────────────────────────────────────
INSERT INTO rbac_permissions (key, domain, label, description, risk_level) VALUES
('invoice.view',            'finance',     'View Invoices',           'View all invoice records',                  'low'),
('invoice.create',          'finance',     'Create Invoices',         'Create new invoices',                       'medium'),
('invoice.approve',         'finance',     'Approve Invoices',        'Approve invoices for sending',              'high'),
('invoice.send',            'finance',     'Send Invoices',           'Send invoices to clients',                  'high'),
('invoice.void',            'finance',     'Void Invoices',           'Void or cancel existing invoices',          'critical'),
('credit_note.view',        'finance',     'View Credit Notes',       'View credit note records',                  'low'),
('credit_note.apply',       'finance',     'Apply Credit Notes',      'Apply credit notes to accounts',            'high'),
('reconciliation.view',     'finance',     'View Reconciliation',     'View reconciliation records',               'low'),
('reconciliation.resolve',  'finance',     'Resolve Reconciliation',  'Mark reconciliation items as resolved',     'high'),
('dispute.view',            'finance',     'View Disputes',           'View billing disputes',                     'low'),
('dispute.create',          'finance',     'Create Disputes',         'Open new billing disputes',                 'medium'),
('dispute.resolve',         'finance',     'Resolve Disputes',        'Mark disputes as resolved',                 'high'),
('dispute.close',           'finance',     'Close Disputes',          'Permanently close a dispute',               'critical'),
('incident.view',           'noc',         'View Incidents',          'View operational incidents',                'low'),
('incident.create',         'noc',         'Create Incidents',        'Open new operational incidents',            'medium'),
('incident.assign',         'noc',         'Assign Incidents',        'Assign incidents to operators',             'medium'),
('incident.resolve',        'noc',         'Resolve Incidents',       'Mark incidents as resolved',                'high'),
('incident.postmortem',     'noc',         'Postmortem',              'Conduct postmortem analysis',               'medium'),
('route.view',              'noc',         'View Routes',             'View routing configuration',                'low'),
('route.suppress',          'noc',         'Suppress Routes',         'Suppress active routes',                    'critical'),
('route.override',          'noc',         'Override Routes',         'Override routing decisions',                'critical'),
('fraud.view',              'noc',         'View Fraud Alerts',       'View fraud detection results',              'low'),
('fraud.block',             'noc',         'Block Fraud',             'Block fraudulent accounts or IPs',          'high'),
('fraud.whitelist',         'noc',         'Whitelist',               'Add entries to fraud whitelist',            'critical'),
('alert.view',              'noc',         'View Alerts',             'View system alerts',                        'low'),
('alert.acknowledge',       'noc',         'Acknowledge Alerts',      'Acknowledge and dismiss alerts',            'medium'),
('alert.escalate',          'noc',         'Escalate Alerts',         'Escalate alerts to management',             'medium'),
('portal.view',             'governance',  'View Portals',            'View portal definitions',                   'low'),
('portal.edit',             'governance',  'Edit Portals',            'Edit portal configuration',                 'high'),
('navigation.view',         'governance',  'View Navigation',         'View navigation governance',                'low'),
('navigation.edit',         'governance',  'Edit Navigation',         'Edit navigation assignments',               'high'),
('theme.edit',              'governance',  'Edit Themes',             'Edit portal themes',                        'medium'),
('module.assign',           'governance',  'Assign Modules',          'Assign modules to portals',                 'high'),
('rbac.view',               'governance',  'View RBAC',               'View role and permission matrix',           'medium'),
('rbac.edit',               'governance',  'Edit RBAC',               'Modify role and permission assignments',    'critical'),
('kam.view',                'kam',         'View KAM',                'View KAM data and portfolio',               'low'),
('kam.manage',              'kam',         'Manage KAM',              'Manage KAM assignments and portfolio',      'high'),
('client.view',             'kam',         'View Clients',            'View client accounts',                      'low'),
('client.manage',           'kam',         'Manage Clients',          'Create and edit client accounts',           'high'),
('rate_card.view',          'kam',         'View Rate Cards',         'View rate card definitions',                'low'),
('rate_card.send',          'kam',         'Send Rate Cards',         'Send rate cards to clients',                'high'),
('calls.view',              'operations',  'View Live Calls',         'View active call data',                     'low'),
('cdrs.view',               'operations',  'View CDRs',               'View call detail records',                  'low'),
('analytics.view',          'operations',  'View Analytics',          'View analytics and reports',                'low'),
('reports.view',            'operations',  'View Reports',            'View generated reports',                    'low'),
('reports.export',          'operations',  'Export Reports',          'Export reports to files',                   'medium'),
('settings.view',           'operations',  'View Settings',           'View system settings',                      'low'),
('settings.edit',           'operations',  'Edit Settings',           'Modify system settings',                    'critical'),
('audit.view',              'operations',  'View Audit Log',          'View system audit trail',                   'medium')
ON CONFLICT (key) DO NOTHING;

-- ── Role → permission seed ─────────────────────────────────────────────────────
DO $$
DECLARE
  all_keys TEXT[] := ARRAY[
    'invoice.view','invoice.create','invoice.approve','invoice.send','invoice.void',
    'credit_note.view','credit_note.apply','reconciliation.view','reconciliation.resolve',
    'dispute.view','dispute.create','dispute.resolve','dispute.close',
    'incident.view','incident.create','incident.assign','incident.resolve','incident.postmortem',
    'route.view','route.suppress','route.override',
    'fraud.view','fraud.block','fraud.whitelist',
    'alert.view','alert.acknowledge','alert.escalate',
    'portal.view','portal.edit','navigation.view','navigation.edit','theme.edit','module.assign',
    'rbac.view','rbac.edit',
    'kam.view','kam.manage','client.view','client.manage','rate_card.view','rate_card.send',
    'calls.view','cdrs.view','analytics.view','reports.view','reports.export',
    'settings.view','settings.edit','audit.view'
  ];
  k TEXT;
BEGIN
  FOREACH k IN ARRAY all_keys LOOP
    INSERT INTO rbac_role_permissions (role, permission_key, granted)
    VALUES ('super_admin', k, true) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

INSERT INTO rbac_role_permissions (role, permission_key, granted) VALUES
('admin','invoice.view',true),('admin','invoice.create',true),('admin','invoice.approve',true),('admin','invoice.send',true),('admin','invoice.void',true),
('admin','credit_note.view',true),('admin','credit_note.apply',true),('admin','reconciliation.view',true),('admin','reconciliation.resolve',true),
('admin','dispute.view',true),('admin','dispute.create',true),('admin','dispute.resolve',true),('admin','dispute.close',true),
('admin','incident.view',true),('admin','incident.create',true),('admin','incident.assign',true),('admin','incident.resolve',true),('admin','incident.postmortem',true),
('admin','route.view',true),('admin','route.suppress',true),('admin','route.override',true),
('admin','fraud.view',true),('admin','fraud.block',true),('admin','fraud.whitelist',true),
('admin','alert.view',true),('admin','alert.acknowledge',true),('admin','alert.escalate',true),
('admin','portal.view',true),('admin','portal.edit',true),('admin','navigation.view',true),('admin','navigation.edit',true),
('admin','theme.edit',true),('admin','module.assign',true),('admin','rbac.view',true),
('admin','kam.view',true),('admin','kam.manage',true),('admin','client.view',true),('admin','client.manage',true),
('admin','rate_card.view',true),('admin','rate_card.send',true),
('admin','calls.view',true),('admin','cdrs.view',true),('admin','analytics.view',true),
('admin','reports.view',true),('admin','reports.export',true),('admin','settings.view',true),('admin','settings.edit',true),('admin','audit.view',true),
('management','invoice.view',true),('management','invoice.approve',true),('management','invoice.send',true),
('management','credit_note.view',true),('management','reconciliation.view',true),
('management','dispute.view',true),('management','dispute.resolve',true),
('management','incident.view',true),('management','incident.assign',true),
('management','route.view',true),('management','fraud.view',true),
('management','alert.view',true),('management','alert.acknowledge',true),('management','alert.escalate',true),
('management','portal.view',true),('management','navigation.view',true),('management','rbac.view',true),
('management','kam.view',true),('management','kam.manage',true),('management','client.view',true),('management','client.manage',true),
('management','rate_card.view',true),('management','rate_card.send',true),
('management','calls.view',true),('management','cdrs.view',true),('management','analytics.view',true),
('management','reports.view',true),('management','reports.export',true),('management','settings.view',true),('management','audit.view',true),
('noc_operator','incident.view',true),('noc_operator','incident.create',true),('noc_operator','incident.assign',true),('noc_operator','incident.resolve',true),
('noc_operator','route.view',true),('noc_operator','route.suppress',true),
('noc_operator','fraud.view',true),('noc_operator','fraud.block',true),
('noc_operator','alert.view',true),('noc_operator','alert.acknowledge',true),('noc_operator','alert.escalate',true),
('noc_operator','calls.view',true),('noc_operator','cdrs.view',true),('noc_operator','analytics.view',true),('noc_operator','reports.view',true),
('team_lead','incident.view',true),('team_lead','incident.assign',true),
('team_lead','alert.view',true),('team_lead','alert.acknowledge',true),
('team_lead','kam.view',true),('team_lead','kam.manage',true),('team_lead','client.view',true),
('team_lead','calls.view',true),('team_lead','analytics.view',true),('team_lead','reports.view',true),
('destination_manager','route.view',true),('destination_manager','route.suppress',true),
('destination_manager','incident.view',true),('destination_manager','incident.assign',true),
('destination_manager','fraud.view',true),('destination_manager','fraud.block',true),
('destination_manager','calls.view',true),('destination_manager','cdrs.view',true),('destination_manager','analytics.view',true),
('routing_admin','route.view',true),('routing_admin','route.override',true),
('routing_admin','incident.view',true),('routing_admin','incident.resolve',true),
('routing_admin','calls.view',true),('routing_admin','cdrs.view',true),
('viewer','calls.view',true),('viewer','analytics.view',true),('viewer','reports.view',true),('viewer','invoice.view',true)
ON CONFLICT (role, permission_key) DO NOTHING;
