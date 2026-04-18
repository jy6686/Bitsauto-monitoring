# Architecture Flow — VoIP Monitoring Platform
Sippy Softswitch (Python 2 Build) Integration

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BROWSER (React + Vite)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Dashboard │  │Live Calls│  │Analytics │  │  CDR Viewer   │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Fraud   │  │Billing   │  │Rate Cards│  │ LCR Analyser  │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │BitsEye   │  │Products  │  │  P&L     │  │Click-to-Call  │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────────────┐  │
│  │  Team    │  │Settings  │  │   🔧 Global Fix Button       │  │
│  └──────────┘  └──────────┘  └─────────────────────────────┘  │
│            TanStack Query + wouter routing                      │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/JSON
┌────────────────────────▼────────────────────────────────────────┐
│                  EXPRESS SERVER (Node.js + tsx)                  │
│  Port 5000 — serves both API and Vite frontend                  │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  Routes Layer   │  │  Storage Layer   │  │ Sippy Module  │  │
│  │  (routes.ts)    │  │  (storage.ts)    │  │ (sippy.ts)    │  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬───────┘  │
│           │                   │                      │           │
│  ┌────────▼──────────────────▼──────────────────────▼────────┐  │
│  │                Background Jobs (in registerRoutes)         │  │
│  │  • CDR cache warmer (every 3 min)                         │  │
│  │  • Sippy watcher (accounts, IPs, vendors — 30 min)        │  │
│  │  • Vendor balance snapshots                               │  │
│  │  • Auto-recovery job (every 2 min) — Phases 3+4           │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │ Drizzle ORM
┌────────────────────────▼────────────────────────────────────────┐
│                   PostgreSQL Database                            │
│  Tables: calls, metrics, alerts, settings, users, roles,        │
│          client_profiles, switches, fas_events, call_snapshots,  │
│          outage_log, alert_rules, monitored_hosts, kams,         │
│          kam_accounts, rate_cards, rate_card_entries,            │
│          call_test_logs, whatsapp_alert_log, fix_history         │
└─────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│              SIPPY SOFTSWITCH (Python 2 — Remote)               │
│  XML-RPC API on port 9900 (HTTP)                                │
│  Methods: listActiveCalls, listAccounts, listVendors,           │
│           getAccountInfo, listRoutingGroupMembers, getCDRs,     │
│           getCustomerCDRs, makeCall                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Global Fix Button Flow

```
User clicks Fix Button
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEP 1 — Detect Context                                       │
│  • Reads current URL via wouter useLocation()                  │
│  • Maps URL → human page name (PAGE_NAMES map)                │
│  • Encodes as ?module= query param                            │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEP 2 — Collect Logs (Frontend)                              │
│  • window.onerror listener → captures JS errors               │
│  • window.unhandledrejection → captures Promise failures      │
│  • Up to 20 errors stored in frontendErrorsRef                │
│  • Encoded as ?errors= JSON param sent to backend             │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEP 3 — Check API (Backend: GET /api/fix/diagnose)           │
│                                                                │
│  Core Checks (always run):                                    │
│  1. Sippy Credentials        (read from DB settings)          │
│  2. Sippy Session Status     (getSippySessionStatus())        │
│  3. Sippy Live API Call      (listActiveCalls XML-RPC)        │
│  4. CDR Cache Health         (size + age check)               │
│  5. PostgreSQL Connectivity  (test query)                     │
│  6. FAS/IRSF Engine          (getFasEvents())                 │
│                                                                │
│  Module-Specific Checks (based on ?module= param):            │
│  • Live Calls → active call count                             │
│  • CDR Viewer → CDR data volume                               │
│  • Analytics → volume + freshness                             │
│  • Fraud Detection → FAS event count                          │
│  • P&L Report → CDR + rate card availability                  │
│  • Billing → client profile count                             │
│  • Rate Cards → rate card count + entries                     │
│  • LCR Analyser → vendor connection cache size                │
│  • Settings → API session validation                          │
│  • BitsEye → CDR source check                                 │
│  • Products → CDR volume check                                │
│  • Click-to-Call → API reachability                           │
│  • Reports → CDR source                                       │
│  • Team Management → KAM count                                │
│  • Dashboard → composite readiness                            │
│                                                                │
│  Frontend Error Check:                                        │
│  • Parses ?errors= param                                      │
│  • If errors present → adds UI_ERROR issue                    │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEP 4 — Classify Issues                                      │
│  • Each check can emit 0 or more typed issues                 │
│  • Types: AUTH_ERROR, NO_DATA, API_FAILURE, TIMEOUT,          │
│           DATA_MISMATCH, BACKEND_ERROR, UI_ERROR              │
│  • Severity: critical, warning, info                          │
│  • Overall status = critical > warning > ok                   │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEP 5 — Past Fix Lookup (Phase 3)                            │
│  • For each issue: storage.findSimilarFix(type, component)    │
│  • Returns most recent successful fix for that issue type     │
│  • Attached as pastFix to each issue in response              │
│  • Shown as "Previously resolved" violet badge in UI          │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEPS 6-9 — Apply Fix (POST /api/fix/attempt)                 │
│                                                                │
│  User-triggered fix actions:                                  │
│  • retry_sippy      → call listActiveCalls                   │
│  • warm_cdr_cache   → report cache status                    │
│  • check_db         → run test query                         │
│  • refresh_accounts → call listSippyAccounts                 │
│  • refresh_vendors  → call listSippyVendors                  │
│                                                                │
│  Each attempt is recorded in fix_history table:               │
│  { page, issueType, component, fixAction, outcome,            │
│    outcomeMessage, triggeredBy:'manual', performedBy }        │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  STEP 10 — Final Validation                                    │
│  • Step 10 panel shows: module, CDR size, cache age,          │
│    JS errors, auto-fix count, diagnosis time, duration        │
│  • TanStack Query cache invalidated for affected queries      │
│  • "Clear Frontend Cache" button available for edge cases     │
└───────────────────────────────────────────────────────────────┘
```

