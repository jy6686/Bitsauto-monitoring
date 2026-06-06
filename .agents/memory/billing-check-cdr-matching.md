---
name: Billing Check CDR matching
description: Field semantics, duration formula, matching algorithm, and DB-first CDR storage pattern for the Call Governance Billing Check tab.
---

## CDR field semantics (governed_calls vs Sippy CDR)

| Field | governed_calls | Sippy CDR |
|-------|---------------|-----------|
| Destination | `gc.caller` = Asterisk EXTEN = `"2060" + E.164 dest` (e.g. `20602917280621`) | `callee` = dest with optional leading "1" (e.g. `12917280621`) |
| Source CLI | `gc.callee` = PJSIP CallerID = original customer CLI (e.g. `+447908985996`) | `caller` = UK CLI with + prefix (e.g. `+447908985996`) |

## Duration formula

`CDR duration ≈ govSec + 8`

The 8-second delta is the B-leg (vendor) cleanup window fired after the governance BYE. Sippy generates the CDR when the vendor leg disconnects, not when the customer leg drops. Confirmed empirically: govSec=22, CDR duration=30.

## DB-first CDR storage architecture (implemented)

**Problem**: Sippy CDR cache only covers the last ~4h of rolling CDRs; older governed cuts show "No CDR" because the CDR has fallen out of the window. XML-RPC `getAccountCDRs` is blocked by an auth-failure circuit breaker.

**Solution**: eager CDR lookup fires **45 seconds after each cut** (when the CDR is fresh and at the top of the portal list). Result is stored on `governed_calls` row in 8 new columns.

| Column | Type | Purpose |
|--------|------|---------|
| `cdr_status` | varchar(32) | `ok / check / loss / no_cdr` |
| `cdr_caller` | varchar(64) | Matched CDR caller (CLI) |
| `cdr_callee` | varchar(64) | Matched CDR callee (CLD) |
| `cdr_duration` | integer | Matched CDR duration (seconds) |
| `cdr_cost` | real | Customer-side cost |
| `cdr_vendor_cost` | real | Vendor-side cost |
| `cdr_vendor_name` | varchar(128) | Resolved vendor name |
| `cdr_checked_at` | timestamp | When lookup ran |

Columns were created via **direct SQL** (db:push blocked by constraint prompt). Schema declaration in `shared/schema.ts` was added after the SQL.

**Billing endpoint resolution order**:
1. If `gc.cdrStatus != null` → use DB-stored values (source: 'db')
2. Else → live cache matching within ±10min window (source: 'live')

**Backfill endpoint**: `POST /api/call-governance/billing-backfill` (auth required)
- Body `{ id: N }` → retry specific cut immediately (no 45s delay)
- Body `{}` → retry all null-cdrStatus cuts

**Limitation**: portal scrape only returns ~244 most recent CDRs (last ~4h). Cuts older than ~4h cannot be backfilled via portal; they'll remain "No CDR" unless XML-RPC auth recovers.

## Matching algorithm (billing endpoint)

1. `destDigits = gc.caller.replace(/\D/g,'').replace(/^2060/,'')` — strip prefix
2. `destSuffix = destDigits.slice(-9)` — last 9 digits
3. **Time window**: CDR `startTime` within ±10 min of `gc.startTime`
4. **CLD match**: `CDR.callee.replace(/\D/g,'').endsWith(destSuffix)`
5. **CLI tiebreaker** (when multiple CLD matches): `CDR.caller.replace(/\D/g,'').endsWith(gc.callee.replace(/\D/g,'').slice(-7))`

Status logic:
- `estimatedBilledSec = govSec + 8`
- `'ok'` if `CDR.duration <= estimatedBilledSec + 15` (15s billing-interval slack)
- `'check'` if CDR exists but `duration > estimatedBilledSec + 15`
- `'loss'` if vendor cost exceeds customer revenue (margin < 0)
- `'no_cdr'` if no CDR found

## TSX compilation caching gotcha

`routes.ts` is ~34 000 lines. TSX file-watch hot-reload uses a **compiled cache** — edits trigger a process restart but TSX may serve the previously-compiled output. Diagnostic console.log changes only appear reliably after a **full server restart** (kill + relaunch, not just TSX watch restart).

**Why:** TSX watches all source files and recompiles on change, but for extremely large files it can cache the previous compiled form in memory, meaning the new source isn't fully re-evaluated until the Node process is freshly spawned.

**How to apply:** When debugging routes.ts changes and logs don't appear as expected, use `restart_workflow` to force a fresh compile, not just a file save.
