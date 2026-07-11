# Platform Dependency Matrix

> **Project:** Platform Feature Rationalization (PFR) — Phase 1 Discovery
> **Generated:** 2026-07-11 · dependency = the `/api/` namespaces a feature's page calls; "shared with" = other features calling at least one identical endpoint (count in parentheses).
>
> Use this before planning any merge: it shows the blast radius of changing or retiring a feature. Data-level only — cross-page component imports are not yet mapped.

## Namespace ownership (heuristic)

Candidate canonical owner = the feature whose page consumes the most endpoints under a namespace. **Heuristic, pending verification** — the owner of the data is not necessarily the page with the most calls.

| API namespace | Candidate owner | Consumers |
|---|---|---|
| `/api/sippy` | Accounts | Live Calls, NOC Dashboard, NOC Command, Ops Console, BitsEye 2, Graphs, Network Topology, Client Portal, Company List, Organization Mgmt, Create Account, DID Management, Recordings, Products, Vendor List, Balance Monitor, Routing Manager, Route Simulator, Route Tester, SIP Trace, Tools, ASR / ACD, Reports, CDR Viewer, Fraud Engine, Firewall Manager, STIR/SHAKEN, Invoices, Client Reconciliation, Carrier Reconciliation, Rate Cards, Platform Settings, Team & KAM, Tariff Versions, Rating Verification, Rating Snapshots, Notifications |
| `/api/carrier-scores` | Carrier Scoring | NOC Dashboard, Route Intelligence, NOC Command, Ops Console, Network Topology, Failover Engine, Traffic Steering |
| `/api/kam` | Graphs | Company List, Onboarding Wizard, Account Names, BitsEye, Team & KAM, Notifications |
| `/api/settings` | Team & KAM | Server Monitor, Route Tester, Number Intelligence, Platform Settings, WhatsApp Alerts, Navigation Manager |
| `/api/anomalies` | AI Ops Center | Alerts, NOC Command, Ops Console, BitsEye 2, Decision Overlay |
| `/api/incidents` | AI Ops Center | NOC Dashboard, BitsEye 2, Decision Overlay, Validation Console |
| `/api/companies` | Company List | Organization Mgmt, Create Account, Onboarding Wizard, Invoices |
| `/api/account-state` | Accounts | Live Calls, AI Ops Center, Decision Overlay |
| `/api/switches` | Multi-Switch View | Live Calls, Accounts, Platform Settings |
| `/api/user` | Live Calls | Graphs, Balance Monitor, My Account |
| `/api/alerts` | Alerts | NOC Dashboard, NOC Command, Ops Console |
| `/api/ai` | Route Intelligence | NOC Dashboard, AI Ops Center, Decision Overlay |
| `/api/noc` | NOC Dashboard | Incident Command, Route Intelligence, Balance Monitor |
| `/api/recommendations` | AI Ops Center | NOC Dashboard, Route Intelligence, Decision Overlay |
| `/api/aiops` | AI Ops Center | NOC Command, Ops Console, Decision Overlay |
| `/api/analytics` | Traffic Analytics | RTP Analytics, Reports, BitsEye |
| `/api/routing-suggestions` | AI Ops Center | Decision Overlay, Route Optimisation, Traffic Steering |
| `/api/vendors` | Routing Manager | NOC Command, Ops Console |
| `/api/bitseye` | BitsEye 2 | Graphs, BitsEye |
| `/api/clients` | Accounts | Reports, Rate Cards |
| `/api/portal` | Governance Console | Accounts, Workspace Settings |
| `/api/rate-cards` | Rate Cards | LCR Analyser, Traffic Analytics |
| `/api/simulation` | Failover Engine | Route Optimisation, Simulation Sandbox |
| `/api/ai-ops` | AI Ops Center | Decision Overlay, Carrier Intelligence |
| `/api/dmr` | Daily Minutes Report | Invoices, Margin Intelligence |
| `/api/server-health` | Server Health | NOC Dashboard |
| `/api/console` | Console | Notification Centre |
| `/api/monitoring` | Server Monitor | BitsEye 2 |
| `/api/traffic-alerts` | Graphs | Team & KAM |
| `/api/fas-events` | Network Topology | Fraud Engine |
| `/api/client-ip-requests` | Company List | Create Account |
| `/api/stats` | SLA Scorecard | QoS Heatmap |
| `/api/route-traces` | Carrier Scoring | Replay Engine |
| `/api/routing-cache` | Routing Manager | Route Simulator |
| `/api/approvals` | Approval Queue | Failover Engine |
| `/api/fas` | Fraud Engine | Tools |
| `/api/reports` | Reports | ASR / ACD |
| `/api/actions` | AI Ops Center | Decision Overlay |
| `/api/cdr-anomalies` | AI Ops Center | Decision Overlay |
| `/api/engine` | AI Ops Center | Decision Overlay |
| `/api/nlq` | AI Ops Center | Decision Overlay |
| `/api/intelligence` | Intelligence Hub | Validation Console |
| `/api/route-optimisation` | Route Optimisation | Simulation Sandbox |
| `/api/audit-log` | Audit Log | Security Ops |
| `/api/security` | Security Ops | MFA / 2FA |
| `/api/billing` | Carrier Reconciliation | Billing |
| `/api/invoices` | Invoices | Platform Settings |
| `/api/rating-snapshots` | Rating Snapshots | Invoices |
| `/api/reconciliation-report-schedules` | Client Reconciliation | Carrier Reconciliation |
| `/api/reconciliation` | Client Reconciliation | Carrier Reconciliation |
| `/api/watcher-recipients` | Platform Settings | Team & KAM |
| `/api/sender-profiles` | Sender Profiles | Commercial Notices |
| `/api/whatsapp` | WhatsApp Alerts | SMS / A2P |
| `/api/governance` | Governance Console | Workspace Settings |

