# Vendor Rates — Subsystem Home

Consolidated entry point for everything Vendor-Rate. **Links, not copies** — the
canonical content lives in the shared engineering docs; this page just gathers the
Vendor-Rate slices so they aren't scattered.

## Design & reference
- **Handbook (functional modules):** [Volume 1 §§2-9](../VOLUME-1-commercial.md) —
  Vendor Import, Compare, Margin, Impact, Approval, Send Rate, Product Registry,
  Destination Catalog, Product Mapping.
- **Dependency Matrix:** [dependency-matrix.md](../dependency-matrix.md).
- **Decisions (ADRs):** [ADR-004 Vendor Import](../decisions/ADR-004-vendor-import.md),
  [ADR-005 Product Registry](../decisions/ADR-005-product-registry.md),
  [ADR-001 Prefix](../decisions/ADR-001-product-prefix.md),
  [ADR-003 Send Rate boundary](../decisions/ADR-003-send-rate-boundary.md).

## Work & status
- **Backlog:** [backlog/vendor-rates/](../backlog/vendor-rates/) (BUG-001..004, STORY-001..006).
- **Bug Register (implementation):** [bug-register.md](../bug-register.md).
- **Verification Register (platform):** [verification-register.md](../verification-register.md)
  — VR-001 (Send Rate prefix), VR-002 (mapping tables), VR-003 (sheet detection).

## Current state (2026-07-11)
- **Sprint 1 (Import Engine) — FROZEN** until BUG-001/003/004 validated.
- BUG-001 fix ready (branch `fix/vendor-import-column-mapping`), awaiting 6-vendor matrix.
- STORY-003/004 blocked on VR-002; STORY-006 blocked on VR-001.

> `architecture.md` / `workflow.md` / `database.md` / `api.md` are intentionally
> **not duplicated here** — that content is the handbook §§2-9 and the dependency
> matrix. This README is the index into them.
