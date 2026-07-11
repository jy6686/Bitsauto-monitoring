# Bug Register (implementation)

| Field | Value |
|-------|-------|
| Purpose | Track **implementation / UI bugs** through root cause → fix → validation → merge |
| Scope | Distinct from the [Verification Register](verification-register.md) (platform/architectural). |
| Status | ACTIVE (living) |
| Last verified | 2026-07-11 |

> A bug is **Closed** only after its fix is validated (tests + real-world/runtime
> evidence) and merged. Until then: Open / Fix Ready / Validating.

## Register (summary)

| ID | Subsystem | Title | Status | Branch |
|----|-----------|-------|--------|--------|
| BUG-001 | Vendor Import | Duplicate column-header mapping collision | **FIX READY — real-file validation pending** | `fix/vendor-import-column-mapping` |
| BUG-002 | Vendor Import | Header-row detection = most-filled row (merged-header edge) | **OPEN — observation** | — |
| BUG-003 | Vendor Import | Sheet selection end-to-end (T&C imported instead of Pricing) | **OPEN — needs runtime reproduction on current deploy** | — |
| BUG-004 | Destination Catalog | "Apply" / destinations load before a selection | **OPEN — needs runtime reproduction on current deploy** | — |

---

## BUG-001 — Duplicate column-header mapping collision
- **Root cause `[V]`:** mapper keys state by header text (`wMap[h]`, `key={h}`);
  `parseFile` uniquified only *empty* headers. Two columns sharing a name (e.g. two
  "Rate") shared one key → selecting one changed the others; server `applyMap`
  `colIdx[h]` became last-wins.
- **Fix:** `parseFile` uniquifies **all** headers (first keeps name; dupes→`_2`/`_3`;
  empties→`col_<i>`). Commits `079ee08d`, `2ef1ba90`.
- **Tests:** ✓ unit `server/routes-vendor-rates-parse.test.ts` (4/4 — dup / blank /
  merged-remainder / triple / multi-sheet selection).
- **Real-file validation (required before Closed):**

  | Vendor | Correct sheet | Correct header | Dup headers | Dates | Prefixes | Row count = Excel | Margin works |
  |--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
  | QuickComm | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
  | Telstra   | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
  | Tata      | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
  | BICS      | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
  | HGC       | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
  | OTEGlobe  | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

- **Status:** **FIX READY** — merge only after the matrix passes.

## BUG-002 — Header-row detection is "most-filled row"
- **Finding `[V]`:** `parseFile` picks the row with the most non-empty cells as the
  header. A heavily **merged/blank header row** can be mis-detected when a data row
  has more populated cells (surfaced by the BUG-001 unit test).
- **Impact:** low-frequency; sheets with sparse/merged headers.
- **Status:** **OPEN — observation** (candidate: content/position-aware detection).

## BUG-003 — Sheet selection end-to-end
- **Symptom (screenshots):** workbook with Sheet 1 = Terms & Conditions, Sheet 3 =
  Pricing; importer read Terms & Conditions.
- **Code trace `[V]`:** preview honours `sheetIndex` → import honours `sheetIndex` →
  UI sends it; picker + keyword auto-detect exist. **No code path found where import
  ignores the selected sheet.**
- **Still open because:** code-correct ≠ workflow-verified. Possible causes: deploy
  behind `main`; Pricing sheet not keyword-named (auto-detect misses → VR-003); UI
  resets selection. **Needs runtime evidence** on the current deploy: upload →
  Preview → pick Sheet 3 → Import → confirm **DB rows match the Pricing sheet**.
- **Status:** **OPEN** — do not close until imported rows match the selected sheet.

## BUG-004 — "Apply" / destinations load before selection
- **Symptom (screenshots):** every destination code loaded before any destination
  was selected.
- **Code trace `[V]`:** "Apply rates to product" is gated
  (`disabled={!selectedProduct}`); by-destination panels take `destId` as a prop.
  **No ungated all-destinations query found on mount** (file is 3.8k lines — not
  exhaustively ruled out).
- **Needs runtime evidence:** Network tab on page load — which API fires before any
  selection, which query has `enabled:true`, which component renders pre-selection.
- **Status:** **OPEN** — reproduce on current deploy before fixing.
