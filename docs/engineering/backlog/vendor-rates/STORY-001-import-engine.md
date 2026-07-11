# STORY-001 — Import Engine (Sprint 1)

- **Objective:** upload any vendor Excel sheet and import it correctly without manual fixes.
- **Scope:** upload → preview → sheet select → column mapping → validation → import →
  DB rows. `VendorSheetUploader.tsx`, `routes-vendor-rates.ts`.
- **Acceptance criteria:**
  - BUG-001..004 closed.
  - Then enhancements: Excel serial dates, validation messages, error messages,
    import summary, progress indicator.
- **Dependencies:** **BUG-001, BUG-002, BUG-003, BUG-004 must be closed first**
  (Sprint 1 frozen — no enhancements until then).
- **Status:** **IN PROGRESS** — blocked on BUG-001 real-file validation + BUG-003/004
  runtime reproduction.
- **Owner:** Commercial.
- **Verification:** per-bug (see BUG files); enhancements unit-tested like BUG-001.
- **Related Bug(s):** BUG-001..004.
- **Related ADR:** [ADR-004](../../decisions/ADR-004-vendor-import.md).
- **Related VR:** VR-003.
