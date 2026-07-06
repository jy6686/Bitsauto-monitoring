# Bitsauto Monitoring Platform — Full Feature Registry

*Document date: May 2026 — covers all features built from project start through current session*

---

## HOW TO READ THIS DOCUMENT

Each feature has a **status tag**:
- ✅ **REAL** — backend engine + frontend both live, real data flowing
- ⚠️ **PARTIAL** — infrastructure exists, intelligence or enrichment layer incomplete
- 🔲 **SHELL** — UI exists, static or near-static, 1 real data hook or fewer
- ❌ **NOT BUILT** — no page, no route, no schema

---

## PART 1 — CORE OPERATIONAL PLATFORM

### 1.1 Real-Time Dashboard ✅ REAL
**Page:** `dashboard.tsx` — 43 hooks  
Live call counters, active switch status, MOS/Jitter/Latency/Packet Loss KPI tiles, ASR/ACD/PDD network metrics, revenue snapshot, recent alerts feed, customizable widget layout.  
Connects to: Sippy XML-RPC live calls, Sippy CDR cache, metric snapshots.

### 1.2 Live Call Monitor ✅ REAL
**Page:** `calls-list.tsx` — 40 hooks  
Real-time active call table with caller/callee, route, codec, MOS per leg, duration, vendor. Multiple sub-views: Active, CDR History, Snapshots, Fraud Watch.  
Push-based NOC WebSocket feeds the live call count to sidebar badge. Background snapshot every 60s.

### 1.3 Multi-Switch Consolidated View ✅ REAL
**Page:** `multi-switch.tsx` — 23 hooks  
Single-pane view across multiple Sippy switches. Per-switch call volume, status, latency, and KPIs. Credential pair management for each switch.

### 1.4 CDR Analytics & Reporting ✅ REAL
**Page:** `analytics.tsx` — 19 hooks, `reports.tsx` — 20 hooks, `cdrs.tsx` — 4 hooks  
72-hour rolling CDR cache with live Sippy fallback. Filterable by account, vendor, date range, result. CSV export. Scheduled report engine (`scheduled_reports` table).

### 1.5 BitsEye Drill-Down Analytics ✅ REAL
**Page:** `bitseye.tsx` — 54 hooks  
Per-client, per-KAM, per-destination traffic analysis. Revenue/margin drill-down, route quality scoring, client performance trends. Most data-rich page in the system.

### 1.6 Revenue & Margin Analysis ✅ REAL
**Page:** `analytics.tsx` (tab)  
Cost-per-minute vs. sell-rate per destination, margin % by route, vendor cost breakdown, profitability trends.

### 1.7 QoS Heatmap ✅ REAL
**Page:** `qos-heatmap.tsx` — 6 hooks  
Hour-of-day × day-of-week MOS quality heatmap. Identifies recurring degradation windows. Uses `mos_hourly` table.

### 1.8 Balance Monitor ✅ REAL
**Page:** `balance-monitor.tsx` — 18 hooks  
Vendor prepaid balance tracking. Automatic snapshot polling, low-balance alert thresholds, balance history chart per vendor.

### 1.9 Graphs & Trends ✅ REAL
**Page:** `graphs.tsx` — 31 hooks  
Time-series charting for ASR, ACD, PDD, call volume, MOS. Configurable time windows, per-vendor and per-account overlays.

---

## PART 2 — ROUTING & CONTROL PLANE

### 2.1 Routing Manager ✅ REAL
**Page:** `routing-manager.tsx` — 66 hooks  
Four sub-modules: Routing Group Manager, Destination Set Explorer, Vendor Connections, Routing Audit Trail. Full CRUD on routing groups and destination sets via Sippy XML-RPC with approval gate. `routing_groups_cache`, `destination_sets_cache` tables with 5-minute sync.

### 2.2 LCR Analyser ✅ REAL
**Page:** `lcr-analyser.tsx` — 5 hooks  
Least-Cost Routing analysis per destination prefix. Compares vendor rates, quality scores, and current route assignments. Feeds routing intelligence engine.

### 2.3 Cost Optimisation Engine ✅ REAL
**Page:** `cost-optimisation.tsx` — 6 hooks  
Identifies over-cost routes, suggests cheaper alternatives, models margin impact of route changes. Alert rules for when cost-per-minute exceeds threshold.

### 2.4 Automated Routing Intelligence ✅ REAL
**Page:** `routing-intelligence.tsx` — 12 hooks  
Rule-based automated routing decisions: ASR drop → deprioritise route, cost threshold breach → flag for approval, trunk capacity near-limit → pre-alert. Integrated with approval queue. `routing_rules` table.

