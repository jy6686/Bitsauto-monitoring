# BitsAuto — Engineering Home Page

> **Start here.** Single entry point for all engineering knowledge — humans and AI.
> Reference a knowledge-area ID or a `VR-NNN` instead of rediscovering the platform.

| | |
|--|--|
| **Platform** | BitsAuto Monitoring (VoIP ops, Sippy control plane) |
| **Repository** | github.com/jy6686/Bitsauto-monitoring |
| **Doc branch** | `docs/engineering-handbook` |
| **Handbook version** | Vol 0 (Governance) ✅ · Vol 1 (Commercial) 🟡 in progress · Vol 2+ not started |
| **Last verified** | 2026-07-11 @ commit `a0e91646` |

## Confidence tags (Volume 0 §6)

**`[V]`** verified-in-code · **`[P]`** production-verified · **`[I]`** institutional ·
**`[H]`** historical (may be stale) · **`[C]`** conflict (see Verification Register).
`[V]` = what the code says; `[P]` = what the system does — not the same thing.

## Verification Dashboard

| State | Count | Where |
|-------|------:|-------|
| Conflicts open `[C]` | 1 | VR-001 (Send Rate prefix) |
| Pending verification | 3 | VR-001, VR-002 (mapping tables), VR-003 (sheet detection) |
| Commercial modules deep | 7 / 8 | §§2-8a done; §9 Product Mapping pending |
| `.agents/memory` notes re-verified | ~10 / 40 | Commercial + Sippy areas |
| Production-verified `[P]` | 0 | (no live-evidence items closed yet) |

**Open Verification Register:** [VR-001, VR-002, VR-003](verification-register.md) — all PENDING.

## Two speeds of knowledge (keep distinct)

- **Knowledge (stable):** Handbook (`docs/engineering/`), Dependency Matrix,
  Architecture, `.agents/memory` — evolves slowly, per verification.
- **Engineering (active):** Verification Register (open discrepancies), open bugs,
  pending verification, sprint work, production incidents — evolves fast.

---

## Knowledge sources

1. **Engineering Handbook** — `docs/engineering/` (Volume 0 Governance, Volume 1
   Commercial, Dependency Matrix, known-issues). Written to the 16-field template;
   every claim tagged `[verified-in-code]` / `[institutional]`.
2. **Agent Memory** — `.agents/memory/` (40 prior institutional notes + `MEMORY.md`
   index). Authored across past sessions; **verification status tracked below.**
   Per Volume 0 §4.1 these are *institutional intent*, not implementation truth.
3. **Code + git** — `shared/schema.ts` (203 tables), `server/routes*.ts`,
   `server/services/**`, git log. The ground truth for `[V]` claims.
4. **[Verification Register](verification-register.md)** — `VR-NNN` log of
   code-vs-source discrepancies awaiting evidence (open: **VR-001** Send Rate prefix).

---

## Platform Memory — numbered knowledge areas

| ID | Area | Where it lives | Status |
|----|------|----------------|--------|
| 001 | Platform Architecture | `docs/architecture_flow.md` (⚠ stale), Volume 0 | `[H]` architecture_flow stale; Volume 0 current |
| 002 | Database Catalog | `shared/schema.ts` (203 tables) | `[V]` |
| 003 | API Catalog | `server/routes*.ts` (19 modules) | `[V]` |
| 004 | UI Catalog | `client/src/pages` (156), `features/` | `[V]` |
| 005 | Services | `server/services/**` (10 domains, 30 sippy) | `[V]` |
| 006 | Background Jobs / Startup | `routes.ts` jobs; `db.ts runSafeMigrations`; `production-startup-blocking.md` | `[V]`+`[I]` |
| 008 | Dependency Matrix | `docs/engineering/dependency-matrix.md` | `[V]` |
| 009 | **Commercial** | **Volume 1** (this is the active, complete-in-progress volume) | see below |
| 010 | Routing / Nav | `top-nav-rule.md`, `workspace-nav-architecture.md` | `[I]` unverified |
| 011 | NOC / Telemetry | `noc-sprint-architecture.md`, `rtp-mos-quality-aggregator.md`, `server-health-poller.md` | `[I]` unverified (FROZEN subsystem) |
| 012 | **Sippy Integration** | `sippy-*.md` notes (see below); `server/sippy.ts` | mixed |
| 013 | Finance / Billing | `finance-governance-modules.md`, `billing-cdr-matching.md`, `billing-check-cdr-matching.md`, `pnl-csv-cache.md`, `vendor-cost-extraction.md`, `trust-center-*.md` | `[I]` unverified |
| 014 | Fraud / Security | `security-sprint-1.md`, `trust-center-auth-ownership.md` | `[I]` unverified |
| 015 | AI Services | `server/services/ai` | `[V]` structure only |
| 016 | Call Governance / Voice OTP / SMS | `call-governance-*.md`, `voice-otp-ami-dial.md`, `ami-bridge-callerid-semantics.md`, `bhaoo-sms-integration.md`, `client-identity-layer.md` | `[I]` unverified |
| 017 | Metrics governance | `asr-acd-metric-governance.md`, `portal-governance-nav.md` | `[I]` unverified |
| 018 | Known Issues | `docs/engineering/known-issues/`, per-module Known-Issues fields | `[V]` |
| 019 | Decisions (LOCKED) | see LOCKED notes below | `[I]` |
| 020 | Roadmap | per-module Future-Roadmap fields; `byteplus-infra-orchestration.md`, `trust-center-roadmap.md` | `[I]` |

