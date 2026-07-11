# STORY-006 — Push Engine (Sprint 5)

- **Objective:** push approved rates to Sippy safely (after approval only).
- **Scope:** `push-to-sippy`, pre-push-check, push jobs. Handbook §7.
- **Acceptance criteria:** destination/product selection, dry run, push queue,
  progress, verification, rollback (compensating push).
- **Dependencies:** Approval (STORY-005); `server/sippy.ts` (frozen).
- **Status:** **PARTIAL** — per-account push + rate_push_jobs logging implemented;
  dry-run/queue/progress/rollback TBD. **Blocked on VR-001** (prefix fullPrefix vs
  dialPrefix) before further push work.
- **Owner:** Commercial.
- **Verification:** §7 verified-in-code; **VR-001 must be resolved first**.
- **Related Bug(s):** none.
- **Related ADR:** [ADR-001](../../decisions/ADR-001-product-prefix.md), [ADR-003](../../decisions/ADR-003-send-rate-boundary.md).
- **Related VR:** VR-001.