### 2.5 Call Flow Simulator / Routing Audit Trail ✅ REAL
**Page:** `call-flow-simulator.tsx` — 8 hooks  
Simulates how a given CLI/CLD pair would route through the current dial plan. Shows which routing group, destination set, and vendor would handle the call. Audit log of all routing changes.

### 2.6 Policy Simulator ✅ REAL (tab within Routing Manager)
Models impact of a proposed routing rule change before applying it. Shows affected call volume and estimated cost/quality delta.

---

## PART 3 — NETWORK MONITORING

### 3.1 SIP Trace Viewer + Ladder Diagram ✅ REAL *(completed this session)*
**Page:** `sip-trace.tsx` — 5 hooks  
Two modes:
- **CDR Lookup mode** — enter Call-ID, CLI, or CLD → reconstructs full SIP dialog from Sippy CDR timing fields + packet dump API
- **Paste mode** — paste raw SIP capture → parses and renders immediately

**Ladder diagram features (built this session):**
- Three-lane layout: Caller | Sippy (centre node) | Carrier
- Timing delta column (Δms) between each consecutive event
- Failure path highlighting — 4xx/5xx rows get red background + red border accent + red arrow lines
- PDD metric bar — colour-coded: green <2s, amber 2–5s, red >5s — pulls from CDR `pdd` field or computes from INVITE→200 timestamps
- Carrier involvement inference — INVITE/BYE/ACK/1xx–2xx span both lanes; Sippy-local messages show dashed right lane
- Expandable raw SIP detail per event row
- Direct link from CDR table rows → `?callId=` URL parameter pre-triggers lookup

### 3.2 Server & Infrastructure Monitoring ✅ REAL
**Page:** `server-monitoring.tsx` — 58 hooks  
Monitored hosts with ICMP/HTTP ping, uptime tracking, outage log, alert thresholds. `monitored_hosts`, `host_outage_log` tables. SIP OPTIONS probe monitoring.

### 3.3 SBC / Media Plane Monitoring ✅ REAL
**Page:** `sbc-monitor.tsx` — 11 hooks  
SBC host health, active media sessions, per-host MOS/jitter/packet loss, codec breakdown, NAT traversal metrics. `sbc_hosts` table with polling. Most metrics from Sippy or SNMP polling.

### 3.4 RTP Analytics ⚠️ PARTIAL
**Page:** `rtp-analytics.tsx` — 4 hooks  
Real-time RTP stream metrics aggregated from call snapshots. MOS distribution, jitter histograms, packet loss heatmap. No true packet-level RTP correlation — metrics are signalling-layer derived, not media-plane captured.

### 3.5 SIP OPTIONS Monitor ✅ REAL (within server-monitoring)
Periodic SIP OPTIONS probe to all registered trunks. Up/down status, response-time tracking, alert on no-response.

### 3.6 Traffic Map ✅ REAL
**Page:** `traffic-map.tsx` — 11 hooks  
World map showing active call volumes by destination country. Colour intensity by call volume.

---

## PART 4 — SECURITY & FRAUD

### 4.1 FAS / IRSF Detection ✅ REAL
**Page:** `fraud.tsx` — 39 hooks  
False Answer Supervision and International Revenue Share Fraud detection. Pattern analysis on CDR data: short calls to premium-rate destinations, anomalous ASR, off-hours traffic spikes. `fas_events`, `irsf_events`, `simbox_scores` tables.

### 4.2 Auto-Blacklist ✅ REAL
**Page:** `firewall.tsx` — 13 hooks  
Rule-based automatic blacklisting of source IPs, CLI patterns, and destination prefixes. `blacklist_rules` table with hit counter. Manual override + time-expiry support.

### 4.3 Simbox Detection ✅ REAL (within Fraud)
SIM box scoring engine. Detects bypass fraud signatures: consistent short calls, same destination patterns, statistical fingerprinting. `simbox_scores` table.

### 4.4 Approval Engine ✅ REAL
**Page:** `approval-queue.tsx` — 15 hooks, `approval-settings.tsx` — 8 hooks  
Multi-role approval workflow for all Sippy write operations (account creation, rate changes, routing changes, blacklist additions). Role-based scope: admin approves all, team_lead approves team, etc.

