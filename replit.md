# VoIP Monitoring Platform

## Overview
Full-stack VoIP monitoring dashboard with real-time metrics, alerting, team management, and live softswitch integration. Supports light/dark theme, command palette, API key management, customizable dashboard widgets, and mobile-responsive NOC view.

## Architecture
- **Backend**: Express + TypeScript (`server/`)
- **Frontend**: React + Vite + TailwindCSS (`client/src/`)
- **Database**: PostgreSQL via Drizzle ORM (`shared/schema.ts`)
- **Auth**: Replit Auth (OpenID Connect)

## Vol 2 Features
- **#24 Multi-Switch Consolidated View** (`/multi-switch`): Real-time aggregated monitoring dashboard for multiple Sippy softswitch instances. Backend `GET /api/switches/consolidated` polls the primary switch (from Settings) + all secondary switches in parallel using `getSippyDashboardMetrics()` (XML-RPC `call_control.getCountersStats`), returning per-switch results + global aggregate. `POST /api/switches/:id/test` tests connectivity. Frontend: 4 global KPI cards (Total Active Calls, Switches Online, Overall ASR, Avg ACD), per-switch status cards (Online/Offline/Error/Unconfigured badges with expandable detail rows), management table with CRUD for secondary switches, add/edit dialog with show/hide password + in-dialog test-connection button, auto-refresh toggle (30s), manual refresh button. Nav: `Layers` icon, admin+management. Primary switch always shown (marked with Star badge). Architecture note panel explains XML-RPC polling.
- **#8 Cost Optimisation Recommendations Engine** (`/cost-optimisation`): AI-assisted multi-factor analysis of CDR cache and rate card data. Groups CDRs by vendor, computes cost/min, ASR, ACD, PDD. Runs 9 rule-based scoring algorithms: HIGH_COST_VENDOR (σ above portfolio mean), POOR_QUALITY_VENDOR (ASR < 50%), ZERO_ANSWER (route failure), HIGH_PDD (>4s), NO_RATE_CARD (unmanaged vendor), NEGOTIATION_LEVERAGE (>25% spend share), CONCENTRATION_RISK (>60% traffic concentration), BEST_VALUE_VENDOR (expand), OFF_PEAK_ROUTING. Each recommendation includes: category badge, priority (High/Medium/Low), description, metric pills, confidence bar, estimated monthly savings, and numbered action steps. Filter tabs by category. CSV export. Time window selector (24h/7d/14d/30d). Nav: Lightbulb icon. Role: admin+management. API: `GET /api/cost-optimisation/analyse?hours=N`.

- **#16 Click-to-call & Test Call Launcher** (`/test-call`): Form with CLI/CLD inputs + optional Sippy billing account picker. Calls Sippy `makeCall` XML-RPC on submit, displays call ID on success. History table shows recent test calls from `call_test_logs` DB table. CDR table and live-calls dashboard table both have hover PhoneCall icons that pre-fill `/test-call?cli=X&cld=Y`. Nav item under admin+management roles.
- **#2 LCR Analyser** (`/lcr-analyser`): "Routing & Cost Intelligence" tool. Enter a destination number → longest-prefix match against ALL vendor rate cards → ranked cheapest-first table with colour coding (green/amber/red), rate bar, savings vs best (% and absolute), and optional margin column when a client rate card is selected. Summary cards show best route, worst route, max saving, client rate. API: `POST /api/lcr/analyse` → `storage.lcrAnalyse()`. Nav item (GitBranch icon) under admin+management.
- **#6 Call Flow Simulator** (`/call-flow-simulator`): Engineering tool. Enter CLI/CLD + optional Sippy billing account → 7-step simulation trace: (1) Number normalization, (2) Account resolution (live Sippy getAccountInfo), (3) Balance & credit check, (4) Tariff/sell-rate lookup (local client rate cards as proxy), (5) Routing group lookup (live Sippy listRoutingGroupMembers, enriched with connectionVendorCache), (6) LCR vendor analysis (local vendor rate cards), (7) Predicted outcome with margin. Each step is colour-coded (ok/warn/error/skip/info) and expandable. Final outcome banner shows call path CLI→CLD→Carrier. API: `POST /api/simulator/run`. Nav item (Workflow icon). No real call is made.
- **User Manual** (`server/manual-generator.ts`): 18-section comprehensive `.docx` user manual covering all platform features, role access matrix, process flow diagrams, keyboard shortcuts, troubleshooting, and glossary. Generated on demand via "Update Manual" button in Settings → Documentation Downloads. Routes: `POST /api/download/regenerate-manual`, `GET /api/download/user-manual`. Files saved to `/tmp/` (writable in both dev and production).

