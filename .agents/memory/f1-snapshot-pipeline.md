---
name: F1 Financial Snapshot Pipeline
description: Architecture and key facts about the financial_snapshot materialization pipeline established in Sprint F1.
---

## Rule
`financial_snapshot` is the single source of truth for all Finance analytical modules.
No Finance UI or route may read `daily_minutes_reports` or `margin_analytics_daily` directly after F1.

## Advisory Lock
Key: `42001` (`pg_try_advisory_lock`) — non-blocking, skip not queue.
Defined in `server/services/sippy/sippy-snapshot.service.ts`.

## Service
`server/services/sippy/sippy-snapshot.service.ts` — exported via `server/services/sippy/index.ts`.
Main entry point: `runMaterialization(triggeredBy, targetDates?)`.
Query helpers: `querySnapshotClients`, `querySnapshotVendors`, `querySnapshotAggregate`, `querySnapshotTrend`, `querySnapshotSummary`.

## Scheduler
Registered at the bottom of `server/routes.ts` (before `return httpServer`).
2-minute initial delay, then `setInterval` every 30 minutes.
`schedulerBusy` flag prevents re-entrant calls within the same process (advisory lock handles cross-process).

## Migrated routes (all now read financial_snapshot)
- `/api/margin/clients` — was `getTopClients` → `margin_analytics_daily`
- `/api/margin/vendors` — was `getTopVendors` → `margin_analytics_daily`
- `/api/margin/aggregate` — was `storage.getMarginAnalytics` → `margin_analytics_daily`
- `/api/margin/trend` — was `getMarginTrend` → `margin_analytics_daily`
- Finance Cockpit panel — was `/api/dmr` → `/api/finance/snapshot/summary`
- Margin Intelligence materialize button — was `/api/margin/materialize` + DMR preflight → `/api/finance/health/materialize-now`

## New endpoints
- `GET /api/finance/snapshot/summary` — Finance Cockpit canonical source
- `GET /api/finance/snapshot` — paginated full snapshot
- `GET /api/finance/snapshot/runs` — materialization run history

## Retained (legacy, not deprecated)
- `POST /api/margin/materialize` — single-date manual backfill to `margin_analytics_daily`, kept for ops use
- `margin_analytics_daily` table — historical data, receives no new Finance UI writes after F1

## **Why**
Established in Sprint F1 to create a deterministic, observable Finance data pipeline
before F3 (Reconciliation & AI Evidence) and F2 (Billing Engine) are built on top.
All downstream sprints depend on this invariant.
