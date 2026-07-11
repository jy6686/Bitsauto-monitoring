# ADR-001 — Product/Trunk Prefix Architecture

**Status:** Accepted (LOCKED) · ⚠ under verification — see [VR-001](../verification-register.md)
**Sources:** `[I]` `.agents/memory/prefix-architecture-rule.md`, `product-policy.md`, `rate-manager-trunk-prefix.md`

## Problem
Products are commercial **classes** (FC/BC/SB/SC), not destinations. The class must
drive routing internally, but must never be exposed to customers, and Sippy tariffs
only understand bare telecom prefixes.

## Decision
- `trunkPrefix` (1/2/6/7) = BitsAuto internal routing-class identifier — **stored for
  audit only, never sent to Sippy**.
- `dialPrefix` (e.g. 9233) = the **only** value sent to Sippy.
- `fullPrefix = trunkPrefix + dialPrefix` = BitsAuto catalogue identifier, audit-only.
- Single enforcement point: `resolveSippyPrefix(prefix, trunkPrefix)` in
  `server/sippy.ts`. No route may concatenate and pass the result to Sippy.

## Alternatives considered
- Send `fullPrefix` to Sippy — **rejected**: causes `Cannot find iRate for prefix 19233`.
- Separate Sippy tariffs per product class — heavier, not needed.

## Consequences
- Prefix handling is centralized and auditable.
- ⚠ **Current Send Rate code (`routes-rate-manager.ts:313`) passes `fullPrefix`**,
  contradicting this ADR — logged as **VR-001**, unresolved pending L2/L3 evidence.
  If prod confirms a full-prefix tariff design, this ADR is **Superseded**; if not,
  the code is a regression to fix.