**Signal Trace Debugger** (built this session): each approval execution now captures `requestReceivedAt`, `execStartedAt`, `execCompletedAt`, `signalEval` (types emitted + skip reason) in `execResult.trace`. Expanded panel in approval queue shows structured timeline per request.

Tables: `approval_requests`, `approval_audit_log`.

---

## PART 5 — AI OPS & INTELLIGENCE

### 5.1 AI Ops Events ✅ REAL
**Table:** `ai_ops_events`  
Signal emission layer. Fires events on: approval execution failures, execution latency >6s. Each event carries `entity` (operationType), `severity`, `message`, `metadata`.

### 5.2 Anomaly Detection Engine ✅ REAL
**Table:** `anomaly_events`  
Background engine runs every 15 minutes. Baselines vendor-level MOS, ASR, and call volume. Detects statistical deviations. Creates `anomaly_events` with vendor, metric, baseline vs. observed values.

### 5.3 Correlation Engine ✅ REAL *(built this session)*
**File:** `server/aiops/correlation-engine.ts`  
**Table:** `ai_ops_incidents`  
Groups `ai_ops_events` (signals) and `anomaly_events` (anomalies) into unified incidents. Deterministic grouping by entity/vendor. Upsert logic: existing open incidents absorb new signals. Auto-resolve after 30-minute signal silence. Runs at T+6 min, repeats every 5 minutes.

Routes: `GET /api/aiops/incidents`, `POST /api/aiops/incidents/run`

### 5.4 AI Ops UI ✅ REAL *(updated this session)*
**Page:** `ai-ops.tsx` — 15 hooks  
Four tabs: All / Anomalies / Signals / Incidents. Incident cards show: severity badge, signal count, anomaly count, duration, active/resolved status, "Run now" button. Live auto-refresh.

### 5.5 Signal Mapper ✅ REAL
**File:** `server/aiops/signal-mapper.ts`  
Maps approval execution results → signal types. Classifies signals as: execution_failure, high_latency, partial_success, rollback_triggered. Feeds `ai_ops_events`.

---

## PART 6 — ACCOUNTS, PRODUCTS & RATES

### 6.1 Client Account Manager ✅ REAL
**Page:** `clients.tsx` — 87 hooks  
Full CRUD for Sippy customer accounts via XML-RPC. Account details, credit limits, product assignment, rate card linkage, call history per account.

### 6.2 Vendor Connections ✅ REAL
**Page:** `vendors.tsx` — 21 hooks  
Sippy vendor (carrier) account management. Connection health, rate card assignment, concurrent call limits, SLA tracking.

### 6.3 Rate Cards ✅ REAL
**Page:** `rate-cards.tsx` — 41 hooks, `rate-editor.tsx` — 11 hooks  
Rate card CRUD, bulk upload, per-prefix rate entry, effective date management, rate vs. cost comparison. `rate_cards`, `rate_card_entries` tables.

### 6.4 Products ✅ REAL
**Page:** `products.tsx` — 17 hooks  
Product catalogue management. Leading-digit prefix encoding for product classification. Assignment to accounts.

### 6.5 DIDs ✅ REAL
**Page:** `dids.tsx` — 14 hooks  
DID (Direct Inward Dialling) number inventory management. Assignment, porting status, per-DID CDR view.

### 6.6 Account Names ✅ REAL
**Page:** `account-names.tsx` — 17 hooks  
Human-readable name mapping for Sippy numeric account IDs. Used across all CDR and analytics views.

### 6.7 Billing Disputes ✅ REAL
**Page:** `billing-disputes.tsx` — 10 hooks  
Log and track billing discrepancy cases. Links to CDR evidence. Status workflow: open → under review → resolved.

---

## PART 7 — TEAM & ACCESS MANAGEMENT

### 7.1 Role-Based Access Control ✅ REAL
**Roles:** `super_admin`, `admin`, `management`, `team_lead`, `noc_operator`, `viewer`  
Every route, page section, and mutation is gated by role. `user_roles` table. Sidebar items are filtered per role at render time.

### 7.2 KAM Management ✅ REAL
**Page:** `team.tsx` — 49 hooks  
Key Account Manager hierarchy. Org chart: HOD → SVP → VP → Manager → TeamLead → KAM. Account assignment per KAM. `kams`, `kam_accounts` tables. Role Assignment tab for promoting/demoting users.

### 7.3 Vendor SLA Scorecard ✅ REAL
**Page:** `vendor-sla-scorecard.tsx` — 8 hooks  
Per-vendor SLA performance report. ASR, ACD, PDD, MOS trends, breach count, breach log. `sla_breach_log`, `vendor_metric_baselines` tables.

