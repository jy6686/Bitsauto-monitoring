---
name: P&L CSV cache architecture
description: How the per-call P&L CSV is downloaded from Sippy and cached in-process.
---

# P&L CSV Cache

## The function
`downloadPnlCsv()` in `server/sippy.ts` (after `scrapeProfitLossReport`).

Tries these POST param combos in order against `profit_loss_report.php`:
1. `output=csv period=cdr` — per-call CDR level (what we want)
2. `output=csv period=call`
3. `output=csv` (no period)
4. `output=csv period=day` — daily aggregated fallback
5. `action=export period=cdr`
6. `action=export` (no period)

Tries both `/profit_loss_report.php` and `/c1/profit_loss_report.php` for each.

Returns `PnlCsvReport` — includes `probe[]` array logging every attempt's statusCode/bodyLen/contentType so you can see exactly which param combo worked.

Parser is header-driven (same as monitoring graph CSV) — maps column names to fields regardless of order. Header index stored in `sippy.PnlCsvRow`.

## The cache
`pnlCache: Map<string, sippy.PnlCsvRow>` declared inside `registerRoutes()` near `cdrCache`.
- Key: `` `${cli}:${cld}:${startTime}` ``
- Refreshed every 10 min via `refreshPnlCache()`, first run T+90s
- Covers last 24h of calls; evicts entries >48h old
- `_pnlCacheRunning` mutex guards against concurrent refreshes

## Routes
- `GET /api/sippy/pnl/probe` — forces fresh download, returns probe log + 5 sample rows. Use this to verify the CSV export works. Supports `?hours=` (default 1).
- `GET /api/sippy/pnl` — reads from cache. Supports `?hours=`, `?cli=`, `?cld=`, `?connection=` filters. Returns `{ rows, totals, cacheSize, updatedAt }`.

## What worked (unknown until first live probe)
The winning `output=` param combo is unknown until `GET /api/sippy/pnl/probe` runs against a live Sippy. Check the `probe[]` array in the response to see which attempt succeeded.

**Why:** Sippy versions differ in what triggers the CSV export. Header-driven parsing + probe log means we can adapt without code changes once we know the column layout.
