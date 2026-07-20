/**
 * noc.config.ts
 *
 * NOC Portal — Full Feature Assignment (Sprint #368)
 *
 * FROZEN: 2026-07-20. Change control via NOC-FEATURE-ASSIGNMENT-MATRIX.md.
 *
 * All paths reference EXISTING routes registered in App.tsx.
 * No new pages. No new APIs. No new components.
 *
 * Top menu (10 entries — per frozen matrix):
 *   Dashboard | Chat | Live Network | Clients | Vendors | Operations |
 *   BitsEye   | Analytics | Intelligence | Security
 *
 * Exclusions (confirmed by governance doc):
 *   Call Governance · KAM Dashboard · Company List · Approval Queue ·
 *   Approval Rules · Permission Matrix · MFA/2FA · Navigation Manager ·
 *   Revenue Heatmap · CDR Rerate · all Finance/Commercial items
 *
 * Note: /vendor-profile not registered in App.tsx — omitted per governance
 *       principle ("all paths reference existing routes").
 */

import type { PortalConfig } from '../types/portal-config.types';

export const nocPortalConfig: PortalConfig = {
  id:           'noc',
  name:         'NOC Portal',
  badgeLabel:   'NOC',
  accentColor:  'blue',

  // ── Navigation ─────────────────────────────────────────────────────────────
  // 10 top-menu entries per NOC-FEATURE-ASSIGNMENT-MATRIX.md (FROZEN 2026-07-20)
  navigation: {
    entries: [

      // 1. Dashboard — portal home (keep existing)
      {
        label: 'Dashboard',
        path:  '/noc',
      },

      // 2. Chat — operational comms (add)
      {
        label: 'Chat',
        path:  '/chat',
        icon:  'message-circle',
      },

      // 3. Live Network — keep existing + /traffic-map
      {
        label: 'Live Network',
        icon:  'radio',
        items: [
          { label: 'Live Calls',       path: '/calls',            icon: 'phone'       },
          { label: 'Live Traffic',     path: '/live-traffic',     icon: 'trending-up' },
          { label: 'Traffic Map',      path: '/traffic-map',      icon: 'map'         },
          { label: 'Traffic Map Live', path: '/live-traffic-map', icon: 'globe'       },
        ],
      },

      // 4. Clients — NOC-owned technical client features (add)
      {
        label: 'Clients',
        icon:  'building-2',
        items: [
          { label: 'Accounts',        path: '/clients',         icon: 'users'    },
          { label: 'Client Identity', path: '/client-identity', icon: 'shield'   },
          { label: 'DID Inventory',   path: '/dids',            icon: 'hash'     },
        ],
      },

      // 5. Vendors — NOC-owned technical vendor features (add)
      {
        label: 'Vendors',
        icon:  'wifi',
        items: [
          { label: 'Vendors',             path: '/vendors',              icon: 'wifi'         },
          { label: 'Vendor Health',       path: '/vendor-health',        icon: 'heart-pulse'  },
          { label: 'SLA Scorecard',       path: '/vendor-sla-scorecard', icon: 'clipboard'    },
          { label: 'Carrier Scoring',     path: '/carrier-scoring',      icon: 'bar-chart-2'  },
          { label: 'Partner Profiles',    path: '/partner-profiles',     icon: 'handshake'    },
          { label: 'Termination Chains',  path: '/termination-chains',   icon: 'git-branch'   },
        ],
      },

      // 6. Operations — keep existing + confirmed additions (add)
      {
        label: 'Operations',
        icon:  'monitor',
        items: [
          { label: 'NOC Dashboard',    path: '/noc-dashboard',    icon: 'layout-dashboard' },
          { label: 'Incident Command', path: '/noc-incidents',    icon: 'shield-alert'     },
          { label: 'NOC Command',      path: '/noc-command',      icon: 'terminal'         },
          { label: 'Ops Console',      path: '/ops-console',      icon: 'square-terminal'  },
          { label: 'Routing Manager',  path: '/routing-manager',  icon: 'route'            },
          { label: 'Server Monitor',   path: '/server-monitoring',icon: 'server'           },
          { label: 'SBC Monitor',      path: '/sbc-monitor',      icon: 'hard-drive'       },
          { label: 'Multi-Switch',     path: '/multi-switch',     icon: 'layers'           },
          { label: 'Email Centre',     path: '/email-centre',     icon: 'mail'             },
          { label: 'WhatsApp Alerts',  path: '/whatsapp-alerts',  icon: 'message-square'   },
        ],
      },

      // 7. BitsEye — architecture FROZEN; nav entries only (add)
      {
        label: 'BitsEye',
        icon:  'telescope',
        items: [
          { label: 'BitsEye 2.0',             path: '/bitseye2',                 icon: 'telescope'   },
          { label: 'BitsEye Classic',          path: '/bitseye',                  icon: 'eye'         },
          { label: 'RTP / MOS History',        path: '/rtp-analytics',            icon: 'activity'    },
          { label: 'QoS Heatmap',              path: '/qos-heatmap',              icon: 'heart-pulse' },
          { label: 'Vendor Stability',         path: '/vendor-stability-timeline',icon: 'trending-up' },
          { label: 'ASR / ACD',               path: '/asr-acd',                  icon: 'bar-chart-2' },
        ],
      },

      // 8. Analytics — operational analytics only (add; financial excluded)
      {
        label: 'Analytics',
        icon:  'bar-chart-2',
        items: [
          { label: 'Traffic Analytics', path: '/analytics',        icon: 'activity'   },
          { label: 'ASR / ACD',        path: '/asr-acd',          icon: 'bar-chart-2'},
          { label: 'CDR Viewer',        path: '/cdrs',             icon: 'history'    },
          { label: 'Traffic Forecast',  path: '/traffic-forecast', icon: 'trending-up'},
        ],
      },

      // 9. Intelligence — keep existing (add to nav)
      {
        label: 'Intelligence',
        icon:  'brain',
        items: [
          { label: 'AI Ops Center',      path: '/ai-ops',               icon: 'cpu'           },
          { label: 'Intelligence Hub',   path: '/intelligence',          icon: 'brain'         },
          { label: 'Carrier Intel',      path: '/carrier-intelligence',  icon: 'search'        },
          { label: 'Vendor RCA',         path: '/vendor-rca',           icon: 'search'        },
          { label: 'Route Intelligence', path: '/route-intelligence',    icon: 'route'         },
          { label: 'Routing Engine',     path: '/routing-intelligence',  icon: 'git-branch'    },
          { label: 'Cost Optimisation',  path: '/cost-optimisation',     icon: 'trending-down' },
          { label: 'Route Optimisation', path: '/route-optimisation',    icon: 'compass'       },
          { label: 'Traffic Steering',   path: '/traffic-steering',      icon: 'arrow-right-left' },
        ],
      },

      // 10. Security — keep existing (add to nav; admin-only items excluded)
      {
        label: 'Security',
        icon:  'shield-alert',
        items: [
          { label: 'Fraud Engine',    path: '/fraud',           icon: 'shield-alert' },
          { label: 'Firewall',        path: '/firewall',         icon: 'shield'       },
          { label: 'Security Ops',    path: '/security-ops',    icon: 'monitor'      },
          { label: 'SLA Breaches',    path: '/sla-breaches',    icon: 'zap'          },
          { label: 'STIR/SHAKEN',     path: '/stir-shaken',     icon: 'lock'         },
          { label: 'Compliance',      path: '/compliance',       icon: 'check-circle' },
          { label: 'Audit Log',       path: '/audit-log',        icon: 'file-text'    },
          { label: 'Call Recordings', path: '/call-recordings',  icon: 'mic'          },
        ],
      },
    ],
  },

  // ── Quick Actions — Section 3 (fixed, exactly 6) ───────────────────────────
  // Updated from Phase 1 to reflect the full NOC Portal scope.
  quickActions: {
    actions: [
      { label: 'Live Calls',       path: '/calls',         icon: 'phone'          },
      { label: 'NOC Dashboard',    path: '/noc-dashboard', icon: 'monitor'        },
      { label: 'Incident Command', path: '/noc-incidents', icon: 'shield-alert'   },
      { label: 'NOC Command',      path: '/noc-command',   icon: 'terminal'       },
      { label: 'Vendor Health',    path: '/vendor-health', icon: 'heart-pulse'    },
      { label: 'BitsEye 2.0',      path: '/bitseye2',      icon: 'telescope'      },
    ],
  },

  // ── Workflows ──────────────────────────────────────────────────────────────
  workflows: {
    // Section 6: Primary Workflows — 6 highest-priority NOC operations
    primary: [
      {
        label:       'Live Calls',
        description: 'Real-time call table — Ingress, Egress, Routing, All tabs',
        path:        '/calls',
        icon:        'phone',
        status:      'active',
      },
      {
        label:       'NOC Dashboard',
        description: 'Network-wide health: carrier alerts, route status, live KPIs',
        path:        '/noc-dashboard',
        icon:        'monitor',
        status:      'active',
      },
      {
        label:       'Incident Command',
        description: 'Create, assign, and resolve network incidents in real time',
        path:        '/noc-incidents',
        icon:        'shield-alert',
        status:      'active',
      },
      {
        label:       'NOC Command',
        description: 'Block routes, trigger manual failover, issue operational commands',
        path:        '/noc-command',
        icon:        'terminal',
        status:      'active',
      },
      {
        label:       'BitsEye 2.0',
        description: 'Concurrent snapshot engine · geo arc · Q-Score · entity intelligence',
        path:        '/bitseye2',
        icon:        'telescope',
        status:      'active',
      },
      {
        label:       'Vendor Health',
        description: 'Carrier health scores, SLA tracking, and stability timelines',
        path:        '/vendor-health',
        icon:        'heart-pulse',
        status:      'active',
      },
    ],

    // Section 7: Secondary Workflows — next-tier NOC modules (all active)
    secondary: [
      {
        label:       'AI Operations',
        description: 'Anomaly detection, AI-driven incident triage, and data quality',
        path:        '/ai-ops',
        icon:        'cpu',
        status:      'active',
      },
      {
        label:       'Carrier Intelligence',
        description: 'Vendor RCA, route health scoring, and prefix-level signals',
        path:        '/carrier-intelligence',
        icon:        'brain',
        status:      'active',
      },
      {
        label:       'Fraud Engine',
        description: 'FAS / IRSF detection, firewall management, and auto-blacklist',
        path:        '/fraud',
        icon:        'shield',
        status:      'active',
      },
      {
        label:       'Traffic Analytics',
        description: 'ASR, ACD, traffic volume trends, and CDR deep-dive',
        path:        '/analytics',
        icon:        'bar-chart-2',
        status:      'active',
      },
      {
        label:       'Routing Manager',
        description: 'Manage routing groups, destination sets, and QBR policies',
        path:        '/routing-manager',
        icon:        'route',
        status:      'active',
      },
      {
        label:       'Ops Console',
        description: 'Unified operational event log for advanced NOC workflows',
        path:        '/ops-console',
        icon:        'layout-grid',
        status:      'active',
      },
    ],
  },

  // ── Widgets ────────────────────────────────────────────────────────────────
  widgets: {
    // Section 1: KPI Cards — four core NOC metrics
    kpiCards: [
      { label: 'Active Calls', dataKey: 'activeCalls',    format: 'number'   },
      { label: 'CPS',          dataKey: 'callsPerSecond', format: 'number'   },
      { label: 'ASR',          dataKey: 'asr',            format: 'percent'  },
      { label: 'ACD',          dataKey: 'acd',            format: 'duration' },
    ],

    // Section 2: Live Telemetry — total traffic chart + right-panel cards
    telemetry: { enabled: true },

    // Section 4: Main Data Widget — Live Calls table
    mainWidget: {
      componentName: 'CallsListPage',
      label:         'Live Calls',
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
    requiredRoles:  ['admin', 'super_admin', 'noc_operator', 'team_lead', 'management'],
    hierarchyScope: 'global',
  },
};
