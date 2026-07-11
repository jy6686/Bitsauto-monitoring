# Volume 0 — Platform Governance

| Field | Value |
|-------|-------|
| Subsystem | Platform (all) |
| Status | ACTIVE |
| Verification | Process document — rules, not platform-behaviour claims |
| Last verified | 2026-07-11 |
| Repository commit | `482babb7` |
| Institutional sections | Yes (§2 frozen/active policy) |

> **Status:** Living document. **Audience:** every contributor (human or agent).
> **Read this before proposing any change to BitsAuto.**

BitsAuto is not a CRUD app. It is a large operational platform (~203 DB tables,
~156 client pages, ~158 server modules, ~280K LOC) running read-only 24/7 against
a **production** Sippy softswitch. Changes carry operational risk. This volume
defines the rules that keep changes safe and reversible.

---

## 1. Core principles

1. **Production-first.** The live system is the source of truth. A change is not
   "done" when it compiles — it's done when its behaviour is verified against the
   running environment.
2. **Freeze by default.** Only the subsystem under active development may be
   modified. Everything else is frozen unless a *confirmed* production bug forces
   a change.
3. **Evidence-driven.** Move from *"I found the root cause"* to *"here is the
   leading hypothesis and the evidence still required."* Do not change the schema,
   the database, or a frozen module on a hypothesis.
4. **Small, isolated changes.** One concern per branch/commit. No mixing feature
   work with troubleshooting, or two subsystems in one change.
5. **Single source of truth.** Never duplicate a definition (e.g. product lists,
   schema) in two places. Fix the canonical source; don't work around it.

---

## 2. Frozen vs. active subsystems

> **Institutional / owner-set policy** (not derivable from code — set by the
> platform owner; update deliberately).

**Frozen — do not modify unless a confirmed production bug forces it:**
- Live Operations / Dashboard
- BitsEye / BitsEye2 (Tier-1 telemetry asset; architecture locked 12+ months —
  UX polish and new graph types only, no redesign or schema change)
- NOC / Telemetry
- Sippy Integration (`server/sippy.ts`)
- Authentication

**Active development (current sprint):**
- Commercial & Rate Management: Vendor Rate Upload, Product Registry, Product
  Mapping, Destination Catalog, Compare / Margin / Impact, Approval Workflow,
  Send Rate.

Everything not listed as active is treated as read-only.

---

## 3. The Eight-Question Gate

Every proposed change must answer all eight before merge. If any is unanswered,
**do not merge.**

| # | Question | Required |
|---|----------|----------|
| 1 | Which subsystem? | ✅ |
| 2 | Which business requirement? | ✅ |
| 3 | Which UI pages are affected? | ✅ |
| 4 | Which APIs are affected? | ✅ |
| 5 | Which database tables? | ✅ |
| 6 | Production impact? | ✅ |
| 7 | Rollback plan? | ✅ |
| 8 | Verification / test plan? | ✅ |
| — | Frozen subsystem touched? | Yes / No (if Yes → requires explicit owner sign-off) |

---

## 4. The Four Evidence Categories

Before changing anything, gather evidence in each relevant category. Do not treat
one category as a substitute for another.

- **A. Code evidence** — what does the repository prove? (grep/read the actual
  source; reproducible commands.)
- **B. Runtime evidence** — what do the *deployment* logs actually show?
- **C. Database evidence** — what does **production** contain *today*? Not what
  `schema.ts` says, not what a migration file says — what `SELECT`/`to_regclass`
  returns against the live DB.
- **D. Business evidence** — *should* the platform behave this way? Many "bugs"
  are intentional business rules. Confirm the requirement before "fixing" it.

A schema or production change requires **C (database evidence)** explicitly — the
repository alone cannot prove what exists in the live database.

---

## 5. Change workflow

```
Observations (verified facts)
        ↓
Leading hypothesis (clearly labelled as such)
        ↓
Evidence still required (A/B/C/D)
        ↓
Decision (owner)
        ↓
Small isolated change → build + typecheck → branch/PR
        ↓
Runtime verification against deployment
        ↓
Merge (only after the gate is fully answered)
```

Schema-creation facts for this project (**code evidence**, verified at `482babb7`).
There are exactly **three** table-creation mechanisms:
1. `drizzle-kit push` (`npm run db:push`) — creates tables defined in
   `shared/schema.ts`.
