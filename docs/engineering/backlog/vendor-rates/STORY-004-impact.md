# STORY-004 — Impact Analysis (Sprint 3)

- **Objective:** estimate commercial exposure of a new sheet's rate increases.
- **Scope:** `POST /api/vendor-rates/impact-analysis` + UI. Handbook §5.
- **Acceptance criteria:** per-prefix increases, product exposure, client exposure,
  estimated monthly impact, before/after comparison, executive summary.
- **Dependencies:** Import Engine; Product Registry; Product Mapping (VR-002);
  `margin_analytics_daily` for traffic context.
- **Status:** **PARTIAL** — summary/impact/clientImpact/vendor-traffic implemented;
  revenue-at-risk + executive summary TBD.
- **Owner:** Commercial.
- **Verification:** §5 verified-in-code; provenance pending VR-002.
- **Related Bug(s):** none.
- **Related ADR:** [ADR-005](../../decisions/ADR-005-product-registry.md).
- **Related VR:** VR-002.
