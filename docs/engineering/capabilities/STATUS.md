# Capability Status Dashboard

| Field | Value |
|-------|-------|
| Purpose | Executive view of where each capability stands — without digging into individual bugs/stories |
| Status | ACTIVE (living) — update as capabilities progress |
| Last verified | 2026-07-11 |

Bars: █ done · ░ remaining. Completion is an honest estimate; only capabilities with
a dossier are scored — others are **Not assessed** (no fabricated numbers).

## Capabilities
| ID | Capability | Status | Completion |
|----|-----------|--------|-----------:|
| [CAP-001](CAP-001-vendor-rate-management.md) | Vendor Rate Management | In Progress | ~45% |
| CAP-002 | Destination Catalog | Not assessed | — (dossier when active) |
| CAP-003 | Product Registry | Not assessed | — |
| CAP-004 | Finance | Not assessed | — |
| CAP-005 | Routing | Not assessed | — |
| CAP-006 | Security | Not assessed | — |

## CAP-001 — Vendor Rate Management (detail)
```
Documentation  ██████████  ~90%   dossier + handbook §§2-9 complete
Development    ██████░░░░  ~60%   import/compare/margin live; impact/approval/push partial; mapping blocked (VR-002)
Testing        ███░░░░░░░  ~35%   parser unit tests + fixtures done; integration/e2e not run
Production      ██░░░░░░░░  ~20%   blocked on BUG-001/003/004 + VR-001/002
```
**Gating (Phase 1):** BUG-001 (fix ready, real-file validation), BUG-003 & BUG-004
(runtime reproduction). See [CAP-001 dossier](CAP-001-vendor-rate-management.md).

> Score a new capability only when its dossier exists (per the frozen model:
> Dossier → Backlog → Implementation → Self-tests → Validation → Release → update
> Dossier). Don't pre-fill CAP-002+ with guessed percentages.
