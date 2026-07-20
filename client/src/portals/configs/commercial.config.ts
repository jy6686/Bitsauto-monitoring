/**
 * commercial.config.ts — Commercial Portal Configuration
 *
 * Implements the PortalConfig contract (portal-config.types.ts).
 * Frozen: 2026-07-20 per COMMERCIAL-FEATURE-ASSIGNMENT-MATRIX.md
 *
 * Top menu (7 entries — per frozen matrix):
 *   Home | Clients | Products & Rates | Deals | Intelligence | Operations | Analytics
 *
 * Excluded:
 *   All NOC-technical features · All Finance/Billing features · All Admin/Governance features
 *
 * All paths reference EXISTING routes registered in App.tsx
 * (verified by COMMERCIAL-PORTAL-FEATURE-AUDIT-2026-07-20.md).
 */

import type { PortalConfig } from '../types/portal-config.types';

export const commercialPortalConfig: PortalConfig = {
  id:           'commercial',
  name:         'Commercial Portal',
  badgeLabel:   'COM',
  accentColor:  'emerald',

  // ── Navigation — 7 top-menu entries (FROZEN 2026-07-20) ─────────────────────
  navigation: {
    entries: [
      // 1. Home — flat tab
      {
        label: 'Home',
        path:  '/commercial',
        icon:  'layout-dashboard',
      },

      // 2. Clients — commercial relationship management (NOT technical SIP config)
      {
        label: 'Clients',
        icon:  'users',
        items: [
          { label: 'Accounts',          path: '/clients',         icon: 'users'       },
          { label: 'KAM Dashboard',     path: '/kam-dashboard',   icon: 'handshake'   },
          { label: 'Company List',      path: '/company/list',    icon: 'building-2'  },
          { label: 'Partner Profiles',  path: '/partner-profiles',icon: 'globe'       },
          { label: 'Dispute Cases',     path: '/dispute-cases',   icon: 'clipboard'   },
          { label: 'Reseller Mgmt',     path: '/reseller',        icon: 'git-branch'  },
        ],
      },

      // 3. Products & Rates — rate management and product catalog
      {
        label: 'Products & Rates',
        icon:  'layers',
        items: [
          { label: 'Product Registry',    path: '/product-registry',    icon: 'layout-grid'  },
          { label: 'Destination Catalog', path: '/destination-catalog', icon: 'globe'        },
          { label: 'Rate Manager',        path: '/rate-manager',        icon: 'trending-up'  },
          { label: 'Rate Cards',          path: '/rate-cards',          icon: 'file-text'    },
          { label: 'Rate Editor',         path: '/rate-editor',         icon: 'wrench'       },
          { label: 'Tariff Profiles',     path: '/tariff-profiles',     icon: 'layers'       },
          { label: 'Tariff Versions',     path: '/tariff-versions',     icon: 'history'      },
          { label: 'LCR Analyser',        path: '/lcr-analyser',        icon: 'route'        },
          { label: 'Rating Snapshots',    path: '/rating-snapshots',    icon: 'compass'      },
        ],
      },

      // 4. Deals — flat tab (deal workspace is its own primary nav item)
      {
        label: 'Deals',
        path:  '/deals',
        icon:  'handshake',
      },

      // 5. Intelligence — commercial analytics and revenue intelligence
      {
        label: 'Intelligence',
        icon:  'brain',
        items: [
          { label: 'Margin Intelligence',  path: '/margin-intelligence', icon: 'trending-up'  },
          { label: 'Revenue Heatmap',      path: '/revenue-heatmap',     icon: 'bar-chart-2'  },
          { label: 'Carrier Intelligence', path: '/carrier-intelligence',icon: 'globe'        },
          { label: 'Cost Optimisation',    path: '/cost-optimisation',   icon: 'trending-down'},
          { label: 'Dispute Defense',      path: '/dispute-defense',     icon: 'shield'       },
          { label: 'Client Rate Report',   path: '/client-rate-report',  icon: 'file-text'    },
        ],
      },

      // 6. Operations — commercial operational workflows
      {
        label: 'Operations',
        icon:  'wrench',
        items: [
          { label: 'Commercial Alerts',  path: '/commercial-notifications', icon: 'zap'          },
          { label: 'Rating Verification',path: '/rating-verification',      icon: 'check-circle' },
          { label: 'Billing Disputes',   path: '/billing-disputes',         icon: 'shield-alert' },
          { label: 'Test Campaigns',     path: '/test-campaigns',           icon: 'radio'        },
          { label: 'Comm. Policies',     path: '/communication-policies',   icon: 'clipboard'    },
          { label: 'Sender Profiles',    path: '/sender-profiles',          icon: 'mail'         },
        ],
      },

      // 7. Analytics — commercial reporting and forecasting
      {
        label: 'Analytics',
        icon:  'bar-chart-2',
        items: [
          { label: 'Traffic Analytics',  path: '/analytics',         icon: 'activity'    },
          { label: 'Traffic Forecast',   path: '/traffic-forecast',  icon: 'trending-up' },
          { label: 'Executive Reports',  path: '/executive-reports', icon: 'file-text'   },
          { label: 'CDR Viewer',         path: '/cdrs',              icon: 'history'     },
          { label: 'Reports',            path: '/reports',           icon: 'clipboard'   },
        ],
      },
    ],
  },

  // ── Quick Actions — exactly 6 (Section 3 of Dashboard Template) ────────────
  quickActions: {
    actions: [
      { label: 'Deal Workspace',    path: '/deals',              icon: 'handshake'    },
      { label: 'Rate Manager',      path: '/rate-manager',       icon: 'trending-up'  },
      { label: 'KAM Dashboard',     path: '/kam-dashboard',      icon: 'users'        },
      { label: 'Margin Intel',      path: '/margin-intelligence',icon: 'brain'        },
      { label: 'LCR Analyser',      path: '/lcr-analyser',       icon: 'route'        },
      { label: 'Product Registry',  path: '/product-registry',   icon: 'layout-grid'  },
    ],
  },

  // ── Workflows — Sections 6 (primary) + 7 (secondary) ───────────────────────
  workflows: {
    primary: [
      {
        label:       'Deal Workspace',
        description: 'Manage commercial deals, pricing proposals, and approvals.',
        path:        '/deals',
        icon:        'handshake',
        status:      'active',
      },
      {
        label:       'Rate Manager',
        description: 'Manage and push rate tables, tariff profiles, and LCR rules.',
        path:        '/rate-manager',
        icon:        'trending-up',
        status:      'active',
      },
      {
        label:       'Product Registry',
        description: 'Commercial product lifecycle — draft, testing, and deployment.',
        path:        '/product-registry',
        icon:        'layout-grid',
        status:      'active',
      },
      {
        label:       'LCR Analyser',
        description: 'Least-cost routing analysis across tariff and destination sets.',
        path:        '/lcr-analyser',
        icon:        'route',
        status:      'active',
      },
      {
        label:       'Margin Intelligence',
        description: 'Real-time and historical margin analysis by client and destination.',
        path:        '/margin-intelligence',
        icon:        'brain',
        status:      'active',
      },
      {
        label:       'KAM Dashboard',
        description: 'Key Account Manager view — client portfolio, KPIs, and pipeline.',
        path:        '/kam-dashboard',
        icon:        'users',
        status:      'active',
      },
    ],

    secondary: [
      {
        label:       'Destination Catalog',
        description: 'Customer-facing destination authority and billing increment management.',
        path:        '/destination-catalog',
        icon:        'globe',
        status:      'active',
      },
      {
        label:       'Revenue Heatmap',
        description: 'Revenue distribution by client, destination, and time period.',
        path:        '/revenue-heatmap',
        icon:        'bar-chart-2',
        status:      'active',
      },
      {
        label:       'Carrier Intelligence',
        description: 'Commercial carrier relationship analytics and performance scoring.',
        path:        '/carrier-intelligence',
        icon:        'globe',
        status:      'active',
      },
      {
        label:       'Executive Reports',
        description: 'Management-level commercial performance and business reporting.',
        path:        '/executive-reports',
        icon:        'file-text',
        status:      'active',
      },
      {
        label:       'Cost Optimisation',
        description: 'Margin improvement recommendations across products and routes.',
        path:        '/cost-optimisation',
        icon:        'trending-down',
        status:      'active',
      },
      {
        label:       'Dispute Defense',
        description: 'Commercial dispute management and evidence preparation tools.',
        path:        '/dispute-defense',
        icon:        'shield',
        status:      'active',
      },
    ],
  },

  // ── Widgets (Dashboard Template sections 1, 2, 4, 5, 8, 9, 10) ─────────────
  widgets: {
    kpiCards: [
      { label: 'Active Deals',    dataKey: 'active_deals',     format: 'number'   },
      { label: 'Monthly Revenue', dataKey: 'monthly_revenue',  format: 'currency' },
      { label: 'Avg Margin %',    dataKey: 'avg_margin_pct',   format: 'percent'  },
      { label: 'Active Products', dataKey: 'active_products',  format: 'number'   },
    ],
    telemetry:        { enabled: false },
    mainWidget:       { componentName: 'DealsOverview', label: 'Deal Pipeline' },
    smartPriorities:  { enabled: true },
    systemHealth:     { enabled: false },
    operationalFeed:  { enabled: true },
    riskSection:      { enabled: true, label: 'Commercial Risk Items' },
  },

  // ── Permissions ──────────────────────────────────────────────────────────────
  permissions: {
    requiredRoles:  ['admin', 'management', 'super_admin'],
    hierarchyScope: 'scoped',
  },
};
