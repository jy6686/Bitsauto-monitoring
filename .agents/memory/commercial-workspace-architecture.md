---
name: Commercial Workspace Architecture
description: Frozen conventions for all Commercial Portal backend endpoints and frontend sections — established through CH-1 to CH-3.
---

# Commercial Workspace Architecture — FROZEN

Confirmed stable after CH-1 → CH-2 → CH-2.5 → CH-3 progression.

## Backend convention (every commercial endpoint)

```
resolveCommercialScope(req)
        ↓
Commercial Service / sharedLiveCallsCache
        ↓
DTO (scoped to accountIds)
        ↓
Response (includes scopeError, orgRole, lastUpdated)
```

- All routes live in `server/routes-commercial.ts`
- Import `sharedLiveCallsCache` from `server/live-calls-cache.ts` for real-time data
- Import `resolveCommercialScope` from scope helper in same file
- Never resolve scope inside `server/routes.ts` for commercial concerns

## Frontend convention (every commercial section)

```
CommercialWorkspaceProvider   (client/src/contexts/commercial-workspace-context.tsx)
        ↓
useCommercialWorkspace()
        ↓
Section Component
```

- Provider loads: scope, portfolio, kpis, liveData — shared across all sections
- `portfolioMap: Map<accountId, PortfolioAccount>` for O(1) per-account lookups
- **No section resolves scope independently**
- **No section duplicates hierarchy logic**
- Section-specific data (e.g. balance, rate jobs, live-traffic detail) fetched inside the section, never in the provider

## Completed sections (all in `client/src/pages/commercial-workspace.tsx`)

| Section       | Endpoint                              | Status | Sprint |
|---------------|---------------------------------------|--------|--------|
| Dashboard     | context (portfolio + kpis)            | ✅     | Fdn    |
| Clients       | /api/commercial/clients (paginated)   | ✅     | Fdn    |
| Live Calls    | /api/commercial/live-calls            | ✅     | CH-2.5 |
| Live Traffic  | /api/commercial/live-traffic          | ✅     | CH-3   |
| Balance       | /api/commercial/balance (server-side) | ✅     | A      |
| Products      | 3-tab: Rate Analysis/Push History/Send Rate | ✅ | A   |
| Reports       | 3-tab: Revenue/Traffic/P&L (inline)   | ✅     | A      |

## Phase 1 — Execution Layer infrastructure (v2)

Single canonical event store: `workflow_events` table.
Engine: `server/services/commercial/execution-engine.ts`

Rules (permanent, enforced at engine level):
- NO route writes workflow_events directly — ALL writes go through executeWorkflowAction()
- Table created via `initWorkflowEventsTable()` (idempotent SQL) — never db:push
- All D1–D5 workstreams are projections (reads) + single write path

Key functions:
- `executeWorkflowAction(opts)` → inserts and returns the new event row
- `queryWorkflowEvents(q)` → flexible read with 7 filter params
- `getWorkflowTimeline(correlationId)` → full lifecycle grouped by correlation
- `getSubjectHistory(type, id)` → all events on one subject

API surface (all in routes-commercial.ts):
- GET  /api/commercial/events              — filtered event log
- GET  /api/commercial/events/audit        — 7-day workspace audit
- GET  /api/commercial/events/timeline/:id — lifecycle by correlationId
- GET  /api/commercial/events/subject      — subject history
- POST /api/commercial/execute             — single write entry point

Event taxonomy (dot-notation, extend in execution-engine.ts):
  rate_job.{created|approved|rejected|activated|verification_passed|customer_notified}
  followup.{created|started|completed|dismissed|assigned}
  quality.{alert_acknowledged|alert_escalated}
  balance.warning_acknowledged
  workflow.note_added

subject_type values: rate_job | account | quality_alert | balance_alert
correlation_id format: "{subject_type}_{subject_id}" by convention

## Sprint C — Action Center (added after Intelligence)

