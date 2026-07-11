# Platform Feature Inventory

> **Project:** Platform Feature Rationalization (PFR) — Phase 1 Discovery
> **Generated:** 2026-07-11 · extracted programmatically from `SIDEBAR_GROUPS` (client/src/components/layout-shell.tsx), routes (client/src/App.tsx), and per-page `/api/` usage.
> **Scope:** Documentation only. No feature has been changed, hidden, or deactivated.
>
> **Registry facts:** 111 registered features · 109 configurable in Navigation Manager · 2 always-visible (locked).

## Status legend

| Status | Meaning |
|---|---|
| Registered | Route + page component exist; runtime verification pending |
| Planned | Marked `status: 'planned'` in the registry (SOON badge) |
| No backend calls | Page makes zero `/api/` calls — possible placeholder |

## Master index

| ID | Feature | Group | Path | Page component | Page size (LOC) | Backend APIs (count) | Flags |
|---|---|---|---|---|---|---|---|
| PF-001 | Live Calls | Live Call Monitoring | `/calls` | `calls-list` | 2288 | 12 | LIVE |
| PF-002 | Alerts | Alerting | `/alerts` | `alerts` | 637 | 3 |  |
| PF-003 | NOC Dashboard | NOC Operations | `/noc-dashboard` | `noc-dashboard` | 2019 | 17 | NEW |
| PF-004 | Incident Command | Incident Management | `/noc-incidents` | `noc-incidents` | 650 | 2 | NEW |
| PF-005 | Route Intelligence | Routing Recommendations | `/route-intelligence` | `route-intelligence` | 6292 | 32 | NEW |
| PF-006 | NOC Command | NOC Operations | `/noc-command` | `noc-command` | 553 | 7 |  |
| PF-007 | Ops Console | NOC Operations | `/ops-console` | `ops-console` | 877 | 10 | NEW |
| PF-008 | Console | Incident Management | `/console` | `console` | 1078 | 3 | NEW |
| PF-009 | BitsEye 2 | Unified Analytics | `/bitseye2` | `bitseye2` | 3469 | 14 |  |
| PF-010 | Live Traffic | Live Call Monitoring | `/live-traffic` | `live-traffic` | 271 | 1 | NEW |
| PF-011 | Traffic Map | Live Call Monitoring | `/traffic-map` | `traffic-map` | 617 | 2 |  |
| PF-012 | Graphs | Performance Charts | `/graphs` | `graphs` | 2011 | 12 |  |
| PF-013 | Multi-Switch View | Live Network | `/multi-switch` | `multi-switch` | 945 | 3 |  |
| PF-014 | Server Monitor | Live Network | `/server-monitoring` | `server-monitoring` | 1848 | 13 |  |
| PF-015 | Server Health | Live Network | `/server-health` | `server-health` | 614 | 5 | NEW |
| PF-016 | SBC Monitor | Live Network | `/sbc-monitor` | `sbc-monitor` | 453 | 2 |  |
| PF-017 | Network Topology | Live Network | `/network-topology` | `network-topology` | 753 | 4 | NEW |
| PF-018 | Accounts | Company | `/clients` | `clients` | 3870 | 21 |  |
| PF-019 | Client Portal | Company | `/client-portal` | `client-portal` | 878 | 8 |  |
| PF-020 | Reseller Management | Company | `/reseller` | `reseller` | 728 | 2 |  |
| PF-021 | Company List | Company | `/company/list` | `company-list` | 2048 | 14 |  |
| PF-022 | Organization Mgmt | Company | `/company-profile` | `company-profile` | 565 | 5 |  |
| PF-023 | Create Account | Company | `/client/wizard` | `client-wizard` | 1484 | 5 |  |
| PF-024 | Onboarding Wizard | Company | `/company/onboarding` | `company-onboarding` | 937 | 3 | NEW |
| PF-025 | Account Names | Company | `/account-names` | `account-names` | 554 | 4 |  |
| PF-026 | DID Management | Company | `/dids` | `dids` | 424 | 3 |  |
| PF-027 | Recordings | Company | `/call-recordings` | `call-recordings` | 479 | 2 |  |
| PF-028 | Products | Company | `/products` | `products` | 1496 | 3 |  |
| PF-029 | Vendor List | Carrier Management | `/vendors` | `vendors` | 1486 | 3 |  |
| PF-030 | SLA Scorecard | Carrier SLA | `/vendor-sla-scorecard` | `vendor-sla-scorecard` | 556 | 2 |  |
| PF-031 | Carrier Scoring | Carrier Performance | `/carrier-scoring` | `carrier-scoring` | 818 | 4 | NEW |
| PF-032 | Stability Timeline | Carrier Performance | `/vendor-stability-timeline` | `vendor-stability-timeline` | 413 | 1 | NEW |
| PF-033 | Balance Monitor | Carrier Finance | `/balance` | `balance-monitor` | 1849 | 11 |  |
| PF-034 | Routing Manager | Routing Configuration | `/routing-manager` | `routing-manager` | 5283 | 20 |  |
| PF-035 | LCR Analyser | Routing Analysis | `/lcr-analyser` | `lcr-analyser` | 467 | 2 |  |
| PF-036 | Route Simulator | Routing Validation | `/call-flow-simulator` | `call-flow-simulator` | 749 | 3 |  |
| PF-037 | Failover Engine | Operations | `/self-heal` | `self-heal` | 1281 | 9 | NEW |
| PF-038 | Route Tester | Routing Validation | `/test-call` | `test-call` | 723 | 4 |  |
| PF-039 | SIP Trace | Operations | `/sip-trace` | `sip-trace` | 1379 | 2 | NEW |
| PF-040 | Replay Engine | Operations | `/replay` | `replay` | 760 | 1 | NEW |
| PF-041 | Test Campaigns | Operations | `/test-campaigns` | `test-campaigns` | 838 | 3 |  |
| PF-042 | Tools | Operations | `/tools` | `tools` | 1704 | 6 |  |
| PF-043 | Traffic Analytics | Traffic Analytics | `/analytics` | `analytics` | 1026 | 4 |  |
| PF-044 | ASR / ACD | Traffic Analytics | `/asr-acd` | `asr-acd-report` | 1181 | 3 | NEW |
| PF-045 | QoS Heatmap | Media Quality | `/qos-heatmap` | `qos-heatmap` | 176 | 1 |  |
| PF-046 | Codec Analytics | Media Quality | `/codec-analytics` | `codec-analytics` | 291 | 1 | NEW |
| PF-047 | RTP Analytics | Media Quality | `/rtp-analytics` | `rtp-analytics` | 389 | 1 |  |
| PF-048 | Revenue Heatmap | Revenue Analytics | `/revenue-heatmap` | `revenue-heatmap` | 674 | 2 | NEW |
| PF-049 | Reports | Reporting | `/reports` | `reports` | 1801 | 8 |  |
| PF-050 | Traffic Forecast | Analytics & Reports | `/traffic-forecast` | `traffic-forecast` | 386 | 1 | NEW |
| PF-051 | CDR Viewer | Analytics & Reports | `/cdrs` | `cdrs` | 911 | 2 |  |
| PF-052 | BitsEye | Unified Analytics | `/bitseye` | `bitseye` | 2815 | 8 |  |
| PF-053 | AI Ops Center | AI Decisioning | `/ai-ops` | `ai-ops` | 2552 | 23 | NEW |
| PF-054 | Intelligence Hub | AI Decisioning | `/intelligence` | `intelligence` | 789 | 1 | NEW |
| PF-055 | Decision Overlay | AI Decisioning | `/ai-ops?tab=decision-overlay` | `ai-ops` | 2552 | 23 | NEW |
| PF-056 | Validation Console | AI Validation | `/intelligence-validation` | `intelligence-validation` | 689 | 2 | NEW |
| PF-057 | Carrier Intelligence | Carrier Performance | `/carrier-intelligence` | `carrier-intelligence` | 678 | 2 | NEW |
| PF-058 | Vendor RCA | Carrier Diagnostics | `/vendor-rca` | `vendor-rca` | 143 | 1 | NEW |
| PF-059 | Prefix Intelligence | Prefix Analysis | `/vendor-prefix-intelligence` | `vendor-prefix-intelligence` | 450 | 1 | NEW |
| PF-060 | Routing Intelligence | Routing Recommendations | `/routing-intelligence` | `routing-intelligence` | 562 | 4 | NEW |
| PF-061 | Number Intelligence | Number Analysis | `/number-intelligence` | `number-intelligence` | 606 | 2 |  |
| PF-062 | Cost Optimisation | Cost Recommendations | `/cost-optimisation` | `cost-optimisation` | 439 | 1 |  |
| PF-063 | Route Optimisation | Routing Recommendations | `/route-optimisation` | `route-optimisation` | 1085 | 7 | NEW |
| PF-064 | Traffic Steering | Traffic Steering | `/traffic-steering` | `traffic-steering` | 416 | 4 | NEW |
| PF-065 | Simulation Sandbox | AI Validation | `/simulation-sandbox` | `simulation-sandbox` | 396 | 2 | NEW |
| PF-066 | Fraud Engine | Security & Compliance | `/fraud` | `fraud` | 1244 | 13 |  |
| PF-067 | Firewall Manager | Security & Compliance | `/firewall` | `firewall` | 537 | 4 |  |
| PF-068 | SLA Breaches | Security & Compliance | `/sla-breaches` | `sla-breaches` | 202 | 1 |  |
| PF-069 | Approval Queue | Change Approval | `/approvals` | `approval-queue` | 609 | 3 | LIVE |
| PF-070 | Approval Rules | Change Approval | `/approval-settings` | `approval-settings` | 417 | 1 |  |
| PF-071 | STIR/SHAKEN | Security & Compliance | `/stir-shaken` | `stir-shaken` | 528 | 1 |  |
| PF-072 | Compliance | Compliance | `/compliance` | `compliance` | 494 | 1 |  |
| PF-073 | Audit Log | Audit Trail | `/audit-log` | `audit-log` | 372 | 2 | NEW |
| PF-074 | Permission Matrix | Security & Compliance | `/rbac` | `rbac-matrix` | 535 | 5 | NEW |
| PF-075 | MFA / 2FA | Security & Compliance | `/mfa-setup` | `mfa-setup` | 262 | 4 | NEW |
| PF-076 | Security Ops | Security & Compliance | `/security-ops` | `security-ops` | 421 | 7 | NEW |
| PF-077 | Billing | Finance & Billing | `/billing` | `billing` | 346 | 2 |  |
| PF-078 | Billing Disputes | Finance & Billing | `/billing-disputes` | `billing-disputes` | 292 | 2 |  |
| PF-079 | Invoices | Finance & Billing | `/invoices` | `invoices` | 1480 | 11 |  |
| PF-080 | Invoice Queue | Finance & Billing | `/invoice-jobs` | `invoice-jobs` | 392 | 3 |  |
| PF-081 | Invoice Templates | Finance & Billing | `/invoice-templates` | `invoice-templates` | 423 | 4 |  |
| PF-082 | Credit Notes | Finance & Billing | `/credit-notes` | `credit-notes` | 347 | 2 |  |
| PF-083 | Credit Control | Finance & Billing | `/credit-control` | `credit-control` | 394 | 4 |  |
| PF-084 | Dispute Cases | Finance & Billing | `/dispute-cases` | `dispute-cases` | 547 | 2 |  |
| PF-085 | Dispute Defense | Finance & Billing | `/dispute-defense` | `dispute-defense` | 297 | 1 |  |
| PF-086 | Client Reconciliation | Reconciliation | `/client-reconciliation` | `client-reconciliation` | 1384 | 12 |  |
| PF-087 | Carrier Reconciliation | Reconciliation | `/carrier-reconciliation` | `carrier-reconciliation` | 1282 | 12 |  |
| PF-088 | Margin Intelligence | Margin Analytics | `/margin-intelligence` | `margin-intelligence` | 453 | 10 |  |
| PF-089 | Daily Minutes Report | Finance & Billing | `/dmr` | `dmr` | 465 | 4 |  |
| PF-090 | AI Assurance | Financial Assurance | `/ai-assurance` | `ai-assurance` | 412 | 4 |  |
| PF-091 | Partner Portal | Finance & Billing | `/partner-profiles` | `partner-profiles` | 264 | 2 |  |
| PF-092 | Rate Cards | Commercial Rates | `/rate-cards` | `rate-cards` | 1450 | 9 |  |
| PF-093 | Executive Reports | Finance & Billing | `/executive-reports` | `executive-reports` | 251 | 3 |  |
| PF-094 | Platform Settings | Platform | `/settings` | `settings` | 3987 | 49 |  |
| PF-095 | Team & KAM | Platform | `/team` | `team` | 2753 | 14 |  |
| PF-096 | API Keys | Platform | `/api-keys` | `api-keys` | 340 | 2 |  |
| PF-097 | VPN Config | Platform | `/vpn-config` | `vpn-config` | 458 | 0 | PLACEHOLDER-CANDIDATE |
| PF-098 | Tariff Versions | Rating Lifecycle | `/tariff-versions` | `tariff-versions` | 486 | 5 |  |
| PF-099 | Rating Verification | Rating Lifecycle | `/rating-verification` | `rating-verification` | 513 | 5 |  |
| PF-100 | Rating Snapshots | Rating Lifecycle | `/rating-snapshots` | `rating-snapshots` | 560 | 6 |  |
| PF-101 | Comm. Policies | Platform | `/communication-policies` | `communication-policies` | 541 | 3 |  |
| PF-102 | Commercial Notices | Notifications | `/commercial-notifications` | `commercial-notifications` | 825 | 4 |  |
| PF-103 | Sender Profiles | Notifications | `/sender-profiles` | `sender-profiles` | 488 | 2 |  |
| PF-104 | Notifications | Notifications | `/email-centre` | `email-centre` | 731 | 4 |  |
| PF-105 | Notification Centre | Notifications | `/notification-centre` | `notification-centre` | 1092 | 3 |  |
| PF-106 | WhatsApp Alerts | Notifications | `/whatsapp-alerts` | `whatsapp-alerts` | 449 | 3 |  |
| PF-107 | SMS / A2P | Platform | `/sms-monitor` | `sms-monitor` | 2342 | 19 | PLANNED |
| PF-108 | Workspace Settings | Platform | `/workspace-settings` | `workspace-settings` | 321 | 2 |  |
| PF-109 | Navigation Manager | Platform | `/navigation-manager` | `sidebar-settings` | 359 | 1 | LOCKED |
| PF-110 | Governance Console | Platform | `/governance` | `navigation-governance` | 1174 | 12 |  |
| PF-111 | My Account | Platform | `/account` | `account` | 351 | 1 | LOCKED |

