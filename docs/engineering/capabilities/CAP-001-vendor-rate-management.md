# CAP-001 — Vendor Rate Management

| Field | Value |
|-------|-------|
| Capability | **CAP-001** Vendor Rate Management |
| Domain | **DOM-009** Products |
| Owner | Commercial |
| Maturity | **Partial** (Sprint 1 Import Engine active; downstream partial) |
| Verified | 2026-07-11 @ commit `448af73b` (facts) |

> The single authoritative document for this capability — the template for all
> others. Aggregates existing artifacts by reference; does not duplicate them.

## Business purpose `[institutional — ADR-004/005, product-policy]`
Turn heterogeneous vendor rate sheets into destination-matched, queryable rate data;
compare/analyse margin and commercial exposure; govern which rates go live; and push
approved rates to the Sippy switch. Products are commercial classes (trunk-prefix
internal, never customer-facing). See [ADR-004](../decisions/ADR-004-vendor-import.md),
[ADR-005](../decisions/ADR-005-product-registry.md), [ADR-001](../decisions/ADR-001-product-prefix.md),
[ADR-003](../decisions/ADR-003-send-rate-boundary.md).

## Feature inventory
| ID | Feature | Handbook | Maturity |
|----|---------|----------|----------|
| FEAT-0001 | Vendor Import | [§2](../VOLUME-1-commercial.md) | Live (BUG-001 fix pending validation) |
| FEAT-0002 | Compare Rates | §3 | Live |
| FEAT-0003 | Margin Analysis | §4 | Live |
| FEAT-0004 | Impact Analysis | §5 | Partial |
| FEAT-0005 | Approval Workflow | §6 | Partial |
| FEAT-0006 | Send Rate / Push to Sippy | §7 | Partial (VR-001 open) |
| FEAT-0007 | Vendor Repository | STORY-002 | Partial (2 items Class-D blocked) |
| FEAT-0008 | Product Registry | §8 | Live (prod seed issue) |
| FEAT-0009 | Destination Catalog | §8a | Live |
| FEAT-0010 | Product Mapping | §9 | **Pending Verification** (VR-002) |

## Technical inventory `[V]`
- **UI:** `features/vendor-sheets/VendorSheetUploader.tsx`, `features/product-mapping/ProductMappingTab.tsx`, `pages/rate-manager.tsx`, `pages/product-registry.tsx`, `pages/destination-catalog.tsx`, `pages/deals.tsx`.
- **APIs:** `routes-vendor-rates.ts`, `routes-rate-manager.ts`, `routes-product-mapping.ts`, `routes-product-templates.ts`, `routes-rate-notifications.ts`; destination-catalog/product-registry endpoints in `routes.ts`.
- **Services:** `services/destination/destination-matcher.service.ts`, `services/commercial/product-mapping-resolver.ts`, `services/vendor-prefix-parser`, `server/sippy.ts` (**frozen**).
- **Tables:** `vendor_rate_sheets`, `vendor_rate_sheet_rows`, `vendor_rate_normalized_prefixes`, `vendor_column_maps`, `canonical_vendors`, `product_registry`, `product_prefixes`, `destination_product_rates`, `global_destinations`, `customer_product_assignments`, `approval_requests`, `approval_audit_log`, `rate_push_jobs`, `deals`; **missing in prod:** `product_mapping_versions`/`product_destination_mappings`/`product_mapping_active_config` (VR-002).

## Dependencies (blast radius)
See [DEPENDENCY-MATRIX.md](../dependency-matrix.md). High-fan-out tables:
`product_registry`, `global_destinations`. Frozen dependency: `server/sippy.ts`.

## Test coverage
[Test Lab](../test-lab/coverage-matrix.md): Vendor Parser ✅ (7 unit + fixtures);
Import ⚠ (integration declared); Repository/Margin/Impact/Approval/Push ❌ planned.
`GET /api/dev/self-test?module=Vendor%20Rates`.

## Bug Register
[BUG-001](../bug-register.md) dup headers (fix ready) · BUG-002 header detection ·
BUG-003 sheet selection (runtime) · BUG-004 Apply load (runtime).

## Verification Register
[VR-001](../verification-register.md) Send Rate prefix (`[C]`) · VR-002 Product
Mapping tables · VR-003 sheet detection.

## Backlog
[STORY-001](../backlog/vendor-rates/STORY-001-import-engine.md) Import (Sprint 1,
frozen) … STORY-007 Test Lab. BUG-001..004.

## Roadmap
Sprint 1 Import Engine (frozen until BUG-001/003/004) → Repository → Margin/Impact →
Approval → Push. STORY-003/004 blocked on VR-002; STORY-006 on VR-001.

## Duplicate analysis
Product Mapping resolver provenance feeds Margin/Impact (Consumer, not duplicate).
No intra-capability duplicates flagged; see PFR [capability matrix](../platform-feature-audit/CANONICAL-CAPABILITY-MATRIX.md).

## Acceptance criteria (capability-level)
Upload any vendor sheet → correct sheet/headers → DB rows match → compare/margin/
impact work → approval governs activation → push applies to Sippy (bare dial prefix).

## Open Questions
- [ ] Close BUG-001/003/004 (runtime) → unfreeze Sprint 1
- [ ] VR-001 / VR-002 (production evidence)
- [ ] `product_registry` empty-in-prod (`[workspace-seed]` log)
- [ ] Confirm DOM-009 vs Finance placement for this capability — `[V]` minor
