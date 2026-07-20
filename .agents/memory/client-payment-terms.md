---
name: client_payment_terms table
description: T0 Treasury prerequisite — payment terms per client, used to calculate settlement due dates
---

## The Rule

`client_payment_terms` is the canonical source for payment terms. Treasury settlement records must **snapshot** the resolved `due_days` (and calculated `due_date`) at the time of creation — they must never recalculate from the current terms later.

**Why:** A client's terms may change (Net 30 → Net 45). Invoices issued under the old terms must retain their original due dates. Same immutability principle as `invoice_batches.snapshot_run_id`.

## Schema Key Points

- `due_days` is the operative field — enum `payment_term` is UI convenience only
- Unique index: `(client_id) WHERE is_active=TRUE AND effective_to IS NULL` — only one active term per client at a time
- Historical versioning: set `effective_to` on old row, insert new row with new `effective_from`
- Platform default: NET_30 / 30 days — seeded automatically for any client in `client_identity_map`

## Due Date Formula

```
due_date = invoice_approved_at::date + due_days
```

T1 KPI buckets:
- **Due Today**: `due_date = CURRENT_DATE AND balance > 0`
- **Due This Week**: `CURRENT_DATE <= due_date <= CURRENT_DATE + 7 AND balance > 0`
- **Overdue**: `due_date < CURRENT_DATE AND balance > 0`

## Seeding

Only clients in `client_identity_map` get seeded. Sippy accounts not yet identity-mapped have no terms until `POST /api/identity/seed` maps them.

## Created

2026-07-20 — T0 Treasury prerequisite, direct SQL (no db:push).
Seeded: Acme Corp, Beta Telco (NET_30).
