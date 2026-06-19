---
name: Product Variant Architecture
description: 9 fixed platform product variants replacing the product+segment model; sprint C pending.
---

## Fixed Platform Variants (LOCKED)

| Code | Name | productClass | commercialType | productFamily | trunkPrefix |
|---|---|---|---|---|---|
| FC-W | First Class - Wholesale | FC | Wholesale | FC | 1 |
| BC-W | Business Class - Wholesale | BC | Wholesale | BC | 2 |
| SB-W | Special Bravo - Wholesale | SB | Wholesale | SB | 6 |
| SB-R | Special Bravo - Retail | SB | Retail | SB | 6 |
| SC-W | Special Charlie - Wholesale | SC | Wholesale | SC | 7 |
| SC-R | Special Charlie - Retail | SC | Retail | SC | 7 |
| PM-R | Premium | PM | Retail | PM | TBD |
| BS-R | Business | BS | Retail | BS | TBD |
| NP | No Prefix | NP | — | NP | — |

**Why:** Product + Segment label was inconsistent — same product appeared as different things across modules. Fixed variants give each commercial tier a canonical identity used by routing, finance, governance, and notifications.

**How to apply:**
- `productClass` drives routing decisions
- `commercialType` drives finance and governance
- `productFamily` enables reporting aggregation (all SB variants together vs SB-W vs SB-R)
- PM-R and BS-R trunk prefixes must be verified against legacy rate sheets before freezing

## Schema changes pending (Sprint C)
- Add `productClass`, `commercialType`, `productFamily` to `product_registry`
- Remove `segment` column (only 9 frontend references across 3 files — small migration)
- Seed 9 fixed variant records

## Validation Rule Hierarchy (roadmap)
- Level 1: Global (#337/#338 — built)
- Level 2: Product Variant Profile (#338B — future)
- Level 3: Client Override (#338C — future)
- Rule struct: `action` (Ignore/Reject Country/Reject Destination/Reject Rate Sheet/Auto Adjust) + `approvalRequired` (bool) — separate fields
