# Platform Feature Review (governance project)

A **separate** governance workstream from Vendor Rates. Goal: a complete catalog of
the platform's features and a duplicate-candidate analysis — **analysis only**.

## Hard guardrails
- **No feature is hidden. No feature is disabled. No feature is deleted.**
- This project produces *documents*, not code or config changes.
- Any consolidation/retirement happens **only** after owner review, as its own
  governed change (eight-question gate + evidence).

## Workflow
```
Feature Inventory → Business-Purpose Review → Technical-Dependency Review
   → Duplicate-Candidate List → Owner Review → Merge Proposal → Implementation
```

## Artifacts
| Doc | Purpose | State |
|-----|---------|-------|
| [feature-inventory.md](feature-inventory.md) | Complete catalog (nav + pages) `[V]` | Started |
| [duplicate-candidates.md](duplicate-candidates.md) | Overlap candidates for owner review | Started |
| business-purpose.md | Why each feature exists `[institutional]` | Not started (owner input) |
| dependency-review.md | Tech dependencies per feature `[V]` | Not started |
| merge-proposals.md | Proposals — only after owner review | Not started |

## Source of truth
Feature grouping = `client/src/components/app-nav-shell.tsx` `DOMAINS[]`
(**11 domains, 146 feature links**; ~150 client pages). This is the authoritative
nav catalog per the platform's top-nav rule.
