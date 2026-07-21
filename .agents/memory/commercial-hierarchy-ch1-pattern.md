---
name: Commercial Hierarchy CH-1 Pattern
description: Canonical hierarchy-scoped API + UI pattern established by Sprint CH-1 (Clients). All Commercial Portal module integrations must follow this.
---

# Commercial Hierarchy CH-1 Canonical Pattern

## The Rule
Every Commercial Portal page that shows client/account data MUST go through the hierarchy scope service. UI pages NEVER call `getVisibleAccountIds()` directly.

```
Authenticated user
  → GET /api/commercial/<module>
  → routes-commercial.ts resolves scope:
      admin/super_admin → getAllAccountIds()
      everyone else     → getVisibleAccountIds(userId)
  → scopeError? return { clients:[], scopeError: 'no_kam_link'|'no_accounts' }
  → accountIds = scope.accountIds
  → SQL WHERE account_id IN (...accountIds) + optional search + pagination
  → return { data[], total, scopeError: null, kamIds, orgRole }
```

## Why
Hierarchy enforcement must be server-side. Any client-side filtering would let users construct arbitrary requests and see out-of-scope accounts.

## How to apply
For each new CH-N sprint module:
1. Add a new `GET /api/commercial/<module>` route to `server/routes-commercial.ts`
2. Copy the scope resolution block from `/api/commercial/clients`
3. Write a scoped SQL query using `placeholders` + `baseParams` pattern (see clients route)
4. Create `client/src/pages/commercial-<module>.tsx` with `ScopeIndicator` component
5. Register route in `App.tsx` at `/commercial-<module>`
6. Update `commercial.config.ts` nav entry path

## Live Stats Overlay Pattern
Where live data is needed (calls, revenue, health), the UI fetches TWO endpoints:
- `/api/commercial/<module>` → hierarchy-scoped identity list (paginated)
- `/api/kam/portfolio` → live stats per accountId (separate stale time)

Merge with a `useMemo` Map by `accountId`. This avoids re-querying Sippy per page render.

## resolveCommercialScope(req) — CH-2 addition

All endpoints now call this single helper instead of repeating the admin-check + scope-call boilerplate:

```ts
const scope = await resolveCommercialScope(req);
// scope.accountIds, scope.kamIds, scope.orgRole, scope.scopeError, scope.isAdmin
if (scope.scopeError) return res.json({ data: [], scopeError: scope.scopeError, ... });
const inClause = buildInClause(scope.accountIds); // returns { placeholders, params } or null
```

## /api/commercial/scope endpoint (CH-2 addition)

Returns full `{ accountIds, kamIds, orgRole, isAdmin, scopeError }` without pagination.
Used by frontend modules that need the accountIds Set for client-side intersection
(e.g. CH-2: filters live calls by scoped accountIds).

This is NOT hierarchy in the UI — the UI receives a server-resolved list and uses it
only as a lookup key. Hierarchy stays server-side.

## CH-2 Live Calls pattern
Frontend: fetch `/api/commercial/scope` + `/api/sippy/live-calls`, build a Set from
accountIds, filter allCalls where `call.accountId ∈ scopeSet`. Auto-refreshes every 15s.

## Files
- `server/routes-commercial.ts` — all Commercial API routes; resolveCommercialScope() here
- `server/services/commercial/hierarchy-scope.ts` — `getVisibleAccountIds()` + `getAllAccountIds()`
- `client/src/pages/commercial-clients.tsx` — CH-1 reference implementation
- `client/src/pages/commercial-live-calls.tsx` — CH-2 reference implementation
- `client/src/portals/configs/commercial.config.ts` — nav config
- `.local/governance/COMMERCIAL-DASHBOARD-GOVERNANCE.md` — governance rules
