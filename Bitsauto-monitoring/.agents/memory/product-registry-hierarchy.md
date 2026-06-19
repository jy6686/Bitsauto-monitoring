---
name: Product Registry commercial hierarchy
description: Lifecycle states, customer-product assignment model, and what "commercial" controls in the platform.
---

## Lifecycle States (ordered progression)
`draft` → `testing` → `commercial` → `deprecated` → `retired`

**Why:** Names change; product codes (FC/BC/SB/SC) must be immutable. Status gates
commercial products from appearing in deal workspace, auth studio, and rate generation.

**How to apply:** Any new feature that filters products for customer-facing flows must
check `status = 'commercial'`. The lifecycle stepper in Product Catalog enforces this visually.

## Seed / migration note
Original seeded products had `status = 'active'`. Migrated to `commercial` via direct SQL.
If future seeds use a new status value, update `LIFECYCLE_STATES` array in `product-registry.tsx`.

## Commercial Master-Data Hierarchy
```
Customer → Product → Destination → Routing Template → Pricing Template → Rate → Deal
```
- `customer_product_assignments` — links Sippy `i_account` to `product_id`. Soft-deleted (status='inactive'), reactivated on re-assign.
- `product_destination_assignments` — links product to global_destinations node.
- Sippy accounts fetched live from `/api/sippy/accounts` for the Customer Assignments tab.

## Availability Matrix
The Assignments tab has a view toggle (DnD / Matrix). Matrix rows = destinations (level ≥ 2),
columns = products. Click ✓ to remove, click + to assign — same API as drag & drop.

## What stays separate
- `global_destinations` is the platform's own destination tree (Country → Type → Operator).
- Sippy routing groups / destination sets remain in Sippy — they are consumed, not replaced.
