/**
 * commercial.config.ts — Commercial Portal Configuration (v2)
 *
 * Revised 2026-07-20: Reduced to 8 approved top-menu entries only.
 * Navigation stays inside the commercial workspace — no deep main-platform menus.
 *
 * Approved modules (per scope decision):
 *   Dashboard | Live Calls | Live Traffic | BitsEye | Clients | Balance | Products | Reports
 *
 * Removed from Commercial Portal (remain in main platform):
 *   Destination Catalog · Revenue Heatmap · Carrier Intelligence
 *   Executive Reports · Cost Optimisation · Dispute Defense
 *   Product Registry · LCR Analyser · Deals · Intelligence menu · Operations menu
 */

import type { PortalConfig } from '../types/portal-config.types';

export const commercialPortalConfig: PortalConfig = {
  id:           'commercial',
  name:         'Commercial Portal',
  badgeLabel:   'COM',
  accentColor:  'emerald',

  // ── Navigation — 8 flat top-menu entries ─────────────────────────────────
  navigation: {
    entries: [

      // 1. Dashboard — KAM home
      {
        label: 'Dashboard',
        path:  '/commercial',
        icon:  'layout-dashboard',
      },

      // 2. Live Calls — read-only, hierarchy filtered
      {
        label: 'Live Calls',
        path:  '/calls',
        icon:  'phone',
      },

      // 3. Live Traffic — read-only, hierarchy filtered
      {
        label: 'Live Traffic',
        path:  '/live-traffic',
        icon:  'activity',
      },

      // 4. BitsEye — telemetry, hierarchy filtered
      {
        label: 'BitsEye',
        path:  '/bitseye2',
        icon:  'eye',
      },

      // 5. Clients — read-only, hierarchy filtered
      {
        label: 'Clients',
        path:  '/clients',
        icon:  'users',
      },

      // 6. Balance — read-only, hierarchy filtered
      {
        label: 'Balance',
        path:  '/balance',
        icon:  'wallet',
      },

      // 7. Products / Rate Manager — read/write per permissions
      {
        label: 'Products',
        path:  '/rate-manager',
        icon:  'layers',
      },

      // 8. Commercial Reports — read-only
      {
        label: 'Reports',
        path:  '/reports',
        icon:  'bar-chart-2',
      },

    ],
  },

  // ── Quick Actions (shown on KAM Dashboard home) ───────────────────────────
  quickActions: {
    actions: [
      { label: 'Rate Manager',      path: '/rate-manager',        icon: 'trending-up'   },
      { label: 'KAM Dashboard',     path: '/kam-dashboard',       icon: 'users'         },
      { label: 'Live Calls',        path: '/calls',               icon: 'phone'         },
      { label: 'BitsEye',          path: '/bitseye2',            icon: 'eye'            },
      { label: 'Balance',           path: '/balance',             icon: 'wallet'        },
      { label: 'Reports',           path: '/reports',             icon: 'bar-chart-2'   },
    ],
  },

  // ── Workflows — only the two approved primary entries remain ─────────────
  workflows: {
    primary: [
      {
        label:       'Rate Manager',
        description: 'Manage and push rate tables, tariff profiles, and LCR rules.',
        path:        '/rate-manager',
        icon:        'trending-up',
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

    // Secondary workflows removed per scope decision 2026-07-20:
    // Destination Catalog, Revenue Heatmap, Carrier Intelligence,
    // Executive Reports, Cost Optimisation, Dispute Defense
    secondary: [],
  },

  // ── Widgets ──────────────────────────────────────────────────────────────
  widgets: {
    kpiCards: [
      { label: 'Managed Accounts', dataKey: 'managed_accounts', format: 'number'   },
      { label: 'Live Calls',       dataKey: 'live_calls',       format: 'number'   },
      { label: 'At Risk',          dataKey: 'at_risk',          format: 'number'   },
      { label: 'Pending Rate',     dataKey: 'pending_rate',     format: 'number'   },
    ],
    telemetry:        { enabled: false },
    mainWidget:       { componentName: 'KamPortfolio', label: 'Account Health Board' },
    smartPriorities:  { enabled: true  },
    systemHealth:     { enabled: false },
    operationalFeed:  { enabled: true  },
    riskSection:      { enabled: false },
  },

  // ── Permissions ──────────────────────────────────────────────────────────
  permissions: {
    requiredRoles:  ['admin', 'management', 'super_admin'],
    hierarchyScope: 'scoped',
  },
};
