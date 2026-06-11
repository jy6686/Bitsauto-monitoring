---
name: Billing Check CDR matching
description: How CDR matching works for governed calls in Call Governance Billing Check tab
---

## The Vendor Blind Spot (Root Cause)

The Asterisk SIP trunk authenticates to Sippy as a **VENDOR** (`asterisk(in)`, iVendor unknown).
As a result, its CDRs **NEVER appear in `cdrs_customer.php`**, regardless of `caller=` filter.
Every customer portal CDR track (Track 0, 1, 2, 1b) sees zero rows for governed calls.

## Track 2b: P&L CDR Lookup (The Fix)

The admin P&L report (`profit_loss_report.php?period=call`) covers ALL call types including
vendor-side legs. Track 2b uses this.

**Implementation** (`server/sippy.ts`):
- `scrapePnlCallRows()` — accepts `startDate`, `endDate`, `offset` (for `n=` pagination), `_cookies` (session reuse)
- `scrapePnlCdrForCall()` — targeted per-call lookup: narrow date window (callStart-90s → callStart+12min), paginates until CLD suffix found or max 15 pages

**Performance**: P&L page returns 51 rows/page sorted most-recent-first. A 12-min window at 2.1 calls/sec = ~1512 calls ≈ 30 pages. But with **early exit on suffix match**, the actual governed call CDR is found in 1-3 pages because it's near the start of the date-filtered window.

**Conditions for Track 2b to fire** (`server/routes-call-governance.ts`):
- Call age >= 3 minutes (Sippy CDR write delay)
- `_pnlFetching = false` (concurrency guard)
- `destSuffix.length >= 8`

## CDR Field Semantics

- `gc.callee` = B-leg CallerID = **CLD** (destination, e.g. `2060923XXXXXXXXX`)
- `gc.caller` = A-leg CallerID = **CLI** (originating customer with routing prefix)
- Strip leading tech prefix `2060` from CLD; take last 10 digits as `destSuffix`
- P&L CLD format: `1923XXXXXXXXXX` (with leading `1`) — suffix-10 matching handles this

## Matching Algorithm (Tier 3)

```
tier3 = cdrs where:
  - cdrTs within ±15 min of startMs
  - callee.replace(/\D/g,'').endsWith(destSuffix10)
```

CLI tiebreaker: if cliSuffix (last 8 digits of caller) matches `c.caller`, prefer that row.

## Hot-reload Note

Changes to `server/routes-call-governance.ts` and `server/sippy.ts` require a **full server restart** (not just TSX HMR) to take effect in the running CDR lookup flow.

## Periodic Backfill

`runCdrLookup` fires: (1) 45s after B-leg cut, (2) every 30 min for unresolved calls (7-day window).
Track 2b runs on the 30-min backfill cycle since fresh calls are < 3 min old when first checked.
