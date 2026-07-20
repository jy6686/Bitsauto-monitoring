/**
 * commercial.config.ts — Commercial Portal Configuration
 *
 * Implements the PortalConfig contract (portal-config.types.ts).
 * Populated: 2026-07-20 per COMMERCIAL-PORTAL-INVENTORY-AUDIT-2026-07-20.md
 *
 * Top menu (7 entries — per frozen matrix):
 *   Home | Clients | Products & Rates | Deals | Intelligence | Operations | Analytics
 *
 * All paths reference EXISTING routes verified in the inventory audit.
 * Zero new pages, zero component changes, zero schema changes.
 *
 * Dual-assign rule: a route listed here may also appear in another portal.
 *   One implementation, multiple portal assignments — not one implementation, one portal.
 *
 * Governance Review Required (deferred, not blocking):
 *   - /kam-dashboard appears in Platform > Team & Access — classify and clean up post-certification
 *
 * Excluded (by audit decision):
 *   /carrier-reconciliation → Finance only
 *   /test-campaigns        → NOC/Engineering only
 *   All Finance-internal features (invoices, credit-notes, treasury, etc.)
 *   All NOC-technical features (SIP trace, routing manager, server health, etc.)
 *   All Admin/Governance features (RBAC, audit-log, platform-settings, etc.)
 */

import type { PortalConfig } from '../types/portal-config.types';