## Key Features
- Real-time call quality metrics (Jitter, Latency, Packet Loss, MOS)
- Telecom KPIs: ASR, ACD, PDD, Call Back Ratio
- Live IP endpoint probe (TCP SIP port check)
- **Sippy Softswitch ONLY** (VOS3000 permanently removed from all UI)
- ASR/ACD origination reports with client/vendor profiles
- Role-based access control (admin > management > viewer)
- Alert engine with threshold-based triggers
- Team page with Quick Assign Role form (email + role dropdown + submit)
- **KAM Management** (`/graphs` page — KAM Overview section): `kams` + `kam_accounts` DB tables, CRUD API at `/api/kam`, assign Sippy clients to KAMs, live call count overlay per KAM
- **Traffic Drop Detector**: background job runs every 5 minutes, compares per-client concurrent calls vs 60-min peak, triggers email when traffic drops >50% or goes to 0. Stores history in `traffic_alerts` table. Email sent via Gmail SMTP (existing settings). Cooldown 30 min per client.
- **Client Traffic Pulse**: per-client live call count cards on the Graphs page with trend indicator and percentage-of-peak bar
- **Traffic Alerts Log** on the Graphs page: shows recent drop events, email sent status, open/resolved state
- **Sippy Change Watcher** (`server/sippy-watcher.ts`): polls every 5 minutes, detects IP auth rule add/remove/change, new/removed client accounts, new/removed vendor connections, new client starts traffic — emails admin on each change. State persisted in `sippy_snapshots` DB table (no false-positives on restart). `notifyNewClientTraffic(name)` hook called from `pushConcurrentPoint` in routes.ts.
- **Security Hardening** (`server/index.ts`): `helmet` HTTP security headers (CSP, XSS protection, clickjacking), `express-rate-limit` (300 req/15min general, 20 req/15min auth), 1MB body limit, `trust proxy` for Replit reverse-proxy, suspicious activity tracker (logs IPs with 15+ 401/403s in 5 min).
- **Traffic Map** (`/traffic-map`): Interactive Leaflet world choropleth map showing destination traffic % by country. Uses CDR `country` field, TopoJSON (world-atlas via `/api/geo/world`), topojson-client, and `/api/traffic-map` endpoint. Dark CartoDB tiles, violet colour scale, hover tooltips, top-destinations sidebar, time range selector (3/6/12/24/48/72h).
- **Tier 5 UX & Workflow Improvements** (Volume 1):
  - **#21 Dark/Light Mode Toggle**: `use-theme.tsx` ThemeProvider, CSS vars in `:root`/`.dark`, sun/moon toggle in sidebar footer, persists in localStorage.
  - **#23 Command Bar**: `command-bar.tsx` with Ctrl+K/Cmd+K shortcut, CommandDialog with all nav items, mounted in `layout-shell.tsx`.
  - **#24 API Key Management**: `api_keys` table, CRUD at `GET/POST/DELETE /api/keys`, external endpoints `GET /ext/api/live-calls|asr-acd|balance/:vendor` (Bearer token auth via SHA-256 hash), `/api-keys` page.
  - **#20 Dashboard Widget Customization**: `dashboard_widget_prefs` table, `GET/PUT /api/user/dashboard-prefs`, "Customize" button in NOC header, Sheet drawer with 5 widget toggles (live_metrics, revenue_analytics, live_calls_table, asr_trend, fas_events), prefs persist per user.
  - **#22 Mobile-Responsive NOC View**: hamburger menu with Sheet slide-out sidebar on mobile, mobile header with theme toggle, push notification opt-in panel in Settings page.

