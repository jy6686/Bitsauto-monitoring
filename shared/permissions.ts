// Central Permission Registry — single source of truth for all action-level permissions.
// Import PERM.* everywhere instead of hardcoding strings.
// Domain groups match rbac_permissions.domain in the DB.

export const PERM = {
  // ── Finance ────────────────────────────────────────────────────────────────
  INVOICE_VIEW:           'invoice.view',
  INVOICE_CREATE:         'invoice.create',
  INVOICE_APPROVE:        'invoice.approve',
  INVOICE_SEND:           'invoice.send',
  INVOICE_VOID:           'invoice.void',
  CREDIT_NOTE_VIEW:       'credit_note.view',
  CREDIT_NOTE_APPLY:      'credit_note.apply',
  RECONCILIATION_VIEW:    'reconciliation.view',
  RECONCILIATION_RESOLVE: 'reconciliation.resolve',
  DISPUTE_VIEW:           'dispute.view',
  DISPUTE_CREATE:         'dispute.create',
  DISPUTE_RESOLVE:        'dispute.resolve',
  DISPUTE_CLOSE:          'dispute.close',

  // ── NOC ────────────────────────────────────────────────────────────────────
  INCIDENT_VIEW:          'incident.view',
  INCIDENT_CREATE:        'incident.create',
  INCIDENT_ASSIGN:        'incident.assign',
  INCIDENT_RESOLVE:       'incident.resolve',
  INCIDENT_POSTMORTEM:    'incident.postmortem',
  ROUTE_VIEW:             'route.view',
  ROUTE_SUPPRESS:         'route.suppress',
  ROUTE_OVERRIDE:         'route.override',
  FRAUD_VIEW:             'fraud.view',
  FRAUD_BLOCK:            'fraud.block',
  FRAUD_WHITELIST:        'fraud.whitelist',
  ALERT_VIEW:             'alert.view',
  ALERT_ACKNOWLEDGE:      'alert.acknowledge',
  ALERT_ESCALATE:         'alert.escalate',

  // ── Governance ─────────────────────────────────────────────────────────────
  PORTAL_VIEW:            'portal.view',
  PORTAL_EDIT:            'portal.edit',
  NAVIGATION_VIEW:        'navigation.view',
  NAVIGATION_EDIT:        'navigation.edit',
  THEME_EDIT:             'theme.edit',
  MODULE_ASSIGN:          'module.assign',
  RBAC_VIEW:              'rbac.view',
  RBAC_EDIT:              'rbac.edit',

  // ── KAM ────────────────────────────────────────────────────────────────────
  KAM_VIEW:               'kam.view',
  KAM_MANAGE:             'kam.manage',
  CLIENT_VIEW:            'client.view',
  CLIENT_MANAGE:          'client.manage',
  RATE_CARD_VIEW:         'rate_card.view',
  RATE_CARD_SEND:         'rate_card.send',

  // ── Operations ─────────────────────────────────────────────────────────────
  CALLS_VIEW:             'calls.view',
  CDRS_VIEW:              'cdrs.view',
  ANALYTICS_VIEW:         'analytics.view',
  REPORTS_VIEW:           'reports.view',
  REPORTS_EXPORT:         'reports.export',
  SETTINGS_VIEW:          'settings.view',
  SETTINGS_EDIT:          'settings.edit',
  AUDIT_VIEW:             'audit.view',
} as const;

export type PermissionKey = typeof PERM[keyof typeof PERM];

// Domain labels for UI grouping
export const PERM_DOMAINS: Record<string, { label: string; color: string }> = {
  finance:     { label: 'Finance',     color: 'emerald' },
  noc:         { label: 'NOC',         color: 'blue'    },
  governance:  { label: 'Governance',  color: 'indigo'  },
  kam:         { label: 'KAM',         color: 'purple'  },
  operations:  { label: 'Operations',  color: 'slate'   },
};

// Risk level visual config for UI
export const RISK_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low:      { label: 'Low',      color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  medium:   { label: 'Medium',   color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20'   },
  high:     { label: 'High',     color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20'  },
  critical: { label: 'Critical', color: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20'    },
};

// Scope types
export const SCOPES = [
  { key: 'all',              label: 'All',              desc: 'Unrestricted access' },
  { key: 'assigned_clients', label: 'Assigned Clients', desc: 'Only their assigned clients' },
  { key: 'own_team',         label: 'Own Team',          desc: 'Only their team members' },
  { key: 'vendor_scoped',    label: 'Vendor Scoped',    desc: 'Only assigned vendors' },
  { key: 'portal_scoped',    label: 'Portal Scoped',    desc: 'Only their portal' },
] as const;

export type ScopeKey = typeof SCOPES[number]['key'];

// All platform roles in authority order
export const PLATFORM_ROLES = [
  'super_admin', 'admin', 'management',
  'destination_manager', 'routing_admin',
  'noc_operator', 'team_lead', 'viewer',
] as const;

export type PlatformRole = typeof PLATFORM_ROLES[number];
