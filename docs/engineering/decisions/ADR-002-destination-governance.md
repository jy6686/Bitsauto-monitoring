# ADR-002 — Destination Catalog Governance

**Status:** Accepted
**Sources:** `[I]` `.agents/memory/destination-catalogue-commercial.md`, `product-policy.md`; `[V]` §8a

## Problem
Destinations are the customer-facing authority and master reference data. Rates,
billing, and routing all depend on them, so ad-hoc edits are unsafe.

## Decision
- `global_destinations` is the platform's own destination tree; Sippy routing
  groups/destination sets are **consumed, not replaced**.
- `commercial_status` (`pending → approved`, plus `blocked`/`unapproved`) is a
  **governed business rule** (workflow: upload → reconcile → review → approve).
- **Billing increment is a destination-level attribute** (not product-level) — the
  same country can have different increments per operator.

## Alternatives considered
- Treat approval as a display flag — **rejected** (it's filtered/guarded in code, VR-004).
- Product-level billing increment — **rejected** (operator-specific reality).

## Consequences
- Approval state is load-bearing (VR-004 verified); **no blanket status mutation**
  (blast radius — Volume 1 §8a).
- Sprint B1 adds `billing_increment_*` fields; Sippy increment push deferred to B2.
