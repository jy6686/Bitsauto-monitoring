---
name: Production startup blocking awaits
description: Top-level awaits in routes.ts caused all late routes to be missing in production (404s for product-registry, call-governance, destination-catalog).
---

## The rule
Any `await` placed directly in the `registerRoutes()` function body (not inside a route handler or a `setTimeout`) blocks ALL route registrations after it. Under DB connection pool pressure, these awaits can hang for 45+ seconds each.

**Why:** `routes.ts` is ~36,500 lines. Route definitions are synchronous and fast. A single hanging `await` stops progress at that line — every `app.get/post` after it never executes. The 60-second safety timer in `index.ts` opens the HTTP gate but does NOT kill `registerRoutes()`. Result: server accepts requests but returns `Cannot GET` for all routes past the blocking point.

**How to apply:** Never add a bare top-level `await` in the `registerRoutes()` body unless it is wrapped with a timeout:

```typescript
// BAD — hangs forever if DB pool is exhausted:
await ensureCallGovernanceMigrations();

// GOOD — proceeds after 10s regardless:
await Promise.race([
  ensureCallGovernanceMigrations().catch(e => console.warn('[startup] migration failed:', e.message)),
  new Promise<void>(r => setTimeout(r, 10_000)),
]);
```

## What happened
Lines ~34184-34185 in routes.ts:
```
await ensureCallGovernanceMigrations(); // blocking — no timeout
await ensureDestinationsSeed();         // blocking — no timeout
```
In production, the DB connection pool was exhausted by parallel startup tasks (Sippy auto-connect, governance seed, guard check). Both awaits timed out after ~45s each (~90s total). All routes after line 34184 — including `/api/product-registry/destinations`, all `/api/call-governance/*`, and `/api/destination-catalog/*` — were never registered. They returned Express `Cannot GET` 404s.

## Diagnostic signature
- Production logs show `registerRoutes() starting` but never `registerRoutes() done`
- `[seed] Failed to seed governance data: Error: timeout exceeded when trying to connect` at ~t+46s
- Routes before line 34184 (e.g. `/api/bitseye/kam-live`) return 200; routes after return 404
- `60 s safety timeout — opening gate before routes finish loading` fires

## Fix applied
Wrapped both awaits with `Promise.race` + 10-second timeout. Added `[startup] CHECKPOINT` log lines before each large route group to confirm they register. After fix: `registerRoutes() done` in ~1.4s.
