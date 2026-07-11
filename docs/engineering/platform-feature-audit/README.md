# Platform Feature Rationalization (PFR) — Audit

**Status:** Phase 1 (Discovery) — inventory + duplicate candidates generated, awaiting review.
**Rule:** Nothing is merged, hidden, deactivated, archived, or removed until the corresponding entry is explicitly approved. Every decision starts as **Pending**.

## Documents

| Document | Contents |
|---|---|
| [FEATURE-INVENTORY.md](./FEATURE-INVENTORY.md) | Master catalog of all 111 registered features (109 configurable in Navigation Manager + 2 locked): business capability, system of record (API namespace), canonical-owner heuristic, path, page component, size, backend APIs + write operations, roles, flags. |
| [DUPLICATE-ANALYSIS.md](./DUPLICATE-ANALYSIS.md) | Duplicate-candidate register with confidence levels (High/Medium/Low/Informational) and the shared-APIs vs shared-workflow distinction: 8 machine-detected overlaps + 11 curated capability clusters. All decisions Pending. |
| [DEPENDENCY-MATRIX.md](./DEPENDENCY-MATRIX.md) | Blast-radius view: namespace → candidate owner → consumers, plus per-feature depends-on / shared-with. Consult before planning any merge or retirement. |
| [REVIEW-DUP-001.md](./REVIEW-DUP-001.md) | Structured review: AI Ops Center ↔ Decision Overlay (same page; `?tab=` deep link confirmed dead). Recommendation drafted, decision Pending. |
| [REVIEW-DUP-002.md](./REVIEW-DUP-002.md) | Structured review: NOC Command ↔ Ops Console (strict API subset + identical write workflow). Recommendation drafted, decision Pending. |

## Source of truth

The feature registry is `SIDEBAR_GROUPS` in `client/src/components/layout-shell.tsx` (marked MAINTENANCE-ONLY / frozen). Routes come from `client/src/App.tsx`; API usage is extracted per page file.

## Regenerating

```sh
node tools/extract-features.mjs features.json
node tools/gen-audit-docs.mjs FEATURE-INVENTORY.md DUPLICATE-ANALYSIS.md   # run from tools/ dir with features.json present
```

Extraction is read-only; regeneration overwrites the two generated documents (manual annotations belong in review notes, not in the generated tables).

## Governance sequence

Inventory → purpose verification → overlap analysis → joint review → approval → merge/retirement plan → regression testing → production validation → deactivate/archive (only after approval).
