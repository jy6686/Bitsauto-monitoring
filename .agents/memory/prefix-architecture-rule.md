---
name: Prefix Architecture Rule
description: Platform-locked rule — dialPrefix only goes to Sippy; resolveSippyPrefix() is the enforcement point.
---

## Rule (LOCKED — do not modify without architecture review)

- `trunkPrefix` (1/2/6/7) = BitsAuto internal routing-class identifier → stored in DB for audit ONLY, never sent to Sippy
- `dialPrefix` (9233, 8801…) = real telecom prefix → the ONLY value ever sent to Sippy
- `fullPrefix` = trunkPrefix + dialPrefix → BitsAuto catalogue identifier, stored in `rate_push_jobs` for audit only

**Why:** Sippy tariffs use bare telecom prefixes. The trunk digit is BitsAuto's internal product-class encoding; Sippy has no concept of it. Sending fullPrefix (e.g. 19233) causes `Cannot find iRate for prefix 19233` errors.

**How to apply:** Every Sippy write path calls `resolveSippyPrefix(prefix, trunkPrefix)` exported from `server/sippy.ts`. No route concatenates trunkPrefix + dialPrefix and passes the result to any Sippy API.

## Known bug locations fixed
- `server/routes.ts` push-batch: fixed (`dest.dialPrefix`)
- `server/routes-rate-manager.ts` Product Rates push: fixed (`sippy.resolveSippyPrefix(prefix, trunkPrefix)`)
- Deal Approval: already correct (`gd.dialPrefix` from globalDestinations)
- Change Client Rates: already correct (reads directly from Sippy)

## Audit table
| Module | Status |
|---|---|
| Send Rate (push-batch) | ✅ Fixed |
| Product Rates Push | ✅ Fixed |
| Deal Approval | ✅ Correct |
| Change Client Rates | ✅ Correct |
| Company Rate Push (provision) | ⚠ Verify when provision is tested |
| Multi-switch Push | ⚠ Verify when multi-switch is tested |
