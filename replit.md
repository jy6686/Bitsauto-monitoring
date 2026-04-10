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
- **Sippy Softswitch ONLY** (VOS3000 permanently removed from all UI)
- ASR/ACD origination reports with client/vendor profiles
- Role-based access control (admin > management > viewer)
- Alert engine with threshold-based triggers
- Team page with Quick Assign Role form (email + role dropdown + submit)

## Sippy Integration (`server/sippy.ts`)
- XML-RPC POST to `/xmlapi/xmlapi`, HTTP **Digest** Auth (RFC-2617, NOT Basic) — `sippyPost()` handles 2-step probe-then-digest
- Admin credentials: ssp-root (apiAdminUsername/apiAdminPassword). Portal credentials (RTST1) only support limited read-only methods
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
- Dashboard stat cards use real portal data when VOS3000 is connected
- All stat cards show `—` when not connected to avoid misleading zeros

## Pages
- `/` — Dashboard with live stats, KPIs, IP probe, portal data
- `/calls` — Call list with metrics
- `/calls/:id` — Call detail page
- `/alerts` — Alert feed
- `/reports` — ASR/ACD report + client stats table
- `/cdrs` — CDR Viewer: full CDR table (CLI, CLD, country, duration, billed, charged), date presets, call type filter, CLI/CLD search, pagination (50/page), CSV export, summary stats. Shows data when RTST1 accounts make completed calls. API: GET /api/sippy/cdr
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
