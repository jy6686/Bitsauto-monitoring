# STORY-007 — Vendor Rate Test Lab (Developer Mode)

- **Objective:** verify the Vendor Rate subsystem *in-platform* (one-click
  PASS/FAIL) instead of a serial Claude→owner→Claude manual loop. Long-term:
  a Developer Mode with a diagnostic page per subsystem.
- **Scope:** hidden Developer page + backend self-test endpoints. No change to
  production import/compare/margin/push behavior (diagnostic only).
- **Acceptance criteria (staged):**
  - **Slice 1 — Import self-test `[DONE, unmerged]`:**
    `GET /api/vendor-rates/dev/self-test` runs parse→map→validate against
    synthetic fixtures → PASS/FAIL per stage (sheet listing, auto-detect,
    sheetIndex, duplicate headers, mapping independence, blank cols, validation).
    Pure, unit-tested (`routes-vendor-rates-parse.test.ts`, overall PASS).
    Branch `fix/vendor-import-column-mapping` (`2b26d492`).
  - **Slice 2 — Developer page:** render the self-test results with PASS/FAIL/WARN
    badges under `Developer → Vendor Test Lab`.
  - **Slice 3 — DB stages:** import→DB rows, row-count match, compare, margin
    (needs a live DB / test vendor + teardown).
  - **Slice 4 — Push Test / Repository Test** harnesses (dry-run, prefix
    resolution, clone/activate/archive) — after their STORYs.
- **Dependencies:** Slice 1 none; Slice 3 needs DB test-fixture strategy.
- **Status:** Framework **FROZEN v1.0** (Registry/Runner/Fixtures/Baselines done, spec at ../../test-lab/001-framework.md). Next = ADD tests; UI later.
  Slices 2-4 not started.
- **Owner:** Commercial / Platform.
- **Verification:** Slice 1 vitest PASS + build clean; runtime = hit the endpoint.
- **Related Bug(s):** BUG-001, BUG-002, BUG-003 (the self-test validates them).
- **Related ADR:** [ADR-004](../../decisions/ADR-004-vendor-import.md).
- **Related VR:** VR-003.
- **Sequencing:** owner priority — build the Test Lab (this STORY) right after the
  BUG gate, before more commercial features.