---

## Auto-Recovery Flow (Phase 4 — Background Job)

```
Every 2 minutes (setInterval inside registerRoutes):
        │
        ├─ Rule 1: sippy_retry
        │   • Check: autoRecovery.consecutiveSippyFailures >= 3
        │   • Check: time since lastAutoFixAt > 5 minutes
        │   • Action: call getSippyActiveCalls()
        │   • On success: reset consecutiveSippyFailures = 0
        │   • Log to fix_history: { triggeredBy:'auto', performedBy:'system' }
        │
        └─ Rule 2: cdr_stale_log
            • Check: CDR cache age > 15 minutes AND cache non-empty
            • Action: log alert only (no active fix attempt)
            • Log to fix_history: { triggeredBy:'auto', outcome:'auto' }
```

---

## CDR Data Flow

```
Sippy XML-RPC (getCDRs)
        │
        ▼
cdrCache Map<string, CdrRecord>    ← refreshed every 3 minutes
cdrCacheUpdatedAt Date             ← timestamp of last refresh
        │
        ├─── CDR Viewer (paginated display)
        ├─── Analytics (ASR/ACD/MOS aggregation)
        ├─── P&L Report (revenue × sell rate − cost × buy rate)
        ├─── FAS Detection (short call pattern analysis)
        ├─── IRSF Detection (high-value destination monitoring)
        ├─── Product Classification (CLD prefix grouping)
        ├─── BitsEye (country → carrier → destination drill-down)
        └─── Reports (summary exports)
```

---

## Authentication & Role Flow

```
Replit Auth (OIDC)
        │
        ▼
req.user = { id, email, name, ... }
        │
        ▼
storage.getUserRole(userId) → Role
        │
        ├─ admin      → full access to all routes + Fix Button
        ├─ management → most routes + Fix Button
        ├─ noc        → read + alerts, no Fix Button
        └─ viewer     → read-only, no Fix Button
```

---

## Key Files

| File | Purpose |
|------|---------|
| `server/routes.ts` | All API endpoints (~11,800+ lines) |
| `server/storage.ts` | Database access layer (Drizzle ORM) |
| `server/sippy.ts` | Sippy XML-RPC client (Python 2 compatible) |
| `server/index.ts` | Express server bootstrap |
| `shared/schema.ts` | Drizzle schema + Zod validators |
| `client/src/App.tsx` | Router config, layout shell |
| `client/src/components/fix-button.tsx` | Global Fix Button (Phase 1-4) |
| `client/src/components/layout-shell.tsx` | Sidebar + top bar (FixButton mounted here) |
| `client/src/lib/queryClient.ts` | TanStack Query client + default fetcher |

---

## Environment Variables

| Variable | Usage |
|----------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing key |
| `REPLIT_DOMAINS` | Allowed OIDC callback domains |

Sippy credentials are stored in the `settings` DB table (not environment variables).