## Sippy Integration (`server/sippy.ts`)
- XML-RPC POST to `/xmlapi/xmlapi`, HTTP **Digest** Auth (RFC-2617, NOT Basic) — `sippyPost()` handles 2-step probe-then-digest
- **Server Monitoring module**: `/server-monitoring` page with 6 tabs — Reachability/Outage Log (every 30s poller + multi-IP vendor/carrier monitoring), RTP Bandwidth, Disk & Memory, Carrier ASR drop detection, Email/Webhook Alert Rules, SIP Reg Storm Detection. DB tables: `outage_log`, `alert_rules`, `monitored_hosts`, `host_outage_log`. Routes: `GET /api/monitoring/status|bandwidth|disk-memory|carrier-asr|registrations` + CRUD `/api/monitoring/alert-rules` + CRUD `/api/monitoring/hosts` + `GET /api/monitoring/hosts/:id/outages` + `GET /api/monitoring/hosts/outages/all`. Background per-host poller every 60s using TCP probe with per-host outage tracking. Sidebar collapsible sub-menu with 6 entries.
- Admin credentials: ssp-root (apiAdminUsername/apiAdminPassword). Portal credentials (RTST1) only support customer-level read. No admin/reseller portal login available — vendor cost computed via balance-delta tracking instead.
- **Vendor balance tracker**: `refreshVendorBalances()` polls `listSippyVendors` every 60 s, storing timestamped snapshots in `vendorBalanceHistory[]` (2-hour rolling window). `vendorCostFromHistory(tStart, tEnd)` computes cost from Callntalk balance decrease (positive delta only). Dashboard shows "Tracking…" for first 91 min after startup, then switches to real balance-delta vendor cost.
- APIs implemented (see full coverage table below):
  - Accounts: listAccounts (107322), getRegistrationStatus (107366), listAuthRules / addAuthRule / updateAuthRule / deleteAuthRule (107336), getLowBalance / setLowBalance (107444), createAccount (107312+), listRoutingGroups
  - Vendors: listVendors, getVendorConnectionsList, createVendorConnection, updateVendorConnection, deleteVendorConnection, getVendorConnectionInfo (all with qmon fields); vendorAddFunds / vendorCredit / vendorDebit (151210)
  - CDRs: getSippyCDRs = getAccountCDRs (107367) + getCustomerCDRs (107429) with full field set + toSippyDate() helper
  - Live Calls: getAccountCallStats (107462) for active call monitoring
  - Monitoring: getMonitoringGraphData for ACD/ASR time-series charts
  - Billing: getAccountBalance (107444), getBillingPlans, getTariffs, getRateList, setRateEntry, deleteRateEntry
  - Routing: listRoutingGroups, getRoutingGroupsList
  - Dictionaries: getSystemDictionary (17 dict types, doc 3000055804)
  - Trunks (3000116551): createTrunk, updateTrunk, deleteTrunk, getTrunkInfo, getTrunksList
  - Trunk Connections (3000116552): createTrunkConnection, updateTrunkConnection, deleteTrunkConnection, getTrunkConnectionInfo, getTrunkConnectionsList
  - Payments — Debit/Credit Cards (107442): addDebitCreditCard, updateDebitCreditCard, deleteDebitCreditCard, getDebitCreditCardInfo, listDebitCreditCards; routes GET|POST /api/sippy/cards, GET|PATCH|DELETE /api/sippy/cards/:id
  - Payments — Account Balance (107440): accountAddFunds, accountCredit, accountDebit; routes POST /api/sippy/accounts/:id/add-funds|credit|debit
  - Payments — Customer Balance (150644): customerAddFunds, customerCredit, customerDebit; routes POST /api/sippy/customers/:id/add-funds|credit|debit
  - Payments — Payment Info (107446): getPaymentInfo, getPaymentsList; routes GET /api/sippy/payments/:id, GET /api/sippy/payments
  - Payments — Voucher (107438): rechargeVoucher (trusted i_voucher mode); route POST /api/sippy/accounts/:id/voucher
  - Payments — Card Payments (107443): makePayment (stored card), makePaymentByCard (inline card); routes POST /api/sippy/payments, POST /api/sippy/payments/by-card
