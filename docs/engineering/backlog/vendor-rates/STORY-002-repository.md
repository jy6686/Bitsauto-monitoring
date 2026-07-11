# STORY-002 — Vendor Sheet Repository (Sprint 2)

- **Objective:** full lifecycle management of uploaded vendor sheets.
- **Scope:** sheet list/detail, states, versioning. `routes-vendor-rates.ts` (sheets*),
  vendor-sheets feature UI.
- **Acceptance criteria & gap analysis `[V @ schema + routes-vendor-rates.ts]`:**
  | Feature | State | Blocker |
  |---------|-------|---------|
  | Draft / Active / Archive | ✅ `status` column exists; `activate` archives current active | none — UI/filter work only |
  | Activation history | ✅ `activatedAt`/`activatedBy` columns exist | none |
  | Clone sheet | 🟢 buildable (copy rows → new sheet); no schema change | none |
  | Filtering by state | 🟢 buildable | none |
  | **Download original file** | 🔴 **BLOCKED** | `vendor_rate_sheets` does **not** store the file — upload discards base64 after parsing. Needs a schema change to persist it (**Class D**). |
  | **Version history** | 🔴 **BLOCKED** | no version table/column; needs schema (**Class D**). |
- **Dependencies:** STORY-001 stable; download-original + version-history need a
  **schema decision (Class D, DB evidence + rollback)** before build.
- **Status:** **PARTIALLY UNBLOCKED** — Draft/Active/Archive/Clone/filter are safe
  to build (own branch, unmerged, Replit-tested); the two 🔴 items are blocked.
- **Owner:** Commercial.
- **Verification:** TBD.
- **Related Bug(s):** none yet.
- **Related ADR:** [ADR-004](../../decisions/ADR-004-vendor-import.md).
- **Related VR:** none.
