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

## Writing a migration

1. Create `migrations/NNN_short_name.sql`, next free number.
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
