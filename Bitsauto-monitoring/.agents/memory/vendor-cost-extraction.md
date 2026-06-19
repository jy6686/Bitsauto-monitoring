---
name: Vendor Cost Extraction — Sippy P&L
description: P3.1 done; P3.2 root causes diagnosed + two fixes applied; pnlCache is the authoritative vendor cost source
---

# Vendor Cost — Architecture & Status

## The Rule
Never implement estimated/calculated vendor cost (Rate × Duration proxy). Sippy already knows the actual cost.

**Why:** Sippy's `profit_loss_report.php` CSV contains Revenue, Cost, and Margin per call — calculated by Sippy itself.

## P3.1 — DONE
`scrapePnlCallRows` now emits `vendorCost = Cost (USD)` column. The DB column `cdr_vendor_cost` in `governed_calls` is written for newly-matched calls.

## P3.2 — Root Causes Diagnosed & Two Fixes Applied (Jun 2026)

### Three stacked failure modes (pre-fix baseline: 2/226 = 0.9% vendor cost coverage)

**Failure 1 — Track 1 XML-RPC CLD format mismatch (primary match blocker)**
- Governed callee `2060923xxxxxxxx` (16 digits) strips to `923xxxxxxxx` (12 digits)
- Sippy CDRs store `1923xxxxxxxx` (E.164 with leading `1`) — 13 digits
- XML-RPC exact CLD filter = always 0 results for BC calls (prefix `2`)
- **Fix applied (Track 1c):** after Track 1 returns 0, retry with `1`+destDigits and also with SIPPY_PROV credentials

**Failure 2 — Track 2b global lock (vendor cost blocker)**
- `_pnlFetching = true` global boolean: only 1 per-call P&L scrape at a time
- At 500 calls/hr, virtually every call hit the locked guard and skipped Track 2b
- Only 2 calls in 7 days caught the lock unlocked → 0.9% vendor cost coverage
- **Fix applied (pnlCache fallback):** after CDR match, if `cdrVendorCost` is null, search `global.__bitsautoPnlCache` by CLD 10-digit suffix + ±15 min window. Uses `sippy.parseSippyDate()`. `cdrVendorCost`/`cdrVendorName` changed from `const` to `let`.

**Failure 3 — pnlCache not exposed to call-governance**
- `pnlCache` was a local closure in routes.ts
- **Fix applied:** exposed as `global.__bitsautoPnlCache` after registration AND after each 10-min refresh. `_getGlobalPnlCache()` added to routes-call-governance.ts.

### Open: Historical backfill
Calls older than 24h that are `no_cdr` or missing vendor cost cannot be enriched automatically. Scope from the "Timed Out" count in `/api/recon-lab/coverage` before building a batch job.

## Coverage Diagnostic (GET /api/recon-lab/coverage)
Funnel for 24h/48h/7d: completed → checked → matched → enriched → timedOut → recoverable.
Live numbers before fixes: 7d = 2,405 completed / 226 matched (9.4%) / 2 enriched (0.9%).

## pnlCache Architecture (routes.ts)
- Key: `${cli}:${cld}:${startTime}` — dedup by call identity
- PnlCsvRow fields: `cli`, `cld`, `startTime`, `revenue` (= customer charge), `cost` (= vendor cost), `connection` (= vendor name), `durationSec`, `buyDurationSec`, `margin`, etc.
- Refreshed every 10 min, 24h window, evicts entries >48h old
- Global ref: `global.__bitsautoPnlCache` — keep current after each refresh

## How to Apply in Code
- Billing Check tab: match by CLI+CLD+Setup Time (±seconds) against P&L, not cdr_vendor_cost
- Deal Workspace: actual Margin from P&L, not estimated from tariff
- NEVER add any "estimate from tariff × duration" code path — reject it if proposed in any future session
- CLD matching in XML-RPC: always try BOTH `destDigits` AND `1`+`destDigits` — Sippy stores E.164
