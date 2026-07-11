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

## Handbook structure (Parts A–E)

This volume is an **operations handbook**, not a code manual. Target structure and
current fill state:

| Part | Contents | State |
|------|----------|-------|
| **A — Business Architecture** | *Why* each area exists: Commercial org, Vendor & Customer management, Product/Routing/Margin strategy, Approval governance. Mostly `[institutional]`. | ⛔ To author with owner (business rationale not derivable from code) |
| **B — Functional Modules** | One chapter per module to the per-module template (Vol 0 §6.3): objective, workflow, UI, APIs, services, tables, approval flow, exceptions, audit, dependencies, tests, open questions. | 🟡 §8a Destination Catalog is the deep reference; §§2–7 are verified summaries to deepen; §9 pending |
| **C — Integration** | How Commercial connects to Sippy (XML-RPC + portal scraping), Product Registry, Routing, Finance, Analytics, Approval Engine. | 🟡 Partial (see §7 Send Rate, §1 map) |
| **D — Technical Reference** | UI → API → Service → Storage → DB → External data-flow per module. | 🟡 Summaries in §§2–9; companion: **[Platform Dependency Matrix](dependency-matrix.md)** |
| **E — Governance** | Change classification, evidence levels, freeze rules, rollback/risk, production checklist. | ✅ Lives in **[Volume 0](VOLUME-0-governance.md)** (referenced, not duplicated) |

> **Companion artifact:** the **[Platform Dependency Matrix](dependency-matrix.md)**
> (Reads / Writes / Depends On / Consumed By per module) is the change-impact tool —
> consult it before any production change to see the downstream blast radius.

The sections below (§§1–9) are the current Part B/D content, to be reorganised
under these parts as they are deepened.

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

---

## 8a. Module — Destination Catalog (deep, per-template) `[verified-in-code @ 482babb7]`

> This module is documented against the full per-module template (Volume 0 §6.3)
> as the reference example for the rest of Volume 1.

**Business purpose** `[institutional]`: the Destination Catalog is master reference
data — the authoritative list of dial destinations and their per-product rates.
Approval state is a **governed business rule**, not a cosmetic flag: once a
destination is `approved`, other commercial flows depend on that state. `[The "why
it is master data" and the operational policy around re-review are owner
knowledge.]`

**UI pages:** `client/src/pages/destination-catalog.tsx` (tabs: Destination
Catalog, Vendor Sheets, Approvals, GDS Rates, Market Intel, Bulk Import, Product
Mapping). Approval state is also read by `pages/product-registry.tsx`,
`pages/deals.tsx`, `pages/rate-manager.tsx`.

**API endpoints** (`server/routes.ts` monolith):
- Destinations: `GET/POST /api/product-registry/destinations`,
  `PUT/DELETE /.../destinations/:id`, `GET /.../destinations/approved`,
  `POST /.../destinations/:id/{approve,block,set-status,unapprove}`,
  `POST /.../destinations/{bulk-reset,bulk-smart,sync-legacy}`.
- Catalog / rates: `GET /api/destination-catalog/product-rates`,
  `.../product-rates/:id/{approve,reject}`, `.../product-rates/approve-all-pending`,
  `PATCH/DELETE .../product-rates/:id`, `.../aliases`, `.../gds-commit`,
  `.../gds-reconcile`, `.../:id/unapprove`, `.../:id/history`, `.../overview/:destId`.

**Services:**
`services/destination/destination-matcher.service.ts` (matches vendor-sheet
prefixes → destinations), `destination-resolver.service.ts`,
`destination-alias.service.ts`.

**Database tables:**
- `global_destinations` — master rows. Approval column: **`commercial_status`**
  `varchar(32) NOT NULL DEFAULT 'pending'`. Documented values (schema comment):
  `approved | blocked | testing | deprecated | pending`; code also sets
  `unapproved`. `blocked_reason varchar(256)`.
- `destination_product_rates` — per-destination × product sell/buy rates.
- `destination_status_history` — audit trail (raw SQL table; written on
  approve/unapprove with old→new status, reason, notes, changed_by).

**Workflow:** import/sync (bulk) → `pending` → review → `approve` (sets
`commercial_status='approved'`, clears `blocked_reason`) → optionally `unapprove`
(guarded: only an `approved` row may be unapproved) or `block`. Each transition is
written atomically with an audit row.

**Approval flow:** `unapprove` requires `current.commercial_status === 'approved'`
([routes.ts:34891](../../server/routes.ts), [:35327](../../server/routes.ts)); the
status change + `destination_status_history` insert run in one transaction.

