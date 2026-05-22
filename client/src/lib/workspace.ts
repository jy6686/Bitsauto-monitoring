// ── Workspace / domain inference ──────────────────────────────────────────────
// Single source of truth for route → workspace mapping, shared by
// AppNavShell (top bar active tab + breadcrumb) and LayoutShell (sidebar filter).

export type WorkspaceDomain =
  | 'live-ops'
  | 'clients'
  | 'vendors'
  | 'routing'
  | 'reports'
  | 'intelligence'
  | 'troubleshooting'
  | 'fraud'
  | 'settings';

// Ordered longest → shortest so longest prefix wins
const ROUTE_DOMAIN_MAP: [string, WorkspaceDomain][] = [
  // Settings / admin (long prefixes first)
  ['/approval-settings',         'settings'],
  ['/sidebar-settings',          'settings'],
  ['/whatsapp-alerts',           'settings'],
  ['/email-centre',              'settings'],
  ['/company-profile',           'settings'],
  ['/company/create',            'settings'],
  ['/company/list',              'settings'],
  ['/vpn-config',                'settings'],
  ['/api-keys',                  'settings'],
  ['/reseller',                  'settings'],
  ['/account',                   'settings'],
  ['/settings',                  'settings'],
  ['/team',                      'settings'],
  // Troubleshooting
  ['/number-intelligence',       'troubleshooting'],
  ['/network-topology',          'troubleshooting'],
  ['/replay-engine',             'troubleshooting'],
  ['/test-campaigns',            'troubleshooting'],
  ['/rtp-analytics',             'troubleshooting'],
  ['/sip-trace',                 'troubleshooting'],
  ['/test-call',                 'troubleshooting'],
  ['/replay',                    'troubleshooting'],
  ['/tools',                     'troubleshooting'],
  // Security / fraud
  ['/vendor-sla-scorecard',      'fraud'],
  ['/call-recordings',           'fraud'],
  ['/sla-breaches',              'fraud'],
  ['/stir-shaken',               'fraud'],
  ['/compliance',                'fraud'],
  ['/approvals',                 'fraud'],
  ['/audit-log',                 'fraud'],
  ['/firewall',                  'fraud'],
  ['/fraud',                     'fraud'],
  // Vendors
  ['/vendor-prefix-intelligence','vendors'],
  ['/vendor-stability-timeline', 'vendors'],
  ['/carrier-intelligence',      'vendors'],
  ['/carrier-scoring',           'vendors'],
  ['/vendor-profile',            'vendors'],
  ['/vendor-rca',                'vendors'],
  ['/rate-editor',               'vendors'],
  ['/rate-cards',                'vendors'],
  ['/vendors',                   'vendors'],
  ['/balance',                   'vendors'],
  ['/products',                  'vendors'],
  // Routing
  ['/routing-intelligence',      'routing'],
  ['/call-flow-simulator',       'routing'],
  ['/cost-optimisation',         'routing'],
  ['/routing-manager',           'routing'],
  ['/lcr-analyser',              'routing'],
  ['/self-heal',                 'routing'],
  // Analytics / reports
  ['/revenue-heatmap',           'reports'],
  ['/traffic-forecast',          'reports'],
  ['/codec-analytics',           'reports'],
  ['/live-traffic',              'reports'],
  ['/qos-heatmap',               'reports'],
  ['/analytics',                 'reports'],
  ['/asr-acd',                   'reports'],
  ['/bitseye',                   'reports'],
  ['/reports',                   'reports'],
  ['/graphs',                    'reports'],
  ['/cdrs',                      'reports'],
  // Intelligence / AI Ops
  ['/intelligence-validation',   'intelligence'],
  ['/intelligence',              'intelligence'],
  ['/ai-ops',                    'intelligence'],
  // Clients
  ['/account-names',             'clients'],
  ['/client-portal',             'clients'],
  ['/client',                    'clients'],
  ['/clients',                   'clients'],
  ['/billing-disputes',          'clients'],
  ['/billing',                   'clients'],
  ['/dids',                      'clients'],
  // Live Ops
  ['/server-monitoring',         'live-ops'],
  ['/traffic-map',               'live-ops'],
  ['/multi-switch',              'live-ops'],
  ['/noc-command',               'live-ops'],
  ['/ops-console',               'live-ops'],
  ['/sbc-monitor',               'live-ops'],
  ['/bitseye2',                  'live-ops'],
  ['/console',                   'live-ops'],
  ['/alerts',                    'live-ops'],
];

export function inferWorkspace(path: string): WorkspaceDomain {
  if (path === '/' || path === '') return 'live-ops';
  const clean = path.split('?')[0];
  for (const [prefix, domain] of ROUTE_DOMAIN_MAP) {
    if (clean === prefix || clean.startsWith(prefix + '/')) {
      return domain;
    }
  }
  return 'live-ops';
}

// ── Workspace → sidebar group keys ────────────────────────────────────────────
// Maps each domain to the sidebar group keys that should be visible.
// The 'operations' sidebar group contains both vendor AND routing items, so it
// appears for both workspaces until groups are split in Phase 3.
export const WORKSPACE_SIDEBAR_GROUPS: Record<WorkspaceDomain, string[]> = {
  'live-ops':        ['live_network'],
  'clients':         ['company'],
  'vendors':         ['operations', 'intelligence'],
  'routing':         ['operations', 'simulation'],
  'reports':         ['analytics', 'reports'],
  'intelligence':    ['intelligence', 'ai_ops'],
  'troubleshooting': ['troubleshooting'],
  'fraud':           ['security'],
  'settings':        ['platform'],
};

// Human-readable workspace labels (mirrors AppNavShell domain labels)
export const WORKSPACE_LABELS: Record<WorkspaceDomain, string> = {
  'live-ops':        'Live Ops',
  'clients':         'Clients',
  'vendors':         'Vendors',
  'routing':         'Routing',
  'reports':         'Analytics',
  'intelligence':    'Intelligence',
  'troubleshooting': 'Troubleshoot',
  'fraud':           'Security',
  'settings':        'Settings',
};

// Tailwind text colour per workspace (matches AppNavShell domain colours)
export const WORKSPACE_TEXT_COLOR: Record<WorkspaceDomain, string> = {
  'live-ops':        'text-violet-400',
  'clients':         'text-amber-400',
  'vendors':         'text-cyan-400',
  'routing':         'text-emerald-400',
  'reports':         'text-blue-400',
  'intelligence':    'text-fuchsia-400',
  'troubleshooting': 'text-orange-400',
  'fraud':           'text-rose-400',
  'settings':        'text-slate-400',
};

// Tailwind bg colour for the indicator dot
export const WORKSPACE_DOT_BG: Record<WorkspaceDomain, string> = {
  'live-ops':        'bg-violet-400',
  'clients':         'bg-amber-400',
  'vendors':         'bg-cyan-400',
  'routing':         'bg-emerald-400',
  'reports':         'bg-blue-400',
  'intelligence':    'bg-fuchsia-400',
  'troubleshooting': 'bg-orange-400',
  'fraud':           'bg-rose-400',
  'settings':        'bg-slate-400',
};
