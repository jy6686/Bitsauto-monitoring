# Volume 1 — Commercial & Rate Management

| Field | Value |
|-------|-------|
| Subsystem | Commercial & Rate Management |
| Status | ACTIVE (current sprint) |
| Verification | Verified in code (Evidence Level 1), **except §9 Product Mapping — PENDING VERIFICATION** |
| Last verified | 2026-07-11 |
| Repository commit | `482babb7` |
| Institutional sections | Marked inline with `[institutional]` |

> Scope: the commercial pipeline — how vendor rate sheets are ingested, matched to
> destinations, compared/analysed, approved, and pushed to Sippy; plus the Product
> Registry and Destination Catalog they depend on. All facts below are
> `[verified-in-code]` at commit `482babb7` unless tagged `[institutional]`.
>
> **Evidence levels** (see Volume 0 §8): everything here is **Level 1 (code)**.
> Statements about what the *production database* contains are **not** made here —
> they require Level 3 evidence. §9 is held pending that evidence.

---

## 1. Subsystem map

```
features/vendor-sheets/VendorSheetUploader.tsx ─┐
features/product-mapping/ProductMappingTab.tsx ─┤
pages/rate-manager.tsx ─────────────────────────┤   HTTP/JSON
pages/product-registry.tsx ─────────────────────┼──────────────► Express route modules
pages/destination-catalog.tsx ──────────────────┤
pages/deals.tsx, pages/kam-dashboard.tsx ───────┘
                                                     │
   routes-vendor-rates.ts  routes-rate-manager.ts    │
   routes-product-templates.ts  routes-product-mapping.ts
   routes-rate-notifications.ts  (+ destination-catalog/
   product-registry endpoints in routes.ts monolith)
                                                     │
   services/destination/destination-matcher.service.ts
   services/commercial/product-mapping-resolver.ts   │
                                                     ▼
                                              PostgreSQL (Drizzle)
```

**Route registration** `[verified-in-code]` (`server/routes.ts`):
`registerRateManagerRoutes`, `registerVendorRatesRoutes`,
`registerRateNotificationRoutes`, `registerProductTemplatesRoutes`,
`registerProductMappingRoutes` (~lines 34247-34271). Destination-catalog and
product-registry endpoints live in the `routes.ts` monolith itself.

---

## 2. Vendor Rate Management

**Purpose:** ingest a vendor's rate sheet (xlsx), normalise its prefixes, and
match them to the destination catalog so rates become queryable per destination.

**UI** `[verified-in-code]`: `features/vendor-sheets/VendorSheetUploader.tsx`
(also referenced from `pages/rate-manager.tsx` and `pages/destination-catalog.tsx`).

**Pipeline & APIs** (`server/routes-vendor-rates.ts`):

| Step | Endpoint | Notes |
|------|----------|-------|
| Preview file | `POST /api/vendor-rates/preview` | Lists worksheets + detects header row + sample rows; no DB write |
| Import | `POST /api/vendor-rates/import` | Parses, validates, inserts sheet + rows; then a background worker normalises + matches |
| Poll status | `GET /api/vendor-rates/sheets/:id/status` | `processing → parsing → normalizing → matching → ready` (or `error`) |
| Re-match | `POST /api/vendor-rates/sheets/:id/match`, `POST /api/vendor-rates/match-sheet` | Re-run destination matching |
| List / rows / normalized | `GET /api/vendor-rates/sheets`, `.../:id/rows`, `.../:id/normalized` | Sheet list carries pipeline metrics (matched/partial/unmatched/pending) |
| Column templates | `GET /api/vendor-rates/column-maps/:vendorId` | Saved column-mapping templates per vendor |
| Vendors | `GET /api/vendor-rates/vendors` | Active canonical vendors |
| Delete | `DELETE /api/vendor-rates/sheets/:id` | |

**Worksheet selection** `[verified-in-code]`: `parseFile()` picks the sheet whose
name matches keywords `pricing|rates|rate|tariff|price`, else the first sheet; the
header row is the row with the most non-empty cells. (Relevant to the reported
"Terms & Conditions detected instead of Pricing" symptom — behaviour is
keyword-driven, not always first-sheet.)

**Import phases** `[verified-in-code]`: parse → `applyMap` (column mapping) →
validate (prefix length 2-16, effective ≤ expiry, dedupe) → insert sheet →
**background worker**: insert rows (batched 500) → normalise prefixes
(`parsePrefixExpression`) → `matchSheetDestinations()` → status `ready`.

