/**
 * noc.config.ts
 *
 * NOC Portal — Phase 1 Configuration
 *
 * All paths reference EXISTING routes registered in App.tsx.
 * No new pages. No new APIs. No new components.
 *
 * Phase 1 scope:
 *   Live Operations  → /calls, /live-traffic, /live-traffic-map
 *   Command Center   → /noc-dashboard, /noc-command, /ops-console
 */

import type { PortalConfig } from '../types/portal-config.types';

export const nocPortalConfig: PortalConfig = {
  id: 'noc',
  name: 'NOC Portal',
  badgeLabel: 'NOC',
  accentColor: 'blue',

  // ── Navigation ─────────────────────────────────────────────────────────────
  // Top nav only. No sidebar. Three entries: Dashboard + two dropdown groups.
  navigation: {
    entries: [
      {
        label: 'Dashboard',
        path: '/noc',
      },
      {
        label: 'Live Operations',
        icon: 'activity',
        items: [
          { label: 'Live Calls',   path: '/calls',            icon: 'phone'       },
          { label: 'Live Traffic', path: '/live-traffic',     icon: 'trending-up' },
          { label: 'Traffic Map',  path: '/live-traffic-map', icon: 'map'         },
        ],
      },
      {
        label: 'Command Center',
        icon: 'monitor',
        items: [
          { label: 'NOC Dashboard', path: '/noc-dashboard', icon: 'layout-dashboard' },
          { label: 'NOC Command',   path: '/noc-command',   icon: 'terminal'         },
          { label: 'Ops Console',   path: '/ops-console',   icon: 'square-terminal'  },
        ],
      },
    ],
  },

  // ── Quick Actions — Section 3 (fixed) ─────────────────────────────────────
  // 6 buttons. Same targets as the 6 Primary Workflow modules.
  quickActions: {
    actions: [
      { label: 'Live Calls',    path: '/calls',            icon: 'phone'            },
      { label: 'Live Traffic',  path: '/live-traffic',     icon: 'activity'         },
      { label: 'Traffic Map',   path: '/live-traffic-map', icon: 'map'              },
      { label: 'NOC Dashboard', path: '/noc-dashboard',    icon: 'monitor'          },
      { label: 'NOC Command',   path: '/noc-command',      icon: 'terminal'         },
      { label: 'Ops Console',   path: '/ops-console',      icon: 'layout-grid'      },
    ],
  },

  // ── Workflows ──────────────────────────────────────────────────────────────
  workflows: {
    // Section 6: Primary Workflows — 6 active Phase 1 modules
    primary: [
      {
        label: 'Live Calls',
        description: 'Real-time call table — Ingress, Egress, Routing, All tabs',
        path: '/calls',
        icon: 'phone',
        status: 'active',
      },
      {
        label: 'Live Traffic',
        description: 'Traffic volume and carrier breakdown in real time',
        path: '/live-traffic',
        icon: 'activity',
        status: 'active',
      },
      {
        label: 'Traffic Map',
        description: 'Geographic visualisation of active call traffic',
        path: '/live-traffic-map',
        icon: 'map',
        status: 'active',
      },
      {
        label: 'NOC Dashboard',
        description: 'Top-level operational view: carrier alerts, route health, KPIs',
        path: '/noc-dashboard',
        icon: 'monitor',
        status: 'active',
      },
      {
        label: 'NOC Command',
        description: 'Block routes, reroute, and trigger manual failover',
        path: '/noc-command',
        icon: 'terminal',
        status: 'active',
      },
      {
        label: 'Ops Console',
        description: 'Raw operational event log for advanced NOC use',
        path: '/ops-console',
        icon: 'layout-grid',
        status: 'active',
      },
    ],

    // Section 7: Secondary Workflows — visible but greyed out, communicates roadmap
    secondary: [
      { label: 'AI Operations',        description: 'AI-powered operations intelligence',       path: '#', icon: 'cpu',         status: 'coming-soon' },
      { label: 'Carrier Intelligence', description: 'Carrier performance and vendor analysis',  path: '#', icon: 'bar-chart-2', status: 'coming-soon' },
      { label: 'Fraud Engine',         description: 'FAS detection and prevention',            path: '#', icon: 'shield',      status: 'coming-soon' },
      { label: 'Diagnostics',          description: 'Call tracing, simulation, replay engine', path: '#', icon: 'wrench',      status: 'coming-soon' },
      { label: 'Reporting',            description: 'Scheduled and ad-hoc reports',            path: '#', icon: 'file-text',   status: 'coming-soon' },
      { label: 'Analytics',            description: 'Business intelligence and trend analysis', path: '#', icon: 'trending-up', status: 'coming-soon' },
    ],
  },

  // ── Widgets ────────────────────────────────────────────────────────────────
  widgets: {
    // Section 1: KPI Cards — four operational metrics
    kpiCards: [
      { label: 'Active Calls', dataKey: 'activeCalls',    format: 'number'   },
      { label: 'CPS',          dataKey: 'callsPerSecond', format: 'number'   },
      { label: 'ASR',          dataKey: 'asr',            format: 'percent'  },
      { label: 'ACD',          dataKey: 'acd',            format: 'duration' },
    ],

    // Section 2: Live Telemetry — total traffic chart + right-panel cards
    telemetry: { enabled: true },

    // Section 4: Main Data Widget — NOC = Live Calls table
    mainWidget: {
      componentName: 'CallsListPage', // existing page at /calls
      label: 'Live Calls',
    },

    // Section 5: Smart Priorities
    smartPriorities: { enabled: true },

    // Section 8: System Health
    systemHealth: { enabled: true },

    // Section 9: Live Operational Feed
    operationalFeed: { enabled: true },

    // Section 10: Risk & Exceptions
    riskSection: { enabled: true, label: 'Risk Destinations' },
  },

  // ── Permissions ────────────────────────────────────────────────────────────
  permissions: {
    requiredRoles: ['admin', 'super_admin', 'noc_operator', 'team_lead', 'management'],
    hierarchyScope: 'global', // NOC sees all data — no hierarchy filtering
  },
};