export const commercialPortalConfig: PortalConfig = {
  id:           'commercial',
  name:         'Commercial Portal',
  badgeLabel:   'COM',
  accentColor:  'emerald',

  // ── Navigation — 7 top-menu entries ─────────────────────────────────────────
  navigation: {
    entries: [

      // ── 1. Home — flat tab ─────────────────────────────────────────────────
      {
        label: 'Home',
        path:  '/commercial',
        icon:  'layout-dashboard',
      },

      // ── 2. Clients ─────────────────────────────────────────────────────────
      //    Scope: commercial relationship management — NOT SIP/technical config
      //    Source: Main platform > Clients (company) domain
      {
        label: 'Clients',
        icon:  'users',
        items: [
          // Account Management
          { label: 'KAM Dashboard',     path: '/kam-dashboard',    icon: 'layout-dashboard' },
          { label: 'Accounts',          path: '/clients',           icon: 'users'            },
          { label: 'Client Identity',   path: '/client-identity',   icon: 'shield'           },
          { label: 'Client Portal',     path: '/client-portal',     icon: 'globe'            },
          { label: 'Company List',      path: '/company/list',      icon: 'building-2'       },
          { label: 'Resellers',         path: '/reseller',          icon: 'git-branch'       },
          { label: 'Partner Profiles',  path: '/partner-profiles',  icon: 'handshake'        },
          // Onboarding
          { label: 'Account Wizard',    path: '/client/wizard',     icon: 'user-plus'        },
          { label: 'Onboarding Wizard', path: '/company/onboarding',icon: 'zap'              },
          { label: 'Org Management',    path: '/company-profile',   icon: 'building-2'       },
          // Assets & Numbers
          { label: 'DID Management',    path: '/dids',              icon: 'phone'            },
          { label: 'Account Names',     path: '/account-names',     icon: 'file-text'        },
        ],
      },

      // ── 3. Products & Rates ────────────────────────────────────────────────
      //    Scope: product catalog, rate management, LCR, tariff tooling
      //    Source: Main platform > Products domain + surfaced orphaned pages
      {
        label: 'Products & Rates',
        icon:  'layers',
        items: [
          // Product Registry
          { label: 'Product Registry',    path: '/product-registry',    icon: 'layout-grid'   },
          // Rate Operations
          { label: 'Rate Manager',        path: '/rate-manager',        icon: 'trending-up'   },
          { label: 'Rate Cards',          path: '/rate-cards',          icon: 'file-text'     },
          { label: 'Rate Editor',         path: '/rate-editor',         icon: 'wrench'        },
          { label: 'Client Rate Report',  path: '/client-rate-report',  icon: 'file-spreadsheet' },
          { label: 'LCR Analyser',        path: '/lcr-analyser',        icon: 'route'         },
          // Catalog & Tariff Tools
          { label: 'Destination Catalog', path: '/destination-catalog', icon: 'globe'         },
          { label: 'Tariff Profiles',     path: '/tariff-profiles',     icon: 'layers'        },
          { label: 'Tariff Versions',     path: '/tariff-versions',     icon: 'history'       },
          { label: 'Rating Snapshots',    path: '/rating-snapshots',    icon: 'camera'        },
          { label: 'Rating Verification', path: '/rating-verification', icon: 'check-circle'  },
        ],
      },

      // ── 4. Deals — flat tab ────────────────────────────────────────────────
      //    Deal Workspace contains sub-tabs: Board / Simulator / Approvals
      //    Source: Main platform > Voice Trading domain
      {
        label: 'Deals',
        path:  '/deals',
        icon:  'briefcase',
      },

      // ── 5. Intelligence ────────────────────────────────────────────────────
      //    Scope: commercial analytics and revenue intelligence
      //    Dual-assigned from: Analytics, Intelligence, Finance, Operations domains
      {
        label: 'Intelligence',
        icon:  'brain',
        items: [
          // Commercial Analytics
          { label: 'Margin Intelligence',  path: '/margin-intelligence',  icon: 'trending-up'   },
          { label: 'Revenue Heatmap',      path: '/revenue-heatmap',      icon: 'bar-chart-2'   },
          { label: 'Executive Reports',    path: '/executive-reports',    icon: 'file-text'     },
          { label: 'Client Rate Report',   path: '/client-rate-report',   icon: 'file-spreadsheet' },
          // Carrier & Route Intelligence
          { label: 'Carrier Intelligence', path: '/carrier-intelligence', icon: 'globe'         },
          { label: 'Carrier Scoring',      path: '/carrier-scoring',      icon: 'bar-chart-3'   },
          { label: 'Cost Optimisation',    path: '/cost-optimisation',    icon: 'trending-down' },
        ],
      },

      // ── 6. Operations ──────────────────────────────────────────────────────
      //    Scope: commercial outbound comms, dispute tools, provisioning
      //    Dual-assigned from: Operations > Messaging, Platform > Notifications, Finance > Disputes
      {
        label: 'Operations',
        icon:  'settings',
        items: [
          // Communications & Notifications
          { label: 'Commercial Alerts',   path: '/commercial-notifications', icon: 'zap'          },
          { label: 'Comm. Policies',      path: '/communication-policies',   icon: 'clipboard'    },
          { label: 'Sender Profiles',     path: '/sender-profiles',          icon: 'mail'         },
          { label: 'WhatsApp Alerts',     path: '/whatsapp-alerts',          icon: 'message-square'},
          { label: 'Email Centre',        path: '/email-centre',             icon: 'mail'         },
          // Dispute & Resolution
          { label: 'Billing Disputes',    path: '/billing-disputes',         icon: 'shield-alert' },
          { label: 'Dispute Cases',       path: '/dispute-cases',            icon: 'clipboard'    },
          { label: 'Dispute Defense',     path: '/dispute-defense',          icon: 'shield'       },
          // Auth & Provisioning (dual-assign — also in Operations domain)
          { label: 'Auth Studio',         path: '/auth-studio',              icon: 'shield-check' },
          // Rating
          { label: 'Rating Verification', path: '/rating-verification',      icon: 'check-circle' },
        ],
      },

      // ── 7. Analytics ──────────────────────────────────────────────────────
      //    Scope: commercial reporting, traffic, CDR, revenue
      //    Dual-assigned from: Analytics, Finance domains
      {
        label: 'Analytics',
        icon:  'bar-chart-2',
        items: [
          // Traffic & Forecasting
          { label: 'Traffic Analytics',  path: '/analytics',          icon: 'activity'     },
          { label: 'Traffic Forecast',   path: '/traffic-forecast',   icon: 'trending-up'  },
          // Revenue
          { label: 'Revenue Heatmap',    path: '/revenue-heatmap',    icon: 'bar-chart-2'  },
          { label: 'Margin Intelligence',path: '/margin-intelligence', icon: 'trending-up'  },
          // Reports
          { label: 'Executive Reports',  path: '/executive-reports',  icon: 'file-text'    },
          { label: 'Reports',            path: '/reports',             icon: 'clipboard'    },
          // CDR
          { label: 'CDR Viewer',         path: '/cdrs',               icon: 'history'      },
          { label: 'CDR Rerate',         path: '/cdr-rerate',         icon: 'refresh-cw'   },
        ],
      },

    ],
  },

  // ── Quick Actions — exactly 6 (Section 3 of Dashboard Template) ─────────────
  quickActions: {
    actions: [
      { label: 'Deal Workspace',    path: '/deals',               icon: 'briefcase'    },
      { label: 'Rate Manager',      path: '/rate-manager',        icon: 'trending-up'  },
      { label: 'KAM Dashboard',     path: '/kam-dashboard',       icon: 'users'        },
      { label: 'Margin Intel',      path: '/margin-intelligence', icon: 'brain'        },
      { label: 'LCR Analyser',      path: '/lcr-analyser',        icon: 'route'        },
      { label: 'Product Registry',  path: '/product-registry',    icon: 'layout-grid'  },
    ],
  },

  // ── Workflows — Sections 6 (primary) + 7 (secondary) ────────────────────────
  workflows: {
    primary: [
      {
        label:       'Deal Workspace',
        description: 'Manage commercial deals, pricing proposals, and approvals.',
        path:        '/deals',
        icon:        'briefcase',
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
      { label: 'Active Deals',    dataKey: 'active_deals',    format: 'number'   },
      { label: 'Monthly Revenue', dataKey: 'monthly_revenue', format: 'currency' },
      { label: 'Avg Margin %',    dataKey: 'avg_margin_pct',  format: 'percent'  },
      { label: 'Active Products', dataKey: 'active_products', format: 'number'   },
    ],
    telemetry:        { enabled: false },
    mainWidget:       { componentName: 'DealsOverview', label: 'Deal Pipeline' },
    smartPriorities:  { enabled: true  },
    systemHealth:     { enabled: false },
    operationalFeed:  { enabled: true  },
    riskSection:      { enabled: true,  label: 'Commercial Risk Items' },
  },

  // ── Permissions ──────────────────────────────────────────────────────────────
  permissions: {
    requiredRoles:  ['admin', 'management', 'super_admin'],
    hierarchyScope: 'scoped',
  },
};
