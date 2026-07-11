# STORY-003 — Margin / Commercial Intelligence (Sprint 3)

- **Objective:** surface margin and commercial risk per product/prefix.
- **Scope:** `POST /api/vendor-rates/margin-analysis` + UI. Handbook §4.
- **Acceptance criteria:** Compare · Margin · Revenue-at-risk · Product exposure ·
  Client exposure. Margin classification (negative/low<10%/healthy).
- **Dependencies:** Import Engine (data); Product Mapping resolver for provenance
  (blocked on **VR-002**).
- **Status:** **PARTIAL** — margin analysis implemented; exposure/revenue-at-risk TBD.
- **Owner:** Commercial.
- **Verification:** §4 verified-in-code; provenance pending VR-002.
- **Related Bug(s):** none.
- **Related ADR:** [ADR-005](../../decisions/ADR-005-product-registry.md).
- **Related VR:** VR-002.