2. `runSafeMigrations()` in `server/db.ts` — a hand-maintained startup function
   running inline idempotent DDL (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ...
   ADD COLUMN IF NOT EXISTS`) for a **curated list** of ~39 tables. It does **not**
   read the `migrations/` folder.
3. The raw SQL files under `migrations/` — **not executed** by any script or at
   runtime (they are Drizzle's generated output dir; the team uses `push`, not
   `migrate`).

Therefore a table that is **absent from both `shared/schema.ts` and
`runSafeMigrations()`** is **never created** by the project's *currently tracked*
automated tooling — regardless of what a `migrations/*.sql` file contains.

- **Verified (Level 1):** such a table is not created by any tracked repository
  mechanism.
- **Pending (Level 3):** *how* production obtained the table, if it exists at all,
  is not knowable from the repo. Possibilities include a one-off manual SQL run, a
  historical bootstrap script no longer in the tree, a past deployment tool, or a
  database restored from an earlier snapshot. Distinguishing these requires
  database/production evidence — do not assert a single origin from code alone.

---

## 6. Documentation standard

Every statement in every volume must be tagged as one of:

- **`[verified-in-code]`** — reproducible from the repository right now. Include
  the file/line or the command that proves it.
- **`[institutional]`** — knowledge that cannot be inferred from code (why a
  module is frozen, business rules, production incidents, roadmap, ownership).
  Supplied by the owner; must be labelled so no one mistakes a recollection for a
  verified fact.

A document that mixes the two without labels is untrustworthy. (Example of why
this matters: `architecture_flow.md` states `routes.ts` is ~11,800 lines and lists
~20 tables — the real figures are 36,543 lines and 203 tables. Stale, unlabelled
claims are worse than no doc.)

### 6.1 Page metadata header

Every handbook page begins with a metadata table so readers immediately know how
trustworthy it is and when it was last checked:

```
| Field | Value |
|-------|-------|
| Subsystem | <e.g. Commercial> |
| Status | ACTIVE | FROZEN | PENDING VERIFICATION |
| Verification | Verified in code | Pending runtime/DB evidence |
| Last verified | YYYY-MM-DD |
| Repository commit | <hash the facts were verified against> |
| Institutional sections | Yes / No |
```

### 6.2 "Open Questions" footer (required)

Every handbook page **ends** with an Open Questions section so unverified
assumptions can never silently become documentation. Each item is tagged with its
state:

```
## Open Questions
- [ ] <question> — **Needs Production Evidence** (Level 3)
- [ ] <question> — **Institutional Knowledge Required**
- [ ] <question> — **Blocked** (depends on <X>)
- [x] <resolved question> — **Verified** (<how>)
```

States: **Verified · Pending · Blocked · Needs Production Evidence ·
Institutional Knowledge Required.**

### 6.3 Per-module template (Volume 1+)

Each subsystem module is documented against this fixed 16-field template so
coverage is uniform and gaps are obvious. A module is not "100% complete" until
every field is present (or explicitly marked N/A):

1. Business purpose · 2. UI pages · 3. Components · 4. API endpoints ·
5. Services · 6. Database tables · 7. Workflow · 8. Sequence diagram ·
9. Dependencies · 10. Approval flow · 11. Rollback impact · 12. Test checklist ·
13. Known issues · 14. Production notes · 15. Future roadmap · 16. Open questions.

Institutional fields (Business purpose, Production notes, Known issues, Future
roadmap) may be sourced from the repo's **`.agents/memory/`** notes (40 authored
institutional records) — cite the note and tag `[institutional]`.

---

## 7. Change classification matrix

Classify every change; the class sets the minimum approval bar.

| Class | Description | Approval |
|-------|-------------|----------|
| A | Documentation only | Immediate |
| B | UI only | Review |
| C | Business logic | Design review |
| D | Database (schema / data / migration) | DBA review + rollback plan + **database evidence (Level 3)** |
| E | Infrastructure / deployment | Production approval |
| F | Frozen subsystem | Executive / owner approval |

A change may span classes; apply the **highest** bar that any part triggers.

---

## 8. Evidence ladder

Every technical conclusion states its evidence level instead of asserting "root
cause." Higher levels do not skip lower ones — a Level 3 claim still needs the
Level 1 code facts behind it.

| Level | Source | Answers |
|-------|--------|---------|
| 1 | Repository structure / code | What does the code say exists? |
| 2 | Runtime logs | What does the running app actually do? |
| 3 | Database verification | What does the **production DB** contain today? |
| 4 | Production observation | What does the live system actually exhibit? |
| 5 | Business confirmation | Is this the intended behaviour? |

Write conclusions as **"Confidence: Level N"**, not "root cause." A Class-D
(database) change requires **Level 3** evidence before it may be approved.

---

## 9. Pre-merge review checklist

- [ ] Eight-Question Gate fully answered
- [ ] Evidence gathered in all relevant categories (A/B/C/D); C present for any DB/schema change
- [ ] No frozen subsystem touched (or explicit owner sign-off attached)
- [ ] Single concern; diff is isolated and reviewable
- [ ] Build + typecheck pass
- [ ] Runtime-verified against the deployment (not just compiled)
- [ ] Rollback plan stated and tested
- [ ] Docs updated; new claims tagged `[verified-in-code]` / `[institutional]`

---

## 10. Volume index (planned)

- **Volume 0 — Platform Governance** (this document)
- Volume 1 — Commercial & Rate Management *(active subsystem; authored once
  product-mapping table evidence is confirmed)*
- Volume 2 — Routing
- Volume 3 — NOC
- Volume 4 — Finance
- Volume 5 — Fraud
- Volume 6 — Analytics / BitsEye
- Volume 7 — AI Services
- Volume 8 — Deployment & Infrastructure
- Volume 9 — Operational Playbooks (incidents, recovery, rollback, postmortems)

---

## Open Questions
- [x] Are the schema-creation mechanisms fully enumerated? — **Verified** (three: schema.ts / `runSafeMigrations` / unused `migrations/`)
- [ ] Should the frozen/active list (§2) be ratified and dated by the owner each sprint? — **Institutional Knowledge Required**
- [ ] Adopt this gate in CI (block merges missing the eight answers)? — **Pending** (process decision)