---

## PART 8 — ALERTS & NOTIFICATIONS

### 8.1 Alert Rules Engine ✅ REAL
**Page:** `alerts.tsx`, `approval-settings.tsx`  
Configurable threshold-based alert rules. Triggers on MOS, ASR, ACD, PDD, packet loss, jitter, balance. `alert_rules`, `traffic_alerts` tables.

### 8.2 WhatsApp Alerts ✅ REAL
**Page:** `whatsapp-alerts.tsx` — 13 hooks  
Sends alerts to configured WhatsApp numbers via API. `watcher_recipients`, `whatsapp_alert_log` tables. Per-event-type routing.

### 8.3 Email Centre ✅ REAL
**Page:** `email-centre.tsx` — 10 hooks  
Email notification management. Template configuration, recipient groups, scheduled digest reports.

### 8.4 Sippy Change Watcher ✅ REAL
**Tables:** `sippy_snapshots`, `sippy_change_events`  
Periodic snapshot of Sippy account/vendor state. Diffs consecutive snapshots to detect unauthorised or unexpected changes. Fires alerts on deviation.

---

## PART 9 — USER EXPERIENCE & TOOLS

### 9.1 Internal Team Chat ✅ REAL
**Page:** `chat.tsx` — 10 hooks  
Multi-room chat for NOC/operations team. `chat_rooms`, `chat_messages` tables. Real-time via polling.

### 9.2 Command Palette ✅ REAL
Global `Cmd+K` / `Ctrl+K` shortcut. Fuzzy-search navigation across all pages and actions. Keyboard-only operation.

### 9.3 Dark / Light Mode ✅ REAL
System preference detection + manual toggle. Persisted to `localStorage`. Tailwind `dark:` class toggling on `document.documentElement`.

### 9.4 Global Fix Button System ✅ REAL
Module-aware diagnostic and self-healing system present on every page. Detects configuration issues, stale data, API errors. One-click fix actions. `fix_history` table logs all auto-repairs.

### 9.5 Dashboard Widget Preferences ✅ REAL
**Table:** `dashboard_widget_prefs`  
Per-user widget visibility and layout configuration. Drag-to-reorder. Persisted per user ID.

### 9.6 Test Call Launcher ✅ REAL
**Page:** `test-call.tsx` — 11 hooks  
Manual one-off test call via Sippy `makeCall` XML-RPC. Selects originating account, destination, records result and MOS. `call_test_logs` table.

### 9.7 Test Campaigns ✅ REAL (manual)
**Page:** `test-campaigns.tsx` — 15 hooks  
Batch test call management. Multiple routes per campaign, result aggregation, pass/fail per route, historical comparison. `test_campaigns`, `test_campaign_results` tables.

### 9.8 Tools Page ✅ REAL
**Page:** `tools.tsx` — 14 hooks  
Utility toolbox: SIP packet analyser helper, number formatter, rate calculator, codec compatibility checker.

### 9.9 API Keys ✅ REAL
**Page:** `api-keys.tsx` — 8 hooks  
Generate and manage API keys for programmatic access to the platform. `api_keys` table with scope configuration.

### 9.10 VPN Config 🔲 SHELL
**Page:** `vpn-config.tsx` — 0 hooks  
Static UI for VPN configuration reference. No backend integration.

---

## PART 10 — FEATURES FROM ROADMAP DOCUMENT

*Cross-referenced against the 9-feature priority document*

### Feature 1 — SIP Trace Viewer / Call Ladder Diagrams
**Status:** ✅ REAL — completed this session  
3-lane ladder diagram (Caller | Sippy | Carrier), PDD metric, timing deltas, failure path highlighting, CDR lookup + paste mode. Links from CDR rows via `?callId=` parameter.

### Feature 2 — Automated Routing Intelligence
**Status:** ✅ REAL  
Rule evaluation engine with Sippy write-back, approval gate integration, ASR/cost/capacity threshold rules.

### Feature 3 — Synthetic Call Testing / Quality Benchmarking (Scheduled)
**Status:** ⚠️ PARTIAL  
Manual test campaigns and one-off test calls work fully. Scheduled automatic test runs, PESQ/MOS regression baseline, and per-carrier quality matrix over time are **not yet implemented**. The tables (`test_campaigns`, `test_campaign_results`) and frontend are ready — the missing piece is a server-side scheduler that triggers campaigns automatically.

