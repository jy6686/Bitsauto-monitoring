---
name: Billing Check CDR matching
description: Field semantics, duration formula, matching algorithm, and global cache architecture for the Call Governance Billing Check tab.
---

## CDR field semantics — CORRECTED (critical — do NOT revert)

| Field | governed_calls | Sippy CDR |
|-------|---------------|-----------|
| Destination (CLD) | `gc.callee` = B-leg CallerID = actual Pakistan/Eritrea dest (e.g. `923719959675`) | `callee` = dest with optional leading "1" (e.g. `1923719959675`) |
| Source CLI | `gc.caller` = A-leg CallerID = customer ANI with routing prefix (e.g. `2060923419451539`) | `caller` = customer CLI |

**Previous bug**: `destDigits` was extracted from `gc.caller` instead of `gc.callee`, causing CDR CLD matching to use the routing prefix number rather than the actual destination. Fixed by swapping `gc.callee` ↔ `gc.caller` at the top of `runCdrLookup`.

**"2060 vs 20601" prefix**: The routing prefix in `gc.caller` is `2060` where Sippy/Asterisk should send `20601`. This is an upstream Asterisk CallerID presentation issue — NOT fixable in Node.js code. Now irrelevant to CDR matching since we use `gc.callee` (destination) not `gc.caller` for CLD matching.

## Duration formula

`CDR duration ≈ govSec + 8`

The 8-second delta is the B-leg (vendor) cleanup window fired after the governance BYE. Sippy generates the CDR when the vendor leg disconnects, not when the customer leg drops.

## Track architecture in runCdrLookup

- **Track 0**: global CDR cache (`(global as any).__bitsautoCdrCache`) — 2000+ CDRs, covers ~2h history
- **Track 1**: XML-RPC getAccountCDRs — blocked by circuit-breaker when auth fails
- **Track 2**: customer portal scrape (`startDate: '2 hours ago'`) — ~150 CDRs, conditional on cdrs.length===0
- **Track 3**: admin portal scrape with `destination=destDigits` filter — 100 targeted CDRs, always runs to merge

**Critical**: Portal date params must be **relative strings** (`'2 hours ago'`/`'now'`), NOT UTC ISO timestamps. The Sippy portal interprets dates in server local time (UTC+5); ISO strings shift the window by 5h.

**Track 3 admin portal filter** uses `destination=destDigits` to return ONLY CDRs for the specific destination — avoids generic 200-CDR dump, works reliably at 500+ calls/hour.

## Global cache (Track 0) design

`(global as any).__bitsautoCdrCache` is set in `routes.ts`:
1. At startup (line ~32873) — empty Map initially, fills as refreshCdrCache runs
2. After every `refreshCdrCache` completion (line ~6303) — keeps reference current

**Why global, not module-level**: TSX hot-reload re-executes `routes-call-governance.ts` when it changes, resetting any module-level `let` variable to its initial value (`null`). `global` persists across module reloads in the same Node.js process.

**Limitation**: Track 0 only fires for retries that run AFTER the cache warms (~60s after server start). The 45s retry may miss the cache if the server just restarted. The 3-min and 8-min retries will reliably use the warm cache.

## DB-first CDR storage architecture

Columns on `governed_calls`: `cdr_status` (ok/check/loss/no_cdr), `cdr_caller`, `cdr_callee`, `cdr_duration`, `cdr_cost`, `cdr_vendor_cost`, `cdr_vendor_name`, `cdr_checked_at`.

**Backfill endpoint**: `POST /api/call-governance/billing-backfill`
- Body `{ id: N }` → retry specific cut immediately
- Body `{}` → retry all null/no_cdr cuts

**Portal pool limitation**: ~150-200 most recent CDRs (~30-45min window). Calls older than ~45min cannot be backfilled via portal; will remain "No CDR".

## CDR matching algorithm (4-tier priority)

1. **Tier 1** — SIP Call-ID exact match (100% deterministic, requires vendorCallId)
2. **Tier 2** — Vendor IP + time window (±15min)
3. **Tier 3** — CLD 10-digit suffix (`gc.callee.slice(-10)`) + CLI tiebreaker; portal CLD format = `1923XXXXXXXXXX` (13 digits), last 10 = `923XXXXXXXXX`
4. **Tier 4** — CLD 9-digit suffix fallback

Status logic:
- `estimatedBilledSec = govSec + 8`
- `'ok'` if `CDR.duration <= estimatedBilledSec + 15`
- `'check'` if CDR exists but duration anomalous
- `'no_cdr'` if no CDR found

## TSX compilation caching gotcha

`routes.ts` is ~34,000 lines. TSX hot-reload for very large files may serve previously-compiled output. Diagnostic log changes only appear reliably after a full server restart (not just a file save / TSX watch restart).