## Per-feature dependencies

| Feature | Capability | Depends on (namespaces) | Writes | Shared with (top) |
|---|---|---|---|---|
| Live Calls | Live Call Monitoring | `sippy`, `call-history`, `switches`, `account-state`, `ip-lookup` +1 | 2 | Accounts (3), Platform Settings (3), NOC Dashboard (2), Multi-Switch View (2) |
| Alerts | Alerting | `alerts`, `anomalies` | 1 | NOC Command (3), Ops Console (3), NOC Dashboard (1), BitsEye 2 (1) |
| NOC Dashboard | NOC Operations | `noc`, `ai`, `sippy`, `alerts`, `carrier-scores` +4 | 3 | Route Intelligence (6), NOC Command (3), Ops Console (3), Live Calls (2) |
| Incident Command | Incident Management | `noc` | 3 | NOC Dashboard (2), Route Intelligence (1) |
| Route Intelligence | Routing Recommendations | `ai`, `route-intelligence`, `copilot`, `carrier-scores`, `noc` +1 | 8 | NOC Dashboard (6), Carrier Scoring (2), AI Ops Center (2), Decision Overlay (2) |
| NOC Command | NOC Operations | `alerts`, `aiops`, `anomalies`, `carrier-scores`, `sippy` +1 | 1 | Ops Console (7), Alerts (3), NOC Dashboard (3), BitsEye 2 (2) |
| Ops Console | NOC Operations | `alerts`, `vendors`, `aiops`, `anomalies`, `carrier-scores` +3 | 1 | NOC Command (7), Alerts (3), NOC Dashboard (3), BitsEye 2 (2) |
| Console | Incident Management | `console` | 1 | Notification Centre (2) |
| BitsEye 2 | Unified Analytics | `bitseye`, `monitoring`, `anomalies`, `incidents`, `sippy` | 4 | NOC Command (2), Ops Console (2), Server Monitor (2), BitsEye (2) |
| Live Traffic | Live Call Monitoring | `live-traffic` | 0 | — |
| Traffic Map | Live Call Monitoring | `geo`, `traffic-map` | 0 | — |
| Graphs | Performance Charts | `kam`, `bitseye`, `mos-carrier-stats`, `mos-trending`, `quality-events` +5 | 5 | Team & KAM (5), Account Names (3), BitsEye (2), Notifications (2) |
| Multi-Switch View | Live Network | `switches` | 4 | Live Calls (2), Platform Settings (2), Accounts (1) |
| Server Monitor | Live Network | `monitoring`, `settings` | 6 | BitsEye 2 (2), Route Tester (1), Team & KAM (1), WhatsApp Alerts (1) |
| Server Health | Live Network | `server-health` | 2 | NOC Dashboard (1) |
| SBC Monitor | Live Network | `sbc-hosts` | 2 | — |
| Network Topology | Live Network | `sippy`, `carrier-scores`, `fas-events` | 0 | NOC Dashboard (2), NOC Command (2), Ops Console (2), Live Calls (1) |
| Accounts | Company | `sippy`, `account-state`, `clients`, `portal`, `switches` | 14 | Routing Manager (4), Live Calls (3), Organization Mgmt (3), Vendor List (3) |
| Client Portal | Company | `sippy`, `admin`, `portal-tokens` | 4 | Accounts (1), DID Management (1), Products (1), Route Simulator (1) |
| Reseller Management | Company | `resellers` | 3 | — |
| Company List | Company | `sippy`, `client-ip-requests`, `companies`, `ip-sharing-approvals`, `kam` +1 | 9 | Onboarding Wizard (3), Create Account (2), Graphs (1), Organization Mgmt (1) |
| Organization Mgmt | Company | `sippy`, `companies` | 0 | Accounts (3), Create Account (2), Invoices (2), Live Calls (1) |
| Create Account | Company | `sippy`, `client-ip-requests`, `client-wizard`, `companies` | 2 | Accounts (2), Company List (2), Organization Mgmt (2), Onboarding Wizard (1) |
| Onboarding Wizard | Company | `companies`, `kam` | 2 | Company List (3), Graphs (1), Organization Mgmt (1), Create Account (1) |
| Account Names | Company | `kam`, `accounts-list` | 2 | Graphs (3), Team & KAM (3), Notifications (2), Company List (1) |
| DID Management | Company | `sippy` | 3 | Accounts (1), Client Portal (1), Route Simulator (1), Route Tester (1) |
| Recordings | Company | `sippy` | 0 | — |
| Products | Company | `product-docs`, `sippy` | 3 | Client Portal (1), CDR Viewer (1) |
| Vendor List | Carrier Management | `sippy` | 5 | Accounts (3), Routing Manager (3), Network Topology (1), ASR / ACD (1) |
| SLA Scorecard | Carrier SLA | `stats`, `vendor-sla` | 0 | — |
| Carrier Scoring | Carrier Performance | `carrier-scores`, `route-traces` | 1 | Route Intelligence (2), NOC Dashboard (1), NOC Command (1), Ops Console (1) |
| Stability Timeline | Carrier Performance | `vendor-stability-timeline` | 0 | — |
| Balance Monitor | Carrier Finance | `accounts`, `balance-alert-notification-settings`, `balance-alert-thresholds`, `noc`, `sippy` +1 | 7 | Firewall Manager (2), Live Calls (1), NOC Dashboard (1), Graphs (1) |
| Routing Manager | Routing Configuration | `routing-cache`, `sippy`, `vendors`, `coverage`, `qbr` +1 | 16 | Accounts (4), Vendor List (3), Rate Cards (2), Network Topology (1) |
| LCR Analyser | Routing Analysis | `lcr`, `rate-cards` | 1 | Traffic Analytics (1), Rate Cards (1) |
| Route Simulator | Routing Validation | `routing-cache`, `simulator`, `sippy` | 1 | Accounts (1), Client Portal (1), DID Management (1), Routing Manager (1) |
| Failover Engine | Operations | `failover-executions`, `failover-policies`, `routing`, `approvals`, `carrier-scores` +1 | 5 | NOC Dashboard (1), Route Intelligence (1), NOC Command (1), Ops Console (1) |
| Route Tester | Routing Validation | `sippy`, `settings` | 1 | Team & KAM (2), Server Monitor (1), Accounts (1), Client Portal (1) |
| SIP Trace | Operations | `sippy` | 0 | — |
| Replay Engine | Operations | `route-traces` | 0 | Carrier Scoring (1) |
| Test Campaigns | Operations | `campaigns` | 4 | — |
| Tools | Operations | `sippy`, `fas` | 4 | Fraud Engine (2), Accounts (1), Client Portal (1), DID Management (1) |
| Traffic Analytics | Traffic Analytics | `analytics`, `rate-cards` | 0 | Rate Cards (2), LCR Analyser (1) |
| ASR / ACD | Traffic Analytics | `sippy`, `reports` | 0 | Accounts (2), Network Topology (1), Client Portal (1), DID Management (1) |
| QoS Heatmap | Media Quality | `stats` | 0 | — |
| Codec Analytics | Media Quality | `codec-analytics` | 0 | — |
| RTP Analytics | Media Quality | `analytics` | 0 | — |
| Revenue Heatmap | Revenue Analytics | `geo-intelligence`, `revenue-heatmap` | 0 | — |
| Reports | Reporting | `reports`, `sippy`, `analytics`, `clients` | 0 | Accounts (3), Live Calls (1), Organization Mgmt (1), ASR / ACD (1) |
| Traffic Forecast | Analytics & Reports | `traffic-forecast` | 0 | — |
| CDR Viewer | Analytics & Reports | `sippy` | 0 | Client Portal (1), Products (1) |
| BitsEye | Unified Analytics | `bitseye`, `analytics`, `kam` | 0 | BitsEye 2 (2), Graphs (2), Company List (1), Onboarding Wizard (1) |
| AI Ops Center | AI Decisioning | `aiops`, `anomalies`, `routing-suggestions`, `account-state`, `actions` +7 | 11 | Decision Overlay (23), Traffic Steering (3), NOC Dashboard (2), Route Intelligence (2) |
| Intelligence Hub | AI Decisioning | `intelligence` | 0 | — |
| Decision Overlay | AI Decisioning | `aiops`, `anomalies`, `routing-suggestions`, `account-state`, `actions` +7 | 11 | AI Ops Center (23), Traffic Steering (3), NOC Dashboard (2), Route Intelligence (2) |
| Validation Console | AI Validation | `incidents`, `intelligence` | 0 | — |
| Carrier Intelligence | Carrier Performance | `ai-ops`, `carrier-intelligence` | 0 | AI Ops Center (1), Decision Overlay (1) |
| Vendor RCA | Carrier Diagnostics | `vendor-rca` | 0 | — |
| Prefix Intelligence | Prefix Analysis | `vendor-prefix-intelligence` | 0 | — |
| Routing Intelligence | Routing Recommendations | `routing-rules` | 4 | — |
| Number Intelligence | Number Analysis | `number-lookup`, `settings` | 1 | — |
| Cost Optimisation | Cost Recommendations | `cost-optimisation` | 0 | — |
| Route Optimisation | Routing Recommendations | `route-optimisation`, `routing-suggestions`, `explain`, `simulation` | 3 | AI Ops Center (2), Decision Overlay (2), Traffic Steering (2), Simulation Sandbox (2) |
| Traffic Steering | Traffic Steering | `routing-suggestions`, `carrier-scores` | 2 | AI Ops Center (3), Decision Overlay (3), Route Optimisation (2), NOC Dashboard (1) |
| Simulation Sandbox | AI Validation | `route-optimisation`, `simulation` | 1 | Route Optimisation (2), Failover Engine (1) |
| Fraud Engine | Security & Compliance | `fas`, `blacklist-rules`, `irsf-events`, `fas-events`, `simbox` +1 | 7 | Tools (2), Network Topology (1) |
| Firewall Manager | Security & Compliance | `sippy` | 2 | Accounts (2), Balance Monitor (2), Invoices (1) |
| SLA Breaches | Security & Compliance | `sla-breaches` | 0 | — |
| Approval Queue | Change Approval | `approvals` | 1 | Failover Engine (1) |
| Approval Rules | Change Approval | `approval-settings` | 1 | — |
| STIR/SHAKEN | Security & Compliance | `sippy` | 0 | — |
| Compliance | Compliance | `compliance` | 0 | — |
| Audit Log | Audit Trail | `audit-log` | 0 | Security Ops (1) |
| Permission Matrix | Security & Compliance | `rbac` | 2 | — |
| MFA / 2FA | Security & Compliance | `security` | 2 | — |
| Security Ops | Security & Compliance | `security`, `audit-log` | 5 | Audit Log (1) |
| Billing | Finance & Billing | `billing` | 0 | — |
| Billing Disputes | Finance & Billing | `disputes` | 3 | — |
| Invoices | Finance & Billing | `invoices`, `rating-snapshots`, `sippy`, `companies`, `dmr` | 5 | Accounts (2), Organization Mgmt (2), Company List (1), Create Account (1) |
| Invoice Queue | Finance & Billing | `invoice-jobs` | 3 | — |
| Invoice Templates | Finance & Billing | `branding-profiles`, `invoice-templates` | 4 | — |
| Credit Notes | Finance & Billing | `credit-notes` | 2 | — |
| Credit Control | Finance & Billing | `credit-control` | 4 | — |
| Dispute Cases | Finance & Billing | `dispute-cases` | 3 | — |
| Dispute Defense | Finance & Billing | `dispute-defense` | 1 | — |
| Client Reconciliation | Reconciliation | `client-reconciliation`, `reconciliation-report-schedules`, `reconciliation`, `sippy` | 8 | Carrier Reconciliation (3), Accounts (1), Client Portal (1), DID Management (1) |
| Carrier Reconciliation | Reconciliation | `billing`, `carrier-reconciliations`, `reconciliation-report-schedules`, `reconciliation`, `sippy` | 6 | Client Reconciliation (3), Accounts (1), Organization Mgmt (1), Invoices (1) |
| Margin Intelligence | Margin Analytics | `margin`, `dmr` | 3 | Daily Minutes Report (2) |
| Daily Minutes Report | Finance & Billing | `dmr` | 2 | Margin Intelligence (2) |
| AI Assurance | Financial Assurance | `ai-assurance` | 2 | — |
| Partner Portal | Finance & Billing | `partner-profiles` | 4 | — |
| Rate Cards | Commercial Rates | `sippy`, `rate-cards`, `clients` | 2 | Accounts (2), Routing Manager (2), Traffic Analytics (2), Organization Mgmt (1) |
| Executive Reports | Finance & Billing | `executive-reports` | 1 | — |
| Platform Settings | Platform | `download`, `sippy`, `alert-config`, `scheduled-reports`, `sippy-watcher` +5 | 25 | Live Calls (3), Multi-Switch View (2), Accounts (2), Team & KAM (2) |
| Team & KAM | Platform | `kam`, `team`, `settings`, `sippy`, `watcher-recipients` +2 | 11 | Graphs (5), Account Names (3), Notifications (3), Route Tester (2) |
| API Keys | Platform | `keys` | 2 | — |
| VPN Config | Platform | — | 0 | — |
| Tariff Versions | Rating Lifecycle | `tariff-versions`, `sippy` | 2 | Accounts (1), Organization Mgmt (1), Invoices (1), Carrier Reconciliation (1) |
| Rating Verification | Rating Lifecycle | `rating-verifications`, `sippy` | 1 | Accounts (1), Organization Mgmt (1), Invoices (1), Carrier Reconciliation (1) |
| Rating Snapshots | Rating Lifecycle | `rating-snapshots`, `sippy` | 2 | Accounts (1), Organization Mgmt (1), Invoices (1), Carrier Reconciliation (1) |
| Comm. Policies | Platform | `communication-policies`, `smtp-sender-profiles` | 3 | — |
| Commercial Notices | Notifications | `commercial-notifications`, `sender-profiles` | 3 | Sender Profiles (1) |
| Sender Profiles | Notifications | `sender-profiles` | 4 | Commercial Notices (1) |
| Notifications | Notifications | `kam`, `email`, `sippy` | 2 | Team & KAM (3), Graphs (2), Account Names (2), Accounts (1) |
| Notification Centre | Notifications | `console` | 0 | Console (2) |
| WhatsApp Alerts | Notifications | `whatsapp`, `settings` | 2 | Server Monitor (1), Route Tester (1), Team & KAM (1) |
| SMS / A2P | Platform | `flows`, `bhaoo`, `voice-otp`, `whatsapp`, `messaging` +2 | 12 | — |
| Workspace Settings | Platform | `governance`, `portal` | 1 | Governance Console (2) |
| Navigation Manager | Platform | `settings` | 1 | — |
| Governance Console | Platform | `governance`, `portal` | 9 | Workspace Settings (2) |
| My Account | Platform | `user` | 1 | — |