- storage.getSippySettings() added to IStorage interface + DatabaseStorage (alias of getSettings()) — all Sippy routes now use this
- Clients page "Sippy Accounts" tab: live account list with SIP registration badge, auth rules CRUD (expandable per account), low balance modal, New Sippy Account modal (4-step BitsAuto-style wizard)
- New Sippy Account Wizard (4-step): Step 1 = Basic Info + Credentials, Step 2 = Network/IPs (tag input for multiple IPs, routing group, service plan, CLI/CLD translation), Step 3 = SIP Config (codec, reg, trust CLI, P-Asserted-ID, disallow loops), Step 4 = Billing & Alerts (credit limit, balance, max sessions/CPS, lifetime, balance threshold, alert email To/CC). Backend auto-adds extra auth rules for additional IPs, calls setSippyLowBalance for threshold config.
- createAccount key learnings (official docs 107312): `preferred_codec` per docs null = "Disabled" (NOT -1; -1 was wrong); `i_password_policy` must be `1`; `max_credit_time` must be positive (default 3600, not 0/-1); `i_routing_group` required for root customer (auto-fetched via listRoutingGroups); `i_billing_plan` required since v1.8 (defaults to 1); `listRoutingGroups` API is the working method on Sippy ≤ 5.x; routing group ID=3 confirmed on this instance; `i_customer: 1` ALWAYS required for ssp-root; `welcome_call_ivr` and `on_payment_action` stored as nil on existing accounts; form now exposes all key fields: username, web_password, authname, voip_password, first_name, last_name, email, country, codec dropdown (null/0/8/18/9/3/4/15), reg_allowed, trust_cli, balance, lifetime
- createAccount FIX (2026-04-08): `welcome_call_ivr` must be `0` (integer) NOT null/<nil/> (crashes server). `on_payment_action` must be `0` (integer). Both hardcoded in pushAccountToSippy(). createAccount NOW WORKS FULLY. Policy for addRoutingGroup: "prefix,preference" (discovered by inspecting listRoutingGroups response on existing groups).
- PUSHTOTALK account SETUP COMPLETE (2026-04-08): Renamed i_account=1 (was "TEST") to "PUSHTOTALK" via updateAccount. Routing group=4 (Pakistan First Class), tariff=3 (PAK prefixes $0.05/min), IP auth=10.0.0.1. Script: scripts/create-pushtotalk.mjs
- AIRCEL + TALK PROVISIONED (2026-04-08): All items created on Sippy via scripts/setup-aircel-talk.mjs + scripts/create-rg-and-finalize.mjs:
  - Aircel: i_account=4 (username=aircel), IP auth=20.0.0.1, routing_group=5 (Pakistan First Class TALK), tariff=4 (Aircel Pakistan)
  - TALK vendor: i_vendor=3, connection i_connection=3 to 45.59.163.182:5060, tariff=5 (TALK Pakistan)
  - Routing group 5: "Pakistan First Class TALK" (policy=prefix,preference)
  - Tariffs 4+5 created; RATES must be added via Sippy web UI (no XML-RPC rate API on this Sippy version)
  - setLowBalance not supported on this Sippy version; alert email qadeerjunaid@icloud.com stored in local DB
  - addRoutingGroupMember requires i_destination_set param (complex Sippy concept, needs web UI)
  - Aircel + TALK profiles registered in local client_profiles table (ID=1, ID=2)
- Balance inversion: listAccounts does NOT invert; createAccount/getAccountInfo DO invert
- Registration status fault 403 = not registered (returns `{ registered: false }` silently)
- **Credential swap resilience (2026-04-10)**: `sippyXmlCredsPairs()` returns both credential pairs (apiAdmin first, portal fallback). `GET /api/sippy/accounts` and `GET /api/sippy/vendors` now retry with the second pair on HTTP 401/403. `listSippyVendors` now checks `resp.statusCode` (previously 401 was silently swallowed returning empty array). This makes the system immune to the production credential-swap bug where `apiAdminUsername=RTST1` and `portalUsername=ssp-root` are stored in the wrong fields.

## Important State
- Simulation is **disabled** (`simulationEnabled = false` in DB)
- Dashboard shows "Connect Softswitch" banner when simulation off and portal not connected
- Dashboard stat cards all use **live Sippy data** when connected:
  - **Avg MOS**: E-model estimate (4.43 est.) from probe latency via RFC 3611 formula — NOT stale local DB
  - **CK Ratio + Breakdown**: Computed from Sippy CDRs (last 1hr, per-account: 1/4/55) — NOT local DB zeros
  - **Revenue/Cost**: CDR-based via per-account fetch (200 CDRs × 3 accounts, limit avoids timeout) — NOT portal zeros
  - **ASR/ACD/PDD**: From Sippy monitoring (`acd_asr` endpoint, iEnvironment=5)
  - **Active Calls**: From `getCountersStats` live call count
