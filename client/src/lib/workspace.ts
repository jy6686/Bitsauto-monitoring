// ── Workspace / domain inference ──────────────────────────────────────────────
// Single source of truth for route → workspace mapping, shared by
// AppNavShell (top bar active tab + breadcrumb) and LayoutShell (sidebar filter).

export type WorkspaceDomain =
  | 'live-ops'
  | 'clients'
  | 'vendors'
  | 'intelligence'
  | 'analytics'
  | 'security'
  | 'finance'
  | 'settings';

// Ordered longest → shortest so longest prefix wins.
// Multi-context routes: only the FIRST match wins for breadcrumb / tab highlight.
// Secondary appearances in other domains are purely nav shortcuts.
const ROUTE_DOMAIN_MAP: [string, WorkspaceDomain][] = [
  // ── Settings ──────────────────────────────────────────────────────────────
  ['/approval-settings',          'settings'],
  ['/sidebar-settings',           'settings'],
  ['/whatsapp-alerts',            'settings'],
  ['/email-centre',               'settings'],
  ['/vpn-config',                 'settings'],
  ['/api-keys',                   'settings'],
  ['/account',                    'settings'],
  ['/settings',                   'settings'],
  ['/team',                       'settings'],
  // ── Finance ───────────────────────────────────────────────────────────────
  ['/billing-disputes',           'finance'],
  ['/billing',                    'finance'],
  ['/rate-cards',                 'finance'],
  ['/products',                   'finance'],
  // ── Security ──────────────────────────────────────────────────────────────
  ['/vendor-sla-scorecard',       'security'],
  ['/call-recordings',            'security'],
  ['/sla-breaches',               'security'],
  ['/stir-shaken',                'security'],
  ['/compliance',                 'security'],
  ['/approvals',                  'security'],
  ['/audit-log',                  'security'],
  ['/firewall',                   'security'],
  ['/fraud',                      'security'],
  // ── Intelligence ──────────────────────────────────────────────────────────
  ['/intelligence-validation',    'intelligence'],
  ['/intelligence',               'intelligence'],
  ['/ai-ops',                     'intelligence'],
  // ── Analytics ─────────────────────────────────────────────────────────────
  ['/revenue-heatmap',            'analytics'],
  ['/traffic-forecast',           'analytics'],
  ['/codec-analytics',            'analytics'],
  ['/qos-heatmap',                'analytics'],
  ['/rtp-analytics',              'analytics'],
  ['/analytics',                  'analytics'],
  ['/asr-acd',                    'analytics'],
  ['/bitseye',                    'analytics'],
  ['/reports',                    'analytics'],
  ['/cdrs',                       'analytics'],
  // ── Vendors (includes routing + carrier ops) ───────────────────────────────
  ['/vendor-prefix-intelligence', 'vendors'],
  ['/vendor-stability-timeline',  'vendors'],
  ['/carrier-intelligence',       'vendors'],
  ['/carrier-scoring',            'vendors'],
  ['/routing-intelligence',       'vendors'],
  ['/call-flow-simulator',        'vendors'],
  ['/cost-optimisation',          'vendors'],
  ['/routing-manager',            'vendors'],
  ['/number-intelligence',        'vendors'],
  ['/lcr-analyser',               'vendors'],
  ['/vendor-profile',             'vendors'],
  ['/vendor-rca',                 'vendors'],
  ['/rate-editor',                'vendors'],
  ['/self-heal',                  'vendors'],
  ['/test-call',                  'vendors'],
  ['/vendors',                    'vendors'],
  ['/balance',                    'vendors'],
  // ── Clients ───────────────────────────────────────────────────────────────
  ['/account-names',              'clients'],
  ['/company-profile',            'clients'],
  ['/company/create',             'clients'],
  ['/company/list',               'clients'],
  ['/client-portal',              'clients'],
  ['/client',                     'clients'],
  ['/clients',                    'clients'],
  ['/reseller',                   'clients'],
  ['/dids',                       'clients'],
  // ── Live Ops ──────────────────────────────────────────────────────────────
  ['/server-monitoring',          'live-ops'],
  ['/network-topology',           'live-ops'],
  ['/traffic-map',                'live-ops'],
  ['/multi-switch',               'live-ops'],
  ['/noc-command',                'live-ops'],
  ['/ops-console',                'live-ops'],
  ['/sbc-monitor',                'live-ops'],
  ['/live-traffic',               'live-ops'],
  ['/bitseye2',                   'live-ops'],
  ['/console',                    'live-ops'],
  ['/graphs',                     'live-ops'],
  ['/alerts',                     'live-ops'],
  // Troubleshooting tools → live-ops for breadcrumb purposes
  ['/replay-engine',              'live-ops'],
  ['/test-campaigns',             'live-ops'],
  ['/sip-trace',                  'live-ops'],
  ['/replay',                     'live-ops'],
  ['/tools',                      'live-ops'],
];

