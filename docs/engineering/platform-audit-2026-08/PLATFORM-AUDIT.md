# BitsAuto Platform Audit — Consolidated Report

> **Date:** 2026-08-28 · **Branch:** feature/portal-framework @ c969a8f7
> **Method:** four parallel read-only deep-dive audits (Security, Stability, Reports/Data-Integrity, Capability/Architecture) over the root checkout. Every finding cites `file:line` evidence the auditor actually read.
> **Governance:** discovery only. **Nothing was changed, hidden, merged, or deactivated.** Every remediation is a recommendation with decision **Pending**, consistent with PFR governance.

---

## 1. Executive summary

The platform has a **strong outer shell and a soft, inconsistent interior**. The engineering that is recent and deliberate is genuinely good — process crash guards, the file-migration runner, UTC-locked billing periods, gap/completeness detection that honestly reports `no_reference` instead of faking a pass, Sippy timeouts, and client WebSocket backoff. The risk is concentrated in three interior layers:

1. **Access control (Security).** The perimeter is well built (helmet+CSP, scrypt hashing, correct cookie flags, rate-limited login, no SQL injection). But authorization is enforced inconsistently: ~157 state-mutating endpoints have **no server-side role check**, including *create/delete Sippy tariffs & rates* and *invoice approve/void/mark-paid*. A live Sippy admin password is hardcoded in source and in six tracked `.bak` files, and a full-source ZIP endpoint (including `.env`) is gated by login only. MFA exists but is never enforced.

2. **Financial truth (Reports).** There are **seven** financial/minutes pipelines that can disagree on the same question, and most "verification" layers compare a number against itself. The DMR marks every row verified before comparing, the invoice has three renderers on two money bases (one documented as over-reporting up to 60×, with the corrected engine written but **not wired in**), per-client margin is an allocation artifact identical for every client, and both "reconciliation" surfaces largely self-compare. This is the layer most likely to present a *plausible wrong number as correct*.

3. **Architecture coherence (Capability).** There are **five** live navigation/feature registries, not the three previously known. The DB-driven portal framework being built binds only 75 of ~174 module keys, so seeded Finance/Admin/KAM portal URLs 404 today. 13 client API paths hit endpoints the server never mounts; 157 served paths have no client consumer. RBAC, approvals, auth, and the portal framework itself have **zero automated tests**.

Stability sits underneath all of this: no CRITICALs (crash guards hold), but SIGKILL-only deploys combined with transactions in only 8 code paths means multi-step writes can be severed half-applied — which directly amplifies the financial-integrity findings.

### Severity totals (78 findings across 4 domains)

| Domain | CRITICAL | HIGH | MEDIUM | LOW | INFO | Total |
|---|---|---|---|---|---|---|
| Security (SEC) | 2 | 3 | 4 | 2 | 4 | 15 |
| Reports (RPT) | 3 | 10 | 9 | 3 | 4 | 29 |
| Stability (STAB) | 0 | 4 | 6 | 4 | 6 | 20 |
| Capability (CAP) | 0 | 4 | 5 | 2 | 3 | 14 |
| **Total** | **5** | **21** | **24** | **11** | **17** | **78** |

INFO findings are documented clean areas (not defects) — they record what was verified sound.

---

## 2. The five CRITICAL findings

These are the items where the platform is exploitable now or is presenting wrong financial numbers as correct.

| ID | Title | Evidence | Why critical |
|---|---|---|---|
| **SEC-001** | ~157 mutating endpoints have no server-side role check | `server/routes.ts:8978, 9039, 9877, 9909, 14061, 34990, 35065, 35352, 40562` (+148) | Any authenticated user — even a `viewer` — can create/delete live-switch tariffs & rates and approve/void/mark-paid invoices. The client `ProtectedRoute` is the only gate on these. |
| **SEC-002** | Hardcoded production Sippy admin password (`!chiaan1`) | `server/routes.ts:543`, `rule-engine.ts:42`, `storage.ts:897`, `approvals.ts:603`, several scripts | A live, working softswitch admin credential is in source and used as an unconditional fallback. |
| **RPT-001** | DMR "platform vs Sippy" verification is a mirror — every row born verified | `server/services/sippy/sippy-dmr.service.ts:276-304, 309, 367` | `platAmt = sipAmt` before classification, so drift can never be detected; and this self-mirror *satisfies the invoice governance gate* (`routes.ts:34834`). The gate is decorative. |
| **RPT-002** | Three invoice renderers, two money bases | `sippy-invoice.service.ts:128,187`; `invoice-pdf.service.ts:85`; `routes.ts:35407` | Customer PDF sums `actual_cost`; stored HTML + register sum `reproduced_cost`; the legacy `/html` route reads non-existent fields and renders `0.00`. The same invoice shows three totals. |
| **RPT-003** | Known 60× reproduced-cost defect; fix written but not wired | `server/rating-cost.ts:4-38` ("NOT WIRED IN"); consumed at `sippy-invoice.service.ts:128`, `invoices.tsx:783` | The corrected rating engine exists but nothing calls it; the defective figure still feeds invoice HTML, the register, unbilled-usage, and carrier reconciliation. |

