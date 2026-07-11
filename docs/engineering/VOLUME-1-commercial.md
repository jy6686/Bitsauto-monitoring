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

## Part A — Business Architecture (placeholder)

| Field | Value |
|-------|-------|
| Status | **PENDING — Institutional Knowledge Required** |
| Author | Junaid Qadeer (owner) |
| Technical references | Parts B–E (below) |

> This part captures the **business intent** behind the Commercial subsystem — *why*
> it works the way it does. It is **not derivable from code**; writing it by reading
> the implementation would produce interpretation, not architecture. It will be
> transcribed from an owner dictation session and tagged `[institutional]`. Until
> then it is intentionally unfilled — the handbook's structure stays complete while
> this section is honestly marked pending.

**Topics to capture (Open Questions):**
- [ ] Commercial organization — **Institutional Knowledge Required**
- [ ] Product strategy (why First Class / Business Class / Special Bravo / Special Charlie) — **Institutional Knowledge Required**
- [ ] Margin philosophy (why margins are computed/tiered as they are) — **Institutional Knowledge Required**
- [ ] Approval philosophy (why approvals exist; why some changes need them and others don't) — **Institutional Knowledge Required**
- [ ] Customer lifecycle — **Institutional Knowledge Required**
- [ ] Vendor lifecycle — **Institutional Knowledge Required**
- [ ] Carrier / routing strategy — **Institutional Knowledge Required**
- [ ] Control-plane vs. execution-plane boundary (BitsAuto orchestrates; Sippy executes) — **Institutional Knowledge Required**

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

## 2. Module — Vendor Rate Import (deep, per-template) `[verified-in-code @ 482babb7]`

**Business objective** `[institutional]`: turn a vendor's rate sheet into
queryable, destination-matched rate data that feeds Compare / Margin / Impact and
ultimately Send Rate. `[The commercial "why" — vendor onboarding cadence, which
vendors, how often — is owner knowledge.]`

**User workflow:** upload xlsx → **Preview** (pick worksheet, confirm header,
map columns) → **Import** → poll status until `ready` → rows are matched to the
Destination Catalog and become available to downstream analysis.

**UI pages / components:** `client/src/features/vendor-sheets/VendorSheetUploader.tsx`
(the wizard), surfaced from `pages/rate-manager.tsx` and `pages/destination-catalog.tsx`
(Vendor Sheets tab). *(Note: a committed `VendorSheetUploader.tsx.backup` exists —
minor repo debt.)*

**API endpoints** (`server/routes-vendor-rates.ts`):

| Step | Endpoint | Notes |
|------|----------|-------|
| Preview | `POST /api/vendor-rates/preview` | Lists worksheets + detects header row + 12 sample rows; **no DB write** |
| Import | `POST /api/vendor-rates/import` | Validates, inserts sheet, returns `{sheetId, status:'processing'}` immediately; background worker finishes |
| Poll status | `GET /api/vendor-rates/sheets/:id/status` | drives the wizard progress bar |
| Re-match | `POST /api/vendor-rates/sheets/:id/match`, `POST /api/vendor-rates/match-sheet` | re-run matching without re-upload |
| List / rows / normalized | `GET /api/vendor-rates/sheets`, `.../:id/rows`, `.../:id/normalized` | list carries matched/partial/unmatched/pending metrics |
| Column templates | `GET /api/vendor-rates/column-maps/:vendorId` | saved per-vendor mappings |
| Vendors | `GET /api/vendor-rates/vendors` | active canonical vendors |
| Delete | `DELETE /api/vendor-rates/sheets/:id` | |

**Services:** `services/vendor-prefix-parser` (`parsePrefixExpression`),
`services/destination/destination-matcher.service.ts` (`matchSheetDestinations`),
`xlsx` (⚠️ untrusted-upload parser — known high-sev advisories, see Volume 0 risk /
dependency audit).

**Database tables:**
- Writes: `vendor_rate_sheets` (one per upload; carries `status`),
  `vendor_rate_sheet_rows` (raw rows), `vendor_rate_normalized_prefixes`
  (expanded/normalised prefixes with match status), `vendor_column_maps` (saved
  templates, when `saveTemplate`).
- Reads: `canonical_vendors`; `global_destinations` (via matcher).

**Workflow internals — sheet & header detection** `[verified-in-code]`:
`parseFile()` selects the worksheet whose name contains any of
`pricing|rates|rate|tariff|price`; **if none match, it falls back to the first
sheet.** Header row = the row with the most non-empty cells. → **This is the exact
mechanism behind the "Terms & Conditions sheet detected instead of Pricing"
symptom:** a sheet with none of those keywords, or where T&C is first and Pricing
isn't keyword-named, mis-selects. Preview lets the user override via `sheetIndex`.

**Import pipeline & status transitions** `[verified-in-code]`:
```
parse → applyMap (column mapping) → validate → INSERT vendor_rate_sheets
  → return {status:'processing'}          (responds immediately)
  → setImmediate background worker:
       'parsing'     → INSERT rows (batched 500)
       'normalizing' → parsePrefixExpression → INSERT normalized (batched 500, deduped)
       'matching'    → matchSheetDestinations()
       'ready'       (or 'error' on throw)
```

**Validation rules** `[verified-in-code]`: reject row if prefix length < 2 or > 16;
reject if `effectiveDate > expiryDate`; **de-duplicate by prefix** (dupes counted
and returned as `duplicatesSkipped`, not imported). Empty result after mapping or
after validation → `400 {error}`.

**Exception handling** `[verified-in-code]`: synchronous phase errors → `400`/`500`
JSON to the caller; background-worker errors are caught and set
`vendor_rate_sheets.status='error'` (the wizard surfaces this via status poll).
The `xlsx` parse runs on user-supplied base64 — treat as untrusted.

**Audit logging** `[verified-in-code]`: ⚠️ **no dedicated audit *table*** is written
for imports — the audit trail is **console telemetry only** (`[vr] parse/applyMap/
validate/...` timing + counts). If a durable import audit trail is a requirement,
that is a **gap** (Open Question below). (Contrast: Approval and Destination
Catalog do write DB audit rows.)

**Dependencies:** Destination Catalog (matcher target — a sheet cannot fully match
until destinations exist/approved), Product Registry (downstream), `xlsx`.

**Consumed by:** Compare, Margin, Impact, Send Rate, `by-destination` lookup
(see [Dependency Matrix](dependency-matrix.md)).

**Rollback impact:** per-sheet and self-contained — deleting a sheet
(`DELETE /sheets/:id`) removes its rows; no shared master data is mutated by import
itself. **Low blast radius** (Class B/C), unlike Destination Catalog/Product
Registry changes.

**Test scenarios:**
- [ ] Upload with a keyword-named Pricing sheet → correct sheet auto-selected
- [ ] Upload where only "Terms & Conditions" is first, no keyword sheet → verify override via `sheetIndex`
- [ ] Rows with prefix len <2/>16 → excluded; `effective>expiry` → excluded
- [ ] Duplicate prefixes → `duplicatesSkipped` count correct, not imported
- [ ] Status progresses processing→parsing→normalizing→matching→ready
- [ ] Induced worker error → status `error`, surfaced in UI
- [ ] Save-template path writes `vendor_column_maps`; reload applies it

**Known issues:** `[C]` worksheet auto-detection mis-selects when no sheet is
keyword-named — **see [Verification Register → VR-003](verification-register.md)**;
no DB audit trail (logs only); `xlsx` untrusted-parse advisories.

**Production notes** `[institutional]`: `xlsx` parses user-supplied base64 — treat
as untrusted (size/MIME/sandbox hardening pending). A sheet cannot fully match until
its destinations exist/approved in the Destination Catalog.

**Future roadmap:** content-based (not name-based) worksheet detection (VR-003
decision); durable import audit trail (if required).

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✓ (sheet-detection reproduced) | ✗ | ✓ | 2026-07-11 |

## Open Questions
- [x] Sheet/header detection mechanism? — **Verified**: keyword match else first sheet; most-filled row = header
- [x] Status lifecycle & error handling? — **Verified**: processing→…→ready|error, worker try/catch
- [ ] Is a durable DB import audit trail required (currently logs only)? — **Institutional Knowledge Required**
- [ ] Should worksheet auto-detection be smarter (content-based, not name-based)? — **Pending** (product decision; ties to active upload bug)
- [ ] `xlsx` untrusted-parse hardening (size/MIME/sandbox) — **Pending** (security task)

---

## 3. Module — Compare Rates (deep, per-template) `[verified-in-code @ 482babb7]`

**Business objective** `[institutional]`: show what changed between two vendor rate
sheets before deciding to activate one. `[When/why a compare is run is owner
workflow.]`

**User workflow:** in Rate Manager, pick a base sheet + a new sheet → run Compare →
review the categorised diff.

**UI:** `pages/rate-manager.tsx`.
**API:** `POST /api/vendor-rates/compare` `{ baseSheetId, newSheetId }` →
`{ summary, rows }`.

**Workflow internals** `[verified-in-code]`: loads both sheets'
`vendor_rate_normalized_prefixes`, builds a prefix→{destination,rate} map for each,
then for every prefix in the union classifies:
`new` (only in new) · `removed` (only in base) · `increased` · `decreased` ·
`unchanged` (|Δ| < 1e-6). Rows sorted new→removed→increased→decreased→unchanged.
Summary counts each category. **Read-only** — no writes.

**Services / dependencies:** none beyond the DB; upstream = Vendor Rate Import
(needs two imported sheets). **Consumed by:** Rate Manager UI (feeds the
activation decision).

**Rollback impact:** none — pure read.

**Test scenarios:**
- [ ] Same sheet vs itself → all `unchanged`
- [ ] Prefix only in new → `new`; only in base → `removed`
- [ ] Rate up/down → `increased`/`decreased` with correct Δ / Δ%
- [ ] Sort order and per-category summary counts correct

**Known issues:** none currently tracked (pure read).
**Production notes:** read-only; no external side-effects.
**Future roadmap:** optionally diff intervals/effective dates, not just rate.

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ | N/A | 2026-07-11 |

## Open Questions
- [x] Diff categories & tie-breaking? — **Verified**: 5 categories, 1e-6 epsilon, fixed sort
- [ ] Should Compare also diff intervals/effective dates, not just rate? — **Pending** (product decision)

---

## 4. Module — Margin Analysis (deep, per-template) `[verified-in-code @ 482babb7]`

**Business objective** `[institutional]`: for a chosen product, show margin per
prefix = sell rate − vendor cost, so weak/negative-margin destinations surface.
`[Margin thresholds/policy are owner-defined.]`

**User workflow:** pick a sheet + a `productPrefix` → run Margin → review rows
classified healthy / low / negative, with summary counts.

**UI:** `pages/rate-manager.tsx`.
**API:** `POST /api/vendor-rates/margin-analysis` `{ sheetId, productPrefix }` →
`{ summary, rows }`.

**Workflow internals** `[verified-in-code]`: SQL joins `vendor_rate_sheet_rows`
(cost) `LEFT JOIN destination_product_rates` (sell) on
`vr.prefix = LTRIM(dpr.dial_prefix,'+')` for the given `product_prefix`. Computes
`margin = sell − cost` and `margin_pct`; orders negative-margin first, then low
(<10%), then healthy, unmatched (no sell) last. Summary =
`{ total, matched, negative, low, healthy, unmatched }`. **Read-only.**

**Classification** `[verified-in-code]`: negative = margin < 0; low = margin ≥ 0 and
margin_pct < 10; healthy = margin_pct ≥ 10; unmatched = no sell rate.

**Dependencies:** Vendor Rate Import (cost rows), Destination Catalog
(`destination_product_rates` sell rates), **Product Mapping resolver** for per-row
mapping provenance fields (`mappingMatchedPrefix`, `mappingStrategy`,
`mappingVersionId`, `destinationIdFromMapping`) — see §9; those fields are `null`
until Product Mapping is verified/active. **Consumed by:** Rate Manager UI.

**Rollback impact:** none — pure read.

**Test scenarios:**
- [ ] Row with sell>cost → healthy/low by pct; sell<cost → negative
- [ ] Row with no matching sell rate → unmatched, excluded from margin stats
- [ ] With a product selected, mapping-provenance fields populate (post-§9) without a `.trim()` crash
- [ ] Summary counts reconcile with row classifications

**Known issues:** mapping-provenance fields stay `null` until Product Mapping is
resolved — depends on **[VR-002](verification-register.md)**.
**Production notes:** read-only; margin thresholds (low<10%, healthy≥10%) are
hard-coded (see Open Questions).
**Future roadmap:** configurable margin thresholds `[institutional pending]`.

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ | ✓ | 2026-07-11 |

## Open Questions
- [x] Margin formula & thresholds in code? — **Verified**: sell−cost; low<10%, healthy≥10%
- [ ] Are the 10% / negative thresholds business-correct/configurable? — **Institutional Knowledge Required**

---

## 5. Module — Impact Analysis (deep, per-template) `[verified-in-code @ 482babb7]`

**Business objective** `[institutional]`: before activating a new sheet, estimate
the commercial exposure of its rate *increases* — which products and clients are
affected and by how much. `[The risk appetite / who reviews is owner policy.]`

**User workflow:** pick a new sheet (baseline auto-detected) → run Impact → review
per-prefix increases, affected products/clients, and per-client rollup.

**UI:** `pages/rate-manager.tsx`.
**API:** `POST /api/vendor-rates/impact-analysis` `{ newSheetId, baseSheetId? }` →
`{ hasBase, summary, increased, clientImpact }`. If `baseSheetId` omitted, the
current `active` sheet for the same vendor is auto-detected.

**Workflow internals** `[verified-in-code]`:
1. **Summary CTE** — FULL OUTER JOIN base vs new `vendor_rate_sheet_rows` →
   counts increased / decreased / new / removed prefixes.
2. **Impact CTE** — increased prefixes joined to `destination_product_rates` →
   `product_registry` (`pr.code`) → `customer_product_assignments` (active) →
   surfaces product code/name, sell rate, margin, margin_pct, and affected
   `customer_name` per prefix.
3. Aggregates into per-prefix → per-product → client sets; builds `clientImpact`
   (per-client affected prefixes, negative/low counts, worst margin).
4. Optional **vendor traffic context** (last 30 days from `margin_analytics_daily`,
   matched by vendor name) — non-fatal if unavailable. **Read-only.**

**Dependencies:** Vendor Rate Import, Destination Catalog, Product Registry,
`customer_product_assignments`, `margin_analytics_daily`, **Product Mapping
resolver** (provenance; §9). **Consumed by:** Rate Manager UI (the activation /
approval decision).

**Rollback impact:** none — pure read.

**Test scenarios:**
- [ ] No baseline (new vendor) → `hasBase:false`, still returns without error
- [ ] Increased prefix mapped to a product+client → appears in `increased` + `clientImpact`
- [ ] Vendor with no `margin_analytics_daily` rows → traffic context null, no crash
- [ ] With product selected → resolver provenance populated (post-§9), no `.trim()` crash

**Known issues:** resolver provenance depends on Product Mapping —
**[VR-002](verification-register.md)**.
**Production notes:** read-only; vendor traffic context uses a 30-day window from
`margin_analytics_daily` (non-fatal if absent).
**Future roadmap:** confirm/parametrise the 30-day traffic horizon `[institutional pending]`.

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ | ✓ | 2026-07-11 |

## Open Questions
- [x] Baseline auto-detection & join chain? — **Verified**: active sheet per vendor; dpr→registry→assignments
- [ ] Is 30-day traffic window the intended horizon? — **Institutional Knowledge Required**

---

## 6. Module — Approval Workflow (deep, per-template) `[verified-in-code @ 482babb7]`

**Business objective** `[institutional]`: activating a vendor rate sheet is a
governed action — a reviewer must approve before rates go live. `[Why some changes
require approval and the reviewer roles are owner policy.]`

**User workflow:**
```
imported sheet (ready) → request-activation → pending queue → reviewer decides
   approved → archive current active sheet (same vendor) → mark this sheet active
   rejected → sheet stays inactive, reason recorded
```
Direct activation (`POST /sheets/:id/activate`) bypasses the queue — an admin path.

**UI:** `pages/rate-manager.tsx` (request + approvals queue).

**API endpoints** (`server/routes-vendor-rates.ts`):
`POST /sheets/:id/request-activation` → `GET /approvals/pending` →
`POST /approvals/:id/decide` `{ decision: approved|rejected, reviewedBy, ... }`.
Also `POST /sheets/:id/activate` (direct).

**Workflow internals** `[verified-in-code]`:
- request-activation guards against a **duplicate pending request** for the same
  sheet (`operationType='vendor_rate_sheet.activate'`, `entityId=sheetId`,
  `status='pending'`) → `409` if one exists; else inserts an `approval_requests`
  row + an `approval_audit_log` `submitted` row.
- decide loads the pending request, sets its status, writes an `approval_audit_log`
  `approved`/`rejected` row; **on approve**: archives the vendor's current `active`
  sheet then marks the target sheet `active` (mirrors the direct-activate path).

**Database tables:** `approval_requests` (operationType, entityId, status
pending/approved/rejected, reviewedBy), `approval_audit_log` (submitted/approved/
rejected actions — **this module DOES keep a DB audit trail**, unlike Vendor
Import §2), `vendor_rate_sheets` (status).

**Dependencies:** Vendor Rate Import (produces the sheet). **Consumed by:** sheet
activation → all downstream rate consumers (Send Rate, by-destination, analytics).

**Related:** rate-notification jobs have a parallel approval cycle
(`routes-rate-notifications.ts`: submit-approval / approve / reject).

**Rollback impact:** approving flips which sheet is `active` for a vendor —
**Class C**. Reversible by re-activating the previously-archived sheet; the audit
log preserves history.

**Test scenarios:**
- [ ] request-activation twice on same sheet → second returns `409`
- [ ] approve → old active archived, new active; audit rows written
- [ ] reject → sheet not activated, reason in audit log
- [ ] direct activate produces same end state as approve

**Known issues:** none currently tracked.
**Production notes:** unlike Vendor Import, this **does** write a DB audit trail
(`approval_audit_log`). A parallel approval cycle exists for rate-notification jobs.
**Future roadmap:** define reviewer roles / dual-control policy `[institutional pending]`.

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ | ✓ | 2026-07-11 |

## Open Questions
- [x] Duplicate-request guard & audit writes? — **Verified**: 409 guard + approval_audit_log rows
- [ ] Which roles may decide, and is dual-control required? — **Institutional Knowledge Required**

---

## 7. Module — Send Rate / Push to Sippy (deep, per-template) `[verified-in-code @ 482babb7]`

> **Architectural boundary** `[institutional]`: **BitsAuto is the control/orchestration
> plane; Sippy is the execution plane.** Send Rate is where Commercial crosses that
> boundary — BitsAuto decides *what* rate to push; Sippy *applies* it. This module
> calls into `server/sippy.ts`, which is **frozen** (do not modify).

**Business objective** `[institutional]`: push an approved product rate into Sippy
tariffs for the relevant account(s).

**User workflow:** from Rate Manager, select a product rate → (pre-push check) →
push → per-account results shown; each attempt logged.

**UI:** `pages/rate-manager.tsx`.

**API endpoints** (`server/routes-rate-manager.ts`):
`POST /api/product-rates/:id/push-to-sippy` (role-guarded `admin`/`management`) —
auto-discovers account names from active `customer_product_assignments` when not
supplied in the body. Supporting: `POST /api/sippy/pre-push-check`,
`GET /api/sippy/rate-history`, `POST /api/sippy/rate-analysis-batch`,
`POST /api/rate-manager/jobs/:id/retry`, `GET /api/rate-manager/export`.

**Workflow internals** `[verified-in-code @ routes-rate-manager.ts:264-318]`:
resolves the rate + product (`trunkPrefix`); computes both
`fullPrefix = trunkPrefix + prefix` (commented "audit only, never sent to Sippy")
**and** `dialPrefix = sippy.resolveSippyPrefix(prefix, trunkPrefix)`; resolves
account names (explicit body list *or* auto-discovered from active assignments →
company names); loops accounts calling `sippy.pushRateToSippy(...)`; each attempt
logged to `rate_push_jobs`; per-account results returned.

**Services / external:** `server/sippy.ts` (`pushRateToSippy`, `resolveSippyPrefix`)
→ Sippy softswitch (portal CSV upload). **frozen dependency.**

**Database tables:** reads `product_rates`, `customer_product_assignments`,
`companies`, `product_registry`, `global_destinations`; writes `rate_push_jobs`
(and `product_rates` status).

**Approval flow:** rate should be approved (§6) before push; `POST /pre-push-check`
is the pre-flight.

**Sequence:**
```
UI → POST /api/product-rates/:id/push-to-sippy
  → load rate + product(trunkPrefix)
  → resolve accountNames (body | active customer_product_assignments)
  → for each account: sippy.pushRateToSippy({prefix, ratePerMin, ...})
       → server/sippy.ts → portal /admin/tariffs.php CSV upload (Action=AS)
  → log rate_push_jobs per attempt → return results[]
```

**Dependencies:** Approval, Product Registry (`trunk_prefix`), Destination Catalog,
`server/sippy.ts` (frozen). **Consumed by:** Sippy tariffs (external execution
plane).

**Rollback impact:** ⚠️ **writes to the external production Sippy switch** — the only
Commercial module with side-effects outside BitsAuto's DB. **Class D/E.** No
automatic rollback; reversal is a compensating push.

**Known issues:**
- 🔴 **`[C]` Prefix-rule conflict — see [Verification Register → VR-001](verification-register.md).**
  Code sends `fullPrefix`; LOCKED note says `dialPrefix`-only. Unresolved, needs
  L2/L3. (Investigation lives in the Register, not here.)
- The `accountIAccountMap` scope bug (fixed this session, commit `81adcfa1`) lived
  here — regression-test the explicit-accountNames path.

**Production notes** `[institutional — .agents/memory/sippy-rate-push-*]`:
- **Sippy has zero XML-RPC rate-write methods** — the only mechanism is portal CSV
  upload (`Action=AS` multipart POST). (`sippy-rate-push-api.md`)
- `ssp-root` is a **reseller**, portal-blocked from `/c1/rates.php`; the working
  path is `/admin/tariffs.php?action=edit_rates&i_tariff=N`. A separate rate-admin
  credential (`settings.sippy_rate_admin_user/pass`, e.g. RTST1) is required.
  (`sippy-rate-push-permissions.md`)
- Accounts resolve tariffs via **Service Plans (iBillingPlan)**, not direct
  iTariff. (`sippy-account-tariff-chain.md`)

**Future roadmap** `[institutional]`: verify prefix rule on Company-Rate-Push
(provision) and Multi-switch push paths (marked ⚠ pending in
`prefix-architecture-rule.md`).

**Test scenarios:**
- [ ] Push with explicit account list vs. auto-discovered → both resolve accounts
- [ ] pre-push-check surfaces conflicts before the push
- [ ] each account attempt logged to `rate_push_jobs`; retry works
- [ ] role guard rejects non-admin/management
- [ ] **prefix sent to Sippy is the bare telecom prefix, not the trunk-prefixed one** (settles the conflict)

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ | ✓ | 2026-07-11 |

*Open discrepancy:* **[VR-001](verification-register.md)** (prefix `fullPrefix` vs
`dialPrefix`) — PENDING production evidence.

## Open Questions
- [x] Account resolution + per-attempt logging? — **Verified**: explicit-or-auto, rate_push_jobs
- [ ] Does the push send `fullPrefix` or `dialPrefix`, and does prod accept it? — **Needs Production Evidence** (Level 2/3; = VR-001)
- [ ] Supported rollback / compensating-push procedure? — **Institutional Knowledge Required**

---

## 8. Module — Product Registry (deep, per-template) `[verified-in-code @ 482babb7]`

**Business purpose** `[institutional — .agents/memory/product-policy.md]`: products
are **commercial classes** (pricing/routing strategy), **not destinations**. The
internal `trunk_prefix` (1/2/6/7) is **routing-only and never exposed to
customers/partners**. Customers buy *destinations*; operations manage *products*.
The registry is the canonical product definition consumed across Rate Manager,
Destination Catalog, Billing, and notifications.

**Product model** `[institutional]`:
- Current seed `[verified-in-code]`: `CANONICAL_PRODUCTS` = FC/BC/SB/SC
  (`server/workspace-seed.ts`), trunk prefixes 1/2/6/7, `status:'commercial'`.
- Target `[institutional — product-variant-architecture.md, LOCKED]`: **9 fixed
  variants** (FC-W, BC-W, SB-W, SB-R, SC-W, SC-R, PM-R, BS-R, NP) adding
  `productClass`/`commercialType`/`productFamily`, replacing `segment`
  (Sprint C, pending — PM-R/BS-R trunk prefixes TBD from legacy sheets).

**Lifecycle** `[institutional — product-registry-hierarchy.md]`:
`draft → testing → commercial → deprecated → retired`. **Only `commercial` products
appear** in deal/auth/rate-generation flows — any customer-facing filter must check
`status='commercial'`. Codes (FC/BC/SB/SC) are immutable; names may change.

**Master-data hierarchy** `[institutional]`:
`Customer → Product → Destination → Routing Template → Pricing Template → Rate → Deal`.

**UI pages:** `pages/product-registry.tsx` (catalog + lifecycle stepper +
Assignments tab with DnD/Matrix toggle), `pages/deals.tsx`, `pages/rate-manager.tsx`.

**API endpoints:** `GET/POST/DELETE /api/product-registry/products`,
`.../assignments`, `.../customer-assignments`, `.../destinations*`, `.../history`;
routing/pricing templates + provisioning in `routes-product-templates.ts`.

**Services:** seed (`workspace-seed.ts`); Sippy accounts fetched live from
`/api/sippy/accounts` for the Customer Assignments tab.

**Database tables:** `product_registry`, `product_prefixes`,
`customer_product_assignments` (links Sippy `i_account`→`product_id`; soft-deleted
`status='inactive'`, reactivated on re-assign), `product_destination_assignments`,
`product_history`, `deals`, `deal_destinations`, `deal_approvals`.

**Workflow:** seed at startup (idempotent upsert) → products managed via catalog →
assigned to customers (`customer_product_assignments`) and destinations
(`product_destination_assignments`) → consumed by rate/deal flows when
`status='commercial'`.

**Dependencies:** `workspace-seed.ts` (canonical seed). **Consumed by:** Margin,
Impact, Send Rate, Destination Catalog, Product Mapping, rate-notifications,
call-governance (see [Dependency Matrix](dependency-matrix.md) — `product_registry`
is a **High-fan-out** table).

**Rollback impact:** **Class C/D.** Codes are immutable and High-fan-out — mutating
`code`/`id` ripples across most of Commercial. Seed is idempotent (conflict on
`code`); prefer the code seed over manual SQL (single source of truth).

**Known issues:** empty `product_registry` in prod (this session) — the code seed
runs at startup but its error is swallowed; root cause pending `[workspace-seed]`
runtime evidence (seed failing vs wrong DB). See §Volume-level Open Questions.

**Production notes** `[institutional]`: original seed used `status='active'`,
migrated to `'commercial'` via direct SQL; a new status value would require updating
`LIFECYCLE_STATES` in `product-registry.tsx`.

**Future roadmap** `[institutional]`: Sprint C — 9-variant migration
(add productClass/commercialType/productFamily, remove `segment`, seed 9 variants).

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ (table empty in prod — unresolved) | ✓ | 2026-07-11 |

## Open Questions
- [x] Lifecycle states & seed source? — **Verified/[institutional]**: draft→…→retired; code seed is SoT
- [ ] When does the 9-variant (Sprint C) migration land, and PM-R/BS-R trunk prefixes? — **Institutional Knowledge Required**
- [ ] Why is `product_registry` empty in prod? — **Needs Runtime Evidence** (`[workspace-seed]` log)

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

**Known issues:** blanket `commercial_status` mutation has wide blast radius (see
Rollback impact); no VR open.
**Production notes** `[institutional — destination-catalogue-commercial.md]`: billing
increment is a **destination-level** attribute (not product); Sprint B1 adds
`billing_increment_*` fields; Sippy increment push deferred to Sprint B2 audit.
**Future roadmap:** Sprint B1 enrichment fields; B2 Sippy increment push.

**Verification status:**
| Verified in code | Verified in runtime | Verified in production | Institutional | Last verified |
|:---:|:---:|:---:|:---:|:---:|
| ✓ | ✗ | ✗ | ✓ | 2026-07-11 |

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
