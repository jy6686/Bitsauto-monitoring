# Platform Architecture Review — Methodology (FROZEN v1.0)

| Field | Value |
|-------|-------|
| Status | **FROZEN v1.0** (2026-07-11) — apply across all features; don't evolve mid-inventory |
| Scope | Analysis only. **No feature hidden, disabled, merged, or deleted** without explicit owner approval per entry. |

> This is a **Platform Architecture Review**, not "duplicate cleanup." It separates
> five concepts that are usually conflated — mixing them causes accidental removals:
>
> **Same business capability ≠ Same API namespace ≠ Same write workflow ≠ Same UI ≠ True duplicate.**

## 1. Classification (use these, not "duplicate")

| Class | Meaning |
|-------|---------|
| **Alias** | Same page, different navigation entry |
| **View** | Different presentation of the same capability |
| **Consumer** | Uses another module's data (read dependency) |
| **Extension** | Adds functionality on top of another |
| **Candidate** | Possible merge — needs review |
| **Duplicate** | Truly redundant |

## 2. Confidence (per pair)
High · Medium · Low · Informational. Confidence is about *evidence strength*, not
about whether to merge.

## 3. Merge Complexity score (implementation effort, set before any decision)

| Score | Meaning |
|-------|---------|
| **A** | Navigation only |
| **B** | UI merge |
| **C** | Shared APIs |
| **D** | Database |
| **E** | Platform-wide |

## 4. Structured review template (every review ends this way)

```
# Review — <ID>: <A> ↔ <B>
Classification: <Alias/View/Consumer/Extension/Candidate/Duplicate>
Confidence: <High/Medium/Low/Informational>   Complexity: <A-E>   Decision: Pending

## Current State      — what exists (paths, components, registry groups, roles)
## Evidence           — [V] code facts (file:line): shared APIs, shared write workflow, UI
## Business Risk      — impact on users/commercial workflows if changed
## Technical Risk     — blast radius (from DEPENDENCY-MATRIX), data/write coupling
## Possible Futures   — Keep · Alias · Merge · Deprecate (with trade-offs)
## Recommendation     — engineering recommendation (facts → suggestion)
## Decision           — Pending  (owner-only; separates facts from business decision)
```

Separation rule: **engineering states facts and a recommendation; the owner makes
the decision.** A review never merges or deactivates anything.

## 5. Evidence bar (the "shared APIs ≠ duplicate" test)
A pair is only a real *Duplicate/Candidate* if it shares **workflow** (same
write operations on the same endpoints), not merely **data** (shared reads). Record
explicitly: Shared APIs? · Shared write workflow? · Shared UI? · Duplicate? (Unknown
until reviewed).

## 6. Governance sequence
Inventory → purpose verification → overlap analysis → joint review → **owner
approval** → merge/retirement plan → regression testing → production validation →
deactivate/archive (only after approval).

### 6.1 Duplicate-stays-Active rule (PERMANENT)

> **A feature identified as a duplicate remains Active until an owner-approved
> consolidation plan has been documented, implemented, validated, and released.**

"Duplicate" is a *classification for review*, never an instruction to remove. No
feature is hidden, deactivated, renamed, or removed — and no menu entry changes —
until all four gates pass in order: **documented → implemented → validated →
released.** Until then every candidate feature stays fully available.

## 7. Artifacts (this project = a first-class subsystem)
FEATURE-INVENTORY · DUPLICATE-ANALYSIS · DEPENDENCY-MATRIX ·
[CANONICAL-CAPABILITY-MATRIX](CANONICAL-CAPABILITY-MATRIX.md) · REVIEW-DUP-NNN ·
this METHODOLOGY. Alongside the Handbook, Registers, Backlog, and Test Lab.

> Methodology frozen: from here, **review features against this fixed process** —
> don't change the rules halfway through the inventory.