**SEC-001 and SEC-002 together** are the sharpest single risk: an unprivileged account can reconfigure the live switch, and the admin credential to that switch is in the repo (and downloadable via SEC-003's ZIP endpoint).

**RPT-001/002/003 together** mean the money layer cannot currently be trusted end-to-end: the numbers are computed multiple ways, "verification" doesn't verify, and a documented 60× error path is still live on customer-adjacent surfaces.

---

## 3. HIGH findings (21) — grouped by theme

### Access & exposure (Security)
- **SEC-003** — Full-source ZIP (`GET /api/download/project-zip`, `routes.ts:17325`) gated by login only; exclusion list omits `.env`.
- **SEC-004** — MFA implemented but the `mfaVerified` flag is never read by any guard (`routes.ts:37945-37987`).
- **SEC-005** — Six tracked `server/routes.ts.bak*` files carry the hardcoded password (`git ls-files`).

### Financial correctness (Reports)
- **RPT-004** — Per-client margin is pro-rata revenue allocation → identical margin % for every client (`sippy-snapshot.service.ts:113`).
- **RPT-005** — F3 "reconciliation" checks a table against itself, then stamps invoice batches `reconCertified` (`reconciliation.service.ts:86`).
- **RPT-006** — Client reconciliation's invoice comparison is structurally dead and links the wrong invoice (`sippy-client-recon.service.ts:137` vs `storage.ts:3194`).
- **RPT-007** — Snapshot "transaction" issues BEGIN/COMMIT through a pool → not atomic; a mid-run failure permanently deletes the day (`sippy-snapshot.service.ts:254`).
- **RPT-008** — Carrier reconciliation drops the period's last day (lexical date compare) and compares a total with itself (`sippy-reconciliation.service.ts:83-94`).
- **RPT-009** — Invoice query truncates at 50k newest rows; null-dated snapshots billed every period (`sippy-invoice.service.ts:623`).
- **RPT-010** — `/api/invoices/generate` has no duplicate-period guard → same period invoiceable twice (`routes.ts:34820`).
- **RPT-011** — Analytics "cost" derived from vendor *balances*, margin from mixed bases across three fallbacks (`routes.ts:21496`).
- **RPT-012** — Monthly executive report computed from a 72-hour in-memory cache (`sippy-executive-report.service.ts:61`).
- **RPT-013** — One-click `auto-verify-period` generates + bulk-verifies DMR to satisfy the invoice gate (`routes.ts:36350`).

### Reliability (Stability)
- **STAB-001** — SIGTERM/SIGINT handlers only log; no `server.close()`/`pool.end()` → every deploy ends in SIGKILL mid-write (`server/index.ts:26`).
- **STAB-002** — `new Pool()` per function call in 10 files / 25+ sites, some on 5-min loops → connection churn / exhaustion risk (`action-store.ts:28` +).
- **STAB-003** — Rate limiter (300 req/15 min/IP) vs dashboards polling 9–20 queries each; one hook polls at 2 s ≈ 450 req/15 min → self-inflicted 429 storms (`index.ts:113`, `use-calls.ts:41`).
- **STAB-004** — ≥60-min in-memory timers degrade to "once per boot" given documented restarts (auth-exposure at 6 h effectively never recurs) (`routes.ts:16167, 25526` +).

### Architecture (Capability)
- **CAP-001** — Product Mapping tab calls `/api/product-mapping/*`; server mounts `/api/gcs/product-mappings/*` → entire tab 404s (`ProductMappingTab.tsx:87` vs `routes-product-mapping.ts:98`).
- **CAP-002** — Portal framework binds 75 of ~174 DB module keys; seeded finance/admin/kam portals 404 today (`module-registry.ts` vs migrations 020/029/030/031).
- **CAP-003** — Legacy `SIDEBAR_GROUPS` is 44 hrefs behind DOMAINS/DB; 4 finance pages exist only in DOMAINS and will vanish under DB-driven nav.
- **CAP-004** — Six more pages query endpoints that don't exist (Finance Cockpit reminders, Fraud Simbox, workspace vendor balances, copilot events, sender-profile picker, company products).

---

## 4. Cross-cutting themes

Several findings from different agents describe the **same underlying weakness** seen from different angles:

1. **"Self-comparison presented as verification."** RPT-001 (DMR), RPT-005 (F3 recon), RPT-008 (carrier recon snapshot=reproduced), and the previously-known completeness self-compare all share one root: a pipeline agreeing with itself is labelled "verified/certified." The completeness service (RPT-026) is the one surface that resists this and says `no_reference` — it is the model the others should follow.

2. **Client-side gate, no server-side gate.** SEC-001 (RBAC only in `ProtectedRoute`) and CAP-004/CAP-001 (client calls endpoints the server doesn't guard or doesn't serve) both stem from the client and server registries/permissions never being reconciled. The five-registry problem (CAP-003) is the structural version of the same drift.

3. **In-memory state in a process that restarts/sleeps.** STAB-004/STAB-005 (long timers), RPT-012 (executive report from 72 h cache), and RPT-007 (pool-level "transaction") all assume durability the runtime doesn't provide. The finance catch-up scheduler (STAB/RPT INFO) already solves this correctly and is the template.

4. **Transactions amplify integrity risk.** STAB-009 (8 transaction sites) + STAB-001 (SIGKILL deploys) + RPT-007 (fake transaction) mean the financial writes most needing atomicity are the least likely to have it.

---

## 5. Recommended remediation queue (Pending approval)

Ordered by risk-reduction per unit effort. **No action taken — this is a proposed sequence for your approval.**

**Tier 0 — contain now (small, high-impact):**
1. Rotate the Sippy admin password and move it to env-only; `git rm` the six `.bak` files (SEC-002, SEC-005).
2. Restrict or remove the project-ZIP endpoint (SEC-003).

**Tier 1 — access control:**
3. Introduce a default-deny authorization layer; every mutating route must declare allowed roles; start with the switch-config and invoice/finance subset (SEC-001). Enforce MFA for `MFA_REQUIRED_ROLES` (SEC-004).

**Tier 2 — financial truth:**
4. Wire `rating-cost.ts` and re-base every customer-visible figure on `actual_cost`; collapse the three invoice renderers to one (RPT-002, RPT-003).
5. Make the DMR platform side read the CDR repository instead of mirroring Sippy; this makes the invoice gate real (RPT-001, RPT-013).
6. Real DB transactions for snapshot/margin materialization (RPT-007, STAB-009).
7. One shared period predicate from `billing-periods.ts` across invoice/recon/exports; add the invoice duplicate-period guard (RPT-008, RPT-009, RPT-010, RPT-022).

**Tier 3 — reliability:**
8. Graceful shutdown (SIGTERM → drain → `pool.end`) (STAB-001).
9. Consolidate on the shared pool; delete `getPool()` helpers (STAB-002).
10. Exempt authenticated sessions from the general limiter or scope it; slow the 2 s poll (STAB-003).
11. Convert ≥60-min timers to the persisted catch-up pattern (STAB-004).

**Tier 4 — architecture (feeds the portal-framework work directly):**
12. Declare one canonical registry (DB/Model A); generate or retire DOMAINS and SIDEBAR_GROUPS; fix the 4 finance-page seed gaps and 2 dead route values (CAP-003, CAP-005, CAP-014).
13. Bind or deactivate the ~100 unrenderable portal module keys before the framework ships (CAP-002).
14. Fix the 13 broken client endpoints; add a CI grep of client `/api` paths vs served routes (CAP-001, CAP-004).
15. Add tests for `rbac.ts`, `approvals.ts`, auth, and the portal endpoints before framework certification (CAP-012).

**Tier 5 — hygiene:** debug endpoints (SEC-007), file-read allowlist (SEC-006), silent catches (STAB-006), dead scaffold/pages (CAP-006, CAP-010, CAP-011), captured-not-delivered endpoints incl. GDPR retention surface (CAP-007).

---

## 6. Documented clean areas (verified sound)

Not everything is a problem — these were checked and found solid, and several are the templates the fixes should copy:

- **Security:** no SQL injection (Drizzle-parameterized), no exploitable XSS, scrypt+timingSafeEqual password hashing, correct cookie flags, no permissive CORS, current dependency majors, role-gated 20 MB memory-storage uploads (SEC-012–015).
- **Reports:** `billing-periods.ts` (UTC-locked, exclusive-boundary, tested), gap/completeness detection that reports `no_reference` honestly, race-safe invoice numbering, consistent division-by-zero guards (RPT-026–029).
- **Stability:** exemplary file-migration runner (advisory lock, halt-on-failure, checksums), correctly configured shared pool, adequate Sippy resilience, solid AMI + client WS reconnection, overlap protection as the norm, conservative query-client defaults (STAB-015–020).
- **Capability:** no large commented-out blocks; DOMAINS↔DB are near-mirrors; dense finance/CDR/rating test coverage (CAP-013, CAP-014, CAP-012 partial).

---

## 7. Notes & caveats

- The feature count grew during the audit window: the PFR inventory recorded 111 `SIDEBAR_GROUPS` entries; the capability audit found 115 (114 unique hrefs). The registries are actively changing, which is itself part of CAP-003.
- Endpoint counts (157 unguarded, 157 unconsumed, 13 broken) are the auditors' best evidence-backed estimates; each auditor hand-verified ≥10 samples, but a definitive count needs a scripted pass. Treat them as strong signals, not exact figures.
- This report is a synthesis of four independent agent audits. Full per-domain detail (every finding with quoted code) is available in the source audit outputs; the tables above preserve the evidence pointers so any finding can be re-confirmed at its `file:line`.
- All decisions are **Pending**. Per governance, no endpoint, page, credential, or registry entry will be changed until the specific item is approved.
