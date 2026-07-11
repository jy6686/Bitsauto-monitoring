# Platform Dependency Matrix — Commercial subsystem

| Field | Value |
|-------|-------|
| Subsystem | Commercial & Rate Management |
| Status | ACTIVE (Commercial modules verified; other subsystems pending) |
| Verification | Verified in code (Evidence Level 1) |
| Last verified | 2026-07-11 |
| Repository commit | `482babb7` |
| Institutional sections | No (edges are code-derived) |

> **Purpose:** before any production change, read the row for the module you're
> touching and the **Consumed By** column to see the downstream blast radius.
> Edges are `[verified-in-code]` — derived from which modules read/write each table
> (`grep` of `shared/schema.ts` exports across `server/`). "Depends On" =
> upstream data/services this module needs; "Consumed By" = modules that read this
> module's outputs.

## Commercial module matrix

| Module | Reads | Writes | Depends On | Consumed By |
|--------|-------|--------|------------|-------------|
| **Vendor Rate Import** (`routes-vendor-rates.ts`) | uploaded xlsx; `canonical_vendors`; `global_destinations` (via matcher) | `vendor_rate_sheets`, `vendor_rate_sheet_rows`, `vendor_rate_normalized_prefixes`, `vendor_column_maps` | Destination Catalog (matcher), Product Registry, `vendor-prefix-parser`, `xlsx` | Compare, Margin, Impact, Send Rate, `by-destination` lookup |
| **Compare** (`routes-vendor-rates.ts`) | `vendor_rate_normalized_prefixes` | — (read-only) | Vendor Rate Import | Rate Manager UI |
| **Margin Analysis** (`routes-vendor-rates.ts`) | `vendor_rate_sheet_rows`, `destination_product_rates` | — | Vendor Rate Import, Destination Catalog, Product Mapping resolver (provenance) | Rate Manager UI |
| **Impact Analysis** (`routes-vendor-rates.ts`) | `vendor_rate_sheet_rows`, `destination_product_rates`, `product_registry`, `customer_product_assignments`, `margin_analytics_daily`, `canonical_vendors` | — | Vendor Rate Import, Product Registry, Destination Catalog, Product Mapping resolver | Rate Manager UI |
| **Approval Workflow** (`routes-vendor-rates.ts`) | `approval_requests`, `vendor_rate_sheets` | `approval_requests`, `approval_audit_log`, `vendor_rate_sheets` (status) | Vendor Rate Import | Sheet activation → all rate consumers |
| **Send Rate / Push to Sippy** (`routes-rate-manager.ts`) | `product_rates`, `customer_product_assignments`, `companies`, `product_registry` | `rate_push_jobs`, `product_rates` | Product Registry, `server/sippy.ts` (**frozen**), Approval | Sippy tariffs (external) |
| **Product Registry** (`routes.ts`, `routes-product-templates.ts`) | `product_registry`, `product_prefixes`, `customer_product_assignments`, `product_destination_assignments` | same + `deals`, `product_history` | `workspace-seed.ts` (`CANONICAL_PRODUCTS` seed) | Margin, Impact, Send Rate, Destination Catalog, Product Mapping, rate-notifications, call-governance |
| **Destination Catalog** (`routes.ts`) | `global_destinations`, `destination_product_rates` | `global_destinations.commercial_status`, `destination_product_rates`, `destination_status_history` | destination matcher/resolver/alias services | Product Registry, Vendor Import (matcher), Send Rate, Rate Manager, Product Mapping resolver, `routes.ts:35803` guard |
| **Rate Notifications** (`routes-rate-notifications.ts`) | `rate_notification_templates`, `product_registry`, `rate_notification_jobs` | `rate_notification_*` tables | Product Registry, email service | KAM dashboard, Rate Manager |
| **Product Mapping** ⚠️ *pending* (`routes-product-mapping.ts`) | `product_mapping_versions`, `product_destination_mappings`, `product_mapping_active_config`, `product_registry`, `global_destinations` | same mapping tables | Product Registry, Global Code Set | Margin, Impact, Compare (provenance) — **see Volume 1 §9 (Pending Verification)** |

## High-fan-out tables (change with care)

Verified reader-module counts (`grep` across `server/`):

| Table | Read by (modules) | Change risk |
|-------|-------------------|-------------|
| `product_registry` | rate-manager, vendor-rates, product-mapping, rate-notifications, product-templates, call-governance, resolver, workspace-seed | **High** — mutating rows/ids ripples across most of Commercial |
| `global_destinations` (`commercial_status`) | routes.ts (catalog + registry), rate-manager, product-mapping, destination services, resolver | **High** — blanket status change trips `/destinations/approved` + guard @routes.ts:35803 (see Volume 1 §8a) |
| `destination_product_rates` | vendor-rates (margin/impact), rate-manager, dest-resolver | Medium |
| `vendor_rate_normalized_prefixes` | vendor-rates (compare/by-destination), matchers | Medium |
| `customer_product_assignments` | rate-manager (send rate), vendor-rates (impact), product-templates | Medium |

## How to read this before a change

1. Find your module's row → note **Writes** (what you mutate).
2. For each table you write, check the **High-fan-out** section and every module's
   **Consumed By** → that is your blast radius.
3. If a written table is High-fan-out, the change is at least **Class C**; a
   schema/DDL or bulk data mutation is **Class D** (needs Level 3 evidence +
   rollback). See Volume 0 §7–§8.

## Open Questions
- [x] Which modules read `product_registry` / `global_destinations`? — **Verified** (grep, above)
- [ ] Scheduled/background jobs that assume `approved` destinations? — **Pending** (audit `setInterval`/cron paths in `routes.ts`)
- [ ] Non-Commercial consumers (Routing, Finance, Analytics) of these tables? — **Pending** (out of current scope; Volume 2+)
- [ ] Confirm Product Mapping edges once §9 table existence is verified — **Blocked** on Level 3 DB evidence
