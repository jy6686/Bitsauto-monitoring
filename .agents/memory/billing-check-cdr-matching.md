---
name: Billing Check CDR matching
description: Field semantics, duration formula, and matching algorithm for the Call Governance Billing Check tab; TSX compilation gotcha for large routes.ts.
---

## CDR field semantics (governed_calls vs Sippy CDR)

| Field | governed_calls | Sippy CDR |
|-------|---------------|-----------|
| Destination | `gc.caller` = Asterisk EXTEN = `"2060" + E.164 dest` (e.g. `20602917280621`) | `callee` = dest with optional leading "1" (e.g. `12917280621`) |
| Source CLI | `gc.callee` = PJSIP CallerID = original customer CLI (e.g. `+447908985996`) | `caller` = UK CLI with + prefix (e.g. `+447908985996`) |

## Duration formula

`CDR duration ≈ govSec + 8`

The 8-second delta is the B-leg (vendor) cleanup window fired after the governance BYE. Sippy generates the CDR when the vendor leg disconnects, not when the customer leg drops. Confirmed empirically: govSec=22, CDR duration=30.

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
- `'no_cdr'` if no CDR found (expected for cuts < ~15 min old due to CDR processing lag)

## CDR cache stats (as of confirmed run)

~1130 total CDRs, ~392 with Eritrea (291) callee, ~171 with UK (+447) caller. Refreshes every 5 min via XML-RPC (1000/page) → Mera enrichment for vendor resolution.

## TSX compilation caching gotcha

`routes.ts` is ~30 000 lines. TSX file-watch hot-reload uses a **compiled cache** — edits trigger a process restart but TSX may serve the previously-compiled output. Diagnostic console.log changes only appear reliably after a **full server restart** (kill + relaunch, not just TSX watch restart).

**Why:** TSX watches all source files and recompiles on change, but for extremely large files it can cache the previous compiled form in memory, meaning the new source isn't fully re-evaluated until the Node process is freshly spawned.

**How to apply:** When debugging routes.ts changes and logs don't appear as expected, use `restart_workflow` to force a fresh compile, not just a file save.