**Sequence (unapprove):**
```
UI (destination-catalog.tsx) → POST /api/destination-catalog/:id/unapprove {reason,notes}
  → guard: current.commercial_status == 'approved' ? else 400
  → tx { UPDATE global_destinations SET commercial_status='unapproved'
         ; INSERT destination_status_history(old,new,reason,notes,changed_by) }
  → invalidate history + overview queries
```

**Dependencies (who reads `commercial_status='approved'` — the blast radius of a
mass change) `[verified-in-code]`:**
- `GET /api/product-registry/destinations/approved` filters
  `commercial_status = 'approved'` ([routes.ts:34946](../../server/routes.ts)).
- A hard guard at [routes.ts:35803](../../server/routes.ts) rejects a flow when
  `dest.commercial_status !== 'approved'`.
- Read in UI by product-registry, deals, rate-manager, destination-catalog pages.

**Rollback impact:** ⚠️ **A blanket `UPDATE global_destinations SET
commercial_status=...` is a Class-D change with wide blast radius.** It would empty
`/destinations/approved` and trip the `:35803` guard, potentially affecting Rate
Manager / Send Rate / Product Mapping consumers. **Do not mass-mutate approval
state.** Safer patterns (per owner guidance): scoped bulk change (by
country/product/vendor) with a confirmation dialog + audit logging; or an approval
**re-review cycle / versioning** (`Review Required` state, keep history) rather
than blanket unapproval. Any such change requires Level 3 (DB) evidence, a backup,
recorded pre-counts, and a rollback script.

**Test checklist:**
- [ ] Approve a `pending` destination → `commercial_status='approved'`, audit row written
- [ ] Unapprove an `approved` destination → `unapproved`, audit row; unapprove a non-approved → 400
- [ ] `/destinations/approved` count changes as expected
- [ ] Dependent flows (Rate Manager / Send Rate) still behave after a *scoped* change
- [ ] `destination_status_history` reflects every transition

## Open Questions
- [x] Which table/column stores approval? — **Verified**: `global_destinations.commercial_status`
- [x] What values exist? — **Verified**: pending/approved/unapproved/blocked (testing/deprecated documented)
- [x] Which modules read `approved`? — **Verified**: `/destinations/approved`, guard @routes.ts:35803, 4 UI pages
- [ ] Is a full catalog re-review desired, and by what policy (versioning vs. re-review cycle)? — **Institutional Knowledge Required**
- [ ] Is this being considered in production or a dev/test env? — **Institutional Knowledge Required**

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

**Leading hypothesis — Confidence: Level 1 (code) only, unconfirmed:**
- **Verified (Level 1):** the tables are not created by any *currently tracked*
  repository mechanism (schema.ts / `runSafeMigrations()` / `migrations/*.sql`).
- **Pending (Level 3):** whether the tables exist in production at all, and if so
  *how* they were created (manual SQL, a historical bootstrap script no longer in
  the tree, a past deploy tool, or a snapshot restore) — not knowable from code.

If the tables are in fact absent, the resolver's `init()` throws `relation ... does
not exist`, leaving it uninitialized → `GET /api/gcs/product-mappings/health` 500
and Compare/Margin/Impact-with-product failures.

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

### §9 Open Questions
- [ ] Do the catalog tables exist in production? — **Needs Production Evidence** (`SELECT to_regclass(...)`)
- [ ] If they exist, how were they created? — **Needs Production Evidence** (Level 3)
- [ ] Is `product_id` in uploads the registry PK, and how is it validated? — **Pending** (verify in `routes-product-mapping.ts`)

---

## Volume-level Open Questions
- [x] Which route modules serve Commercial? — **Verified** (§1)
- [x] Vendor rate import pipeline & worksheet detection? — **Verified** (§2)
- [ ] Product Mapping production state — **Blocked** on Level 3 DB evidence (§9)
- [ ] `product_registry` empty in prod: seed failing vs. wrong DB? — **Needs Runtime Evidence** (`[workspace-seed]` log; see §8)
- [ ] Deep per-module writeups for §§2-7 (only §8a Destination Catalog is deep so far) — **Pending**
- [ ] Business rationale for approval governance & re-review policy — **Institutional Knowledge Required**

---

*Documentation status: §8a (Destination Catalog) is written to the full per-module
template as the reference example. §§2-7 are verified-in-code summaries to be
deepened to the same template. §9 (Product Mapping) is held Pending Verification.*