- All stat cards show `—` when not connected to avoid misleading zeros
- Dashboard-stats endpoint (`/api/sippy/dashboard-stats`) now returns: ckRatio, ckBreakdown, cdrCount, estimatedMos in addition to activeCalls/asr/acd/pdd
- CK breakdown maps Sippy result codes: "0" = Connected; "-16"/"-1"/"-20" = Wrong Number; "-17"/"-18"/"-19" = Switched Off; "-23"/"-24"/"-21"/"-22" = Untraceable

## Tier 1 Features (Added April 2026)
- **IRSF Detection**: Background worker scans CDRs for 35+ IRSF risk prefixes (Somalia, Congo, Cuba, etc.), stores events in `irsf_events` table. `/api/fraud/irsf` CRUD, scan trigger at `/api/fraud/irsf/scan`. Visible as a tab in the Fraud page.
- **Auto-Blacklist**: `blacklist_rules` table with prefix/IP/account blocking. CRUD at `/api/fraud/blacklist`. UI tab in Fraud page with add-rule form + enable/disable/delete.
- **MOS Trending**: Hourly MOS quality aggregation in `mos_hourly` table. Endpoint `/api/mos-trending?days=N`. Visible as a collapsible section at the bottom of the Graphs page with line chart (avg MOS) + bar chart (Good/Poor %).
- **SIP OPTIONS Monitor**: TCP-based `probeSipOptions(ip, port)` probes all configured switch IPs every 60s. Results cached in `sipOptionsCache` Map. API `/api/monitoring/sip-options`. New "SIP Trunk Health" tab in Server Monitoring page.
- **Rate Card Management**: `rate_cards` + `rate_card_entries` tables. CRUD at `/api/rate-cards`. CSV upload (auto-detects prefix/country/breakout/rate columns) at `/api/rate-cards/:id/upload`. Dedicated `/rate-cards` page with expandable entry tables.
- **Revenue Analytics**: `/api/analytics/revenue?days=N` computes P&L from call snapshots + client profile rates. Returns summary, byClient, byVendor arrays. `/analytics` page with summary cards, Revenue vs Cost bar chart, vendor cost pie, client P&L table.

## Pages
- `/` — Dashboard with live stats, KPIs, IP probe, portal data
- `/calls` — Call list with metrics
- `/calls/:id` — Call detail page
- `/alerts` — Alert feed
- `/reports` — ASR/ACD report + client stats table
- `/cdrs` — CDR Viewer: full CDR table (CLI, CLD, country, duration, billed, charged), date presets, call type filter, CLI/CLD search, pagination (50/page), CSV export, summary stats. Shows data when RTST1 accounts make completed calls. API: GET /api/sippy/cdr
- `/tools` — Telecom Tools & Calculators: 4 tabs — (1) Carrier Quality Scoring (ASR/ACD/PDD/FraudRisk → 0-100 score + rating from Sippy CDRs), (2) SIP Capacity Calculator (employees × concurrency × codec → channels + bandwidth, industry presets), (3) Bandwidth Planner (concurrent calls × codec → Mbps, QoS/VPN overhead, max calls table), (4) Burst Capacity Simulator (normal × peak multiplier + overflow %, scenario presets)
- `/fraud` — Fraud & FAS: 3 tabs — FAS detection, IRSF events (scan + table), Blacklist (CRUD)
- `/rate-cards` — Carrier Rate Card management: create cards, upload CSV, expand prefix entries
- `/analytics` — Revenue Analytics: P&L by client/vendor, margin trending, summary cards
- `/clients` — Client/vendor profiles
- `/settings` — Thresholds, IP probe, softswitch connection
- `/team` — Team member management
- `/account` — User profile

## API Routes (portal)
- `GET /api/portal/session` — current VOS3000 session status
- `GET /api/portal/stats` — 24h summary stats
- `GET /api/portal/live-calls` — active calls
- `GET /api/portal/cdr` — CDR records
- `GET /api/portal/clients` — terminal account list
- `GET /api/portal/client-stats` — per-client 24h traffic stats

## Database Schema (`shared/schema.ts`)
Key tables: `calls`, `callMetrics`, `alerts`, `settings`, `clientProfiles`, `userConfig`
Settings table has `switchType` column (vos3000 | sippy).
