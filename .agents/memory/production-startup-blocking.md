---
name: Production startup blocking awaits
description: Top-level awaits in index.ts and routes.ts can block the startup gate, causing indefinite 503s in production under DB connection pressure.
---

## The rule
Any `await` placed in `main()` in `index.ts` (or directly in `registerRoutes()`) before the safety timer is set up can cause the server to serve 503 forever if the DB times out. The safety timer MUST be registered before any `await` that touches the DB.

**Why:** The startup gate (`_serverReady`) only flips via either the safety timer OR the `finally` block after `registerRoutes()`. If a DB-hitting `await` runs before the safety timer is registered and hangs, the timer never fires and `_serverReady` stays `false` indefinitely.

**How to apply:**
1. The safety timer in `index.ts` must always be set up BEFORE any `await` (especially `runSafeMigrations()`).
2. Wrap every blocking `await` in `main()` in a `Promise.race` with a timeout:

```typescript
// BAD — safety timer set after migration await:
await runSafeMigrations();           // hangs 16 minutes on DB timeout
const _safetyTimer = setTimeout(…);  // never reached

// GOOD — timer first, then race-guarded await:
const _safetyTimer = setTimeout(…, 90_000);  // registered before any await
await Promise.race([
  runSafeMigrations().catch(e => console.warn('[startup]', e.message)),
  new Promise<void>(r => setTimeout(r, 45_000)),
]);
```

3. Never add a bare top-level `await` in `registerRoutes()` without wrapping with a timeout (same pattern as above).

## Incident 1 (routes.ts blocking awaits)
Lines ~34184-34185 in routes.ts had bare `await ensureCallGovernanceMigrations()` and `await ensureDestinationsSeed()`. DB pool exhaustion made them hang ~45s each. Routes after those lines were never registered → 404s on product-registry, call-governance, destination-catalog.

**Fix:** Wrapped with `Promise.race` + 10s timeout.

## Incident 2 (index.ts safety timer ordering)
`runSafeMigrations()` at line 236 in `index.ts` was awaited before the safety timer was registered (line 259). DB connection timeout in production caused `runSafeMigrations()` to hang ~16 minutes. Safety timer was never set. `_serverReady` stayed `false`. All API calls returned 503 for the entire session.

**Diagnostic signature:**
- Boot logs show `[BOOT +9ms] 5 runSafeMigrations() starting` but never `6 runSafeMigrations() done`
- `Connection terminated due to connection timeout` at ~t+15s
- 503 "Server is starting up" responses persist 16+ minutes after boot

**Fix (2026-07-20):** Moved safety timer registration to BEFORE `runSafeMigrations()`. Wrapped `runSafeMigrations()` in `Promise.race` with 45s timeout. Safety timer extended to 90s (was 60s) to account for the 45s migration window plus route registration.
