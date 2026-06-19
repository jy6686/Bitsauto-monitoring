# VoIP Watcher — Complete Application Documentation

> **Platform:** Sippy Softswitch Only  
> **Stack:** Node.js / Express (backend) · React + Vite (frontend) · PostgreSQL (Drizzle ORM) · Replit Auth  
> **Deployment URL:** https://vo-ip-watcher--junaid70.replit.app  
> **Last Updated:** 17 April 2026

---

## Table of Contents

1. [Overview](#1-overview)  
2. [Architecture](#2-architecture)  
3. [Authentication & RBAC](#3-authentication--rbac)  
4. [Database Schema](#4-database-schema)  
5. [Backend — Server](#5-backend--server)  
6. [Sippy XML-RPC Integration](#6-sippy-xml-rpc-integration)  
7. [Frontend Pages](#7-frontend-pages)  
8. [API Routes Reference](#8-api-routes-reference)  
9. [Feature Details](#9-feature-details)  
10. [Environment Variables & Secrets](#10-environment-variables--secrets)  
11. [File Structure](#11-file-structure)  

---

## 1. Overview

VoIP Watcher is a full-stack Network Operations Center (NOC) monitoring and management platform built exclusively for the **Sippy Softswitch**. It provides:

- **Real-time NOC Dashboard** — live call counts, ASR, ACD, PDD, CK Ratio, system health
- **Live Call Monitor** — active sessions with codec, account, vendor, PDD, media IPs
- **CDR Viewer** — CDR search, filtering, enrichment (client/vendor tagging, FAS flag)
- **FAS / Fraud Detection** — False Answer Supervision scoring with composite fraud score
- **Per-Client & Per-Vendor Reporting** — ASR/ACD breakdowns, revenue estimates
- **Account Balance Monitor** — real-time balance polling with email alerts
- **DID Management** — list, search, and inspect DIDs directly from the switch
- **Traffic Map** — geographic call-flow visualization
- **Telecom Calculators** — ASR, ACD, MOS, margin, codec bandwidth tools
- **Dialplan / Route Tester** — test translations and routing via Sippy XML-RPC
- **Route Quality Analysis** — vendor route ranking by ASR/ACD/PDD
- **Client & Vendor Profiles** — full CRUD with Sippy account push wizard
- **Team Monitoring Assignments** — assign NOC staff to specific monitoring areas
- **SNMP Monitoring** — optional Sippy SNMP MIB polling
- **Email Alerts** — Gmail SMTP for balance/FAS/threshold notifications

---

## 2. Architecture

```
┌──────────────────────────────────────────────────┐
│                   Browser (React)                │
│  Vite + TanStack Query + shadcn/ui + wouter      │
└────────────────────┬─────────────────────────────┘
                     │ HTTP / JSON
┌────────────────────▼─────────────────────────────┐
│            Express Server (Node.js)              │
│  server/index.ts → server/routes.ts              │
│  ├─ Replit Auth middleware (session-based)       │
│  ├─ RBAC middleware (admin / management / viewer)│
│  ├─ Sippy XML-RPC layer  (server/sippy.ts)       │
│  ├─ Storage layer        (server/storage.ts)     │
│  ├─ CDR enrichment       (server/cdr-enrichment) │
│  ├─ SNMP poller          (server/snmp.ts)        │
│  └─ Email alerts         (server/email.ts)       │
└────────────────────┬─────────────────────────────┘
                     │ Drizzle ORM
┌────────────────────▼─────────────────────────────┐
│              PostgreSQL Database                 │
│  (Replit managed — DATABASE_URL env var)         │
└──────────────────────────────────────────────────┘
                     │ Digest Auth (XML-RPC)
┌────────────────────▼─────────────────────────────┐
│            Sippy Softswitch                      │
│  XML-RPC API on port 9999 (HTTP Digest)          │
│  Primary admin: ssp-root                         │
│  Read-only:     RTST1 (limited access)           │
└──────────────────────────────────────────────────┘
```

### Key Design Decisions
- **Single-port serving** — Express serves both the API and Vite's frontend on port 5000
- **All XML-RPC uses Digest auth** (`sippyPost()`) — Basic auth returns 401 from Sippy
- **Credential retry** — routes try RTST1 first, then ssp-root via `withSippyCreds()`
- **No mock/stub data** — all live data comes from Sippy or the PostgreSQL database

---

## 3. Authentication & RBAC

### Authentication Provider
Uses **Replit Auth** (`javascript_log_in_with_replit v2.0.0`). Session stored server-side in PostgreSQL via `connect-pg-simple`. Session secret in `SESSION_SECRET` env var.

### Roles

| Role | Description | Pages Accessible |
|------|-------------|-----------------|
| `admin` | Full access — all pages, settings, team management, client creation | All |
| `management` | Operational access — no settings or team management | Dashboard, Calls, Alerts, Reports, Clients, Fraud, CDRs, Tools, Traffic Map, Balance, DIDs |
| `viewer` | Read-only — dashboard and calls only | Dashboard, Calls, Account |

### Role Assignment
- First-time login: defaults to `viewer`
- Admin promotes users via the **Team** page (`/team`)
- Stored in `user_roles` table (`userId` PK, `role`, `assignedAt`, `assignedBy`)

### Route Protection
- **Backend:** `requireRole(['admin','management'], req, res, next)` middleware on sensitive routes
- **Frontend:** `<ProtectedRoute requiredRoles={[...]} />` — shows "Access Restricted" screen with `ShieldOff` icon if role check fails; unauthenticated users redirect to `/login`

---

## 4. Database Schema

All tables defined in `shared/schema.ts` using Drizzle ORM.

### Tables

#### `calls`
Local VoIP call session records (used for simulation/testing)
- `id`, `caller`, `callee`, `status`, `startTime`, `endTime`, `direction`
- `pdd` — Post-Dial Delay (seconds)
- `failReason` — `wrong_number | switched_off | untraceable | invalid`
- `originCountry`, `termCountry`, `trunkClass`
- `sipCode`, `billableSecs`, `fasFlag`, `callbackFlag`

#### `metrics`
Time-series call quality data
- `callId`, `timestamp`, `jitter` (ms), `latency` (ms), `packetLoss` (%), `mos` (1-5)

#### `alerts`
System threshold breach notifications
- `type`, `severity` (`warning | critical`), `message`, `resolved`, `createdAt`

#### `settings`
Global system configuration (single row)
- Switch connection: `switchType`, `portalUrl`, `portalUsername`, `portalPassword`
- Sippy XML-RPC admin: `apiAdminUsername`, `apiAdminPassword`
- SNMP: `snmpEnabled`, `snmpHost`, `snmpPort`, `snmpCommunity`, `snmpEnvironments`
- Email: `alertAdminEmail`, `alertGmailUser`, `alertGmailAppPass`, `alertEnabled`
- Thresholds: `jitterThreshold`, `latencyThreshold`, `packetLossThreshold`, `balanceAlertThreshold`
- FAS thresholds: `fasMinPddSecs`, `fasMaxBillSecs`, `fasEarlyAnswerSecs`, `fasShortCallSecs`

#### `clientProfiles`
Client and vendor account profiles
- `name`, `type` (`client | vendor`), `prefix`, `ipAddress`, `ratePerMin`
- `rateEffectiveFrom`, `rateEffectiveTo` — time-bounded rates
- `notes`, `switchSyncStatus` (JSON: `{ sippy, vos3000, syncedAt }`)
- Sippy account params: `maxSessions`, `maxCallsPerSecond`, `maxSessionTime`, `creditLimit`
- `routingGroup`, `preferredCodec`, `cldTranslationRule`, `cliTranslationRule`
- `servicePlan`, `sipClass`, `timezone`, `language`, `companyName`, `alertEmail`
- `costPerMin`, `revenuePerMin` (override per-client/vendor rates)

#### `switches`
Multi-switch configuration (additional Sippy or VOS3000 instances)
- `name`, `type` (`sippy | vos3000`), `portalUrl`, `portalUsername`, `portalPassword`
- `loginType`, `enabled`, `lastSyncAt`, `lastSyncStatus`

#### `fasEvents`
False Answer Supervision fraud detection records
- `callId`, `caller`, `callee`, `clientName`, `vendor`
- `pddSecs`, `billSecs`, `sipCode`, `reason` (comma-sep flags)
- `fraudScore` (0-100 composite), `detectedAt`, `alertSent`

#### `callSnapshots`
Live call state snapshots polled every 30 seconds, retained 24 hours (one row per Sippy call ID, upserted)
- `sippyCallId` (UNIQUE), `caller`, `callee`, `clientName`, `vendor`
- `accountId`, `iCustomer`, `iEnvironment`, `direction`, `codec`, `ccState`
- `maxDurationSecs`, `pddMs`, `mediaIpCaller`, `mediaIpCallee`, `connection`
- `firstSeen`, `lastSeen`

#### `userConfig`
Per-user personal settings (beyond Replit Auth profile)
- `userId` (PK), `displayName`, `phone`, `department`, `timezone`
- `notificationEmail`, `defaultReportRange`, `bio`

#### `monitoringAssignments`
Which monitoring items each team member is responsible for
- `userId` (PK), `items` (text array), `assignedBy`, `updatedAt`

#### `userRoles`
RBAC role mapping
- `userId` (PK), `role` (`admin | management | viewer`), `assignedAt`, `assignedBy`

### Monitoring Items (canonical list in `shared/schema.ts`)

| ID | Label | Group |
|----|-------|-------|
| `live_summary` | Live Calls – Summary | Live Calls |
| `live_details` | Live Calls – Details | Live Calls |
| `live_quality` | Live Calls – Quality | Live Calls |
| `call_history` | Call History | Live Calls |
| `balance_monitor` | Balance Monitor | Finance |
| `alerts` | Alerts | Operations |
| `fraud_fas` | FAS / Fraud Detection | Security |
| `traffic_map` | Traffic Map | Operations |
| `reports` | ASR / ACD Reports | Reports |
| `route_quality` | Route Quality Analysis | Reports |
| `did_management` | DID Management | Operations |

---

## 5. Backend — Server

### `server/index.ts`
Entry point. Starts Express, registers middleware (CORS, sessions, Replit Auth), calls `registerRoutes()`, then starts the HTTP server on port 5000. On startup, attempts Sippy auto-connect with stored credentials.

### `server/routes.ts`
All REST API routes (~2500+ lines). Key helpers defined at top:
- `sippyXmlCreds(settings, sw?)` — extract `{ username, password }` from settings or a switch override
- `sippyXmlCredsPairs(settings)` — returns array of all credential pairs to try: `[RTST1, ssp-root]`
- `sippyPortalUrl(settings)` — derives XML-RPC base URL from stored `portalUrl`
- `withSippyCreds(settings, fn)` — tries each credential pair, retries on auth failure, returns first success

### `server/sippy.ts`
All Sippy XML-RPC functions (~5000+ lines). Uses HTTP Digest auth via `sippyPost()`.

Key functions:
| Function | Description |
|----------|-------------|
| `sippyPost(url, body, user, pass)` | Core HTTP Digest XML-RPC caller |
| `testSippyConnection(user, pass, url)` | Connectivity test (pings `getAccountInfo`) |
| `getSippyActiveCalls(user, pass, url)` | Live call sessions via `getActiveCalls` |
| `getSippyCDRs(filters)` | CDR export with date/account/CLI/CLD filters |
| `createSippyAccount(params, user, pass, url)` | Create customer account via `createAccount` |
| `getSippyAccountInfo(id, user, pass, url)` | Fetch account details |
| `getSippyCustomerList(user, pass, url)` | List all customers |
| `listSippyBillingPlans(user, pass, url)` | Probe billing/service plans (tries multiple XML-RPC methods, falls back to ID probe 1–100) |
| `getSippyDIDs(user, pass, url)` | List DID numbers via `getDIDList` |
| `getSippyAccountBalances(user, pass, url)` | Fetch balances for all accounts |
| `testSippyDialplan(...)` | Route/dialplan test via `testDialplan` |
| `getSippyRoutingGroups(user, pass, url)` | List routing groups |
| `getSippySipClasses(user, pass, url)` | List SIP classes |
| `pushAccountToSippy(params, user, pass, url)` | Full account creation with billing plan pre-discovery and fault-based probing |

### `server/storage.ts`
`IStorage` interface + `DatabaseStorage` class (PostgreSQL via Drizzle). Methods for all CRUD operations on every table.

### `server/cdr-enrichment.ts`
Enriches raw Sippy CDR rows with client/vendor name matching based on IP address, CLI/CLD prefix lookup, and FAS flag detection.

### `server/snmp.ts`
Optional SNMP poller for Sippy MIB (Enterprise OID `.1.3.6.1.4.1.36523`). Polls active call count, codec stats, environment metrics.

### `server/email.ts`
Gmail SMTP email alert dispatcher using `nodemailer`. Sends balance threshold alerts, FAS fraud alerts.

### `server/db.ts`
Drizzle ORM setup connected to `DATABASE_URL`.

---

## 6. Sippy XML-RPC Integration

### Connection
- **Protocol:** HTTP Digest Authentication over XML-RPC
- **Default Port:** 9999
- **URL format:** `http://<switch-host>:9999/RPC2`

### Credentials
| Credential | Username | Access Level |
|------------|----------|-------------|
| Portal / Admin | `ssp-root` | Full XML-RPC admin access |
| API Read-only | `RTST1` | Limited — read-only, many admin calls return 401 |

### Credential Retry Pattern
The `withSippyCreds()` function tries RTST1 first, then ssp-root. The `/api/sippy/accounts` create route also has its own retry loop. The billing plans endpoint manually iterates all pairs until one returns actual plans.

### Billing Plan Discovery
`listSippyBillingPlans()` tries these methods in order:
1. `getBillingPlanList` (Sippy 5.x)
2. `getCustomerBillingPlanList`
3. `listBillingPlans`
4. `billing_plan.getList`
5. `billing.getBillingPlanList`
6. Falls back to probing `getServicePlanInfo` with IDs 1–100

If the first round fails, the account creation route performs a fault-based probe: tries `createAccount` with IDs 1–20 until one succeeds or all fail.

---

## 7. Frontend Pages

| Route | File | Roles | Description |
|-------|------|-------|-------------|
| `/login` | `login.tsx` | — | Replit Auth login page |
| `/` | `dashboard.tsx` | All | NOC Dashboard — live stats, active calls summary, health indicators |
| `/calls` | `calls-list.tsx` | All | Live & recent call list with filters |
| `/calls/:id` | `call-detail.tsx` | All | Individual call detail — metrics, SIP codes, timeline |
| `/alerts` | `alerts.tsx` | Admin, Mgmt | System alerts with severity, resolve/dismiss controls |
| `/reports` | `reports.tsx` | Admin, Mgmt | ASR/ACD per-CLI/CLD reports, revenue estimates, route quality |
| `/clients` | `clients.tsx` | Admin, Mgmt | Client & vendor profiles + New Sippy Account wizard |
| `/fraud` | `fraud.tsx` | Admin, Mgmt | FAS event log, fraud scores, filters by vendor/client |
| `/cdrs` | `cdrs.tsx` | Admin, Mgmt | CDR viewer with date/CLI/CLD/account filters |
| `/tools` | `tools.tsx` | Admin, Mgmt | Telecom calculators + Dialplan/Route Tester |
| `/team` | `team.tsx` | Admin | Team members, role assignment, monitoring assignments |
| `/traffic-map` | `traffic-map.tsx` | Admin, Mgmt | Geographic call flow map (origin → termination countries) |
| `/balance` | `balance-monitor.tsx` | Admin, Mgmt | Real-time account balance monitor with alert thresholds |
| `/dids` | `dids.tsx` | Admin, Mgmt | DID number management from Sippy |
| `/settings` | `settings.tsx` | Admin | System settings — switch connection, SNMP, email, thresholds |
| `/account` | `account.tsx` | All | Personal user profile, timezone, notification email |
| `/multi-switch` | `multi-switch.tsx` | Admin, Mgmt | Multi-Switch Consolidated View — aggregated NOC across all Sippy instances |

### Layout
`client/src/components/layout-shell.tsx` — shared dark-mode sidebar layout wrapping all authenticated pages. Navigation items vary by role.

---

## 8. API Routes Reference

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/user` | Current authenticated user + role |
| POST | `/api/auth/logout` | Logout / clear session |

### Calls (local DB)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/calls` | List calls with optional filters |
| GET | `/api/calls/:id` | Single call + latest metric |
| POST | `/api/calls` | Create call record |
| PATCH | `/api/calls/:id` | Update call |
| GET | `/api/stats` | Dashboard stats (ASR, ACD, PDD, CK ratio) |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts` | List alerts |
| POST | `/api/alerts` | Create alert |
| PATCH | `/api/alerts/:id` | Update alert (e.g. resolve) |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get system settings |
| PATCH | `/api/settings` | Update settings |

### Client / Vendor Profiles
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/clients` | List all profiles |
| POST | `/api/clients` | Create profile |
| PATCH | `/api/clients/:id` | Update profile |
| DELETE | `/api/clients/:id` | Delete profile |

### Sippy Live Data
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sippy/status` | Test connection + ping |
| GET | `/api/sippy/active-calls` | Live active call sessions |
| GET | `/api/sippy/cdrs` | CDR export (query: `dateStart`, `dateEnd`, `cliFilter`, `cldFilter`, `accountId`, `limit`) |
| GET | `/api/sippy/balances` | All account balances |
| GET | `/api/sippy/dids` | DID list |
| GET | `/api/sippy/billing-plans` | Service plan list (tries all credential pairs) |
| GET | `/api/sippy/routing-groups` | Routing group list |
| GET | `/api/sippy/sip-classes` | SIP class list |
| GET | `/api/sippy/customers` | Customer account list |
| GET | `/api/sippy/accounts/:id` | Account details by ID |
| POST | `/api/sippy/accounts` | Create new Sippy account (Admin/Mgmt only) |
| POST | `/api/sippy/test-dialplan` | Test dialplan/route translation |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/asr-acd` | ASR/ACD report (from Sippy CDRs or local DB) |
| GET | `/api/reports/route-quality` | Route quality analysis by vendor |

### FAS / Fraud
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fas/events` | FAS detection events |
| POST | `/api/fas/scan` | Run FAS scan on recent CDRs |

### Team
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/team/members` | All users with roles |
| POST | `/api/team/roles` | Assign role to user (Admin only) |
| GET | `/api/team/assignments` | Monitoring assignments |
| POST | `/api/team/assignments` | Set monitoring assignments |

### User Config
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user/config` | Get personal settings |
| PATCH | `/api/user/config` | Update personal settings |

### Switches (Multi-Switch)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/switches` | List all configured secondary switches |
| POST | `/api/switches` | Add a secondary switch |
| PATCH | `/api/switches/:id` | Update a switch (name, URL, credentials, enabled) |
| DELETE | `/api/switches/:id` | Remove a switch |
| GET | `/api/switches/consolidated` | Poll all switches in parallel and return per-switch stats + global aggregate. Writes `lastSyncAt` + `lastSyncStatus` to each secondary switch DB record on every poll. |
| POST | `/api/switches/:id/test` | Test connectivity of a specific switch (Sippy XML-RPC ping). Updates `lastSyncAt` + `lastSyncStatus` on success/failure. |
| GET | `/api/switches/:id/session` | Check session/auth status for a specific switch |

---

## 9. Feature Details

### NOC Dashboard (`/`)
Displays:
- **Active Calls** — count from Sippy live poll
- **ASR** — Answer-Seizure Ratio (%)
- **ACD** — Average Call Duration (seconds)
- **PDD** — Post-Dial Delay (seconds)
- **CK Ratio** — Connection Rate (connected / total attempted)
- **CK Breakdown** — connected / wrong number / switched off / untraceable
- **System Health** — Healthy / Degraded / Critical based on thresholds
- Live call table with codec, account, vendor, direction, PDD, media IPs

### New Sippy Account Wizard (`/clients` → New Account)
7-step wizard:
1. **Switch** — select configured Sippy switch instance
2. **Account Info** — account ID, username, SIP password (auto-generated, 12-char, RefreshCw regenerate)
3. **Limits** — max sessions, CPS, credit limit, max session time
4. **Billing** — service plan (name-based dropdown or text input), rate/min, max session time
5. **Routing** — routing group, preferred codec, SIP class
6. **Translation Rules** — CLI rule, CLD rule, PAI rule (4-digit auto-generated, RefreshCw regenerate)
7. **Review & Create** — summary before Sippy push

Auto-features:
- SIP Password: generates 12-char strong password on mount (letters + digits + symbols)
- PAI Translation Rule: generates 4-digit code (1000-9999) on mount
- Service Plan: auto-matches plan name from client name; dropdown shows names only (no ID numbers)

### Account Balance Monitor (`/balance`)
- Polls Sippy account balances via XML-RPC
- Shows balance, credit limit, threshold status per account
- Highlights accounts below configurable threshold
- Email alerts via Gmail when balance drops below threshold

### CDR Viewer (`/cdrs`)
- Fetches CDRs from Sippy via `getAccountCDRs` / `getCDRs` XML-RPC
- Filters: date range, CLI, CLD, account ID, limit
- CDR enrichment: matches CLI/CLD/IP to client/vendor profiles
- FAS flagging inline

### FAS / Fraud Detection (`/fraud`)
Composite fraud score formula:
- `high_pdd` — PDD > `fasMinPddSecs` (default 10s)
- `short_billed` — billed < `fasMaxBillSecs` (default 5s) but SIP 200
- `zero_billed` — 0 seconds billed on answered call
- `early_answer` — PDD < `fasEarlyAnswerSecs` (default 2s)
- `short_call` — billed < `fasShortCallSecs` (default 10s)

Score 0-100; each flag contributes weighted points. Stored in `fasEvents` table.

### Telecom Calculators (`/tools`)
- **ASR Calculator** — answered / total calls
- **ACD Calculator** — total duration / answered calls
- **MOS Estimator** — from jitter, latency, packet loss (E-Model approximation)
- **Revenue/Margin** — minutes × rate, cost vs revenue
- **Codec Bandwidth** — calls × codec bitrate + overhead
- **Dialplan Tester** — send CLI/CLD through Sippy `testDialplan` API, show routing result

### Traffic Map (`/traffic-map`)
Geo-visualizes call flow using origin country (from CLI number) and termination country (from CLD number). Drawn on a world map with arc overlays.

### Team Monitoring Assignments (`/team`)
Admins assign each NOC team member to specific monitoring items from the canonical `MONITORING_ITEMS` list (11 items across 5 groups). Stored in `monitoringAssignments` table. Used to show each operator what they are responsible for.

### Route Quality Analysis (`/reports`)
Ranks vendor routes by:
- ASR — Answer-Seizure Ratio
- ACD — Average Call Duration
- PDD — Post-Dial Delay
- Volume — total call attempts

Source: Sippy CDR data aggregated by terminating vendor/account.

### DID Management (`/dids`)
- Fetches DID list from Sippy via XML-RPC
- Displays number, account, country, state, type
- Search and filter by number or account

### Multi-Switch Consolidated View (`/multi-switch`)

Aggregated real-time NOC monitoring across the primary Sippy switch and any number of secondary Sippy instances.

#### Architecture

```
Primary switch (from Settings)          Secondary switches (from `switches` table)
       │                                        │ (type = 'sippy', enabled = true)
       └─────────────── GET /api/switches/consolidated ──────────────┘
                           pollSwitch() per switch in parallel
                           (getSippyDashboardMetrics → getCountersStats XML-RPC)
                                             │
                            per-switch result + global aggregate
                                             │
                            writes lastSyncAt + lastSyncStatus to DB
                            (for "Last Sync" column in the UI)
```

#### Global KPI Cards (top of page)
| Card | Source |
|------|--------|
| Total Active Calls | Sum of `activeCalls` across all online switches |
| Switches Online | Count of switches where `status === 'online'` |
| Overall ASR | Average ASR across online switches |
| Avg ACD | Average ACD across online switches |

#### Per-Switch Status Cards
Each switch renders an expandable card showing:
- **Badge:** `Online` (green), `Offline` (gray), `Error` (red), or `Unconfigured` (yellow)
- **Primary badge:** Star badge on the primary switch
- **KPIs:** Active calls, ASR %, ACD (seconds)
- **Expandable detail row:** URL, last sync timestamp, last sync status message

#### Switch Management Table
Columns: Name, URL, User, Type, Status, Last Sync, Actions

**Last Sync behavior (as of April 2026 fix):**
- `GET /api/switches/consolidated` writes `lastSyncAt` + a status summary to the DB for each secondary switch after every consolidated poll. Status examples:
  - `online · 4 active calls · ASR 92%`
  - `error: connection refused`
  - `offline (disabled)`
- `POST /api/switches/:id/test` (wifi icon in Actions column) writes `lastSyncAt` + `test OK — connection verified` or `test failed: <reason>` after each test.
- Before the first poll or test, "Last Sync" shows `—`.

#### Add / Edit Switch Dialog
Fields:
- **Display Name** — friendly label (e.g. `SB1`)
- **Portal URL** — full Sippy web URL (e.g. `https://104.245.246.110/`)
- **API Username** — Sippy admin/XML-RPC username (e.g. `RTST-SB1`)
- **API Password** — stored in `portal_password` column; show/hide toggle
- **Enabled** — checkbox to include/exclude from consolidated poll
- **Test Connection** button — fires `POST /api/switches/:id/test` in-dialog before saving

#### Auto-Refresh
- 30-second auto-refresh toggle in the page header
- Manual **Refresh** button fires `GET /api/switches/consolidated` immediately
- Both actions update "Last Sync" for all secondary switches

#### Navigation
- Sidebar icon: `Layers`
- Roles: `admin`, `management`

#### Database Fields (`switches` table)
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | Auto-increment |
| `name` | varchar(128) | Display name |
| `type` | varchar(20) | Always `sippy` for secondary switches |
| `portal_url` | varchar(512) | Full switch URL |
| `portal_username` | varchar(128) | XML-RPC username |
| `portal_password` | varchar(255) | XML-RPC password (plaintext, stored in DB) |
| `api_admin_username` | varchar(128) | Optional override admin username |
| `api_admin_password` | varchar(255) | Optional override admin password |
| `login_type` | integer | Default 1 |
| `enabled` | boolean | Whether to include in consolidated poll |
| `last_sync_at` | timestamp | Updated after every consolidated poll or test |
| `last_sync_status` | varchar(512) | Human-readable result of last poll/test |
| `created_at` | timestamp | Auto-set on INSERT |

---

## 10. Environment Variables & Secrets

| Variable | Description | Managed By |
|----------|-------------|-----------|
| `DATABASE_URL` | PostgreSQL connection string | Replit (auto-provided) |
| `SESSION_SECRET` | Express session signing secret | Replit Secrets |
| `REPLIT_DOMAINS` | Replit Auth allowed domains | Replit (auto-provided) |
| `ISSUER_URL` | Replit OIDC issuer URL | Replit (auto-provided) |

Sippy credentials (`portalUrl`, `portalUsername`, `portalPassword`, `apiAdminUsername`, `apiAdminPassword`) are stored in the **`settings` database table**, not in environment variables. They are configured via the **Settings page** (`/settings`).

---

## 11. File Structure

```
/
├── client/
│   └── src/
│       ├── App.tsx                    # Router + ProtectedRoute + RBAC
│       ├── pages/
│       │   ├── dashboard.tsx          # NOC dashboard
│       │   ├── calls-list.tsx         # Live/recent calls list
│       │   ├── call-detail.tsx        # Single call detail
│       │   ├── alerts.tsx             # Alert management
│       │   ├── reports.tsx            # ASR/ACD + route quality reports
│       │   ├── clients.tsx            # Client/vendor profiles + Sippy wizard
│       │   ├── fraud.tsx              # FAS/fraud detection viewer
│       │   ├── cdrs.tsx               # CDR viewer
│       │   ├── tools.tsx              # Telecom calculators + dialplan tester
│       │   ├── team.tsx               # Team members + monitoring assignments
│       │   ├── traffic-map.tsx        # Geographic traffic visualization
│       │   ├── balance-monitor.tsx    # Account balance monitor
│       │   ├── dids.tsx               # DID management
│       │   ├── settings.tsx           # System settings
│       │   ├── account.tsx            # Personal user account
│       │   ├── multi-switch.tsx       # Multi-Switch Consolidated View
│       │   ├── login.tsx              # Replit Auth login
│       │   └── not-found.tsx          # 404 page
│       ├── components/
│       │   ├── layout-shell.tsx       # Dark sidebar shell layout
│       │   ├── stat-card.tsx          # Dashboard metric cards
│       │   └── mos-badge.tsx          # MOS score color badge
│       ├── hooks/
│       │   ├── use-auth.ts            # Auth context + role fetch
│       │   └── use-toast.ts           # Toast notifications
│       └── lib/
│           └── queryClient.ts         # TanStack Query client + apiRequest helper
│
├── server/
│   ├── index.ts                       # Express entry point
│   ├── routes.ts                      # All REST API routes
│   ├── sippy.ts                       # Sippy XML-RPC integration layer
│   ├── storage.ts                     # IStorage interface + DatabaseStorage
│   ├── db.ts                          # Drizzle ORM / PostgreSQL connection
│   ├── cdr-enrichment.ts              # CDR client/vendor tagging + FAS detection
│   ├── snmp.ts                        # Sippy SNMP MIB poller
│   ├── email.ts                       # Gmail SMTP alert sender
│   ├── vite.ts                        # Vite dev server integration (do not modify)
│   ├── static.ts                      # Static file serving for production
│   └── types/                         # Shared TypeScript types for server
│
├── shared/
│   ├── schema.ts                      # Drizzle table definitions, Zod schemas, shared types
│   └── models/
│       └── auth.ts                    # Auth user type (from Replit OIDC)
│
├── drizzle.config.ts                  # Drizzle ORM config (do not modify)
├── vite.config.ts                     # Vite config (do not modify)
├── tailwind.config.ts                 # Tailwind + dark mode config
├── replit.md                          # Project memory / architecture notes
└── APP_DOCUMENTATION.md               # This file
```

---

## Key Technical Notes

1. **Sippy XML-RPC always uses Digest Auth** — `sippyPost()` handles the 401 → re-request with `Authorization: Digest ...` cycle automatically. Never use Basic auth with Sippy.

2. **Billing plan ID resolution** — The wizard sends the plan ID (integer) to the backend. The dropdown now shows plan names only. If no plans load, the user types a name and the backend's pre-discovery probe finds the matching ID by calling `getServicePlanInfo` for IDs 1–100 with ssp-root credentials.

3. **Live call snapshots** — `callSnapshots` are upserted every 30 seconds (by `sippyCallId`), auto-expired after 24 hours. This allows historical "call was active" lookups without keeping Sippy live data forever.

4. **Multi-credential fallback** — `sippyXmlCredsPairs()` returns `[RTST1, ssp-root]`. Any route using `withSippyCreds()` automatically retries with ssp-root if RTST1 gets a 401. The billing-plans endpoint uses a manual loop for the same purpose (since `listSippyBillingPlans` returns `{plans: []}` on empty, not `{success: false}`).

5. **Rate time-bounding** — `rateEffectiveFrom` / `rateEffectiveTo` on `clientProfiles` allow scheduling rate changes in advance. The reporting layer uses the rate active at call time.

6. **Session persistence** — Express sessions stored in PostgreSQL via `connect-pg-simple`. Server restarts do not log users out.
