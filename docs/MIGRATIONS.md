# Database migrations

**Schema changes reach a database exactly one way: a numbered file in `migrations/`, applied at startup by `runFileMigrations()` in `server/migrate.ts`.**

Do not hand-apply migrations from a shell. Do not add DDL to `runSafeMigrations()`.

For the deployment sequence, success criteria, and what to check when a deployment is not clean, see [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md).

---

## Why this exists

Migrations 038–047 were written, verified, and applied by hand to the dev database — and never reached production. The operator's shell held `helium`; the deployed application held a different database. Ten migrations covering the whole Onboarding 2.0 schema landed in the wrong place, and nobody found out until a company created in production had no configuration to prepare from.

The failure was not carelessness. It was that "apply the migration" meant *whatever database this shell happens to point at*, which is a different question from *the database the application is using*. Startup application removes the gap: the runner uses the same `DATABASE_URL` the app does, because it is the app.

## How the runner behaves

| Behaviour | Rule |
|---|---|
| **Identity** | The **filename**, not the number. `030` is used by two different files. |
| **Ledger** | `schema_migrations` — filename (PK), checksum, `applied_at`, `duration_ms`, `baselined`. |
| **Baseline** | Files numbered **≤ 037** are recorded, never executed. See below. |
| **Atomicity** | Each file runs as **one** `client.query(wholeFile)`, so the file's own `BEGIN;`/`COMMIT;` governs it. |
| **Failure** | **Halts** the remaining migrations, logs at error level, reports `migrations: incomplete` on `/healthz`. The process still boots. |
| **Drift** | An applied file that changed on disk is reported, never silently re-run. |
| **Concurrency** | `pg_advisory_lock` — two instances booting together do not race. |

### Why one query per file, not one per statement

Every migration from 038 onward opens with `BEGIN;` and closes with `COMMIT;`. Executing a file statement-by-statement discards that: a failure halfway through leaves half the migration applied, with nothing to roll back and no record that it happened. Passing the whole file as a single query preserves the transaction — and is identical to what `scripts/apply-migration.mjs` does, which is how these files were originally verified.

This is the specific reason the ten migrations were **not** copied into `runSafeMigrations()`.

### Baseline validation

The baseline is a *claim about this database*, and it was false for production once already — which is how ten migrations went missing. So the runner tests the claim before acting on it, at every startup, with two severities:

- **fatal** — a core table the baseline range creates does not exist (`companies`, `navigation_modules`, `platform_feature_flags`, `navigation_groups`). This is not a database that has been through the baseline, so nothing the runner does next is sound. **Everything halts; nothing is applied and nothing is recorded.** Recording 001–037 as applied against such a database would write a permanent lie into the ledger.
- **warn** — the tables exist but seed data a later migration depends on does not (e.g. `navigation_groups` is empty because 031's seed never ran). This does *not* halt: migrations 038–047 have no dependency on the workspace model, and halting over it would block the very recovery the runner exists to perform. It is logged, shown on the diagnostics page, and the dependent migration fails on its own pre-flight naming itself.

Results — passes included — appear under **Baseline validation** on `/schema-migrations`.

### Why 001–037 are baselined

A fresh database in this platform is built from the Drizzle schema plus `runSafeMigrations()`, not by replaying 001–037 in order. Several of those early files are not re-runnable, and one number is used twice. Treating them as a replayable history would be a claim the first genuinely fresh deployment would disprove.

`BASELINE_THROUGH` moves only as a deliberate re-baselining — never to make a failing migration go away.

## Reserved number ranges

`MIGRATION_FILE` is `/^(\d{3})_[A-Za-z0-9_.-]+\.sql$/` and the runner sorts **lexically** on
the filename. Three digits, always — a file named `C01_…` or `1000_…` does not match the
pattern and is **silently skipped**, not reported.

| Range | Owner | Notes |
|---|---|---|
| 000–037 | historical | baselined, never executed — see `BASELINE_THROUGH` |
| 038–499 | general / finance / platform | sequential, next free number |
| **500–599** | **destination catalogue** | reserved 2026-08-28 — see below |
| 600–999 | unallocated | do not use without adding a row here |

### Why the catalogue needed its own range

Catalogue work has had its numbers taken twice. `059`'s header schedules the cutover as
`060`/`061` and the retirement as `062`; `065`'s header schedules dedup as `066` and the
status change as `067`. On disk, `062` is `pakistan_mobile_commercial_hierarchy`, and `066`/`067`
are `invoice_email_test_mode` and `delivery_smtp_lineage` — the finance workstream reached those
numbers first. Both plans now read as instructions to write files that already exist as
something else.

The runner tolerates this (identity is the filename, and `030`/`052` are each used twice), so
nothing breaks at boot. What breaks is people: "066" names two different things depending on
which document you are reading.

**Catalogue migrations from 2026-08-28 onward are numbered 500+.** The gap is deliberate — it
is large enough that a sequential workstream will not reach it.

### Slot allocation within 500–599

Numbered in **decades**, not units. Every renumbering problem in this repo came from a plan
that assumed the next integer would still be free; leaving nine spare slots between steps means
an inserted migration never forces one.

| Slot | Step | Depends on |
|---|---|---|
| 500 | `destination_prefixes` — **empty structure only** | — |
| 510 | commercial identity merge — **populates 500 as it merges** | ER-002B §C, **OD-1**, **OD-2** |
| 520 | legacy id translation — additive `destination_id_canonical` | ER-002, ADR-001 |
| 530 | FK re-point onto `destinations` | 520 verified |
| 540 | write-path cutover — the four write sites | 530 |
| 550 | resolver re-point + provisioning re-certification gate | 540 |
| 560 | **retire `global_destinations`** | everything above |
| 570–599 | unallocated | — |

### Why the prefix structure is created before the merge, but populated by it

The objection to structure-first is correct: building prefix relationships against identities
that deduplication will delete creates rework. The objection to merge-first is that it is
impossible.

`destinations.dial_prefix` is a **single `TEXT` column** (`BitsAuto_Phase1_Step1_DDL.sql:23`).
Merging `Pakistan Mobile Jazz` (9230) and `Pakistan Mobile Jazz` (9232) into one identity
produces one row, which can hold one prefix. **The second prefix is destroyed** unless
somewhere multi-valued already exists to receive it — and under OD-1 Option A both prefixes are
Jazz's and both must survive.

So the merge cannot run before the prefix table exists, and the prefix table must not hold rows
before the merge. Both hold at once if 500 ships the table **empty** and 510 populates it as
part of the merge transaction: nothing ever references a doomed identity, and no prefix is
dropped on the floor. Splitting it across two slots rather than folding it into one keeps the
structure reviewable on its own and lets 510 be re-run against a table that already exists.

Three constraints shaped this, and they override any convenient ordering:

1. **Audits are scripts, not migrations.** `scripts/er-002-legacy-id-audit.sql` and
   `scripts/er-002b-commercial-identity-audit.sql` are run on demand against a chosen database.
   Giving them migration slots would execute them at every boot, against whichever database the
   app holds, which is the opposite of what an audit is for.
2. **Retirement is last** — unchanged from the frozen sequence's "062 last, once nothing reads
   it". Because the runner sorts lexically, the slot number *is* the execution order, so a
   retirement numbered before the prefix and dedup work would run before it.
3. **Dedup precedes the FK re-point.** Merging duplicate identities removes destination ids.
   Re-pointing foreign keys first and deduplicating second would require translating the same
   references twice — the second pass against ids the first pass just created.
4. **`destinations` is not in the Drizzle schema.** `shared/schema.ts` models
   `global_destinations` but not `destinations`, which is created by raw DDL. That is why the
   application writes to the legacy table through `db.insert(globalDestinations)` while reading
   the canonical one through raw SQL: there is no ORM model to insert into. Slot 540 is
   therefore not only a query rewrite — it needs a `destinations` model, or it will keep
   reaching for the only table Drizzle knows about.

### The rule this creates

Because the sort is lexical, everything numbered below 500 applies **before** the catalogue
block. Any future migration that depends on the catalogue cutover having run must therefore be
numbered **above** it, not at the next free sequential number. If that becomes common, the
catalogue block is in the wrong place and should be moved by allocating a new range — never by
renumbering an applied file.

### Historical references are stale, and are left alone

The `060`/`061`/`062` and `066`/`067` references inside `059` and `065` are now wrong. **They
are not corrected**, because both files have been applied and editing an applied migration is
drift: the runner reports it and refuses to re-run, which is exactly the state `059` is already
in (recorded checksum `ccb74bf9…`, repository `28c3fd36…`). A stale comment in an applied file
is a documentation problem; an edited applied file is an operational one. This table is the
authority; the comments are historical record.

## Writing a migration

1. Create `migrations/NNN_short_name.sql`, next free number **within your workstream's range**
   (see Reserved number ranges above).
2. Open with `BEGIN;`, close with `COMMIT;`.
3. Make every statement re-runnable: `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`, or a `DO $$` existence check.
4. End with a `DO $$` verify block that raises if the intended state was not reached. A migration that cannot tell you it worked is a migration you will re-litigate later.
5. Restart. Check **Schema Migrations** (`/schema-migrations`, admin only) or the `[migrate]` boot logs.

Never edit a migration that has been applied anywhere. The runner will report it as drift and refuse to re-run it — correctly, because it cannot know whether the database or the file is right. Write a new migration instead.

## Diagnostics

- **`/schema-migrations`** (admin, super_admin) — the full ledger: applied, baselined, pending, drift with both checksums, and the failure that halted the last boot.
- **`GET /api/admin/migrations`** — the same data as JSON.
- **`GET /healthz`** — unauthenticated, so coarse only: `migrations: ok | pending | incomplete | skipped`. No filenames, no checksums. `status` stays `ok` even when migrations are incomplete: this probe decides whether the container is alive, and failing it would pull a running platform out of service over a schema problem.

---

## Retiring `runSafeMigrations()`

`runSafeMigrations()` in `server/db.ts` is **legacy**. It is ~950 lines of inline DDL wrapped in a *single* `try/catch` that logs `non-fatal` and returns — so the first statement that errors silently skips every statement after it. That is not a property to build on.

Nothing new goes in it. The end state is three phases:

```
Phase 1  (now)          Phase 2                    Phase 3
─────────────────       ─────────────────────      ────────────────────
runSafeMigrations()     runSafeMigrations()        runFileMigrations()
runFileMigrations()       (workspace block         
                           extracted → files)      runSafeMigrations()
                        runFileMigrations()          deleted
```

- **Phase 1 — now.** Both run, in that order. `runFileMigrations()` is called from `server/index.ts` *outside* `runSafeMigrations()`, deliberately: anything inside that function is subject to its swallow-everything catch.
- **Phase 2.** Extract the legacy body into numbered migration files, starting with the workspace/navigation boot block. Tracked as Phase 2A / 2B.
- **Phase 3.** Delete `runSafeMigrations()` and its call. One mechanism, one place.

Until Phase 3 lands, the rule that keeps schema from being defined in two places is simply: **new schema goes in a file, always.**
