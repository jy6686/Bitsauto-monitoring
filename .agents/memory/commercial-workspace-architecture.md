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

| Section       | Endpoint                            | Status |
|---------------|-------------------------------------|--------|
| Dashboard     | context (portfolio + kpis)          | ✅     |
| Clients       | /api/commercial/clients (paginated) | ✅     |
| Live Calls    | /api/commercial/live-calls          | ✅     |
| Live Traffic  | /api/commercial/live-traffic        | ✅     |
| Balance       | /api/sippy/balance-monitor (scoped) | ✅     |
| Products      | /api/rate-manager/jobs              | ✅     |
| Reports       | read-only links to existing pages   | ✅     |

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
