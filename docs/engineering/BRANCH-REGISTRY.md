# Branch Registry & Reconciliation Report

| Field | Value |
|-------|-------|
| Purpose | Permanent source of truth for every branch — replaces chat history |
| Status | ACTIVE (living) — **documentation only** |
| Last verified | 2026-07-11 @ `origin/main` = `8f1972d1` |

> **No merges, deletions, or force-pushes performed.** This is a review artifact.
> Execution happens only after the owner reviews this registry.
> PR status: none have open PRs (the read-only GitHub integration can't create them;
> owner opens PRs via the compare links).

## Registry (summary)

| Branch | Type | Capability / Subsystem | Status | Depends On | Runtime validation | Merge order | Recommendation |
|--------|------|------------------------|--------|------------|:---:|:--:|----------------|
| `docs/engineering-handbook` | Docs | Engineering system | Ready | none | No | **1** | **Merge** (after final review) |
| `fix/vendor-import-column-mapping` | Code | CAP-001 · BUG-001 | Waiting | none | **Yes** | **2** | **Hold** until validated |
| `feature/vendor-test-lab` | Platform | Test Lab v1.0 | Waiting | BUG-001 branch (stacked) | **Yes** | **3** | **Hold** until BUG-001 merges |
| `fix/product-mapping-urls-and-resolver-calls` | Code | CAP-001 · Product Mapping | Review | VR-002 evidence | **Yes** | **4** | **Hold / Review** |
| `fix/revenue-rate-manager-smoke` | Code | early fixes | **Merged** | — | — | — | **Archive** (already in main) |
| `feature/commercial-engine-integration` | Code | superseded | Stale | — | — | — | **Archive** (behind 13; 1 old commit) |

## Per-branch detail

### 1. `docs/engineering-handbook`  — **Merge order 1**
- **Purpose:** the entire engineering system (Handbook, ADRs, Capability Dossiers,
  Business Inventory, Dependency Matrix, Verification/Bug Registers, Test Lab docs,
  PFR methodology, this registry).
- **Base:** `main` · **Ahead/Behind:** +23 / −0 · **Files:** 46 (all `docs/`).
- **Depends on:** none. **Runtime validation:** No (docs-only, zero prod risk).
- **Recommendation:** Merge — but owner wants one final review first (no urgency).

### 2. `fix/vendor-import-column-mapping`  — **Merge order 2**
- **Purpose:** CAP-001 BUG-001 — duplicate column-header uniquification in `parseFile`.
- **Base:** `main` · **Ahead/Behind:** +2 / −0 · **Files:** `server/routes-vendor-rates.ts`, `routes-vendor-rates-parse.test.ts`.
- **Depends on:** none. **Runtime validation:** **Yes** — 6-vendor matrix (BUG-001) + self-test run.
- **Recommendation:** Hold until validated, then merge (first code branch).

### 3. `feature/vendor-test-lab`  — **Merge order 3**
- **Purpose:** Test Lab v1.0 (Self-Test Registry, Runner, Fixture Library, baselines).
- **Base:** `fix/vendor-import-column-mapping` (**stacked** — needs its exports) ·
  **Ahead/Behind vs main:** +5 / −0 · **Files:** 15 (`server/dev/*`, `.gitignore`).
- **Depends on:** BUG-001 branch (merge #2 first). **Runtime validation:** Yes (run the endpoint).
- **Recommendation:** Hold; merge after BUG-001.

### 4. `fix/product-mapping-urls-and-resolver-calls`  — **Merge order 4**
- **Purpose:** CAP-001 Product Mapping — frontend API prefix fix, resolver call
  signature/field fixes, startup `init()`, **+ removal of a committed GitHub PAT**.
- **Base:** `main` · **Ahead/Behind:** +4 / −0 · **Files:** `ProductMappingTab.tsx`,
  `server/index.ts`, `server/routes-vendor-rates.ts`, and the leaked-token
  `attached_assets/…txt` (deletion).
- **Depends on:** VR-002 (does the mapping tables exist in prod?) for full function.
- **Note:** the leaked-token file removal exists **only here** — still present in
  `main`. Token was rotated; file cleanup pending this merge.
- **Recommendation:** Hold / Review — merge after Product Mapping runtime evidence.

### 5. `fix/revenue-rate-manager-smoke`  — Merged
- Merged into `main` (behind 21 / ahead 0). **Recommendation:** Archive (tag/leave),
  delete only after owner confirms nothing references it.

### 6. `feature/commercial-engine-integration`  — Stale
- Behind 13 / ahead 1 (`b86fac28` — an old 11-line `routes-vendor-rates.ts` edit,
  superseded by the resolver work already in main). **Recommendation:** Archive.

## Merge sequence (only after review — not executed)
1. `docs/engineering-handbook` (docs)
2. `fix/vendor-import-column-mapping` (BUG-001) — after runtime validation
3. `feature/vendor-test-lab` (Test Lab) — after #2
4. `fix/product-mapping-urls-and-resolver-calls` — after Product Mapping evidence
5. Archive `fix/revenue-rate-manager-smoke`, `feature/commercial-engine-integration`
6. Delete stale branches **only** after CAP-001 is production and nothing references them.

## Rules
- Each branch maps to exactly one capability or one engineering subsystem (above).
- No new development branch opens until this registry is reconciled.
- Update this file when a branch is created, merged, or archived.
