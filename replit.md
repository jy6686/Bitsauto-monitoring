# VoIP Monitoring Platform

## Overview
Full-stack dark-mode VoIP monitoring dashboard with real-time metrics, alerting, team management, and live softswitch integration.

## Architecture
- **Backend**: Express + TypeScript (`server/`)
- **Frontend**: React + Vite + TailwindCSS (`client/src/`)
- **Database**: PostgreSQL via Drizzle ORM (`shared/schema.ts`)
- **Auth**: Replit Auth (OpenID Connect)

## Key Features
- Real-time call quality metrics (Jitter, Latency, Packet Loss, MOS)
- Telecom KPIs: ASR, ACD, PDD, Call Back Ratio
- Live IP endpoint probe (TCP SIP port check)
- VOS3000 softswitch integration (CAPTCHA login, CDR, live calls, stats)
- Sippy Softswitch integration (XML-RPC, HTTP Basic Auth)
- Per-client stats from VOS3000 terminal accounts
- ASR/ACD origination reports with client/vendor profiles
- Role-based access control (admin > management > viewer)
- Alert engine with threshold-based triggers

## VOS3000 Integration (`server/vos3000.ts`)
- CAPTCHA fetched from `verifyimage.jsp` using `node:http` (native fetch drops Set-Cookie)
- Login: POST to `login.jsp?randCode=<captcha>` with JSON body `{terminalName, terminalPassword, terminalType}`
- Session stored in memory (`activeSession`)
- Endpoints: CDR, live calls, summary stats, per-client stats, terminal account list
- `fetchVosClients()` — queries terminal accounts (tries 4 endpoint variants)
- `fetchClientStats()` — per-client traffic via `expenditureSummary.action`
- `clientName` extracted from CDR and live call records

## Sippy Integration (`server/sippy.ts`)
- XML-RPC POST to `/xmlapi/xmlapi`, HTTP **Digest** Auth (RFC-2617, NOT Basic) — `sippyPost()` handles 2-step probe-then-digest
- Admin credentials: ssp-root (apiAdminUsername/apiAdminPassword). Portal credentials (RTST1) only support limited read-only methods
- APIs implemented (see full coverage table below):
  - Accounts: listAccounts (107322), getRegistrationStatus (107366), listAuthRules / addAuthRule / updateAuthRule / deleteAuthRule (107336), getLowBalance / updateLowBalance (107444), createAccount (107312+), listRoutingGroups
  - Vendors: listVendors, getVendorConnectionsList, createVendorConnection, updateVendorConnection, deleteVendorConnection, getVendorConnectionInfo (all with qmon fields)
  - CDRs: getSippyCDRs = getAccountCDRs (107367) + getCustomerCDRs (107429) with full field set + toSippyDate() helper
  - Live Calls: getAccountCallStats (107462) for active call monitoring
  - Monitoring: getMonitoringGraphData for ACD/ASR time-series charts
  - Billing: getAccountBalance (107444), getBillingPlans, getTariffs, getRateList, setRateEntry, deleteRateEntry
  - Routing: listRoutingGroups, getRoutingGroupsList
  - Dictionaries: getSystemDictionary (17 dict types, doc 3000055804)
  - Trunks (3000116551): createTrunk, updateTrunk, deleteTrunk, getTrunkInfo, getTrunksList
  - Trunk Connections (3000116552): createTrunkConnection, updateTrunkConnection, deleteTrunkConnection, getTrunkConnectionInfo, getTrunkConnectionsList
- Clients page "Sippy Accounts" tab: live account list with SIP registration badge, auth rules CRUD (expandable per account), low balance modal, New Sippy Account modal
- createAccount key learnings (official docs 107312): `preferred_codec` per docs null = "Disabled" (NOT -1; -1 was wrong); `i_password_policy` must be `1`; `max_credit_time` must be positive (default 3600, not 0/-1); `i_routing_group` required for root customer (auto-fetched via listRoutingGroups); `i_billing_plan` required since v1.8 (defaults to 1); `listRoutingGroups` API is the working method on Sippy ≤ 5.x; routing group ID=3 confirmed on this instance; `i_customer: 1` ALWAYS required for ssp-root; `welcome_call_ivr` and `on_payment_action` stored as nil on existing accounts; form now exposes all key fields: username, web_password, authname, voip_password, first_name, last_name, email, country, codec dropdown (null/0/8/18/9/3/4/15), reg_allowed, trust_cli, balance, lifetime
- createAccount SERVER BUG: This Sippy server returns fault 501 "Fatal error" for all createAccount calls after full validation passes. Root cause is internal to the Sippy server (DB state/sequence issue or license limit). All params and auth are correct. Customers 1 (root) and 2 (RTST1) both fail. This is NOT an application code bug. Current accounts: i_account=1 (TEST) and i_account=4 (testfinal05/TestFinal). Fault string extraction fixed (was using wrong regex for struct format). Error message now correctly shows "Fatal error" instead of misleading "Authentication failed"
- Balance inversion: listAccounts does NOT invert; createAccount/getAccountInfo DO invert
- Registration status fault 403 = not registered (returns `{ registered: false }` silently)

## Important State
- Simulation is **disabled** (`simulationEnabled = false` in DB)
- Dashboard shows "Connect Softswitch" banner when simulation off and portal not connected
- Dashboard stat cards use real portal data when VOS3000 is connected
- All stat cards show `—` when not connected to avoid misleading zeros

## Pages
- `/` — Dashboard with live stats, KPIs, IP probe, portal data
- `/calls` — Call list with metrics
- `/calls/:id` — Call detail page
- `/alerts` — Alert feed
- `/reports` — ASR/ACD report + VOS3000 Client Stats table
- `/clients` — Client/vendor profiles + VOS3000 terminal account sync
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