`ActionsSection`: prioritised work queue for KAM morning triage.
Signal sources — four backend DB queries + two frontend context derivations:
1. Traffic drops: `concurrent_snapshots` last 3h vs prior 3h (by entityName, scope-filtered via nameCache)
2. Quality alerts: `mos_hourly` avgMos < 3.5 with 4h trend comparison
3. Revenue drops: `financial_snapshot` today vs 7d average (scope-filtered by accountId[])
4. Rate job alerts: `rate_notification_jobs` WHERE status IN (awaiting_approval, failed, rejected, pending_rates)
5. Zero-traffic accounts: portfolio context (calls24h === 0 AND state !== healthy)
6. At-risk / degraded accounts: portfolio context state field

Priority encoding: critical/high/medium/low — sorted before response.
Backend does NOT call Sippy (avoids expensive live call per refresh).
Balance alerts computed client-side from balance section data.
Sidebar badge shows critical+high count from shared TanStack Query cache.

`ActionsResp` type + `ActionItem` type + `PRIORITY_ORDER/STYLE/TYPE_ICON` maps defined in commercial-workspace.tsx.

## Sprint B — Intelligence section (added after Dashboard)

`IntelligenceSection`: 2×2 panel grid visible all at once (no tabs).
- **Traffic**: hourly sparkline (SVG, no lib) + top-5 by calls24h from context
- **Quality**: MOS/Jitter/PktLoss from `/api/commercial/intelligence` endpoint; 4h trend badge
- **Risk**: flagged accounts derived from portfolio context (zero_traffic/at_risk/degraded/declining)
- **Commercial**: 7d revenue sparkline + top-4 + growing/attention columns from context

Backend: `GET /api/commercial/intelligence` — three DB queries in one endpoint:
  hourlyTrend (concurrent_snapshots, dim=client), qualityMetrics (mos_hourly + rtp_quality_history), revenueTrend (financial_snapshot 7d, scope-filtered)

Risk + Commercial computed client-side from shared portfolio context — no extra API calls.

`Sparkline` SVG helper, `mosColor`, `ScopeAlertInline` are shared helpers inside commercial-workspace.tsx.

## Sprint A — canonical pattern confirmed

All 8 sections now follow the same pattern:
- **Backend**: `resolveCommercialScope()` → service/Sippy → scoped DTO
- **Frontend**: `useCommercialWorkspace()` → section-level query for specific data

No section uses client-side scope filtering. No section calls `/api/sippy/*` directly for commercial concerns.

## Balance endpoint specifics

`GET /api/commercial/balance` in `routes-commercial.ts`:
- Imports: `storage` from `./storage`; `listSippyAccounts` from `./sippy`
- Names enriched from `(global).__bitsautoAccountCache` (set by routes.ts poller)
- `balanceFlag: 'low'` when `balance < creditLimit * 0.1`
- Returns accounts sorted low→high so at-risk appear first

## Products section tabs

- **Rate Analysis**: `/api/rate-manager/kpi` + `/api/rate-manager/products`
- **Push History**: `/api/rate-manager/jobs` with search filter + progress bars
- **Send Rate**: portfolio coverage snapshot from context + links to Rate Manager

## Scope resolution chain

```
Authentication → Authorization → Portal Assignment
        ↓
/commercial → CommercialWorkspacePage
        ↓
CommercialWorkspaceProvider → resolveCommercialScope()
        ↓
Workspace Context (scope, portfolio, liveData, kpis)
        ↓
All 7 section consumers
```

**Why:** Each sprint independently resolving scope produced duplicate DB queries, inconsistent visibility, and prop-drilling. Centralising in the provider ensures every section sees the exact same scope without re-querying.

**How to apply:** Any new Commercial section must use `useCommercialWorkspace()`. Any new backend endpoint in `routes-commercial.ts` must call `resolveCommercialScope()` first.

## NOC vs Commercial separation

- NOC → network-wide operational visibility (global, not hierarchy-scoped)
- Commercial → portfolio-scoped operational visibility
- Commercial Live Traffic (`/api/commercial/live-traffic`) is separate from NOC BitsEye2 (`/api/bitseye/*`) by design