**Tables:** `vendor_rate_sheets`, `vendor_rate_sheet_rows`,
`vendor_rate_normalized_prefixes`, `vendor_column_maps`, `vendor_parser_profiles`,
`canonical_vendors`, `vendor_product_prefixes`.

**Dependencies:** `services/vendor-prefix-parser`,
`services/destination/destination-matcher.service.ts`, `xlsx` (untrusted-upload
parser — see Volume 0 risk notes / dependency audit).

---

## 3. Compare Rates

**Purpose:** diff two vendor sheets (or a sheet vs. its active baseline) prefix by
prefix — new / removed / increased / decreased / unchanged.

**API:** `POST /api/vendor-rates/compare` (`{ baseSheetId, newSheetId }`) →
`{ summary, rows }`. **UI:** `pages/rate-manager.tsx`.
**Tables:** `vendor_rate_normalized_prefixes`.

---

## 4. Margin Analysis

**Purpose:** join a vendor sheet's cost rows against sell rates
(`destination_product_rates`) to surface margin per prefix, classified
negative / low / healthy.

**API:** `POST /api/vendor-rates/margin-analysis`
(`{ sheetId, productPrefix }`) → `{ summary, rows }`. **UI:** `pages/rate-manager.tsx`.
**Tables:** `vendor_rate_sheet_rows`, `destination_product_rates`.
**Dependency:** `product-mapping-resolver` for per-row mapping provenance
(see §9 status).

---

## 5. Impact Analysis

**Purpose:** for a new sheet vs. the active baseline, aggregate the rate increases,
join to products/clients, and estimate client-level exposure.

**API:** `POST /api/vendor-rates/impact-analysis` (`{ newSheetId, baseSheetId? }`;
auto-detects the active baseline sheet if omitted) → `{ hasBase, summary,
increased, clientImpact }`. **UI:** `pages/rate-manager.tsx`.
**Tables:** `vendor_rate_sheet_rows`, `destination_product_rates`,
`product_registry`, `customer_product_assignments`, `canonical_vendors`,
`margin_analytics_daily`. **Dependency:** `product-mapping-resolver` (see §9).

---

## 6. Approval Workflow

**Purpose:** activating a vendor rate sheet is governed — it goes through a
request/decide cycle with an audit trail. `[institutional: the "why" — commercial
control over which rates go live — is owner policy, not derivable from code.]`

**APIs** (`server/routes-vendor-rates.ts`):
`POST /api/vendor-rates/sheets/:id/request-activation` →
`GET /api/vendor-rates/approvals/pending` →
`POST /api/vendor-rates/approvals/:id/decide` (`approved|rejected`).
Direct activation also exists: `POST /api/vendor-rates/sheets/:id/activate`.

**Tables:** `approval_requests`, `approval_audit_log`, `vendor_rate_sheets`.
On approval: archives the current active sheet for that vendor and marks the new
one `active`.

**Related:** rate-notification jobs have their own approval cycle
(`routes-rate-notifications.ts`: submit-approval / approve / reject).

---

## 7. Send Rate (Push to Sippy)

**Purpose:** push an approved product rate to Sippy tariffs for the relevant
account(s).

**API:** `POST /api/product-rates/:id/push-to-sippy` (`server/routes-rate-manager.ts`)
— role-guarded (`admin`, `management`). Auto-discovers account names from active
`customer_product_assignments` when not supplied. Also: `GET /api/rate-manager/export`,
`POST /api/sippy/pre-push-check`, `GET /api/sippy/rate-history`,
`POST /api/sippy/rate-analysis-batch`, push-job retry.

**UI:** `pages/rate-manager.tsx`.
**Tables:** `product_rates`, `rate_push_jobs`, `customer_product_assignments`,
`companies`, `product_registry`.
**Dependency:** `server/sippy.ts` (**frozen** — Send Rate calls into it but must
not modify it). `[institutional: on some Sippy versions rates must be added via
the Sippy web UI — no XML-RPC rate API — per replit.md gotchas.]`

---

## 8. Product Registry & Destination Catalog

