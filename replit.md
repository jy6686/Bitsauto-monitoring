# Bitsauto Monitoring Platform

## Overview
Full-stack VoIP monitoring dashboard with real-time metrics, alerting, team management, and live softswitch integration. Supports light/dark theme, command palette, API key management, customizable dashboard widgets, and mobile-responsive NOC view.

## Architecture
- **Backend**: Express + TypeScript (`server/`)
- **Frontend**: React + Vite + TailwindCSS (`client/src/`)
- **Database**: PostgreSQL via Drizzle ORM (`shared/schema.ts`)
- **Auth**: Replit Auth (OpenID Connect)

## Vol 2 Features
- **BitsEye Drill-Down Analytics** (`/bitseye`): Hierarchical traffic analytics with URL-driven navigation and full drill-down flow. No internal left sidebar — navigation is driven by URL params and in-page breadcrumb/drill-down buttons. Sidebar links: `?view=clients` (All Clients), `?view=vendors` (All Vendors), `?view=destinations` (All Destinations + country filter), `?view=countries` (Countries grid), `?view=kam` (All KAMs), `?view=kam&kamId=N` (single KAM). Full drill-down flow: Countries grid → click "View KAMs →" on a card → KAMs filtered by that country → click "View Destinations →" on a KAM card → Destinations filtered by KAM. Top bar has Back ← button and breadcrumb (Countries > Pakistan > KAM Name). Sub-navigation strip shows Aggregated/All toggle tabs and country filter dropdown (on Destinations view). API endpoint `GET /api/bitseye/per-entity` supports `category=countries|clients|vendors|kam|destinations`, `countryFilter=X`, `kamFilter=Y`, `kamId=N`. Each entity shown as an `EntityPanel` card with: KPI strip (concurrent, today's calls, trend %, ASR, ACD), daily AreaChart (violet/sky, 24h), weekly AreaChart (amber/teal, 7d), redesigned StatsTable (rounded card, color swatches, monospace bold numbers). NavState type drives content: `country-all|country-agg|country|country-clients|country-vendors|kam-all|kam-agg|kam|dest-all|dest-agg|dest|clients-all|vendors-all`. Chart improvements: 45% gradient fill opacity, 2.5px/2px strokes, horizontal-only grid, inline legends, enhanced tooltips. Nav: BarChart3 icon, admin+management roles. Countries view shows helpful empty-state message if CDR cache has no dial-code matches.
- **#24 Multi-Switch Consolidated View** (`/multi-switch`): Real-time aggregated monitoring dashboard for multiple Sippy softswitch instances. Backend `GET /api/switches/consolidated` polls the primary switch (from Settings) + all secondary switches in parallel using `getSippyDashboardMetrics()` (XML-RPC `call_control.getCountersStats`), returning per-switch results + global aggregate. After each poll it writes `lastSyncAt` + `lastSyncStatus` (e.g. `online · 4 active calls · ASR 92%` or `error: ...`) back to each secondary switch DB record so the "Last Sync" column stays current. `POST /api/switches/:id/test` tests connectivity and also writes `lastSyncAt` + `test OK — connection verified` or `test failed: <reason>` after each run. Frontend: 4 global KPI cards (Total Active Calls, Switches Online, Overall ASR, Avg ACD), per-switch status cards (Online/Offline/Error/Unconfigured badges with expandable detail rows), management table with CRUD for secondary switches (columns: Name, URL, User, Type, Status, Last Sync, Actions), add/edit dialog with show/hide password + in-dialog test-connection button, auto-refresh toggle (30s), manual refresh button. Nav: `Layers` icon, admin+management. Primary switch always shown (marked with Star badge). Secondary switches stored in `switches` table (`type='sippy'`). SB1 (https://104.245.246.110/, user RTST-SB1) confirmed active in production DB (id=2, created 2026-04-17, has_password=true, enabled=true). `lastSyncAt` starts as null and updates after first consolidated poll or test. Architecture note panel explains XML-RPC polling.
- **#8 Cost Optimisation Recommendations Engine** (`/cost-optimisation`): AI-assisted multi-factor analysis of CDR cache and rate card data. Groups CDRs by vendor, computes cost/min, ASR, ACD, PDD. Runs 9 rule-based scoring algorithms: HIGH_COST_VENDOR (σ above portfolio mean), POOR_QUALITY_VENDOR (ASR < 50%), ZERO_ANSWER (route failure), HIGH_PDD (>4s), NO_RATE_CARD (unmanaged vendor), NEGOTIATION_LEVERAGE (>25% spend share), CONCENTRATION_RISK (>60% traffic concentration), BEST_VALUE_VENDOR (expand), OFF_PEAK_ROUTING. Each recommendation includes: category badge, priority (High/Medium/Low), description, metric pills, confidence bar, estimated monthly savings, and numbered action steps. Filter tabs by category. CSV export. Time window selector (24h/7d/14d/30d). Nav: Lightbulb icon. Role: admin+management. API: `GET /api/cost-optimisation/analyse?hours=N`.

- **#16 Click-to-call & Test Call Launcher** (`/test-call`): Form with CLI (first-leg) + CLD (destination) inputs + optional Sippy billing account picker. Three-phase origination per articles 106909/107448/107525: Phase 1 = `call_control.makeCall` XML-RPC (admin creds, Trusted Mode), Phase 2 = `make2WayCallback` XML-RPC (customer creds, Normal Mode — cld_first=CLI, cld_second=CLD, cli_first/cli_second=CLI), Phase 3 = `/simpleapi/callback.php` HTTP Basic Auth GET. Auto-detects swapped credentials (shows red warning if apiAdminUsername matches a customer account). History table from `call_test_logs` DB. CDR table and live-calls dashboard both have hover PhoneCall icons pre-filling `/test-call?cli=X&cld=Y`. Nav: admin+management.
- **#3 Revenue & Margin Analytics Dashboard** (`/analytics`): Full financial overlay on CDR traffic data. Backend endpoint `GET /api/analytics/margin?days=N&vendorCardId=N&threshold=N` fetches up to 2000 CDRs for the period (via XML-RPC `getAccountCDRs` / `getCustomerCDRs`, falling back to portal scrape), then computes: rolling daily P&L time-series, margin per client, margin per destination/breakout (country + description), and worst-performing routes. Vendor cost computed two ways: (a) **Rate Card method** — if a vendor rate card is selected, each CDR's CLD is matched by longest prefix against `rate_card_entries`; cost = `rate * duration_min`; (b) **Proportional fallback** — vendor balance from the 60s balance-delta poller is allocated across CDRs proportionally to their revenue share. Frontend tabs: **Overview** (6 KPI cards: Revenue, Cost, Profit, Margin, Calls, Minutes + rolling Area chart of daily P&L), **By Client** (sortable table + Revenue/Cost/Profit bar chart), **By Destination** (searchable sortable table with country/breakout/margin/vendor rate), **Worst Routes** (threshold slider 0-30%, alert summary cards, sorted worst-first table), **Rate Import** (file picker for CSV/XLS, rate card dropdown, calls existing `/api/rate-cards/:id/upload` endpoint), **P&L Report** (portal-scrape tab — date range picker, quick presets 7/14/30/60/90d, KPI cards Revenue/Cost/Profit/Margin/Calls/Minutes, area chart, daily breakdown table with totals; backend `GET /api/analytics/pnl?days=N&from=YYYY-MM-DD&to=YYYY-MM-DD` via `scrapeProfitLossReport()` in `server/sippy.ts`). Period picker: 7/30/60/90 days. Vendor rate card dropdown auto-populates from existing vendor rate cards. API role: admin + management.
- **Routing Manager** (`/routing-manager`): 6-tab routing configuration viewer backed by a 15-min local cache of Sippy routing data (PostgreSQL `routing_groups_cache`, `destination_sets_cache`, `connections_cache`). **Tab 1 — Routing Groups** (Feature 1 LIVE): Expandable rows — click any group to load live members from Sippy via `GET /api/routing-cache/routing-groups/:id/detail`, enriched with cached connection/vendor names, host, destination set name, route count, blocked status. Members rendered in a sortable mini-table by preference. **Tab 2 — Destination Sets** (Feature 2 LIVE): Expandable rows — click any set to load live routes from Sippy via `GET /api/sippy/destination-sets/:id/routes`, rendered with prefix, preference, huntstop indicator, timeout, blocked status, and a "Run LCR →" button that navigates to `/lcr-analyser?prefix=X`. **Tab 3 — Connections**: Summary cards. **Tabs 4–6** (QBR/On-Net/Policy Sim): Placeholder cards. Cache banner shows last sync time, item counts, Sync Now button. Sidebar status for all three routing features updated to 'live'. Backend new endpoints: `GET /api/routing-cache/routing-groups/:id/detail`, `GET /api/sippy/accounts/:id/info`.
- **#2 LCR Analyser** (`/lcr-analyser`): "Routing & Cost Intelligence" tool. Enter a destination number → longest-prefix match against ALL vendor rate cards → ranked cheapest-first table with colour coding (green/amber/red), rate bar, savings vs best (% and absolute), and optional margin column when a client rate card is selected. Summary cards show best route, worst route, max saving, client rate. API: `POST /api/lcr/analyse` → `storage.lcrAnalyse()`. Nav item (GitBranch icon) under admin+management.
- **#6 Call Flow Simulator + Routing Audit Trail** (`/call-flow-simulator`): Two-mode page with tab toggle. **Simulator mode**: Enter CLI/CLD + optional Sippy billing account → 7-step simulation trace: (1) Number normalization, (2) Account resolution (live Sippy getAccountInfo), (3) Balance & credit check, (4) Tariff/sell-rate lookup (local client rate cards as proxy), (5) Routing group lookup (live Sippy listRoutingGroupMembers, enriched with connectionVendorCache), (6) LCR vendor analysis (local vendor rate cards), (7) Predicted outcome with margin. Each step is colour-coded (ok/warn/error/skip/info) and expandable. Final outcome banner shows call path CLI→CLD→Carrier. API: `POST /api/simulator/run`. No real call is made. **Routing Audit mode** (Feature 3 complete): Select any account → fetches account info live from Sippy (`GET /api/sippy/accounts/:id/info`) to get `iRoutingGroup` → fetches live routing group members enriched with cached connection/vendor/DS names (`GET /api/routing-cache/routing-groups/:id/detail`) → renders full chain: Account node (blue) → Routing Group node (primary) → Members table (pref/weight/connection/vendor/host/DS/routes/status). Sidebar status updated to 'live'.
- **User Manual** (`server/manual-generator.ts`): Multi-section comprehensive `.docx` user manual covering all platform features, role access matrix, process flow diagrams, keyboard shortcuts, troubleshooting, and glossary. §5.4 CK Drill-Down Sheet (status chips, time window chips, Excel export). §7.1 4-Tab Analytics structure. §7.5 Traffic Map with Country Drill-Down Panel. §7.6 Vendor Balance. §7.7 P&L Report. Generated on demand via "Update Manual" button in Settings. Routes: `POST /api/download/regenerate-manual`, `GET /api/download/user-manual`.
- **Troubleshooting Guide** (`server/troubleshoot-generator.ts`): `.docx` internal reference covering ISS-001 through ISS-016. New issues: ISS-013 (formatInTz arg order crash), ISS-014 (Traffic Map no coloured polygons — normaliseCountryName fix), ISS-015 (CK Drill-Down hours param ignored), ISS-016 (Breakout name bug — `7923364335326` showing "MOBILE MEGAFON" instead of "MOBILE UFONE"; trunk class digit strip fix in `server/dial-lookup.ts`). Routes: `GET /api/download/troubleshooting-guide`, `POST /api/download/regenerate-troubleshoot`.
- **FAS Enhancement v2** (Fraud page `/fraud`): CDR-pattern FAS detection extended with: (1) **Per-vendor alert thresholds** — `fas_vendor_settings` DB table (`vendor PK`, `suppressed bool`, `alertThreshold int`), full CRUD at `/api/fas/vendor-settings`, "Vendor Alert Controls" panel in FAS tab with quick-add form and suppress toggle; (2) **Vendor drill-down sheet** — click Drill button in vendor scores table or View in vendor controls to open right-side sheet showing 7-day daily FAS bar chart, inline vendor settings, and paginated list of per-vendor FAS events (from `/api/fas/vendor-events?vendor=X`); (3) **Sippy recording status banner** — `/api/sippy/recording-status` probes `getSystemConfig` XML-RPC for call_recording keys and shows green/amber/grey banner at top of FAS tab; (4) **Background threshold alerting** — after each 5-min FAS batch, computes per-vendor FAS rate vs configured threshold and sends WhatsApp alert (1h cooldown per vendor, in-memory map `fasVendorAlertCooldowns`); (5) **`getFasEvents(limit, vendor?)`** now supports optional vendor filter for vendor-specific queries.
- **Sippy Dataflow Reference** (`server/sippy-dataflow-generator.ts`): §7 "Recent Platform Data-Flow Changes" added — 7.1 Traffic Map Country Normalisation, 7.2 CK Drill-Down Hours Parameter, 7.3 Analytics 4-Tab Report Structure. Routes: `POST /api/download/regenerate-sippy-dataflow`, `GET /api/download/sippy-dataflow`.
- **Org Hierarchy Doc** (`server/org-hierarchy-generator.ts`): §7b "Recent Hierarchy & Access Changes" added — OrgScopeContext propagation, "My Portfolio" sidebar link, BitsEye auto-filter integration. Routes: `POST /api/download/regenerate-org-hierarchy`, `GET /api/download/org-hierarchy`.
- **"Update All Documents" button** (Settings → Documentation Downloads): Prominent violet→blue gradient button that sequentially rebuilds all 5 documents (Manual → Dataflow → Troubleshooting → Org Hierarchy → Status Report) with live progress text. Individual buttons are disabled during "Update All" run. `updateAllDocs()` function uses fetch() with credentials, sets per-doc timestamp state on success, and shows a combined success/partial-failure toast.
- **Product Classification** (`/products`): New sidebar "Products" section showing CDR breakdown by Sippy trunk class (first CLD digit). Four product classes: `1`=First Class Wholesale (blue), `2`=Business Class Wholesale (violet), `6`=Special Bravo (amber), `7`=Special Charlie (orange). Per-class KPI cards (calls, ASR bar, duration, charged), comparison table with share %, top destinations per class. Time range selector (1h–last month). Uses `lookupCLD()` from `country-lookup.ts` to classify CDRs client-side. Nav: Package icon, admin+management.
- **Global Fix Button System** (`client/src/components/fix-button.tsx`): Intelligent module-aware self-healing diagnostic system covering every page. Floating wrench button (bottom-right, fixed, admin+management only). Three-tab modal: **Diagnose**, **Fix History**, **Auto Rules**. Step 1 = detect page via URL→PAGE_NAMES map. Step 2 = capture browser JS errors via `window.onerror`/`unhandledrejection` listeners, sent as `?errors=` JSON param. Step 3 = 6 core checks (Sippy credentials, session, live listActiveCalls, CDR cache, PostgreSQL, FAS/IRSF) + 17 module-specific checks (Live Calls: call count; CDR Viewer: volume; Analytics: volume+freshness; Fraud: FAS events; P&L: CDR+rate cards; Billing: profiles; Rate Cards: entry count; LCR: vendor cache; Settings: session; BitsEye/Products/Reports/Click-to-Call: respective data sources; Team: KAM count; Dashboard: composite). Step 4 = classify (AUTH_ERROR/API_FAILURE/TIMEOUT/NO_DATA/DATA_MISMATCH/BACKEND_ERROR/UI_ERROR). Steps 5–9 = one-click fixes + admin extended actions. Step 10 = module name, CDR size, JS error count, auto-fix count. Phase 3 Fix History: `fix_history` DB table (page/issueType/component/fixAction/outcome/triggeredBy/performedBy/createdAt); `pastFix` violet badge per issue via `storage.findSimilarFix()`; `GET /api/fix/history`; all attempts recorded. Phase 4 Auto Recovery: 2-min background job; Rule 1 `sippy_retry` (3× fail → auto-retry, 5min cooldown); Rule 2 `cdr_stale_log` (15min alert); `GET /api/fix/auto-rules`. Docs: `system_changes_log.md`, `fix_history.md`, `architecture_flow.md`.
- **CDR Viewer country fix**: Replaced `lookupDialCode` (from `dial-lookup.ts`) with `lookupCLD` (from `country-lookup.ts`) throughout CDR Viewer. Now correctly strips the product prefix digit (1/2/6/7) from 11+ digit CLDs before resolving the country — e.g. `78801408881679` now resolves to 🇧🇩 Bangladesh instead of 🇷🇺 Russia/Kazakhstan. Added "Product" column to the CDR table showing the short class badge (First/Business/Bravo/Charlie) with full name tooltip. Country column now shows emoji flag. Updated CSV/Excel export headers to include Country (with flag), Product, Breakout, Description. `CLD_CLASS_MAP` labels updated to full names with a new `short` field for badge display.

- **Internal Team Chat** (`/chat`): Real-time WebSocket-based internal messaging for KAMs and team members. Three default group channels auto-created on startup: **#general**, **#noc-team**, **#announcements**. **Direct Messages (DM)**: click any member in the "Team Members" sidebar section to open a private 1-on-1 conversation; DM rooms are created on-demand with slug `dm_${[uid1,uid2].sort().join('_')}` ensuring symmetry; if target is online they are instantly notified via `dm_invited` WebSocket event. Sidebar sections: Channels (group rooms with unread badge), Direct Messages (past DM conversations with online dot), Team Members (all KAMs from `kams` table + any online non-KAM guests — click to DM). Features: live online presence, message persistence in PostgreSQL (`chat_rooms` + `chat_messages` tables), typing indicators, avatar initials with deterministic colour hash, date dividers, grouped messages, unread count badges. WebSocket message types: `join`, `join_room`, `leave_room`, `open_dm` (DM initiation), `message`, `typing`, `ping/pong`, `dm_opened` (sent back to initiator), `dm_invited` (sent to target if online). REST: `GET /api/chat/rooms`, `POST /api/chat/rooms`, `GET /api/chat/rooms/:id/messages`, `GET /api/chat/members` (KAMs + online guests). "Team Chat" link pinned at top of sidebar for all roles. Auto-reconnect every 3s, keepalive ping every 25s.

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
- **Organisational Hierarchy & RBAC** (Team page — Org Hierarchy section): 6-level hierarchy (HOD→SVP→VP→Manager→TeamLead→KAM). Schema: `kams.orgRole`, `kams.reportsTo` (parent KAM id), `kams.userId` (links to auth user). New storage methods: `getKamByUserId`, `getKamSubtreeIds` (BFS), `getAccountsForSubtree`. API: `GET /api/org/hierarchy` (nested tree), `GET /api/org/my-scope` (user's kamId+orgRole+visibleAccountIds). KAM form: Org Role dropdown (HOD/SVP/VP/Manager/TeamLead/KAM), Reports-To dropdown (filtered to higher-rank KAMs), Link Login Account picker. Team page shows collapsible tree with role colour badges and client counts. `OrgScopeContext` (React context) fetches scope once on login and shares it app-wide. BitsEye auto-filters to user's KAM subtree when `orgScope.isScoped=true`. Sidebar shows "My Portfolio" link with role badge for scoped users. HOD = full access. Non-HOD users see only their scope + subordinates.
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
- Full reference: article 106909 (API intro), 107448 (make2WayCallback), 107462 (makeCall/listActiveCalls), 107525 (Simple API)
- XML-RPC POST to `/xmlapi/xmlapi`, HTTP **Digest** Auth (RFC-2617, NOT Basic) — `sippyPost()` handles 2-step probe-then-digest
- **Credential Modes (per article 106909)**:
  - **Trusted Mode** (admin creds: `apiAdminUsername` / `apiAdminPassword`): Full root access. Credentials = web login + API Password (set separately in My Preferences → Allow API Calls → API Password — NOT the web portal password).
  - **Normal Mode** (customer creds: `portalUsername` / `portalPassword`): Scoped to that customer account. Customer must have Allow API Calls + API password set. Used for `make2WayCallback`.
- **Call Origination 3-Phase Strategy** (`POST /api/sippy/make-call` in routes.ts):
  - Phase 1 — `call_control.makeCall` XML-RPC Trusted Mode (ADMIN creds). Requires "Allow XML-RPC call origination" on admin account in Sippy Admin → System → Administrators → API Access.
  - Phase 2 — `make2WayCallback` XML-RPC Normal Mode (CUSTOMER creds). `cld_first`=CLI (your phone), `cld_second`=CLD (destination), `cli_first`/`cli_second`=CLI. Requires Callback service on customer account: Sippy Admin → Customers → Applications → Callback.
  - Phase 3 — `/simpleapi/callback.php` HTTP Basic Auth GET (article 107525). Admin must run `htpasswd /home/ssp/sippy_web/simpleapi/.htpassword <username>` on the switch. Customer account (authname) still needs Callback service active.
- **Server Monitoring module**: `/server-monitoring` page with 6 tabs — Reachability/Outage Log (every 30s poller + multi-IP vendor/carrier monitoring), RTP Bandwidth, Disk & Memory, Carrier ASR drop detection, Email/Webhook Alert Rules, SIP Reg Storm Detection. DB tables: `outage_log`, `alert_rules`, `monitored_hosts`, `host_outage_log`. Routes: `GET /api/monitoring/status|bandwidth|disk-memory|carrier-asr|registrations` + CRUD `/api/monitoring/alert-rules` + CRUD `/api/monitoring/hosts` + `GET /api/monitoring/hosts/:id/outages` + `GET /api/monitoring/hosts/outages/all`. Background per-host poller every 60s using TCP probe with per-host outage tracking. Sidebar collapsible sub-menu with 6 entries.
- **SB-1 is now the PRIMARY switch (https://104.245.246.110)** — promoted 2026-04-17:
  - **DB Field Mapping (Settings table)**:
    - `api_admin_username` = `ssp-root` (XML-RPC primary user)
    - `api_admin_password` = `!chiaan1` (XML-RPC API password — set in Sippy My Preferences → Allow API Calls)
    - `portal_username` = `RTST-1` (portal web login username for Normal Mode / customer CDRs)
    - `portal_password` = `abcd@1234` (portal web login password for RTST-1)
    - `admin_web_password` = `HumJeet@y2018` (ssp-root web portal login password, distinct from XML-RPC API key)
  - **Connection Mode**: Portal session via `ssp-root`/`HumJeet@y2018` (customer account type) — XML-RPC is 401, portal scraping active
  - **CDR Data**: Returns 401 when XML-RPC API key `!chiaan1` is tried — user needs to verify/reset the API password in Sippy → My Preferences → Allow API Calls → API Password
  - Portal scraping fallback active: when XML-RPC returns 0/401, `scrapeActiveCallsPortal()` fires via active session cookies; orange-banner gives authoritative total
- **Old primary switch (https://191.101.30.107)** — now secondary in multi-switch view:
  - Admin web portal: `ssp-root` / `HumJeet@y2019`
  - XML-RPC Trusted Mode: `ssp-root` / `!chiaan1`
  - XML-RPC secondary user: `RTST-1` / `abcd@1234`
  - Stored in `switches` table with the correct credential mapping
- Vendor cost computed via balance-delta tracking.
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
- **Test Call credential swap detector (2026-04-16)**: `/test-call` page cross-checks `apiAdminUsername` against the live accounts list. If it matches a customer billing account, a red warning banner appears with the exact correct values and a "Fix in Settings" link.
- **3-Phase call origination (2026-04-16)**: Per articles 106909/107448/107525. Phase 1 = admin makeCall, Phase 2 = customer make2WayCallback (with cli_first/cli_second), Phase 3 = Simple API `/simpleapi/callback.php` HTTP Basic Auth GET. `simpleApiCallback()` added to sippy.ts.
- **BitsEye-style chart unification (2026-04-16)**: All Recharts charts across the app now match the BitsEye visual language. Shared primitives extracted to `client/src/components/bse-chart.tsx`: `BseTooltip` (glassmorphic `bg-card/98 backdrop-blur-md` tooltip with monospace labels + colored square indicators), `BSE_GRID_PROPS` (horizontal-only, `rgba(255,255,255,0.05)` solid lines), `BSE_AXIS_PROPS` (8px monospace `rgba(148,163,184,0.5)` ticks, no lines), `BSE_CURSOR` (dashed `4 2` cursor line), `BseGradStops` (3-stop gradient 0.45→0.08→0.0), `bseActiveDot` (card-ringed hover dot). Applied to: `dashboard.tsx` (ASR/ACD area + FAS bar), `server-monitoring.tsx` (uptime bar, bandwidth area, metrics area, SLA bars, registration area), `analytics.tsx` (P&L area + client bar), `reports.tsx` (composed ASR/ACD line), `graphs.tsx` (trend line + HBar), `calls-list.tsx` (PDD line + volume bar), `call-detail.tsx` (quality line).
- **Settings API password security (2026-04-16)**: `GET /api/settings` now requires authentication (401 for unauthenticated). Admin role returns full settings; non-admin roles receive the same object with `portalPassword`, `apiAdminPassword`, `adminWebPassword`, `alertGmailAppPass`, `whatsappApiKey`, and `portalSessionToken` nulled out. `PATCH /api/settings` and `POST /api/settings/simulation/reset` restricted to admin role only. WhatsApp alerts save mutation corrected from POST to PATCH. Frontend settings page already guarded by `requiredRoles={['admin']}` in router.

## Product / Trunk Class Schema

The platform uses a **leading-digit prefix encoding** to identify both the **product class** and the **destination** from a single route prefix. The first digit of every routing prefix is the product class code; the remaining digits map to the destination dial-code (Pakistan country code = 92).

### Product Classes

| Code | Product Name | Prefix Pattern | Notes |
|---|---|---|---|
| **1** | First Class Wholesale | `1` + destination | e.g. `192` (Pakistan Fixed), `19230` (Pakistan Jazz) |
| **2** | Business Class Wholesale | `2` + destination | e.g. `292` (Pakistan Fixed), `29233` (Pakistan Ufone) |
| **6** | Special Bravo | `6` + destination | e.g. `692` (Pakistan Fixed), `69234` (Pakistan Telenor) |
| **7** | Special Charlie | `7` + destination | e.g. `792` (Pakistan Fixed), `79231` (Pakistan Zong) |

### Prefix Anatomy

```
[Product Code] [9] [Destination Digits]
      1          9        2          →  192   (First Class / Pakistan Fixed)
      1          9        230        →  19230 (First Class / Pakistan Jazz)
      2          9        2          →  292   (Business Class / Pakistan Fixed)
      2          9        233        →  29233 (Business Class / Pakistan Ufone)
      6          9        2          →  692   (Special Bravo / Pakistan Fixed)
      6          9        234        →  69234 (Special Bravo / Pakistan Telenor)
      7          9        2          →  792   (Special Charlie / Pakistan Fixed)
      7          9        231        →  79231 (Special Charlie / Pakistan Zong)
```

### Pakistan Destination Sub-codes (after product digit)

| Sub-prefix | Operator / Destination |
|---|---|
| `92` | Pakistan Fixed (generic) |
| `9230` | Pakistan Jazz |
| `9231` | Pakistan Zong |
| `9233` | Pakistan Ufone |
| `9234` | Pakistan Telenor |

### Usage in the Platform
- **Rate Cards**: Each product class has its own vendor/client rate card. Prefix matching in LCR Analyser and Rate Card entries follows this schema.
- **BitsEye drill-down**: Destination breakouts group by these sub-codes (Jazz, Zong, Ufone, Telenor, Fixed).
- **CDR filtering**: `trunkClass` field on calls maps to the product code digit (`1`, `2`, `6`, `7`).
- **Routing Groups**: Named per product class (e.g. "Pakistan First Class", "Pakistan Business Class").

---

## Data Safety & Read-Only Policy

The platform is designed to be **read-only by default**. Every operation that runs automatically in the background is a pure read — nothing is written to the live Sippy switch without an explicit user action. This makes the platform safe to run 24/7 against a production Sippy instance.

### Background auto-runs (reads only — fire continuously, never touch Sippy data)

| Poll / Job | Sippy API Call | Interval |
|---|---|---|
| Live call monitor | `call_control.listActiveCalls` | Every 5 s |
| Dashboard KPIs | `call_control.getCountersStats` | Every 5 s |
| ASR/ACD trend charts | `monitoring.getMonitoringGraphData` | Every 5 s |
| Vendor balance snapshots | `account.getAccountBalance` (per vendor) | Every 60 s |
| CDR cache refresh | `account.getAccountCDRs` + `account.getCustomerCDRs` | Incremental on demand |
| Sippy Change Watcher | `account.listAccounts`, `account.listVendors`, `account.listAuthRules` | Every 5 min |
| Traffic Drop Detector | reads call snapshot cache (no Sippy call) | Every 5 min |
| SIP OPTIONS probe | TCP socket connect to switch IPs | Every 60 s |
| Multi-Switch consolidated poll | `call_control.getCountersStats` on each switch | Every 30 s (when page open) |
| MOS hourly aggregation | reads local CDR cache (no Sippy call) | Every 60 min |
| Account/vendor cache warm | `account.listAccounts`, `account.listVendors` | On startup + periodic |

### Write operations (only on explicit user action — never automatic)

| User Action | Sippy API Called | Where |
|---|---|---|
| Test Call — Phase 1 | `call_control.makeCall` (Trusted Mode) | Test Call Launcher |
| Test Call — Phase 2 | `make2WayCallback` (Normal/Customer Mode) | Test Call Launcher |
| Test Call — Phase 3 | `/simpleapi/callback.php` HTTP GET | Test Call Launcher |
| Push Rate Card to Sippy | `tariff.setRateEntry` (per prefix, batched) | Rate Cards → Push to Sippy |
| Delete rate from Sippy | `tariff.deleteRateEntry` | Rate Cards |
| Add IP auth rule | `account.addAuthRule` | Clients → Auth Rules |
| Edit IP auth rule | `account.updateAuthRule` | Clients → Auth Rules |
| Delete IP auth rule | `account.deleteAuthRule` | Clients → Auth Rules |
| Create Sippy account | `account.createAccount` + `account.addAuthRule` | Clients → New Account wizard |
| Update Sippy account | `account.updateAccount` | Clients → Edit account |
| Add DID | `account.addDID` | Clients → DID management |
| Delete DID | `account.deleteDID` | Clients → DID management |
| Add vendor connection | `vendor.createVendorConnection` | Clients → Vendors |
| Update vendor connection | `vendor.updateVendorConnection` | Clients → Vendors |
| Delete vendor connection | `vendor.deleteVendorConnection` | Clients → Vendors |
| Create/Update/Delete tariff | `createTariff` / `updateTariff` / `deleteTariff` | Rate Cards (tariff management) |
| Set low-balance threshold | `account.setLowBalance` | Clients → Balance alerts |

**Local-DB-only writes (never touch Sippy):** Settings save, KAM CRUD, team/role changes, alert rules, blacklist rules, secondary switch config, API key management, dashboard widget prefs, MOS snapshots, CDR cache, all monitoring log tables.

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
