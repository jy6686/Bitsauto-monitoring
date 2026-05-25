// ── Workspace / domain inference ──────────────────────────────────────────────
// Single source of truth for route → workspace mapping, shared by
// AppNavShell (top bar active tab + breadcrumb) and LayoutShell (sidebar filter).

export type WorkspaceDomain =
  | 'live-network'
  | 'company'
  | 'operations'
  | 'analytics'
  | 'intelligence'
  | 'troubleshooting'
  | 'security'
  | 'finance'
  | 'platform';

// Ordered longest → shortest so longest prefix wins.
// Multi-context routes: only the FIRST match wins for breadcrumb / tab highlight.
// Secondary appearances in other domains are purely nav shortcuts.
const ROUTE_DOMAIN_MAP: [string, WorkspaceDomain][] = [
  // ── Platform ──────────────────────────────────────────────────────────────
  ['/approval-settings',          'platform'],
  ['/sidebar-settings',           'platform'],
  ['/whatsapp-alerts',            'platform'],
  ['/notification-centre',        'platform'],
  ['/email-centre',               'platform'],
  ['/vpn-config',                 'platform'],
  ['/api-keys',                   'platform'],
  ['/account',                    'platform'],
  ['/settings',                   'platform'],
  ['/team',                       'platform'],
  // ── Finance & Billing ─────────────────────────────────────────────────────
  ['/billing-disputes',           'finance'],
  ['/billing',                    'finance'],
  ['/rate-cards',                 'finance'],
  ['/rate-editor',                'finance'],
  // ── Security & Compliance ─────────────────────────────────────────────────
  ['/sla-breaches',               'security'],
  ['/stir-shaken',                'security'],
  ['/compliance',                 'security'],
  ['/approvals',                  'security'],
  ['/audit-log',                  'security'],
  ['/firewall',                   'security'],
  ['/fraud',                      'security'],
  // ── Intelligence ──────────────────────────────────────────────────────────
  ['/cost-optimisation',          'intelligence'],
  ['/intelligence-validation',    'intelligence'],
  ['/intelligence',               'intelligence'],
  ['/routing-intelligence',       'intelligence'],
  ['/carrier-intelligence',       'intelligence'],
  ['/vendor-prefix-intelligence', 'intelligence'],
  ['/number-intelligence',        'intelligence'],
  ['/vendor-rca',                 'intelligence'],
  ['/ai-ops',                     'intelligence'],
  ['/route-optimisation',         'intelligence'],
  ['/traffic-steering',           'intelligence'],
  ['/simulation-sandbox',         'intelligence'],
  // ── Analytics & Reports ───────────────────────────────────────────────────
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
  // ── Operations (carriers + routing) ───────────────────────────────────────
  ['/vendor-stability-timeline',  'operations'],
  ['/carrier-scoring',            'operations'],
  ['/call-flow-simulator',        'operations'],
  ['/routing-manager',            'operations'],
  ['/lcr-analyser',               'operations'],
  ['/vendor-profile',             'operations'],
  ['/self-heal',                  'operations'],
  ['/test-call',                  'operations'],
  ['/test-campaigns',             'operations'],
  ['/sip-trace',                  'operations'],
  ['/replay',                     'operations'],
  ['/tools',                      'operations'],
  ['/vendors',                    'operations'],
  ['/balance',                    'operations'],
  // ── Company ───────────────────────────────────────────────────────────────
  ['/products',                   'company'],
  ['/account-names',              'company'],
  ['/company-profile',            'company'],
  ['/company/create',             'company'],
  ['/company/onboarding',         'company'],
  ['/company/list',               'company'],
  ['/company',                    'company'],
  ['/client-portal',              'company'],
  ['/call-recordings',            'company'],
  ['/client',                     'company'],
  ['/clients',                    'company'],
  ['/reseller',                   'company'],
  ['/dids',                       'company'],
  // ── Live Network ──────────────────────────────────────────────────────────
  ['/server-monitoring',          'live-network'],
  ['/network-topology',           'live-network'],
  ['/traffic-map',                'live-network'],
  ['/multi-switch',               'live-network'],
  ['/noc-command',                'live-network'],
  ['/ops-console',                'live-network'],
  ['/sbc-monitor',                'live-network'],
  ['/live-traffic',               'live-network'],
  ['/bitseye2',                   'live-network'],
  ['/console',                    'live-network'],
  ['/graphs',                     'live-network'],
  ['/alerts',                     'live-network'],
  ['/calls',                      'live-network'],
];

export function inferWorkspace(path: string): WorkspaceDomain {
  if (path === '/' || path === '') return 'live-network';
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
  return 'live-network';
}

// Private helper used only above — avoids circular dependency with exported WORKSPACE_LABELS
const WORKSPACE_LABELS_PLACEHOLDER: Record<string, true> = {
  'live-network': true, 'company': true, 'operations': true,
  'analytics': true, 'intelligence': true, 'troubleshooting': true,
  'security': true, 'finance': true, 'platform': true,
};

// ── Workspace → sidebar group keys ────────────────────────────────────────────
export const WORKSPACE_SIDEBAR_GROUPS: Record<WorkspaceDomain, string[]> = {
  'live-network':    ['live_network'],
  'company':         ['company'],
  'operations':      ['operations'],
  'analytics':       ['analytics'],
  'intelligence':    ['intelligence'],
  'troubleshooting': ['operations'],
  'security':        ['security'],
  'finance':         ['finance'],
  'platform':        ['platform'],
};

// Human-readable workspace labels (mirrors AppNavShell domain labels)
export const WORKSPACE_LABELS: Record<WorkspaceDomain, string> = {
  'live-network':    'Live Network',
  'company':         'Company',
  'operations':      'Operations',
  'analytics':       'Analytics & Reports',
  'intelligence':    'Intelligence',
  'troubleshooting': 'Troubleshooting',
  'security':        'Security & Compliance',
  'finance':         'Finance & Billing',
  'platform':        'Platform',
};

// Tailwind text colour per workspace (matches AppNavShell domain colours)
export const WORKSPACE_TEXT_COLOR: Record<WorkspaceDomain, string> = {
  'live-network':    'text-emerald-400',
  'company':         'text-amber-400',
  'operations':      'text-blue-400',
  'analytics':       'text-indigo-400',
  'intelligence':    'text-fuchsia-400',
  'troubleshooting': 'text-orange-400',
  'security':        'text-rose-400',
  'finance':         'text-emerald-400',
  'platform':        'text-slate-400',
};

// Tailwind bg colour for the indicator dot
export const WORKSPACE_DOT_BG: Record<WorkspaceDomain, string> = {
  'live-network':    'bg-emerald-400',
  'company':         'bg-amber-400',
  'operations':      'bg-blue-400',
  'analytics':       'bg-indigo-400',
  'intelligence':    'bg-fuchsia-400',
  'troubleshooting': 'bg-orange-400',
  'security':        'bg-rose-400',
  'finance':         'bg-emerald-400',
  'platform':        'bg-slate-400',
};
