# Sippy Connection Lifecycle — Audit Baseline

**Status: AUDIT COMPLETE. NO CODE CHANGED.**
Audited 2026-09-16, read-only, against `server/sippy.ts` at commit `d116ce4a`.

This document is the baseline a fix is measured against. It is deliberately written before
any change, so that "we fixed it" can be checked against a record made when nobody had a fix
to defend.

---

## Why this audit exists

Sippy support reported that **34.63.207.201 was using all available connections**, and
suggested blocking it if unfamiliar.

**That address has not been blocked and must not be, on this evidence.** It is a Google Cloud
customer VM in us-central1 (`201.207.63.34.bc.googleusercontent.com`). Our own deployment
fronts on Google Cloud as well (`34.117.33.233`, same reverse-DNS pattern). That makes it
*consistent with* our production egress and therefore a plausible description of BitsAuto
itself — but the allocation is shared by every Google Cloud tenant, so ownership records
cannot distinguish our deployment from anyone else's. No endpoint reports this application's
own outbound address, so the question is open.

**The two claims are separate and must stay separate:**

| Claim | State |
|---|---|
| The client *can* accumulate sessions and generate unbounded connection pressure | **VERIFIED** — from the code, below |
| The client *did* cause the reported exhaustion | **NOT PROVEN** — needs Sippy's connection records, or our egress address |

Every finding below stands on its own regardless of how the attribution resolves. They are
defects whether or not they caused that incident.

---

## Control status

| Control | Status | Evidence |
|---|---|---|
| Session release | **FAIL** | No logout or close path exists anywhere in the client |
| Acquisition single-flight | **FAIL** | No in-flight map, promise dedupe, mutex or semaphore |
| Positive cache persistence | **FAIL** | Cache entry deleted at the top of acquisition (`sippy.ts:259`) |
| Cross-caller serialisation | **FAIL** | Loops are sequential internally; nothing coordinates across callers |
| Socket bound | **FAIL** | Shared agent sets neither `maxSockets` nor `keepAlive` (`sippy.ts:445`) |
| Retry amplification | **PRESENT** | ~80 requests worst case for one acquisition |
| Concurrent acquisition | **PRESENT** | 7 callers of `getAdminPortalSession`, 5 of `findRatesCapableSession`, plus independent timers |

---

## The findings, with mechanism

### 1. Nothing is ever released

There is no call to the portal's logout endpoint anywhere in `server/sippy.ts`. The only
occurrences of "logout" are substring tests used to *recognise* a logged-in page.
`clearSippySession()` (`sippy.ts:437`) sets a local variable to null; it tells Sippy nothing.

Every successful `portalLogin` therefore leaves a server-side session behind. This includes
logins that succeed and are then **deliberately discarded** — `findRatesCapableSession`
(`sippy.ts:330`) logs in, checks whether that session can reach a rates page, and moves on to
the next credential pair if it cannot. Each rejected candidate is a live abandoned session.

This is the finding that turns pressure into accumulation. Without release, load does not
have to be concurrent to exhaust a pool; it only has to be repeated.

### 2. Nothing deduplicates a concurrent acquisition

`adminPortalCacheByUrl` (`sippy.ts:149`) is a plain `Map`, read and then populated. There is
no in-flight promise, lock or queue anywhere in the module. So N callers arriving together
all miss the cache, all run the full acquisition, and all create their own sessions. The
cache converts a steady-state cost into a periodic thundering herd rather than preventing it.

With `PORTAL_SESSION_TTL_MS` at five minutes (`sippy.ts:146`), that herd re-forms every five
minutes even when caching works as intended.

### 3. The cache disables itself under a real configuration

`getAdminPortalSession` (`sippy.ts:245`) begins by deleting its own positive cache entry
whenever dedicated rate-admin credentials are configured (`sippy.ts:259`). The comment
explains the intent: without it, a cached `ssp-root` session is returned and the rate-admin
pair is never tried.

The consequence is that in that configuration **the full acquisition runs on every single
call**, not once per TTL. This is the largest amplifier of the other findings, and it is
invisible in any environment where those credentials are unset.

### 4. Retries multiply, and the multiplication is nested

One acquisition builds up to ~8 credential pairs and tries each against 3 outer account types
(`admin`, `reseller`, `customer`). `portalLogin(..., 'admin')` (`sippy.ts:774`) then loops a
further 3 inner `acct_type` values (`account`, `customer`, `vendor`), each costing a POST plus
a verification GET on success.

Worst case for a single failing acquisition is on the order of **80 HTTP requests**. The
XML-RPC side multiplies separately through `withSippyCreds` / `sippyXmlCredsPairs` in
`server/routes.ts`.

### 5. Sockets are unbounded and never reused

```ts
const lenientHttpsAgent = new https.Agent({ rejectUnauthorized: false });   // sippy.ts:445
```

No `keepAlive`, so every request is a fresh TCP connection and TLS handshake. No `maxSockets`,
so Node's default is unbounded: there is no ceiling on how many of those exist at once. The
80-request figure above is therefore not serialised by anything underneath it.

### 6. Several independent timers reach these paths

`reconcileActiveCalls` (60 s), `runPeriodicCdrBackfill` (30 min), live telemetry polling and
others run on their own schedules with no shared coordination. Combined with finding 2, two
timers firing together are two full acquisitions.

---

## Fix order, and one trap

1. **Release sessions** — remove the accumulation.
2. **Single-flight acquisition** — one acquisition per origin at a time.
3. **Stop deleting the positive cache** — let the intended reuse actually happen.
4. **Bound sockets and concurrency** — a hard ceiling under everything else.

**Do not start by adding a logout call.** While multiple callers can independently acquire
sessions, a release path introduces a release/re-acquire race: one caller logs out a session
another caller is still using, which converts a capacity problem into an intermittent
authentication failure that is far harder to diagnose. **Session ownership has to be explicit
before anything is released**, so in practice control 2 lands with or before control 1 even
though control 1 is the more visible defect.

---

## What "fixed" has to demonstrate

The current incident is **not** the test. A quiet switch proves nothing, and attribution is
unresolved anyway. The fix must be demonstrated directly:

```
concurrent callers
      ↓
ONE acquisition
      ↓
one reusable session
      ↓
bounded in-flight requests
      ↓
explicit release on invalidation and shutdown
```

Each control needs a test that fails when that control is removed — a test that passes both
with and without the fix is not evidence of the fix. The existing production rate-write
safety boundaries must be preserved unchanged throughout: this workstream touches connection
and session lifecycle only, and writes nothing to Sippy.

---

## Scope boundary

This work is **separate from** the identity/product reconciliation on `d116ce4a` and gets its
own commits and verification cycle. Also untouched and still unauthorised: the three identity
repairs, the Special Bravo push, and the billing-plan name-reuse hardening.