export function inferWorkspace(path: string): WorkspaceDomain {
  if (path === '/' || path === '') return 'live-ops';
  const clean = path.split('?')[0];
  // Workspace home pages: /workspace/<domain>
  if (clean.startsWith('/workspace/')) {
    const sub = clean.slice('/workspace/'.length).split('/')[0] as WorkspaceDomain;
    if (sub in WORKSPACE_LABELS_PLACEHOLDER) return sub;
  }
  for (const [prefix, domain] of ROUTE_DOMAIN_MAP) {
    if (clean === prefix || clean.startsWith(prefix + '/')) {
      return domain;
    }
  }
  return 'live-ops';
}

// Private helper used only above — avoids circular dependency with exported WORKSPACE_LABELS
const WORKSPACE_LABELS_PLACEHOLDER: Record<string, true> = {
  'live-ops': true, 'clients': true, 'vendors': true,
  'intelligence': true, 'analytics': true, 'security': true,
  'finance': true, 'settings': true,
};

// ── Workspace → sidebar group keys ────────────────────────────────────────────
export const WORKSPACE_SIDEBAR_GROUPS: Record<WorkspaceDomain, string[]> = {
  'live-ops':     ['live_network'],
  'clients':      ['company'],
  'vendors':      ['operations', 'intelligence', 'simulation'],
  'intelligence': ['intelligence', 'ai_ops'],
  'analytics':    ['analytics', 'reports'],
  'security':     ['security'],
  'finance':      ['billing'],
  'settings':     ['platform'],
};

// Human-readable workspace labels (mirrors AppNavShell domain labels)
export const WORKSPACE_LABELS: Record<WorkspaceDomain, string> = {
  'live-ops':     'Live Ops',
  'clients':      'Clients',
  'vendors':      'Vendors',
  'intelligence': 'Intelligence',
  'analytics':    'Analytics',
  'security':     'Security',
  'finance':      'Finance',
  'settings':     'Settings',
};

// Tailwind text colour per workspace (matches AppNavShell domain colours)
export const WORKSPACE_TEXT_COLOR: Record<WorkspaceDomain, string> = {
  'live-ops':     'text-violet-400',
  'clients':      'text-amber-400',
  'vendors':      'text-cyan-400',
  'intelligence': 'text-fuchsia-400',
  'analytics':    'text-blue-400',
  'security':     'text-rose-400',
  'finance':      'text-emerald-400',
  'settings':     'text-slate-400',
};

// Tailwind bg colour for the indicator dot
export const WORKSPACE_DOT_BG: Record<WorkspaceDomain, string> = {
  'live-ops':     'bg-violet-400',
  'clients':      'bg-amber-400',
  'vendors':      'bg-cyan-400',
  'intelligence': 'bg-fuchsia-400',
  'analytics':    'bg-blue-400',
  'security':     'bg-rose-400',
  'finance':      'bg-emerald-400',
  'settings':     'bg-slate-400',
};
