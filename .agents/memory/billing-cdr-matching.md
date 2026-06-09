---
name: Billing CDR matching in governed_calls
description: Field semantics for CDR matching in the billing endpoint, common mistakes, and retry strategy.
---

## Field semantics in governed_calls (CORRECT — post-fix)
| DB column | AMI source | Contains |
|---|---|---|
| `gc.callee` | callerIdNum1 (B-leg SIP/sippy) | CLD — destination with `2060` routing prefix |
| `gc.caller` | callerIdNum2 (A-leg PJSIP) | CLI — originating ANI |

## CDR matching: use gc.callee for destination, gc.caller for CLI tiebreaker
In both `runCdrLookup()` (routes-call-governance.ts) and the live-match fallback in the billing endpoint (routes.ts):
```
const destDigits = (gc.callee || '').replace(/\D/g, '').replace(/^2060/, '');
const cliSuffix  = (gc.caller || '').replace(/\D/g, '').slice(-7);
```

## displayCli / displayCld in billing endpoint (routes.ts)
```
displayCli = gc.caller   ← PJSIP A-leg = originating CLI
displayCld = gc.callee with /^2060/ stripped ← real destination
```

## Common mistake (was wrong, now fixed)
Using `gc.caller` as destination and `gc.callee` as CLI tiebreaker — this was the original wrong mapping before the callee/caller swap fix. Do NOT revert.

## CDR lookup retry strategy
- Fresh cut: scheduled at 45s / 3min / 8min via `scheduleCdrLookup()`
- Background retry: `runPeriodicCdrBackfill()` runs every 30 min (limit 50 records, 1.5s spacing), first run 5 min after startup
- Manual retry: POST /api/call-governance/billing-backfill

## Why pool=0 failure happens
Sippy intermittently returns `Parse Error: Invalid character in Content-Length` during high load.
ALL three tracks (XML-RPC, portal scrape, admin portal) fail simultaneously.
CDR stays `no_cdr` until next retry window. Periodic backfill ensures eventual resolution.
