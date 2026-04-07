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
- APIs implemented: listAccounts (doc 107322), getRegistrationStatus (107366), listAuthRules / addAuthRule / updateAuthRule / deleteAuthRule (107336), getLowBalance / updateLowBalance (107444), createAccount (doc 107417+), listRoutingGroups
- Clients page "Sippy Accounts" tab: live account list with SIP registration badge, auth rules CRUD (expandable per account), low balance modal, New Sippy Account modal
- createAccount key learnings: `preferred_codec` must be `-1` (integer, NOT nil); `i_password_policy` must be `1`; `max_credit_time` must be positive (default 3600, not 0/-1); `i_routing_group` required for root customer (auto-fetched via listRoutingGroups); `i_billing_plan` must be specified (defaults to 1); `listRoutingGroups` API is the working method on Sippy ≤ 5.x; routing group ID=3 confirmed on this instance
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