## Per-feature detail

### PF-001 — Live Calls

- **Group:** Live Network (`live_network`)
- **Path:** `/calls`
- **Page:** `client/src/pages/calls-list` (2288 LOC)
- **Roles:** admin, management, viewer, super_admin, noc_operator, team_lead
- **Registry status:** live
- **Business capability:** Live Call Monitoring
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (12):** `/api/account-state`, `/api/call-history`, `/api/call-history/route-quality`, `/api/ip-lookup`, `/api/sippy/calls/`, `/api/sippy/calls/terminate-pattern`, `/api/sippy/live-calls`, `/api/sippy/live-calls/fraud-watch`, `/api/sippy/session`, `/api/switches`, `/api/switches/`, `/api/user/assigned-accounts`
- **Write operations:** `POST /api/sippy/calls/`, `POST /api/sippy/calls/terminate-pattern`
- **Shares endpoints with:** Accounts (3), Platform Settings (3), NOC Dashboard (2), Multi-Switch View (2), NOC Command (1), Ops Console (1), +8 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-002 — Alerts

- **Group:** Live Network (`live_network`)
- **Path:** `/alerts`
- **Page:** `client/src/pages/alerts` (637 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager, routing_admin
- **Business capability:** Alerting
- **System of record (primary API namespace):** `/api/alerts` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/alerts`
- **Backend APIs (3):** `/api/alerts`, `/api/alerts/`, `/api/anomalies`
- **Write operations:** `POST /api/alerts/`
- **Shares endpoints with:** NOC Command (3), Ops Console (3), NOC Dashboard (1), BitsEye 2 (1), AI Ops Center (1), Decision Overlay (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-003 — NOC Dashboard

- **Group:** Live Network (`live_network`)
- **Path:** `/noc-dashboard`
- **Page:** `client/src/pages/noc-dashboard` (2019 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Badge:** NEW
- **Business capability:** NOC Operations
- **System of record (primary API namespace):** `/api/noc` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/noc`
- **Backend APIs (17):** `/api/ai/route-copilot/apply`, `/api/ai/route-copilot/execution-mode`, `/api/ai/route-copilot/summary`, `/api/alerts`, `/api/carrier-scores`, `/api/incidents`, `/api/noc/balance-alerts`, `/api/noc/cap-alerts`, `/api/noc/cap-alerts/refresh-caps`, `/api/noc/incidents`, `/api/noc/incidents/`, `/api/noc/vendor-health-alerts`, `/api/recommendations`, `/api/server-health/current`, `/api/sippy/live-calls`, `/api/sippy/live-calls/fraud-watch`, `/api/system/ssl-status`
- **Write operations:** `PATCH /api/noc/incidents/`, `POST /api/ai/route-copilot/apply`, `POST /api/noc/cap-alerts/refresh-caps`
- **Shares endpoints with:** Route Intelligence (6), NOC Command (3), Ops Console (3), Live Calls (2), Incident Command (2), Network Topology (2), +9 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-004 — Incident Command

- **Group:** Live Network (`live_network`)
- **Path:** `/noc-incidents`
- **Page:** `client/src/pages/noc-incidents` (650 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Badge:** NEW
- **Business capability:** Incident Management
- **System of record (primary API namespace):** `/api/noc` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** NOC Dashboard (this feature is a consumer)
- **Backend APIs (2):** `/api/noc/incidents`, `/api/noc/incidents/`
- **Write operations:** `PATCH /api/noc/incidents/`, `POST /api/noc/incidents`, `POST /api/noc/incidents/`
- **Shares endpoints with:** NOC Dashboard (2), Route Intelligence (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-005 — Route Intelligence

- **Group:** Live Network (`live_network`)
- **Path:** `/route-intelligence`
- **Page:** `client/src/pages/route-intelligence` (6292 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Badge:** NEW
- **Business capability:** Routing Recommendations
- **System of record (primary API namespace):** `/api/ai` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/ai`
- **Backend APIs (32):** `/api/ai/actions/`, `/api/ai/actions/expired`, `/api/ai/actions/pending`, `/api/ai/route-copilot/action-history`, `/api/ai/route-copilot/applied-actions`, `/api/ai/route-copilot/apply`, `/api/ai/route-copilot/cached`, `/api/ai/route-copilot/execution-mode`, `/api/ai/route-copilot/rollback-summary`, `/api/ai/route-copilot/rollback/`, `/api/ai/route-copilot/settings`, `/api/ai/route-copilot/summary`, `/api/ai/route-recommendations`, `/api/carrier-scores`, `/api/carrier-scores/recompute`, `/api/copilot/rtp-quality`, `/api/copilot/rtp-quality/history`, `/api/copilot/rtp-quality/slot-cdrs`, `/api/copilot/rtp-quality/trigger`, `/api/copilot/sip-error-history`, `/api/copilot/sip-errors`, `/api/noc/incidents`, `/api/recommendations`, `/api/route-intelligence/last-updated`, `/api/route-intelligence/sip-errors`, `/api/route-intelligence/sip-errors/count`, `/api/route-intelligence/sip-errors/export`, `/api/route-intelligence/trigger`, `/api/route-intelligence/vendor`, `/api/route-intelligence/vendor-compare/trend`, `/api/route-intelligence/vendor-summary`, `/api/route-intelligence/vendor/`
- **Write operations:** `POST /api/ai/actions/`, `POST /api/ai/route-copilot/apply`, `POST /api/ai/route-copilot/rollback/`, `POST /api/ai/route-recommendations`, `POST /api/carrier-scores/recompute`, `POST /api/copilot/rtp-quality/trigger`, `POST /api/route-intelligence/trigger`, `PUT /api/ai/route-copilot/settings`
- **Shares endpoints with:** NOC Dashboard (6), Carrier Scoring (2), AI Ops Center (2), Decision Overlay (2), Incident Command (1), NOC Command (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-006 — NOC Command

- **Group:** Live Network (`live_network`)
- **Path:** `/noc-command`
- **Page:** `client/src/pages/noc-command` (553 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Business capability:** NOC Operations
- **System of record (primary API namespace):** `/api/alerts` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Alerts (this feature is a consumer)
- **Backend APIs (7):** `/api/aiops/incidents`, `/api/alerts`, `/api/alerts/`, `/api/anomalies`, `/api/carrier-scores`, `/api/sippy/live-calls`, `/api/vendors/current-balances`
- **Write operations:** `POST /api/alerts/`
- **Shares endpoints with:** Ops Console (7), Alerts (3), NOC Dashboard (3), BitsEye 2 (2), Network Topology (2), AI Ops Center (2), +6 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-007 — Ops Console

- **Group:** Live Network (`live_network`)
- **Path:** `/ops-console`
- **Page:** `client/src/pages/ops-console` (877 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Badge:** NEW
- **Business capability:** NOC Operations
- **System of record (primary API namespace):** `/api/alerts` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Alerts (this feature is a consumer)
- **Backend APIs (10):** `/api/aiops/incidents`, `/api/alerts`, `/api/alerts/`, `/api/anomalies`, `/api/carrier-scores`, `/api/cdr-cache/vendor-summary`, `/api/entity-timeline`, `/api/sippy/live-calls`, `/api/vendors/balance-history`, `/api/vendors/current-balances`
- **Write operations:** `POST /api/alerts/`
- **Shares endpoints with:** NOC Command (7), Alerts (3), NOC Dashboard (3), BitsEye 2 (2), Network Topology (2), AI Ops Center (2), +6 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-008 — Console

- **Group:** Live Network (`live_network`)
- **Path:** `/console`
- **Page:** `client/src/pages/console` (1078 LOC)
- **Roles:** admin, management, noc_operator, team_lead, super_admin
- **Badge:** NEW
- **Business capability:** Incident Management
- **System of record (primary API namespace):** `/api/console` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/console`
- **Backend APIs (3):** `/api/console/incidents`, `/api/console/incidents/`, `/api/console/replay`
- **Write operations:** `POST /api/console/incidents/`
- **Shares endpoints with:** Notification Centre (2)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-009 — BitsEye 2

- **Group:** Live Network (`live_network`)
- **Path:** `/bitseye2`
- **Page:** `client/src/pages/bitseye2` (3469 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Business capability:** Unified Analytics
- **System of record (primary API namespace):** `/api/bitseye` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/bitseye`
- **Backend APIs (14):** `/api/anomalies`, `/api/bitseye/alerts`, `/api/bitseye/concurrent-trend`, `/api/bitseye/destination-lookup`, `/api/bitseye/entity-detail`, `/api/bitseye/entity-history`, `/api/bitseye/kam-live`, `/api/bitseye/live-slice`, `/api/bitseye/live-summary`, `/api/bitseye/traffic-events`, `/api/incidents/`, `/api/monitoring/alert-rules`, `/api/monitoring/alert-rules/`, `/api/sippy/live-calls`
- **Write operations:** `DELETE /api/monitoring/alert-rules/`, `PATCH /api/incidents/`, `PATCH /api/monitoring/alert-rules/`, `POST /api/monitoring/alert-rules`
- **Shares endpoints with:** NOC Command (2), Ops Console (2), Server Monitor (2), BitsEye (2), Live Calls (1), Alerts (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-010 — Live Traffic

- **Group:** Live Network (`live_network`)
- **Path:** `/live-traffic`
- **Page:** `client/src/pages/live-traffic` (271 LOC)
- **Roles:** admin, management, noc_operator, viewer, team_lead, super_admin
- **Badge:** NEW
- **Business capability:** Live Call Monitoring
- **System of record (primary API namespace):** `/api/live-traffic` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/live-traffic`
- **Backend APIs (1):** `/api/live-traffic/snapshot`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-011 — Traffic Map

- **Group:** Live Network (`live_network`)
- **Path:** `/traffic-map`
- **Page:** `client/src/pages/traffic-map` (617 LOC)
- **Roles:** admin, management
- **Business capability:** Live Call Monitoring
- **System of record (primary API namespace):** `/api/geo` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/geo`
- **Backend APIs (2):** `/api/geo/world`, `/api/traffic-map`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-012 — Graphs

- **Group:** Live Network (`live_network`)
- **Path:** `/graphs`
- **Page:** `client/src/pages/graphs` (2011 LOC)
- **Roles:** admin, management
- **Business capability:** Performance Charts
- **System of record (primary API namespace):** `/api/kam` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/kam`
- **Backend APIs (12):** `/api/bitseye/per-entity`, `/api/kam`, `/api/kam/`, `/api/kam/accounts/`, `/api/mos-carrier-stats`, `/api/mos-trending`, `/api/quality-events`, `/api/sippy/live-graphs`, `/api/traffic-alerts`, `/api/traffic-anomalies`, `/api/traffic-baselines`, `/api/user/assigned-accounts`
- **Write operations:** `DELETE /api/kam/`, `DELETE /api/kam/accounts/`, `PATCH /api/kam/`, `POST /api/kam`, `POST /api/kam/`
- **Shares endpoints with:** Team & KAM (5), Account Names (3), BitsEye (2), Notifications (2), Live Calls (1), Company List (1), +2 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-013 — Multi-Switch View

- **Group:** Live Network (`live_network`)
- **Path:** `/multi-switch`
- **Page:** `client/src/pages/multi-switch` (945 LOC)
- **Roles:** admin, management
- **Business capability:** Live Network
- **System of record (primary API namespace):** `/api/switches` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/switches`
- **Backend APIs (3):** `/api/switches`, `/api/switches/`, `/api/switches/consolidated`
- **Write operations:** `DELETE /api/switches/`, `PATCH /api/switches/`, `POST /api/switches`, `POST /api/switches/`
- **Shares endpoints with:** Live Calls (2), Platform Settings (2), Accounts (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-014 — Server Monitor

- **Group:** Live Network (`live_network`)
- **Path:** `/server-monitoring`
- **Page:** `client/src/pages/server-monitoring` (1848 LOC)
- **Roles:** admin, management
- **Business capability:** Live Network
- **System of record (primary API namespace):** `/api/monitoring` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/monitoring`
- **Backend APIs (13):** `/api/monitoring/alert-rules`, `/api/monitoring/alert-rules/`, `/api/monitoring/bandwidth`, `/api/monitoring/carrier-asr`, `/api/monitoring/diagnostics`, `/api/monitoring/disk-memory`, `/api/monitoring/hosts`, `/api/monitoring/hosts/`, `/api/monitoring/hosts/outages/all`, `/api/monitoring/registrations`, `/api/monitoring/sip-options`, `/api/monitoring/status`, `/api/settings`
- **Write operations:** `DELETE /api/monitoring/alert-rules/`, `DELETE /api/monitoring/hosts/`, `PATCH /api/monitoring/alert-rules/`, `POST /api/monitoring/alert-rules`, `POST /api/monitoring/hosts`, `PUT /api/monitoring/hosts/`
- **Shares endpoints with:** BitsEye 2 (2), Route Tester (1), Team & KAM (1), WhatsApp Alerts (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-015 — Server Health

- **Group:** Live Network (`live_network`)
- **Path:** `/server-health`
- **Page:** `client/src/pages/server-health` (614 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Live Network
- **System of record (primary API namespace):** `/api/server-health` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/server-health`
- **Backend APIs (5):** `/api/server-health/cleanup-execute`, `/api/server-health/cleanup-preview`, `/api/server-health/current`, `/api/server-health/history`, `/api/server-health/refresh`
- **Write operations:** `POST /api/server-health/cleanup-execute`, `POST /api/server-health/refresh`
- **Shares endpoints with:** NOC Dashboard (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-016 — SBC Monitor

- **Group:** Live Network (`live_network`)
- **Path:** `/sbc-monitor`
- **Page:** `client/src/pages/sbc-monitor` (453 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Business capability:** Live Network
- **System of record (primary API namespace):** `/api/sbc-hosts` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/sbc-hosts`
- **Backend APIs (2):** `/api/sbc-hosts`, `/api/sbc-hosts/`
- **Write operations:** `DELETE /api/sbc-hosts/`, `POST /api/sbc-hosts`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-017 — Network Topology

- **Group:** Live Network (`live_network`)
- **Path:** `/network-topology`
- **Page:** `client/src/pages/network-topology` (753 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Live Network
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (4):** `/api/carrier-scores`, `/api/fas-events`, `/api/sippy/live-calls`, `/api/sippy/vendors`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** NOC Dashboard (2), NOC Command (2), Ops Console (2), Live Calls (1), Route Intelligence (1), BitsEye 2 (1), +8 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-018 — Accounts

- **Group:** Company (`company`)
- **Path:** `/clients`
- **Page:** `client/src/pages/clients` (3870 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/sippy`
- **Backend APIs (21):** `/api/account-state`, `/api/account-state/history`, `/api/clients`, `/api/clients/`, `/api/portal/push-rate`, `/api/sippy/accounts`, `/api/sippy/accounts/`, `/api/sippy/auth-rules/`, `/api/sippy/billing-plans`, `/api/sippy/circuit-reset`, `/api/sippy/connections/`, `/api/sippy/dictionaries/currencies`, `/api/sippy/dictionaries/timezones`, `/api/sippy/per-account-stats`, `/api/sippy/routing-groups`, `/api/sippy/service-plans/create`, `/api/sippy/session`, `/api/sippy/tariffs`, `/api/sippy/vendors`, `/api/sippy/vendors/`, `/api/switches`
- **Write operations:** `DELETE /api/clients/`, `DELETE /api/sippy/auth-rules/`, `DELETE /api/sippy/connections/`, `PATCH /api/clients/`, `PATCH /api/sippy/accounts/`, `PATCH /api/sippy/auth-rules/`, `PATCH /api/sippy/connections/`, `POST /api/clients`, `POST /api/clients/`, `POST /api/portal/push-rate`, `POST /api/sippy/accounts`, `POST /api/sippy/accounts/`, `POST /api/sippy/service-plans/create`, `POST /api/sippy/vendors/`
- **Shares endpoints with:** Routing Manager (4), Live Calls (3), Organization Mgmt (3), Vendor List (3), Reports (3), Create Account (2), +22 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-019 — Client Portal

- **Group:** Company (`company`)
- **Path:** `/client-portal`
- **Page:** `client/src/pages/client-portal` (878 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (8):** `/api/admin/portal/tickets`, `/api/admin/portal/tickets/`, `/api/portal-tokens`, `/api/portal-tokens/`, `/api/sippy/account-balance`, `/api/sippy/account-balance/`, `/api/sippy/accounts`, `/api/sippy/cdr`
- **Write operations:** `DELETE /api/portal-tokens/`, `PATCH /api/admin/portal/tickets/`, `POST /api/admin/portal/tickets/`, `POST /api/portal-tokens`
- **Shares endpoints with:** Accounts (1), DID Management (1), Products (1), Route Simulator (1), Route Tester (1), Tools (1), +5 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-020 — Reseller Management

- **Group:** Company (`company`)
- **Path:** `/reseller`
- **Page:** `client/src/pages/reseller` (728 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/resellers` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/resellers`
- **Backend APIs (2):** `/api/resellers`, `/api/resellers/`
- **Write operations:** `DELETE /api/resellers/`, `PATCH /api/resellers/`, `POST /api/resellers`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-021 — Company List

- **Group:** Company (`company`)
- **Path:** `/company/list`
- **Page:** `client/src/pages/company-list` (2048 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (14):** `/api/client-ip-requests`, `/api/client-ip-requests/`, `/api/client-ip-requests/bulk`, `/api/companies`, `/api/companies/`, `/api/ip-sharing-approvals`, `/api/ip-sharing-approvals/`, `/api/kam`, `/api/products`, `/api/sippy/pre-provision-check`, `/api/sippy/sync/execute`, `/api/sippy/sync/import`, `/api/sippy/sync/link`, `/api/sippy/sync/preview`
- **Write operations:** `DELETE /api/companies/`, `PATCH /api/client-ip-requests/`, `POST /api/client-ip-requests`, `POST /api/client-ip-requests/bulk`, `POST /api/companies/`, `POST /api/ip-sharing-approvals/`, `POST /api/sippy/sync/execute`, `POST /api/sippy/sync/import`, `POST /api/sippy/sync/link`
- **Shares endpoints with:** Onboarding Wizard (3), Create Account (2), Graphs (1), Organization Mgmt (1), Account Names (1), BitsEye (1), +3 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-022 — Organization Mgmt

- **Group:** Company (`company`)
- **Path:** `/company-profile`
- **Page:** `client/src/pages/company-profile` (565 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (5):** `/api/companies`, `/api/sippy/billing-plans`, `/api/sippy/company-profile/setup`, `/api/sippy/session`, `/api/sippy/tariffs`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Accounts (3), Create Account (2), Invoices (2), Live Calls (1), Company List (1), Onboarding Wizard (1), +7 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-023 — Create Account

- **Group:** Company (`company`)
- **Path:** `/client/wizard`
- **Page:** `client/src/pages/client-wizard` (1484 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (5):** `/api/client-ip-requests`, `/api/client-wizard/submit`, `/api/companies`, `/api/sippy/billing-plans`, `/api/sippy/routing-groups`
- **Write operations:** `POST /api/client-ip-requests`, `POST /api/client-wizard/submit`
- **Shares endpoints with:** Accounts (2), Company List (2), Organization Mgmt (2), Onboarding Wizard (1), Routing Manager (1), Invoices (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-024 — Onboarding Wizard

- **Group:** Company (`company`)
- **Path:** `/company/onboarding`
- **Page:** `client/src/pages/company-onboarding` (937 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/companies` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Company List (this feature is a consumer)
- **Backend APIs (3):** `/api/companies`, `/api/companies/`, `/api/kam`
- **Write operations:** `POST /api/companies`, `PUT /api/companies/`
- **Shares endpoints with:** Company List (3), Graphs (1), Organization Mgmt (1), Create Account (1), Account Names (1), BitsEye (1), +3 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-025 — Account Names

- **Group:** Company (`company`)
- **Path:** `/account-names`
- **Page:** `client/src/pages/account-names` (554 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/kam` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Graphs (this feature is a consumer)
- **Backend APIs (4):** `/api/accounts-list`, `/api/kam`, `/api/kam/`, `/api/kam/accounts/`
- **Write operations:** `DELETE /api/kam/accounts/`, `POST /api/kam/`
- **Shares endpoints with:** Graphs (3), Team & KAM (3), Notifications (2), Company List (1), Onboarding Wizard (1), BitsEye (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-026 — DID Management

- **Group:** Company (`company`)
- **Path:** `/dids`
- **Page:** `client/src/pages/dids` (424 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (3):** `/api/sippy/accounts`, `/api/sippy/dids`, `/api/sippy/dids/`
- **Write operations:** `DELETE /api/sippy/dids/`, `PATCH /api/sippy/dids/`, `POST /api/sippy/dids`
- **Shares endpoints with:** Accounts (1), Client Portal (1), Route Simulator (1), Route Tester (1), Tools (1), ASR / ACD (1), +3 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-027 — Recordings

- **Group:** Company (`company`)
- **Path:** `/call-recordings`
- **Page:** `client/src/pages/call-recordings` (479 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (2):** `/api/sippy/recording-download/`, `/api/sippy/recordings`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-028 — Products

- **Group:** Company (`company`)
- **Path:** `/products`
- **Page:** `client/src/pages/products` (1496 LOC)
- **Roles:** admin, management
- **Business capability:** Company
- **System of record (primary API namespace):** `/api/product-docs` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/product-docs`
- **Backend APIs (3):** `/api/product-docs`, `/api/product-docs/`, `/api/sippy/cdr`
- **Write operations:** `DELETE /api/product-docs/`, `POST /api/product-docs`, `PUT /api/product-docs/`
- **Shares endpoints with:** Client Portal (1), CDR Viewer (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-029 — Vendor List

- **Group:** Operations (`operations`)
- **Path:** `/vendors`
- **Page:** `client/src/pages/vendors` (1486 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager, routing_admin
- **Business capability:** Carrier Management
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (3):** `/api/sippy/connections/`, `/api/sippy/vendors`, `/api/sippy/vendors/`
- **Write operations:** `DELETE /api/sippy/connections/`, `DELETE /api/sippy/vendors/`, `PATCH /api/sippy/connections/`, `PATCH /api/sippy/vendors/`, `POST /api/sippy/vendors`
- **Shares endpoints with:** Accounts (3), Routing Manager (3), Network Topology (1), ASR / ACD (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-030 — SLA Scorecard

- **Group:** Operations (`operations`)
- **Path:** `/vendor-sla-scorecard`
- **Page:** `client/src/pages/vendor-sla-scorecard` (556 LOC)
- **Roles:** admin, management, destination_manager, routing_admin
- **Business capability:** Carrier SLA
- **System of record (primary API namespace):** `/api/stats` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/stats`
- **Backend APIs (2):** `/api/stats/ner`, `/api/vendor-sla/scorecard`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-031 — Carrier Scoring

- **Group:** Operations (`operations`)
- **Path:** `/carrier-scoring`
- **Page:** `client/src/pages/carrier-scoring` (818 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager
- **Badge:** NEW
- **Business capability:** Carrier Performance
- **System of record (primary API namespace):** `/api/carrier-scores` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/carrier-scores`
- **Backend APIs (4):** `/api/carrier-scores`, `/api/carrier-scores/delta`, `/api/carrier-scores/recompute`, `/api/route-traces`
- **Write operations:** `POST /api/carrier-scores/recompute`
- **Shares endpoints with:** Route Intelligence (2), NOC Dashboard (1), NOC Command (1), Ops Console (1), Network Topology (1), Failover Engine (1), +2 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-032 — Stability Timeline

- **Group:** Operations (`operations`)
- **Path:** `/vendor-stability-timeline`
- **Page:** `client/src/pages/vendor-stability-timeline` (413 LOC)
- **Roles:** admin, management, destination_manager, routing_admin
- **Badge:** NEW
- **Business capability:** Carrier Performance
- **System of record (primary API namespace):** `/api/vendor-stability-timeline` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/vendor-stability-timeline`
- **Backend APIs (1):** `/api/vendor-stability-timeline`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-033 — Balance Monitor

- **Group:** Operations (`operations`)
- **Path:** `/balance`
- **Page:** `client/src/pages/balance-monitor` (1849 LOC)
- **Roles:** admin, management
- **Business capability:** Carrier Finance
- **System of record (primary API namespace):** `/api/accounts` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/accounts`
- **Backend APIs (11):** `/api/accounts`, `/api/accounts/`, `/api/balance-alert-notification-settings`, `/api/balance-alert-notification-settings/test`, `/api/balance-alert-thresholds`, `/api/balance-alert-thresholds/`, `/api/noc/balance-alerts`, `/api/noc/balance-alerts/run`, `/api/sippy/accounts/`, `/api/sippy/balance-monitor`, `/api/user/assigned-accounts`
- **Write operations:** `DELETE /api/balance-alert-thresholds/`, `PATCH /api/sippy/accounts/`, `POST /api/balance-alert-notification-settings/test`, `POST /api/balance-alert-thresholds`, `POST /api/noc/balance-alerts/run`, `POST /api/sippy/accounts/`, `PUT /api/balance-alert-notification-settings`
- **Shares endpoints with:** Firewall Manager (2), Live Calls (1), NOC Dashboard (1), Graphs (1), Accounts (1), Invoices (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-034 — Routing Manager

- **Group:** Operations (`operations`)
- **Path:** `/routing-manager`
- **Page:** `client/src/pages/routing-manager` (5283 LOC)
- **Roles:** admin, management, routing_admin
- **Business capability:** Routing Configuration
- **System of record (primary API namespace):** `/api/routing-cache` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/routing-cache`
- **Backend APIs (20):** `/api/coverage/matrix`, `/api/qbr/metrics`, `/api/routing-cache`, `/api/routing-cache/connections`, `/api/routing-cache/destination-sets`, `/api/routing-cache/routing-groups`, `/api/routing-cache/routing-groups/`, `/api/routing-cache/status`, `/api/routing-cache/sync`, `/api/routing-simulator/preview`, `/api/sippy/connections/`, `/api/sippy/destination-sets`, `/api/sippy/destination-sets/`, `/api/sippy/routing-groups`, `/api/sippy/routing-groups/`, `/api/sippy/vendors`, `/api/sippy/vendors/`, `/api/vendors`, `/api/vendors/`, `/api/vendors/probe-status`
- **Write operations:** `DELETE /api/sippy/connections/`, `DELETE /api/sippy/destination-sets/`, `DELETE /api/sippy/routing-groups/`, `DELETE /api/sippy/vendors/`, `PATCH /api/sippy/connections/`, `PATCH /api/sippy/destination-sets/`, `POST /api/routing-cache/sync`, `POST /api/sippy/destination-sets`, `POST /api/sippy/destination-sets/`, `POST /api/sippy/routing-groups`, `POST /api/sippy/routing-groups/`, `POST /api/sippy/vendors`, `POST /api/sippy/vendors/`, `POST /api/vendors/`, `PUT /api/sippy/routing-groups/`, `PUT /api/sippy/vendors/`
- **Shares endpoints with:** Accounts (4), Vendor List (3), Rate Cards (2), Network Topology (1), Create Account (1), Route Simulator (1), +1 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-035 — LCR Analyser

- **Group:** Operations (`operations`)
- **Path:** `/lcr-analyser`
- **Page:** `client/src/pages/lcr-analyser` (467 LOC)
- **Roles:** admin, management, routing_admin
- **Business capability:** Routing Analysis
- **System of record (primary API namespace):** `/api/lcr` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/lcr`
- **Backend APIs (2):** `/api/lcr/analyse`, `/api/rate-cards`
- **Write operations:** `POST /api/lcr/analyse`
- **Shares endpoints with:** Traffic Analytics (1), Rate Cards (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-036 — Route Simulator

- **Group:** Operations (`operations`)
- **Path:** `/call-flow-simulator`
- **Page:** `client/src/pages/call-flow-simulator` (749 LOC)
- **Roles:** admin, management
- **Business capability:** Routing Validation
- **System of record (primary API namespace):** `/api/routing-cache` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Routing Manager (this feature is a consumer)
- **Backend APIs (3):** `/api/routing-cache/routing-groups`, `/api/simulator/run`, `/api/sippy/accounts`
- **Write operations:** `POST /api/simulator/run`
- **Shares endpoints with:** Accounts (1), Client Portal (1), DID Management (1), Routing Manager (1), Route Tester (1), Tools (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-037 — Failover Engine

- **Group:** Operations (`operations`)
- **Path:** `/self-heal`
- **Page:** `client/src/pages/self-heal` (1281 LOC)
- **Roles:** admin, management, routing_admin
- **Badge:** NEW
- **Business capability:** Operations
- **System of record (primary API namespace):** `/api/failover-executions` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/failover-executions`
- **Backend APIs (9):** `/api/approvals`, `/api/carrier-scores`, `/api/failover-executions`, `/api/failover-executions/`, `/api/failover-policies`, `/api/failover-policies/`, `/api/routing/self-heal/propose`, `/api/routing/self-heal/status`, `/api/simulation`
- **Write operations:** `POST /api/failover-executions/`, `POST /api/failover-policies`, `POST /api/failover-policies/`, `POST /api/routing/self-heal/propose`, `POST /api/simulation`
- **Shares endpoints with:** NOC Dashboard (1), Route Intelligence (1), NOC Command (1), Ops Console (1), Network Topology (1), Carrier Scoring (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-038 — Route Tester

- **Group:** Operations (`operations`)
- **Path:** `/test-call`
- **Page:** `client/src/pages/test-call` (723 LOC)
- **Roles:** admin, management
- **Business capability:** Routing Validation
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (4):** `/api/settings`, `/api/sippy/accounts`, `/api/sippy/make-call`, `/api/sippy/test-call-logs`
- **Write operations:** `POST /api/sippy/make-call`
- **Shares endpoints with:** Team & KAM (2), Server Monitor (1), Accounts (1), Client Portal (1), DID Management (1), Route Simulator (1), +5 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-039 — SIP Trace

- **Group:** Operations (`operations`)
- **Path:** `/sip-trace`
- **Page:** `client/src/pages/sip-trace` (1379 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Operations
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (2):** `/api/sippy/cdr-trace`, `/api/sippy/cdr/sdp`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-040 — Replay Engine

- **Group:** Operations (`operations`)
- **Path:** `/replay`
- **Page:** `client/src/pages/replay` (760 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Operations
- **System of record (primary API namespace):** `/api/route-traces` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Carrier Scoring (this feature is a consumer)
- **Backend APIs (1):** `/api/route-traces`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Carrier Scoring (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-041 — Test Campaigns

- **Group:** Operations (`operations`)
- **Path:** `/test-campaigns`
- **Page:** `client/src/pages/test-campaigns` (838 LOC)
- **Roles:** admin, management
- **Business capability:** Operations
- **System of record (primary API namespace):** `/api/campaigns` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/campaigns`
- **Backend APIs (3):** `/api/campaigns`, `/api/campaigns/`, `/api/campaigns/carrier-matrix`
- **Write operations:** `DELETE /api/campaigns/`, `PATCH /api/campaigns/`, `POST /api/campaigns`, `POST /api/campaigns/`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-042 — Tools

- **Group:** Operations (`operations`)
- **Path:** `/tools`
- **Page:** `client/src/pages/tools` (1704 LOC)
- **Roles:** admin, management
- **Business capability:** Operations
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (6):** `/api/fas/analyze`, `/api/fas/vendor-scores`, `/api/sippy/accounts`, `/api/sippy/apply-translation-rule`, `/api/sippy/check-match-rule`, `/api/sippy/test-dialplan`
- **Write operations:** `POST /api/fas/analyze`, `POST /api/sippy/apply-translation-rule`, `POST /api/sippy/check-match-rule`, `POST /api/sippy/test-dialplan`
- **Shares endpoints with:** Fraud Engine (2), Accounts (1), Client Portal (1), DID Management (1), Route Simulator (1), Route Tester (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-043 — Traffic Analytics

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/analytics`
- **Page:** `client/src/pages/analytics` (1026 LOC)
- **Roles:** admin, management
- **Business capability:** Traffic Analytics
- **System of record (primary API namespace):** `/api/analytics` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/analytics`
- **Backend APIs (4):** `/api/analytics/margin`, `/api/analytics/pnl`, `/api/rate-cards`, `/api/rate-cards/`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Rate Cards (2), LCR Analyser (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-044 — ASR / ACD

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/asr-acd`
- **Page:** `client/src/pages/asr-acd-report` (1181 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Traffic Analytics
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (3):** `/api/reports/asr-acd`, `/api/sippy/accounts`, `/api/sippy/vendors`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Accounts (2), Network Topology (1), Client Portal (1), DID Management (1), Vendor List (1), Routing Manager (1), +7 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-045 — QoS Heatmap

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/qos-heatmap`
- **Page:** `client/src/pages/qos-heatmap` (176 LOC)
- **Roles:** admin, management
- **Business capability:** Media Quality
- **System of record (primary API namespace):** `/api/stats` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** SLA Scorecard (this feature is a consumer)
- **Backend APIs (1):** `/api/stats/heatmap`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-046 — Codec Analytics

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/codec-analytics`
- **Page:** `client/src/pages/codec-analytics` (291 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Media Quality
- **System of record (primary API namespace):** `/api/codec-analytics` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/codec-analytics`
- **Backend APIs (1):** `/api/codec-analytics`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-047 — RTP Analytics

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/rtp-analytics`
- **Page:** `client/src/pages/rtp-analytics` (389 LOC)
- **Roles:** admin, management
- **Business capability:** Media Quality
- **System of record (primary API namespace):** `/api/analytics` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Traffic Analytics (this feature is a consumer)
- **Backend APIs (1):** `/api/analytics/rtp-quality`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-048 — Revenue Heatmap

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/revenue-heatmap`
- **Page:** `client/src/pages/revenue-heatmap` (674 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Revenue Analytics
- **System of record (primary API namespace):** `/api/geo-intelligence` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/geo-intelligence`
- **Backend APIs (2):** `/api/geo-intelligence`, `/api/revenue-heatmap`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-049 — Reports

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/reports`
- **Page:** `client/src/pages/reports` (1801 LOC)
- **Roles:** admin, management
- **Business capability:** Reporting
- **System of record (primary API namespace):** `/api/reports` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/reports`
- **Backend APIs (8):** `/api/analytics/revenue`, `/api/clients`, `/api/reports/asr-acd`, `/api/reports/route-degradation`, `/api/reports/route-recommendations`, `/api/sippy/monitoring/acd-asr`, `/api/sippy/per-account-stats`, `/api/sippy/session`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Accounts (3), Live Calls (1), Organization Mgmt (1), ASR / ACD (1), Rate Cards (1), Platform Settings (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-050 — Traffic Forecast

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/traffic-forecast`
- **Page:** `client/src/pages/traffic-forecast` (386 LOC)
- **Roles:** admin, management
- **Badge:** NEW
- **Business capability:** Analytics & Reports
- **System of record (primary API namespace):** `/api/traffic-forecast` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/traffic-forecast`
- **Backend APIs (1):** `/api/traffic-forecast`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-051 — CDR Viewer

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/cdrs`
- **Page:** `client/src/pages/cdrs` (911 LOC)
- **Roles:** admin, management
- **Business capability:** Analytics & Reports
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (2):** `/api/sippy/cdr`, `/api/sippy/cdr/vendor`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Client Portal (1), Products (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-052 — BitsEye

- **Group:** Analytics & Reports (`analytics`)
- **Path:** `/bitseye`
- **Page:** `client/src/pages/bitseye` (2815 LOC)
- **Roles:** admin, management
- **Business capability:** Unified Analytics
- **System of record (primary API namespace):** `/api/bitseye` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** BitsEye 2 (this feature is a consumer)
- **Backend APIs (8):** `/api/analytics/dashboard`, `/api/bitseye/account-destinations`, `/api/bitseye/call-trend`, `/api/bitseye/concurrent-trend`, `/api/bitseye/graph-events`, `/api/bitseye/live-summary`, `/api/bitseye/per-entity`, `/api/kam`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** BitsEye 2 (2), Graphs (2), Company List (1), Onboarding Wizard (1), Account Names (1), Team & KAM (1), +1 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-053 — AI Ops Center

- **Group:** Intelligence (`intelligence`)
- **Path:** `/ai-ops`
- **Page:** `client/src/pages/ai-ops` (2552 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Badge:** NEW
- **Business capability:** AI Decisioning
- **System of record (primary API namespace):** `/api/aiops` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/aiops`
- **Backend APIs (23):** `/api/account-state`, `/api/account-state/history`, `/api/actions`, `/api/actions/`, `/api/ai-ops/decision-overlay`, `/api/ai-ops/entity-verdict`, `/api/ai/actions/`, `/api/aiops/incidents`, `/api/aiops/incidents/run`, `/api/aiops/signals`, `/api/anomalies`, `/api/anomalies/`, `/api/anomalies/run`, `/api/cdr-anomalies`, `/api/engine/run-all`, `/api/incidents`, `/api/incidents/run`, `/api/nlq`, `/api/recommendations`, `/api/recommendations/run`, `/api/routing-suggestions`, `/api/routing-suggestions/`, `/api/routing-suggestions/generate`
- **Write operations:** `PATCH /api/ai/actions/`, `POST /api/actions`, `POST /api/actions/`, `POST /api/aiops/incidents/run`, `POST /api/anomalies/`, `POST /api/anomalies/run`, `POST /api/engine/run-all`, `POST /api/incidents/run`, `POST /api/recommendations/run`, `POST /api/routing-suggestions/`, `POST /api/routing-suggestions/generate`
- **Shares endpoints with:** Decision Overlay (23), Traffic Steering (3), NOC Dashboard (2), Route Intelligence (2), NOC Command (2), Ops Console (2), +6 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-054 — Intelligence Hub

- **Group:** Intelligence (`intelligence`)
- **Path:** `/intelligence`
- **Page:** `client/src/pages/intelligence` (789 LOC)
- **Roles:** admin, management, destination_manager
- **Badge:** NEW
- **Business capability:** AI Decisioning
- **System of record (primary API namespace):** `/api/intelligence` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/intelligence`
- **Backend APIs (1):** `/api/intelligence/chain`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-055 — Decision Overlay

- **Group:** Intelligence (`intelligence`)
- **Path:** `/ai-ops?tab=decision-overlay`
- **Page:** `client/src/pages/ai-ops` (2552 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead
- **Badge:** NEW
- **Business capability:** AI Decisioning
- **System of record (primary API namespace):** `/api/aiops` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** AI Ops Center (this feature is a consumer)
- **Backend APIs (23):** `/api/account-state`, `/api/account-state/history`, `/api/actions`, `/api/actions/`, `/api/ai-ops/decision-overlay`, `/api/ai-ops/entity-verdict`, `/api/ai/actions/`, `/api/aiops/incidents`, `/api/aiops/incidents/run`, `/api/aiops/signals`, `/api/anomalies`, `/api/anomalies/`, `/api/anomalies/run`, `/api/cdr-anomalies`, `/api/engine/run-all`, `/api/incidents`, `/api/incidents/run`, `/api/nlq`, `/api/recommendations`, `/api/recommendations/run`, `/api/routing-suggestions`, `/api/routing-suggestions/`, `/api/routing-suggestions/generate`
- **Write operations:** `PATCH /api/ai/actions/`, `POST /api/actions`, `POST /api/actions/`, `POST /api/aiops/incidents/run`, `POST /api/anomalies/`, `POST /api/anomalies/run`, `POST /api/engine/run-all`, `POST /api/incidents/run`, `POST /api/recommendations/run`, `POST /api/routing-suggestions/`, `POST /api/routing-suggestions/generate`
- **Shares endpoints with:** AI Ops Center (23), Traffic Steering (3), NOC Dashboard (2), Route Intelligence (2), NOC Command (2), Ops Console (2), +6 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-056 — Validation Console

- **Group:** Intelligence (`intelligence`)
- **Path:** `/intelligence-validation`
- **Page:** `client/src/pages/intelligence-validation` (689 LOC)
- **Roles:** admin, management, destination_manager
- **Badge:** NEW
- **Business capability:** AI Validation
- **System of record (primary API namespace):** `/api/incidents` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** AI Ops Center (this feature is a consumer)
- **Backend APIs (2):** `/api/incidents/lifecycle-events`, `/api/intelligence/validation`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-057 — Carrier Intelligence

- **Group:** Intelligence (`intelligence`)
- **Path:** `/carrier-intelligence`
- **Page:** `client/src/pages/carrier-intelligence` (678 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager
- **Badge:** NEW
- **Business capability:** Carrier Performance
- **System of record (primary API namespace):** `/api/ai-ops` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** AI Ops Center (this feature is a consumer)
- **Backend APIs (2):** `/api/ai-ops/entity-verdict`, `/api/carrier-intelligence`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** AI Ops Center (1), Decision Overlay (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-058 — Vendor RCA

- **Group:** Intelligence (`intelligence`)
- **Path:** `/vendor-rca`
- **Page:** `client/src/pages/vendor-rca` (143 LOC)
- **Roles:** admin, management, destination_manager
- **Badge:** NEW
- **Business capability:** Carrier Diagnostics
- **System of record (primary API namespace):** `/api/vendor-rca` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/vendor-rca`
- **Backend APIs (1):** `/api/vendor-rca`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-059 — Prefix Intelligence

- **Group:** Intelligence (`intelligence`)
- **Path:** `/vendor-prefix-intelligence`
- **Page:** `client/src/pages/vendor-prefix-intelligence` (450 LOC)
- **Roles:** admin, management, destination_manager
- **Badge:** NEW
- **Business capability:** Prefix Analysis
- **System of record (primary API namespace):** `/api/vendor-prefix-intelligence` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/vendor-prefix-intelligence`
- **Backend APIs (1):** `/api/vendor-prefix-intelligence`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-060 — Routing Intelligence

- **Group:** Intelligence (`intelligence`)
- **Path:** `/routing-intelligence`
- **Page:** `client/src/pages/routing-intelligence` (562 LOC)
- **Roles:** admin, management, destination_manager, routing_admin
- **Badge:** NEW
- **Business capability:** Routing Recommendations
- **System of record (primary API namespace):** `/api/routing-rules` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/routing-rules`
- **Backend APIs (4):** `/api/routing-rules`, `/api/routing-rules/`, `/api/routing-rules/evaluate`, `/api/routing-rules/metrics`
- **Write operations:** `DELETE /api/routing-rules/`, `PATCH /api/routing-rules/`, `POST /api/routing-rules`, `POST /api/routing-rules/evaluate`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-061 — Number Intelligence

- **Group:** Intelligence (`intelligence`)
- **Path:** `/number-intelligence`
- **Page:** `client/src/pages/number-intelligence` (606 LOC)
- **Roles:** admin, management
- **Business capability:** Number Analysis
- **System of record (primary API namespace):** `/api/number-lookup` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/number-lookup`
- **Backend APIs (2):** `/api/number-lookup/`, `/api/settings/hlr-provider`
- **Write operations:** `POST /api/settings/hlr-provider`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-062 — Cost Optimisation

- **Group:** Intelligence (`intelligence`)
- **Path:** `/cost-optimisation`
- **Page:** `client/src/pages/cost-optimisation` (439 LOC)
- **Roles:** admin, management, destination_manager
- **Business capability:** Cost Recommendations
- **System of record (primary API namespace):** `/api/cost-optimisation` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/cost-optimisation`
- **Backend APIs (1):** `/api/cost-optimisation/analyse`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-063 — Route Optimisation

- **Group:** Intelligence (`intelligence`)
- **Path:** `/route-optimisation`
- **Page:** `client/src/pages/route-optimisation` (1085 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager
- **Badge:** NEW
- **Business capability:** Routing Recommendations
- **System of record (primary API namespace):** `/api/route-optimisation` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/route-optimisation`
- **Backend APIs (7):** `/api/explain/telemetry`, `/api/route-optimisation`, `/api/route-optimisation/explain`, `/api/route-optimisation/explain/`, `/api/routing-suggestions/`, `/api/routing-suggestions/generate`, `/api/simulation`
- **Write operations:** `POST /api/routing-suggestions/`, `POST /api/routing-suggestions/generate`, `POST /api/simulation`
- **Shares endpoints with:** AI Ops Center (2), Decision Overlay (2), Traffic Steering (2), Simulation Sandbox (2), Failover Engine (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-064 — Traffic Steering

- **Group:** Intelligence (`intelligence`)
- **Path:** `/traffic-steering`
- **Page:** `client/src/pages/traffic-steering` (416 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager
- **Badge:** NEW
- **Business capability:** Traffic Steering
- **System of record (primary API namespace):** `/api/routing-suggestions` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** AI Ops Center (this feature is a consumer)
- **Backend APIs (4):** `/api/carrier-scores`, `/api/routing-suggestions`, `/api/routing-suggestions/`, `/api/routing-suggestions/generate`
- **Write operations:** `POST /api/routing-suggestions/`, `POST /api/routing-suggestions/generate`
- **Shares endpoints with:** AI Ops Center (3), Decision Overlay (3), Route Optimisation (2), NOC Dashboard (1), Route Intelligence (1), NOC Command (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-065 — Simulation Sandbox

- **Group:** Intelligence (`intelligence`)
- **Path:** `/simulation-sandbox`
- **Page:** `client/src/pages/simulation-sandbox` (396 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager
- **Badge:** NEW
- **Business capability:** AI Validation
- **System of record (primary API namespace):** `/api/route-optimisation` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Route Optimisation (this feature is a consumer)
- **Backend APIs (2):** `/api/route-optimisation`, `/api/simulation`
- **Write operations:** `POST /api/simulation`
- **Shares endpoints with:** Route Optimisation (2), Failover Engine (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-066 — Fraud Engine

- **Group:** Security & Compliance (`security`)
- **Path:** `/fraud`
- **Page:** `client/src/pages/fraud` (1244 LOC)
- **Roles:** admin, management
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/fas` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/fas`
- **Backend APIs (13):** `/api/blacklist-rules`, `/api/blacklist-rules/`, `/api/fas-events`, `/api/fas/analyze`, `/api/fas/vendor-events`, `/api/fas/vendor-scores`, `/api/fas/vendor-settings`, `/api/fas/vendor-settings/`, `/api/fas/vendor-trend`, `/api/irsf-events`, `/api/irsf-events/scan`, `/api/simbox`, `/api/sippy/recording-status`
- **Write operations:** `DELETE /api/blacklist-rules/`, `DELETE /api/fas/vendor-settings/`, `PATCH /api/blacklist-rules/`, `POST /api/blacklist-rules`, `POST /api/fas/analyze`, `POST /api/fas/vendor-settings`, `POST /api/irsf-events/scan`
- **Shares endpoints with:** Tools (2), Network Topology (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-067 — Firewall Manager

- **Group:** Security & Compliance (`security`)
- **Path:** `/firewall`
- **Page:** `client/src/pages/firewall` (537 LOC)
- **Roles:** admin, management
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (4):** `/api/sippy/accounts/`, `/api/sippy/auth-rules/`, `/api/sippy/balance-monitor`, `/api/sippy/network-services`
- **Write operations:** `DELETE /api/sippy/auth-rules/`, `POST /api/sippy/accounts/`
- **Shares endpoints with:** Accounts (2), Balance Monitor (2), Invoices (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-068 — SLA Breaches

- **Group:** Security & Compliance (`security`)
- **Path:** `/sla-breaches`
- **Page:** `client/src/pages/sla-breaches` (202 LOC)
- **Roles:** admin, management
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/sla-breaches` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/sla-breaches`
- **Backend APIs (1):** `/api/sla-breaches`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-069 — Approval Queue

- **Group:** Security & Compliance (`security`)
- **Path:** `/approvals`
- **Page:** `client/src/pages/approval-queue` (609 LOC)
- **Roles:** admin, management, super_admin, noc_operator, team_lead, destination_manager, routing_admin
- **Registry status:** live
- **Business capability:** Change Approval
- **System of record (primary API namespace):** `/api/approvals` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/approvals`
- **Backend APIs (3):** `/api/approvals`, `/api/approvals/`, `/api/approvals/pending-count`
- **Write operations:** `POST /api/approvals/`
- **Shares endpoints with:** Failover Engine (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-070 — Approval Rules

- **Group:** Security & Compliance (`security`)
- **Path:** `/approval-settings`
- **Page:** `client/src/pages/approval-settings` (417 LOC)
- **Roles:** admin, management, destination_manager
- **Business capability:** Change Approval
- **System of record (primary API namespace):** `/api/approval-settings` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/approval-settings`
- **Backend APIs (1):** `/api/approval-settings`
- **Write operations:** `PATCH /api/approval-settings`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-071 — STIR/SHAKEN

- **Group:** Security & Compliance (`security`)
- **Path:** `/stir-shaken`
- **Page:** `client/src/pages/stir-shaken` (528 LOC)
- **Roles:** admin, management
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (1):** `/api/sippy/cdr/graphs`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-072 — Compliance

- **Group:** Security & Compliance (`security`)
- **Path:** `/compliance`
- **Page:** `client/src/pages/compliance` (494 LOC)
- **Roles:** admin, management
- **Business capability:** Compliance
- **System of record (primary API namespace):** `/api/compliance` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/compliance`
- **Backend APIs (1):** `/api/compliance/report`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-073 — Audit Log

- **Group:** Security & Compliance (`security`)
- **Path:** `/audit-log`
- **Page:** `client/src/pages/audit-log` (372 LOC)
- **Roles:** admin, management, destination_manager, routing_admin
- **Badge:** NEW
- **Business capability:** Audit Trail
- **System of record (primary API namespace):** `/api/audit-log` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/audit-log`
- **Backend APIs (2):** `/api/audit-log`, `/api/audit-log/stats`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Security Ops (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-074 — Permission Matrix

- **Group:** Security & Compliance (`security`)
- **Path:** `/rbac`
- **Page:** `client/src/pages/rbac-matrix` (535 LOC)
- **Roles:** admin, super_admin
- **Badge:** NEW
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/rbac` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/rbac`
- **Backend APIs (5):** `/api/rbac/audit`, `/api/rbac/overrides`, `/api/rbac/overrides/`, `/api/rbac/permissions`, `/api/rbac/role-permissions`
- **Write operations:** `DELETE /api/rbac/overrides/`, `PUT /api/rbac/role-permissions`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-075 — MFA / 2FA

- **Group:** Security & Compliance (`security`)
- **Path:** `/mfa-setup`
- **Page:** `client/src/pages/mfa-setup` (262 LOC)
- **Roles:** admin, super_admin, management, noc_operator, team_lead, viewer
- **Badge:** NEW
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/security` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Security Ops (this feature is a consumer)
- **Backend APIs (4):** `/api/security/mfa/disable`, `/api/security/mfa/setup`, `/api/security/mfa/status`, `/api/security/mfa/verify-setup`
- **Write operations:** `POST /api/security/mfa/disable`, `POST /api/security/mfa/verify-setup`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-076 — Security Ops

- **Group:** Security & Compliance (`security`)
- **Path:** `/security-ops`
- **Page:** `client/src/pages/security-ops` (421 LOC)
- **Roles:** admin, super_admin
- **Badge:** NEW
- **Business capability:** Security & Compliance
- **System of record (primary API namespace):** `/api/security` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/security`
- **Backend APIs (7):** `/api/audit-log`, `/api/security/ip-restrictions`, `/api/security/ip-restrictions/`, `/api/security/sessions`, `/api/security/sessions/`, `/api/security/sessions/stats`, `/api/security/sessions/user/`
- **Write operations:** `DELETE /api/security/ip-restrictions/`, `DELETE /api/security/sessions/`, `DELETE /api/security/sessions/user/`, `PATCH /api/security/ip-restrictions/`, `POST /api/security/ip-restrictions`
- **Shares endpoints with:** Audit Log (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-077 — Billing

- **Group:** Finance & Billing (`finance`)
- **Path:** `/billing`
- **Page:** `client/src/pages/billing` (346 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/billing` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Carrier Reconciliation (this feature is a consumer)
- **Backend APIs (2):** `/api/billing/connection`, `/api/billing/connection/`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-078 — Billing Disputes

- **Group:** Finance & Billing (`finance`)
- **Path:** `/billing-disputes`
- **Page:** `client/src/pages/billing-disputes` (292 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/disputes` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/disputes`
- **Backend APIs (2):** `/api/disputes`, `/api/disputes/`
- **Write operations:** `DELETE /api/disputes/`, `PATCH /api/disputes/`, `POST /api/disputes`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-079 — Invoices

- **Group:** Finance & Billing (`finance`)
- **Path:** `/invoices`
- **Page:** `client/src/pages/invoices` (1480 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/invoices` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/invoices`
- **Backend APIs (11):** `/api/companies`, `/api/dmr/auto-verify-period`, `/api/invoices`, `/api/invoices/`, `/api/invoices/generate`, `/api/invoices/generate-from-sippy`, `/api/invoices/sippy-accounts`, `/api/rating-snapshots/seed-from-portal`, `/api/rating-snapshots/seed-job/`, `/api/sippy/accounts/`, `/api/sippy/tariffs`
- **Write operations:** `POST /api/dmr/auto-verify-period`, `POST /api/invoices/`, `POST /api/invoices/generate`, `POST /api/invoices/generate-from-sippy`, `POST /api/rating-snapshots/seed-from-portal`
- **Shares endpoints with:** Accounts (2), Organization Mgmt (2), Company List (1), Create Account (1), Onboarding Wizard (1), Balance Monitor (1), +6 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-080 — Invoice Queue

- **Group:** Finance & Billing (`finance`)
- **Path:** `/invoice-jobs`
- **Page:** `client/src/pages/invoice-jobs` (392 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/invoice-jobs` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/invoice-jobs`
- **Backend APIs (3):** `/api/invoice-jobs`, `/api/invoice-jobs/`, `/api/invoice-jobs/detect-cycles`
- **Write operations:** `PATCH /api/invoice-jobs/`, `POST /api/invoice-jobs`, `POST /api/invoice-jobs/detect-cycles`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-081 — Invoice Templates

- **Group:** Finance & Billing (`finance`)
- **Path:** `/invoice-templates`
- **Page:** `client/src/pages/invoice-templates` (423 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/branding-profiles` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/branding-profiles`
- **Backend APIs (4):** `/api/branding-profiles`, `/api/branding-profiles/`, `/api/invoice-templates`, `/api/invoice-templates/`
- **Write operations:** `PATCH /api/branding-profiles/`, `PATCH /api/invoice-templates/`, `POST /api/branding-profiles`, `POST /api/invoice-templates`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-082 — Credit Notes

- **Group:** Finance & Billing (`finance`)
- **Path:** `/credit-notes`
- **Page:** `client/src/pages/credit-notes` (347 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/credit-notes` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/credit-notes`
- **Backend APIs (2):** `/api/credit-notes`, `/api/credit-notes/`
- **Write operations:** `PATCH /api/credit-notes/`, `POST /api/credit-notes`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-083 — Credit Control

- **Group:** Finance & Billing (`finance`)
- **Path:** `/credit-control`
- **Page:** `client/src/pages/credit-control` (394 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/credit-control` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/credit-control`
- **Backend APIs (4):** `/api/credit-control/events`, `/api/credit-control/events/`, `/api/credit-control/rules`, `/api/credit-control/sweep`
- **Write operations:** `PATCH /api/credit-control/events/`, `POST /api/credit-control/events`, `POST /api/credit-control/rules`, `POST /api/credit-control/sweep`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-084 — Dispute Cases

- **Group:** Finance & Billing (`finance`)
- **Path:** `/dispute-cases`
- **Page:** `client/src/pages/dispute-cases` (547 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/dispute-cases` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/dispute-cases`
- **Backend APIs (2):** `/api/dispute-cases`, `/api/dispute-cases/`
- **Write operations:** `PATCH /api/dispute-cases/`, `POST /api/dispute-cases`, `POST /api/dispute-cases/`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-085 — Dispute Defense

- **Group:** Finance & Billing (`finance`)
- **Path:** `/dispute-defense`
- **Page:** `client/src/pages/dispute-defense` (297 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/dispute-defense` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/dispute-defense`
- **Backend APIs (1):** `/api/dispute-defense/generate`
- **Write operations:** `POST /api/dispute-defense/generate`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-086 — Client Reconciliation

- **Group:** Finance & Billing (`finance`)
- **Path:** `/client-reconciliation`
- **Page:** `client/src/pages/client-reconciliation` (1384 LOC)
- **Roles:** admin, management
- **Business capability:** Reconciliation
- **System of record (primary API namespace):** `/api/client-reconciliation` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/client-reconciliation`
- **Backend APIs (12):** `/api/client-reconciliation`, `/api/client-reconciliation/`, `/api/client-reconciliation/export/`, `/api/client-reconciliation/export/download/`, `/api/client-reconciliation/export/email`, `/api/client-reconciliation/import`, `/api/client-reconciliation/summary`, `/api/client-reconciliation/versions`, `/api/reconciliation-report-schedules`, `/api/reconciliation-report-schedules/`, `/api/reconciliation/email-log`, `/api/sippy/accounts`
- **Write operations:** `DELETE /api/reconciliation-report-schedules/`, `PATCH /api/client-reconciliation/`, `PATCH /api/reconciliation-report-schedules/`, `POST /api/client-reconciliation/`, `POST /api/client-reconciliation/export/email`, `POST /api/client-reconciliation/import`, `POST /api/reconciliation-report-schedules`, `POST /api/reconciliation-report-schedules/`
- **Shares endpoints with:** Carrier Reconciliation (3), Accounts (1), Client Portal (1), DID Management (1), Route Simulator (1), Route Tester (1), +4 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-087 — Carrier Reconciliation

- **Group:** Finance & Billing (`finance`)
- **Path:** `/carrier-reconciliation`
- **Page:** `client/src/pages/carrier-reconciliation` (1282 LOC)
- **Roles:** admin, management
- **Business capability:** Reconciliation
- **System of record (primary API namespace):** `/api/billing` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/billing`
- **Backend APIs (12):** `/api/billing/reconciliation/export/csv`, `/api/billing/reconciliation/export/csv-full`, `/api/billing/reconciliation/export/download/`, `/api/billing/reconciliation/export/email`, `/api/billing/reconciliation/export/pdf`, `/api/carrier-reconciliations`, `/api/carrier-reconciliations/`, `/api/carrier-reconciliations/run`, `/api/reconciliation-report-schedules`, `/api/reconciliation-report-schedules/`, `/api/reconciliation/email-log`, `/api/sippy/tariffs`
- **Write operations:** `DELETE /api/reconciliation-report-schedules/`, `PATCH /api/reconciliation-report-schedules/`, `POST /api/billing/reconciliation/export/email`, `POST /api/carrier-reconciliations/run`, `POST /api/reconciliation-report-schedules`, `POST /api/reconciliation-report-schedules/`
- **Shares endpoints with:** Client Reconciliation (3), Accounts (1), Organization Mgmt (1), Invoices (1), Rate Cards (1), Tariff Versions (1), +2 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-088 — Margin Intelligence

- **Group:** Finance & Billing (`finance`)
- **Path:** `/margin-intelligence`
- **Page:** `client/src/pages/margin-intelligence` (453 LOC)
- **Roles:** admin, management
- **Business capability:** Margin Analytics
- **System of record (primary API namespace):** `/api/margin` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/margin`
- **Backend APIs (10):** `/api/dmr`, `/api/dmr/generate`, `/api/margin`, `/api/margin/aggregate`, `/api/margin/alerts`, `/api/margin/alerts/`, `/api/margin/clients`, `/api/margin/materialize`, `/api/margin/trend`, `/api/margin/vendors`
- **Write operations:** `PATCH /api/margin/alerts/`, `POST /api/dmr/generate`, `POST /api/margin/materialize`
- **Shares endpoints with:** Daily Minutes Report (2)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-089 — Daily Minutes Report

- **Group:** Finance & Billing (`finance`)
- **Path:** `/dmr`
- **Page:** `client/src/pages/dmr` (465 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/dmr` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/dmr`
- **Backend APIs (4):** `/api/dmr`, `/api/dmr/`, `/api/dmr/generate`, `/api/dmr/trend`
- **Write operations:** `POST /api/dmr/`, `POST /api/dmr/generate`
- **Shares endpoints with:** Margin Intelligence (2)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-090 — AI Assurance

- **Group:** Finance & Billing (`finance`)
- **Path:** `/ai-assurance`
- **Page:** `client/src/pages/ai-assurance` (412 LOC)
- **Roles:** admin, management
- **Business capability:** Financial Assurance
- **System of record (primary API namespace):** `/api/ai-assurance` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/ai-assurance`
- **Backend APIs (4):** `/api/ai-assurance/alerts`, `/api/ai-assurance/alerts/`, `/api/ai-assurance/scan`, `/api/ai-assurance/scans`
- **Write operations:** `PATCH /api/ai-assurance/alerts/`, `POST /api/ai-assurance/scan`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-091 — Partner Portal

- **Group:** Finance & Billing (`finance`)
- **Path:** `/partner-profiles`
- **Page:** `client/src/pages/partner-profiles` (264 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/partner-profiles` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/partner-profiles`
- **Backend APIs (2):** `/api/partner-profiles`, `/api/partner-profiles/`
- **Write operations:** `DELETE /api/partner-profiles/`, `PATCH /api/partner-profiles/`, `POST /api/partner-profiles`, `POST /api/partner-profiles/`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-092 — Rate Cards

- **Group:** Finance & Billing (`finance`)
- **Path:** `/rate-cards`
- **Page:** `client/src/pages/rate-cards` (1450 LOC)
- **Roles:** admin, management
- **Business capability:** Commercial Rates
- **System of record (primary API namespace):** `/api/sippy` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Accounts (this feature is a consumer)
- **Backend APIs (9):** `/api/clients`, `/api/rate-cards`, `/api/rate-cards/`, `/api/rate-cards/push-jobs/`, `/api/sippy/destination-sets`, `/api/sippy/destination-sets/`, `/api/sippy/rate-card-context`, `/api/sippy/tariff-rates`, `/api/sippy/tariffs`
- **Write operations:** `DELETE /api/rate-cards/`, `POST /api/rate-cards`
- **Shares endpoints with:** Accounts (2), Routing Manager (2), Traffic Analytics (2), Organization Mgmt (1), LCR Analyser (1), Reports (1), +5 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-093 — Executive Reports

- **Group:** Finance & Billing (`finance`)
- **Path:** `/executive-reports`
- **Page:** `client/src/pages/executive-reports` (251 LOC)
- **Roles:** admin, management
- **Business capability:** Finance & Billing
- **System of record (primary API namespace):** `/api/executive-reports` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/executive-reports`
- **Backend APIs (3):** `/api/executive-reports`, `/api/executive-reports/`, `/api/executive-reports/generate`
- **Write operations:** `POST /api/executive-reports/generate`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-094 — Platform Settings

- **Group:** Platform (`platform`)
- **Path:** `/settings`
- **Page:** `client/src/pages/settings` (3987 LOC)
- **Roles:** admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/download` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/download`
- **Backend APIs (49):** `/api/alert-config`, `/api/alert-config/test`, `/api/download/account-management-impl-spec`, `/api/download/account-management-workflow`, `/api/download/api-reference`, `/api/download/asterisk-guide`, `/api/download/country-codes-xlsx`, `/api/download/feature-cost-estimate`, `/api/download/feature-registry`, `/api/download/feature-roadmap`, `/api/download/feature-roadmap-v2`, `/api/download/gds-master-xlsx`, `/api/download/org-hierarchy`, `/api/download/partner-initial-cost-docx`, `/api/download/platform-features-docx`, `/api/download/platform-features-explained-docx`, `/api/download/platform-presentation`, `/api/download/platform-status-report`, `/api/download/regenerate`, `/api/download/regenerate-feature-registry`, `/api/download/regenerate-manual`, `/api/download/regenerate-org-hierarchy`, `/api/download/regenerate-routing-features`, `/api/download/regenerate-sippy-dataflow`, `/api/download/regenerate-troubleshoot`, `/api/download/routing-features`, `/api/download/sippy-dataflow`, `/api/download/status-report`, `/api/download/troubleshooting-guide`, `/api/download/user-manual`, `/api/global-destinations/export`, `/api/invoices/test-smtp`, `/api/scheduled-reports`, `/api/scheduled-reports/`, `/api/settings/test-approval-expiry-notification`, `/api/sippy-watcher/status`, `/api/sippy-watcher/test-alert`, `/api/sippy/change-events`, `/api/sippy/connect`, `/api/sippy/recording-config`, `/api/sippy/session`, `/api/sippy/snmp/test`, `/api/sippy/test`, `/api/sippy/users`, `/api/sippy/users/`, `/api/switches`, `/api/switches/`, `/api/watcher-recipients`, `/api/watcher-recipients/`
- **Write operations:** `DELETE /api/scheduled-reports/`, `DELETE /api/sippy/users/`, `DELETE /api/switches/`, `DELETE /api/watcher-recipients/`, `PATCH /api/alert-config`, `PATCH /api/scheduled-reports/`, `PATCH /api/sippy/recording-config`, `PATCH /api/sippy/users/`, `PATCH /api/switches/`, `PATCH /api/watcher-recipients/`, `POST /api/alert-config/test`, `POST /api/download/regenerate`, `POST /api/download/regenerate-feature-registry`, `POST /api/download/regenerate-manual`, `POST /api/download/regenerate-org-hierarchy`, `POST /api/download/regenerate-routing-features`, `POST /api/download/regenerate-sippy-dataflow`, `POST /api/download/regenerate-troubleshoot`, `POST /api/invoices/test-smtp`, `POST /api/scheduled-reports`, `POST /api/settings/test-approval-expiry-notification`, `POST /api/sippy-watcher/test-alert`, `POST /api/sippy/users`, `POST /api/switches`, `POST /api/watcher-recipients`
- **Shares endpoints with:** Live Calls (3), Multi-Switch View (2), Accounts (2), Team & KAM (2), Organization Mgmt (1), Reports (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-095 — Team & KAM

- **Group:** Platform (`platform`)
- **Path:** `/team`
- **Page:** `client/src/pages/team` (2753 LOC)
- **Roles:** admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/kam` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Graphs (this feature is a consumer)
- **Backend APIs (14):** `/api/kam`, `/api/kam/`, `/api/kam/accounts/`, `/api/org/hierarchy`, `/api/settings`, `/api/settings/mgmt-permissions`, `/api/sippy/accounts`, `/api/sippy/live-graphs`, `/api/team`, `/api/team/`, `/api/team/monitoring-assignments`, `/api/traffic-alerts`, `/api/watcher-recipients`, `/api/watcher-recipients/`
- **Write operations:** `DELETE /api/kam/`, `DELETE /api/kam/accounts/`, `DELETE /api/watcher-recipients/`, `PATCH /api/kam/`, `PATCH /api/settings`, `PATCH /api/team/`, `PATCH /api/watcher-recipients/`, `POST /api/kam`, `POST /api/kam/`, `POST /api/watcher-recipients`, `PUT /api/team/`
- **Shares endpoints with:** Graphs (5), Account Names (3), Notifications (3), Route Tester (2), Platform Settings (2), Server Monitor (1), +11 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-096 — API Keys

- **Group:** Platform (`platform`)
- **Path:** `/api-keys`
- **Page:** `client/src/pages/api-keys` (340 LOC)
- **Roles:** admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/keys` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/keys`
- **Backend APIs (2):** `/api/keys`, `/api/keys/`
- **Write operations:** `DELETE /api/keys/`, `POST /api/keys`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-097 — VPN Config

- **Group:** Platform (`platform`)
- **Path:** `/vpn-config`
- **Page:** `client/src/pages/vpn-config` (458 LOC)
- **Roles:** admin
- **Business capability:** Platform
- **System of record (primary API namespace):** — _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** n/a
- **Backend APIs (0):** _none detected — Placeholder Candidate, verify (may be client-side only)_
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-098 — Tariff Versions

- **Group:** Platform (`platform`)
- **Path:** `/tariff-versions`
- **Page:** `client/src/pages/tariff-versions` (486 LOC)
- **Roles:** admin, management
- **Business capability:** Rating Lifecycle
- **System of record (primary API namespace):** `/api/tariff-versions` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/tariff-versions`
- **Backend APIs (5):** `/api/sippy/tariffs`, `/api/tariff-versions`, `/api/tariff-versions/`, `/api/tariff-versions/detect-changes`, `/api/tariff-versions/snapshot`
- **Write operations:** `POST /api/tariff-versions/detect-changes`, `POST /api/tariff-versions/snapshot`
- **Shares endpoints with:** Accounts (1), Organization Mgmt (1), Invoices (1), Carrier Reconciliation (1), Rate Cards (1), Rating Verification (1), +1 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-099 — Rating Verification

- **Group:** Platform (`platform`)
- **Path:** `/rating-verification`
- **Page:** `client/src/pages/rating-verification` (513 LOC)
- **Roles:** admin, management
- **Business capability:** Rating Lifecycle
- **System of record (primary API namespace):** `/api/rating-verifications` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/rating-verifications`
- **Backend APIs (5):** `/api/rating-verifications`, `/api/rating-verifications/`, `/api/rating-verifications/run-batch`, `/api/rating-verifications/summary`, `/api/sippy/tariffs`
- **Write operations:** `POST /api/rating-verifications/run-batch`
- **Shares endpoints with:** Accounts (1), Organization Mgmt (1), Invoices (1), Carrier Reconciliation (1), Rate Cards (1), Tariff Versions (1), +1 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-100 — Rating Snapshots

- **Group:** Platform (`platform`)
- **Path:** `/rating-snapshots`
- **Page:** `client/src/pages/rating-snapshots` (560 LOC)
- **Roles:** admin, management
- **Business capability:** Rating Lifecycle
- **System of record (primary API namespace):** `/api/rating-snapshots` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/rating-snapshots`
- **Backend APIs (6):** `/api/rating-snapshots`, `/api/rating-snapshots/`, `/api/rating-snapshots/integrity-audit`, `/api/rating-snapshots/lock-batch`, `/api/rating-snapshots/summary`, `/api/sippy/tariffs`
- **Write operations:** `POST /api/rating-snapshots/integrity-audit`, `POST /api/rating-snapshots/lock-batch`
- **Shares endpoints with:** Accounts (1), Organization Mgmt (1), Invoices (1), Carrier Reconciliation (1), Rate Cards (1), Tariff Versions (1), +1 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-101 — Comm. Policies

- **Group:** Platform (`platform`)
- **Path:** `/communication-policies`
- **Page:** `client/src/pages/communication-policies` (541 LOC)
- **Roles:** admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/communication-policies` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/communication-policies`
- **Backend APIs (3):** `/api/communication-policies`, `/api/communication-policies/`, `/api/smtp-sender-profiles`
- **Write operations:** `DELETE /api/communication-policies/`, `PATCH /api/communication-policies/`, `POST /api/communication-policies`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-102 — Commercial Notices

- **Group:** Platform (`platform`)
- **Path:** `/commercial-notifications`
- **Page:** `client/src/pages/commercial-notifications` (825 LOC)
- **Roles:** admin
- **Business capability:** Notifications
- **System of record (primary API namespace):** `/api/commercial-notifications` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/commercial-notifications`
- **Backend APIs (4):** `/api/commercial-notifications`, `/api/commercial-notifications/`, `/api/commercial-notifications/audience/companies`, `/api/sender-profiles`
- **Write operations:** `DELETE /api/commercial-notifications/`, `POST /api/commercial-notifications`, `POST /api/commercial-notifications/`
- **Shares endpoints with:** Sender Profiles (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-103 — Sender Profiles

- **Group:** Platform (`platform`)
- **Path:** `/sender-profiles`
- **Page:** `client/src/pages/sender-profiles` (488 LOC)
- **Roles:** admin
- **Business capability:** Notifications
- **System of record (primary API namespace):** `/api/sender-profiles` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/sender-profiles`
- **Backend APIs (2):** `/api/sender-profiles`, `/api/sender-profiles/`
- **Write operations:** `DELETE /api/sender-profiles/`, `POST /api/sender-profiles`, `POST /api/sender-profiles/`, `PUT /api/sender-profiles/`
- **Shares endpoints with:** Commercial Notices (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-104 — Notifications

- **Group:** Platform (`platform`)
- **Path:** `/email-centre`
- **Page:** `client/src/pages/email-centre` (731 LOC)
- **Roles:** admin
- **Business capability:** Notifications
- **System of record (primary API namespace):** `/api/kam` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Graphs (this feature is a consumer)
- **Backend APIs (4):** `/api/email/bulk-send`, `/api/kam`, `/api/kam/accounts/`, `/api/sippy/accounts`
- **Write operations:** `PATCH /api/kam/accounts/`, `POST /api/email/bulk-send`
- **Shares endpoints with:** Team & KAM (3), Graphs (2), Account Names (2), Accounts (1), Client Portal (1), Company List (1), +8 more
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-105 — Notification Centre

- **Group:** Platform (`platform`)
- **Path:** `/notification-centre`
- **Page:** `client/src/pages/notification-centre` (1092 LOC)
- **Roles:** admin, management
- **Business capability:** Notifications
- **System of record (primary API namespace):** `/api/console` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Console (this feature is a consumer)
- **Backend APIs (3):** `/api/console/incidents`, `/api/console/incidents/`, `/api/console/incidents/operators`
- **Write operations:** none detected (read-only view)
- **Shares endpoints with:** Console (2)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-106 — WhatsApp Alerts

- **Group:** Platform (`platform`)
- **Path:** `/whatsapp-alerts`
- **Page:** `client/src/pages/whatsapp-alerts` (449 LOC)
- **Roles:** admin, management
- **Business capability:** Notifications
- **System of record (primary API namespace):** `/api/whatsapp` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/whatsapp`
- **Backend APIs (3):** `/api/settings`, `/api/whatsapp/logs`, `/api/whatsapp/test`
- **Write operations:** `PATCH /api/settings`, `POST /api/whatsapp/test`
- **Shares endpoints with:** Server Monitor (1), Route Tester (1), Team & KAM (1)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-107 — SMS / A2P

- **Group:** Platform (`platform`)
- **Path:** `/sms-monitor`
- **Page:** `client/src/pages/sms-monitor` (2342 LOC)
- **Roles:** admin, management
- **Registry status:** planned
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/flows` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/flows`
- **Backend APIs (19):** `/api/bhaoo/messages`, `/api/bhaoo/profiles`, `/api/bhaoo/profiles/`, `/api/bhaoo/stats`, `/api/bhaoo/status`, `/api/flows/otp/generate-keys`, `/api/flows/otp/key-rotation-status`, `/api/flows/otp/poll-verified`, `/api/flows/otp/provision`, `/api/flows/otp/public-key`, `/api/flows/otp/test`, `/api/messaging/policy`, `/api/meta-flows/settings`, `/api/sms/send`, `/api/voice-otp/calls`, `/api/voice-otp/stats`, `/api/voice-otp/stats/hourly`, `/api/whatsapp/message`, `/api/whatsapp/meta/test`
- **Write operations:** `DELETE /api/bhaoo/profiles/`, `PATCH /api/bhaoo/profiles/`, `PATCH /api/messaging/policy`, `PATCH /api/meta-flows/settings`, `POST /api/bhaoo/profiles`, `POST /api/bhaoo/profiles/`, `POST /api/flows/otp/generate-keys`, `POST /api/flows/otp/provision`, `POST /api/flows/otp/test`, `POST /api/sms/send`, `POST /api/whatsapp/message`, `POST /api/whatsapp/meta/test`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-108 — Workspace Settings

- **Group:** Platform (`platform`)
- **Path:** `/workspace-settings`
- **Page:** `client/src/pages/workspace-settings` (321 LOC)
- **Roles:** admin, super_admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/governance` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Governance Console (this feature is a consumer)
- **Backend APIs (2):** `/api/governance/portals/`, `/api/portal/definitions`
- **Write operations:** `PUT /api/governance/portals/`
- **Shares endpoints with:** Governance Console (2)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-109 — Navigation Manager

- **Group:** Platform (`platform`)
- **Path:** `/navigation-manager` · **always visible (locked)**
- **Page:** `client/src/pages/sidebar-settings` (359 LOC)
- **Roles:** admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/settings` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Team & KAM (this feature is a consumer)
- **Backend APIs (1):** `/api/settings/sidebar-visibility`
- **Write operations:** `POST /api/settings/sidebar-visibility`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-110 — Governance Console

- **Group:** Platform (`platform`)
- **Path:** `/governance`
- **Page:** `client/src/pages/navigation-governance` (1174 LOC)
- **Roles:** super_admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/governance` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** **this feature** — largest consumer of `/api/governance`
- **Backend APIs (12):** `/api/governance/assignments`, `/api/governance/assignments/`, `/api/governance/assignments/0`, `/api/governance/assignments/reorder`, `/api/governance/modules`, `/api/governance/portals/`, `/api/governance/sections`, `/api/governance/sections/`, `/api/governance/sections/reorder`, `/api/portal/definitions`, `/api/portal/modules`, `/api/portal/sections`
- **Write operations:** `DELETE /api/governance/assignments/0`, `DELETE /api/governance/sections/`, `POST /api/governance/assignments`, `POST /api/governance/assignments/reorder`, `POST /api/governance/sections`, `POST /api/governance/sections/reorder`, `PUT /api/governance/assignments/`, `PUT /api/governance/portals/`, `PUT /api/governance/sections/`
- **Shares endpoints with:** Workspace Settings (2)
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)

### PF-111 — My Account

- **Group:** Platform (`platform`)
- **Path:** `/account` · **always visible (locked)**
- **Page:** `client/src/pages/account` (351 LOC)
- **Roles:** admin, management, viewer, noc_operator, team_lead, super_admin
- **Business capability:** Platform
- **System of record (primary API namespace):** `/api/user` _(DB-table mapping pending server-side verification)_
- **Canonical owner (heuristic):** Live Calls (this feature is a consumer)
- **Backend APIs (1):** `/api/user/config`
- **Write operations:** `PATCH /api/user/config`
- **Shares endpoints with:** none
- **Business purpose:** _to be verified during runtime audit_
- **Production tested:** Pending
- **Decision:** — (inventory only)