**Product Registry** — canonical product definitions (First Class, Business Class,
Special Bravo, Special Charlie) with a `trunk_prefix` routing code (1/2/6/7) and a
unique `code` (FC/BC/SB/SC).
- **Seeded from code:** `server/workspace-seed.ts` → `CANONICAL_PRODUCTS` +
  `seedProductsIfEmpty()` (idempotent upsert), invoked at startup from
  `routes.ts:820`. **This is the single source of truth — do not seed via SQL.**
- **APIs:** `GET/POST/DELETE /api/product-registry/products`, `.../assignments`,
  `.../customer-assignments`, `.../destinations*`, `.../history`.
- **UI:** `pages/product-registry.tsx`, `pages/deals.tsx`, `pages/rate-manager.tsx`.
- **Tables:** `product_registry`, `product_prefixes`,
  `customer_product_assignments`, `product_destination_assignments`,
  `product_history`, `deals`, `deal_destinations`, `deal_approvals`.

**Destination Catalog** — the global destination reference and per-destination
product rates, with an approval/unapprove governance layer.
- **APIs** (`routes.ts` monolith): `/api/destination-catalog/*`
  (product-rates, approve/reject, approve-all-pending, aliases, gds-commit,
  gds-reconcile, `:id/unapprove`, history, overview) and
  `/api/product-registry/destinations/*` (approve/block/set-status/unapprove/
  bulk-reset/bulk-smart/sync-legacy).
- **UI:** `pages/destination-catalog.tsx`.
- **Tables:** `global_destinations`, `destination_product_rates`,
  plus `destination_status_history` (raw SQL) for the audit trail.
- **Dependencies:** `services/destination/{destination-matcher,destination-resolver,destination-alias}.service.ts`.

---

## 9. Product Mapping — ⚠️ PENDING VERIFICATION

> **Status:** PENDING VERIFICATION. **Confidence on the blocking issue: Level 1
> (code) only.** Do not document production behaviour or recommend schema changes
> until Level 3 (database) evidence is captured.

**Intended purpose** `[verified-in-code]`: a versioned product→dial-prefix mapping
catalog that the resolver loads into memory so Compare/Margin/Impact can attach
mapping provenance and resolve destinations per product.

**Code facts (Level 1):**
- UI: `features/product-mapping/ProductMappingTab.tsx` → `/api/gcs/product-mappings/*`
  (upload, versions, versions/:id, download, activate, diff, archive, active,
  products, active-config, refresh, health) in `server/routes-product-mapping.ts`.
- Resolver: `server/services/commercial/product-mapping-resolver.ts` —
  `init()`/`refresh()` query `product_destination_mappings`,
  `product_mapping_active_config`, `product_mapping_versions`.
- **Those three tables are NOT in `shared/schema.ts`.**
- The migration that would create them (`migrations/028_product_mapping_catalog.sql`)
  is **0 bytes** (empty) in both working tree and git HEAD; a populated copy exists
  only in the stale nested duplicate (see known-issues/nested-repo-duplicate.md).
- The three tables are absent from **all three** creation mechanisms (Volume 0 §5):
  not in `shared/schema.ts` (so `drizzle-kit push` won't create them); not in
  `runSafeMigrations()` in `server/db.ts` (its curated ~39-table DDL list does not
  include them); and the `migrations/*.sql` files are never executed.

**Leading hypothesis — Confidence: Level 1 (code) only, unconfirmed:** because the
tables are created by none of the three automated mechanisms, they were likely
never created in production (their only possible origin is a one-off manual SQL
run). If so, the resolver's `init()` throws `relation ... does not exist`, leaving
it uninitialized → `GET /api/gcs/product-mappings/health` 500 and
Compare/Margin/Impact-with-product failures.

**Evidence still required — Level 3 (database):**
```sql
SELECT to_regclass('product_destination_mappings'),
       to_regclass('product_mapping_active_config'),
       to_regclass('product_mapping_versions');
-- all NULL → confirms the tables are missing
```
Or Level 2 (runtime): deploy log line
`[startup] ProductMappingResolver init (non-fatal): relation ... does not exist`.

**Fixes already applied (code, on branch `fix/product-mapping-urls-and-resolver-calls`):**
frontend API prefix corrected; resolver call signature/field paths corrected;
`init()` wired at startup. These are necessary but **not sufficient** if the tables
are missing — that is the pending item.

**Proposed fix (Class D — needs Level 3 evidence + rollback first):** port the 5
tables into `shared/schema.ts` and `db:push`. Not to be actioned until confirmed.
