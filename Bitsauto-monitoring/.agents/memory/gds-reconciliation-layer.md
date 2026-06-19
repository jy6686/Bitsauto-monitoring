---
name: GDS Reconciliation Layer
description: Destination Catalog enhancement — per-product buy/sell rates via GDS upload, approval workflow, rate matrix view
---

# GDS Reconciliation Layer — Architecture

## Rule
Products are NEVER hardcoded. All product columns (FC, BC, SB, SC, …) are fetched dynamically from `product_prefixes` table via `GET /api/product-prefixes`. Adding a new product in product_prefixes automatically appears as a new column in the rate matrix.

**Why:** User explicitly requested no hardcoding so future products can be added without schema/code changes.

## DB Table: `destination_product_rates`
- PK: id SERIAL
- `destination_id` → global_destinations(id) ON DELETE CASCADE
- `product_prefix` → matches product_prefixes.prefix (VARCHAR 16)
- UNIQUE(destination_id, product_prefix) — one rate per dest×product
- Fields: buy_rate, sell_rate (NUMERIC 10,6), currency, approval_status, approved_by, approved_at, source, source_file, notes
- Approval statuses: `pending` | `approved` | `rejected`
- Source values: `manual` | `gds_upload`

## Backend Routes (injected into routes.ts before sync-legacy)
- `GET  /api/product-prefixes` — all active products
- `GET  /api/destination-catalog/product-rates` — full matrix with dest + product joins
- `GET  /api/destination-catalog/product-rates/pending-count`
- `POST /api/destination-catalog/gds-reconcile` — dry-run: longest-prefix match against global_destinations, returns preview
- `POST /api/destination-catalog/gds-commit` — write pending rows (upsert; re-approved rows reset to pending)
- `POST /api/destination-catalog/product-rates/:id/approve`
- `POST /api/destination-catalog/product-rates/:id/reject`
- `POST /api/destination-catalog/product-rates/approve-all-pending`
- `DELETE /api/destination-catalog/product-rates/:id`

## Frontend: GdsRatesTab component (destination-catalog.tsx)
- **TabId `"gds"`** — 3rd tab in Destination Catalog, badge shows pending GDS rate count
- **Two views** (toggled internally): "Rate Matrix" and "Upload GDS"
- **Rate Matrix**: pivot table — destination rows × product columns; each cell shows buy/sell rates + margin% + approval status + Approve/Reject buttons
- **Upload view**: drag-drop CSV/XLSX → local parse → product selector → POST gds-reconcile → preview (color-coded new/update/unmatched/invalid) → POST gds-commit
- **Column detection**: regex on header names (Prefix/Code/Dial, Dest/Name/Country, Buy/Cost, Sell/Rate/Price)
- **Margin color**: ≥20% = emerald, 10-20% = amber, <10% = rose

## Approval Workflow
Upload GDS → Reconcile (server-side prefix match) → Commit (pending) → You review in Rate Matrix → Approve/Reject per cell

## How to Apply
- To add a new product: INSERT into product_prefixes; it appears automatically everywhere
- Margin formula: (sell - buy) / sell × 100
- Reconciliation uses longest-prefix match against global_destinations.dial_prefix (level ≥ 2)
