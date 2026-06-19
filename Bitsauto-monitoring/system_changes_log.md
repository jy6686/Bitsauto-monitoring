# System Changes Log
Bitsauto Monitoring Platform — Sippy Softswitch (Python 2)

---

## 2026-04-18 — Global Fix Button System: Phases 3, 4 & Full Cross-Platform Rollout

### Summary
Extended the Global Fix Button from a basic 2-phase diagnostic tool into a fully intelligent, module-aware, self-healing system covering every page and data source in the platform.

---

### Phase 1+2 (Previously Completed)
- Floating Fix button added to all pages (bottom-right, fixed position)
- 10-step diagnostic modal with Sippy API checks, CDR cache health, DB connectivity
- Backend: `GET /api/fix/diagnose` + `POST /api/fix/attempt`
- Fix actions: retry_sippy, warm_cdr_cache, check_db, refresh_accounts, refresh_vendors

---

### Phase 3 — Fix History (this session)

**New DB Table**: `fix_history`
- Columns: id, page, issueType, component, fixAction, outcome, outcomeMessage, triggeredBy, performedBy, createdAt
- Records every fix attempt (manual and auto) with full context

**Backend Changes**:
- `POST /api/fix/attempt` now records every attempt to `fix_history` table including outcome, performer, and page context
- `GET /api/fix/diagnose` now enriches each issue with `pastFix` — the most recent successful fix for that issue type (via `storage.findSimilarFix(issueType, component)`)
- New `GET /api/fix/history` endpoint returns last 50 fix events

**Frontend Changes**:
- New "Fix History" tab in the Fix modal showing all 50 events with outcome icons
- "Previously resolved" violet badge shown on each issue when a past successful fix exists
- History shows: issue type, fix action, outcome, performer, timestamp, triggeredBy (manual/auto)

---

### Phase 4 — Auto Recovery (this session)

**Background Job** (every 2 minutes, inside `registerRoutes()` closure):
- Rule 1 `sippy_retry`: Auto-retries Sippy API after 3 consecutive failures, with 5-minute cooldown. Logs to fix_history with `triggeredBy=auto`
- Rule 2 `cdr_stale_log`: Logs a warning when CDR cache has not refreshed in 15+ minutes

**State Object** `autoRecovery`:
- Tracks: `consecutiveSippyFailures`, `lastAutoFixAt`, `stats.totalAutoFixes`, `stats.lastEvent`
- Shared between diagnose endpoint, attempt endpoint, and background job
- `GET /api/fix/diagnose` resets `consecutiveSippyFailures` counter on success

**New Endpoint**: `GET /api/fix/auto-rules`
- Returns: enabled rules, current consecutive failure count, total auto fixes, last event

**Frontend Changes**:
- New "Auto Rules" tab showing live rule state (enabled/disabled, trigger codes, consecutive failures warning)
- Planned rules roadmap shown (ASR drop alert, balance threshold, etc.)
- Auto-recovery stats shown in Diagnose tab header and Step 10 summary

---

### Module-Specific Diagnostics (this session)

**Backend Enhancement** (`GET /api/fix/diagnose`):
- Now accepts `?module=<page name>` query parameter
- Runs module-specific additional checks on top of the 6 core checks
- Accepts `?errors=<JSON>` for frontend console error injection

**Modules Covered**:
| Module | Additional Check | Condition |
|--------|-----------------|-----------|
| Live Calls | Active Call Count | Warns if 0 calls (off-peak notice) |
| CDR Viewer | CDR Data Volume | Warns if <10 CDRs |
| Analytics | Data Volume + Freshness | Warns if <100 CDRs or >5m old |
| Fraud Detection | FAS Engine Events | Checks event DB, info if empty |
| P&L Report | CDR Source + Rate Cards | Critical if CDR empty; warn if no rate cards |
| Billing | Client Profiles | Warns if no profiles loaded |
| Rate Cards | Rate Card Count | Warns if no cards configured |
| LCR Analyser | Vendor Connection Cache | Warns if connectionVendorCache empty |
| Settings | API Session Validation | Checks Sippy session mode |
| Server Monitoring | Live Call Visibility | Confirms API responsiveness |
| Multi-Switch View | Switch API Connectivity | Confirms primary switch active |
| BitsEye | CDR Source | Warns if cache empty |
| Product Classification | CDR Volume | Warns if <50 CDRs |
| Click-to-Call | Sippy API Reachability | Critical if API down |
| Reports | CDR Source | Warns if CDR empty |
| Team Management | KAM Database Count | Info if no KAMs configured |
| Dashboard | Overall Readiness | Composite of API + DB + CDR |

---

### Frontend Error Capture (this session)

**Step 2 — Collect Logs**:
- `FixButton` now installs `window.onerror` and `window.unhandledrejection` listeners on mount
- Captures up to 20 recent JS errors + unhandled Promise rejections in a ref
- Errors are sent to backend via `?errors=` param when a diagnosis is run
- If errors exist, a `UI_ERROR` issue is added to the diagnose response
- Frontend "Step 2 — Browser Console Errors" panel shown in the diagnose tab when errors captured

---

### API Changes

| Endpoint | Method | Change |
|----------|--------|--------|
| `/api/fix/diagnose` | GET | Added `?module=`, `?errors=` params; module-specific checks; `pastFix` per issue; `frontendErrorsReceived` in response |
| `/api/fix/attempt` | POST | Now records every attempt to `fix_history`; added `issueType`, `component`, `page` to request body |
| `/api/fix/history` | GET | New — returns last N fix history rows |
| `/api/fix/auto-rules` | GET | New — returns auto-recovery rule state |

All endpoints require `admin` or `management` role.

---

## Earlier Changes (Previous Sessions)

### WhatsApp Alert System
- `whatsapp_alert_log` table
- `POST /api/alerts/whatsapp` — send fix/issue alerts via WhatsApp Business API
- `GET /api/alerts/whatsapp-logs` — last 100 alert logs

### P&L Report
- Revenue vs cost analysis using CDR data × rate card prices
- Margin calculation per vendor/destination
- Chart: daily P&L trend, top profitable routes

### Click-to-Call
- Sippy XML-RPC `makeCall` integration
- POST `/api/click-to-call` with CLI + CLD + accountId

### Product Classification
- CLD prefix-based product grouping (First Class / Business / Bravo / Charlie)
- Per-class KPI cards and comparison table

### BitsEye Drill-Down
- Hierarchical CDR breakdown: Country → Carrier → Destination
- Click-through from chart to raw CDR list

### Multi-Switch View
- Secondary switch configuration
- Combined active calls view across switches

### LCR Analyser
- Enter a destination number, see all vendor routes ranked by cost
- Margin calculation per route using sell vs buy rates

### Call Flow Simulator
- 7-step call trace without making a real call
- Account resolution, balance check, tariff lookup, routing analysis

### FAS / IRSF Fraud Detection
- Short call detection (FAS)
- High-value destination monitoring (IRSF)
- Real-time alert on anomalous call patterns