### Feature 4 — Number Intelligence Layer
**Status:** ⚠️ PARTIAL  
Page and route exist. Basic number structure display works. `cnam: null`, `stirShaken: 'unknown'`, `hlr: null` in the API response — confirmed stubs. No external HLR/CNAM/STIR provider wired. The `number_lookup_cache` table exists for caching once providers are integrated.

### Feature 5 — SBC / Media Plane Monitoring
**Status:** ✅ REAL (signalling-layer metrics)  
SBC host health, media session counts, MOS/jitter/packet-loss polling. Not packet-level RTP correlation — that requires a separate media tap.

### Feature 6 — Client Self-Service Portal
**Status:** 🔲 SHELL  
UI exists (230 lines, 3 hooks). No tenant data isolation enforced — a customer role user can access all data. No billing separation, no per-account CDR scoping. Infrastructure exists (client_profiles table, account linkage) but the access control layer is not applied.

### Feature 7 — Reseller Management
**Status:** ✅ REAL  
`reseller_profiles` table, full CRUD wired (11 hooks), markup rule management.

### Feature 8 — Unified Communications Integration (Teams, Zoom, WebRTC)
**Status:** ❌ NOT BUILT  
No pages, no routes, no schema. Entirely absent. Would require Microsoft Teams Direct Routing SIP trunk monitoring, Zoom Phone REST API integration, and WebRTC gateway health tracking.

### Feature 9 — Compliance & Regulatory Dashboard
**Status:** 🔲 SHELL  
Page exists (164 lines, 1 hook). STIR/SHAKEN attestation rate display, GDPR retention policy tracking, and regulatory data pipeline are **not implemented**. Static UI only.

---

## PART 11 — DATABASE SCHEMA SUMMARY

55 tables in production as of this session:

| Category | Tables |
|---|---|
| Core telephony | `calls`, `metrics`, `call_snapshots`, `mos_hourly` |
| CDR & analytics | `sippy_snapshots`, `sippy_change_events` |
| Accounts & products | `client_profiles`, `switches`, `rate_cards`, `rate_card_entries` |
| Routing | `routing_groups_cache`, `destination_sets_cache`, `routing_rules`, `routing_cache_meta`, `connection_vendor_cache2` |
| Security & fraud | `fas_events`, `fas_vendor_settings`, `irsf_events`, `blacklist_rules`, `simbox_scores` |
| Approvals | `approval_requests`, `approval_audit_log` |
| AI Ops | `ai_ops_events`, `ai_ops_incidents`, `anomaly_events` |
| Alerts & notifications | `alerts`, `alert_rules`, `traffic_alerts`, `whatsapp_alert_log`, `watcher_recipients` |
| Infrastructure | `monitored_hosts`, `host_outage_log`, `outage_log`, `sbc_hosts` |
| Team | `kams`, `kam_accounts`, `user_roles`, `user_config` |
| Quality | `vendor_metric_baselines`, `sla_breach_log` |
| Testing | `test_campaigns`, `test_campaign_results`, `call_test_logs` |
| DID & numbers | `number_lookup_cache` |
| Commerce | `billing_disputes`, `reseller_profiles` |
| Reporting | `scheduled_reports` |
| UX | `dashboard_widget_prefs`, `fix_history` |
| Comms | `chat_rooms`, `chat_messages` |
| Misc | `settings`, `api_keys`, `product_docs` |

---

## PART 12 — WHAT REMAINS TO BUILD

In priority order:

| Priority | Feature | Effort | What's needed |
|---|---|---|---|
| 🥇 | Scheduled Synthetic Testing | Medium | Server-side cron scheduler wired to existing test campaign tables + baseline comparison logic |
| 🥈 | Number Intelligence real enrichment | Small | One external provider API call (Telnyx / Neustar) to populate `cnam`, `hlr`, `stirShaken` fields |
| 🥉 | Client Self-Service Portal data isolation | Medium | Role-scoped query filtering — customer role sees only their `iAccount` data across CDRs, live calls, analytics |
| 🟡 | Compliance Dashboard | Medium | STIR/SHAKEN aggregation from CDR records, GDPR retention policy engine |
| 🔵 | Unified Communications | Large | Microsoft Teams Direct Routing + Zoom Phone REST API — entirely new integration module |
| ⏸️ | SMS / A2P Monitor | Deferred | Tagged "Coming Soon" in sidebar — build only if SMS traffic is live in the system |

---

*Generated from codebase analysis — May 2026*