---

## Area 009 — Commercial memory notes (verification status)

Cross-referenced against current code this session:

| `.agents/memory` note | Status | Notes |
|-----------------------|--------|-------|
| `product-policy.md` | `[I]` used in Vol 1 §8 | products = commercial classes; trunk prefix never customer-facing |
| `product-variant-architecture.md` (LOCKED) | `[I]` | 9 variants target; Sprint C pending — **not yet in schema** |
| `product-registry-hierarchy.md` | `[I]` used in §8 | lifecycle draft→…→retired; only `commercial` in flows |
| `rate-manager-trunk-prefix.md` | `[I]` | trunk prefix encoding |
| `prefix-architecture-rule.md` (LOCKED) | ⚠️ **CONFLICT** | says dialPrefix-only to Sippy; **code §7 sends fullPrefix** — unresolved, needs Level-2/3 evidence |
| `destination-catalogue-commercial.md` | `[I]` | billing increment is destination-level; Sprint B1 fields pending |
| `gds-reconciliation-layer.md` | `[I]` | `destination_product_rates`; GDS Rates tab |
| `deal-workspace-architecture.md` | `[I]` | deals blended-rate formula, health thresholds |
| `governance-339-consumer-scope.md` | `[I]` | approval consumer scope (frozen sprint) |

## Area 012 — Sippy memory notes (high-value, mostly `[I]`/`[H]` — verify before use)

`sippy-rate-push-api.md` (no XML-RPC rate write; portal CSV only) ·
`sippy-rate-push-permissions.md` (ssp-root reseller ACL; rate-admin creds) ·
`sippy-account-tariff-chain.md` (service plans, not direct iTariff) ·
`sippy-portal-auth-chain.md` · `sippy-cdr-access.md` (getAccountCDRs needs dates) ·
`sippy-portal-cdr-pagination.md` · `sippy-service-layer.md` (import from
`services/sippy/index.ts`, never `sippy.ts` directly) · `sippy-timeout-credentials.md`
· `sippy-date-format.md` · `sippy-extjs-upload.md` · `cdr-ondemand-portal-fallback.md`
· `scrape-portal-cdrs-all-iaccount.md` · `pnl-csv-cache.md`.

## LOCKED decisions (Area 019) — do not change without architecture review

- `prefix-architecture-rule.md` — dialPrefix only to Sippy (⚠️ code conflict, see above)
- `product-variant-architecture.md` — 9 fixed variants
- `trust-center-auth-ownership.md` — managed_by / last_change_source model
- `top-nav-rule.md` — new pages go in `DOMAINS[]`, never sidebar

---

## Verification protocol (per Volume 0)

When incorporating any `.agents/memory` note into the handbook:
1. Re-check it against current code (`grep`/read) → mark `[V]` if it still holds.
2. If it can't be inferred from code → `[I]`, cite the note.
3. If it contradicts current code → flag as **CONFLICT**, document both sides, do
   **not** resolve without Level-2/3 evidence (the `prefix-architecture-rule` case
   is the worked example).

## Open Questions
- [ ] Re-verify the ~30 not-yet-checked `.agents/memory` notes against current code as each area is documented — **Pending**
- [ ] Resolve the `prefix-architecture-rule` vs Send Rate conflict — **Needs Production Evidence** (Level 2/3)
- [ ] Backfill `002-005` catalogs as generated reference pages — **Pending**
