/**
 * migrate.ts — executes pending numbered migration files at startup.
 *
 * WHY THIS EXISTS
 * ---------------
 * Migrations 038–047 were applied by hand to the dev database and never reached
 * production, because "apply the migration" was a manual step aimed at whatever
 * DATABASE_URL the operator's shell happened to hold. The shell held helium; the
 * deployed app holds something else. Ten migrations landed in the wrong database
 * and nobody found out until a company created in production had no configuration
 * to prepare from.
 *
 * The fix is not to copy those files' DDL into runSafeMigrations(). That would
 * create a second copy of the schema to maintain, and — more concretely — it would
 * DISCARD the transactions those files carry. Every migration from 038 onward opens
 * with BEGIN; and closes with COMMIT;. runSafeMigrations() issues one client.query()
 * per statement, so a copied migration is no longer atomic: a failure halfway
 * through leaves half of it applied, with nothing to roll back and no record that
 * it happened.
 *
 * This runner executes each file exactly the way scripts/apply-migration.mjs does —
 * the whole file as a single query, so the file's own BEGIN/COMMIT governs it. The
 * semantics here are the semantics those ten migrations were actually verified
 * under, not a reimplementation of them.
 *
 * DESIGN DECISIONS
 * ----------------
 * • Files at or below BASELINE_THROUGH are recorded, never executed. A fresh
 *   database in this platform is built by the Drizzle schema plus
 *   runSafeMigrations(), not by replaying 001–037 in order — several of those
 *   early files are not re-runnable and one number (030) is used twice. Pretending
 *   they form a replayable history would be a lie the first fresh deploy exposes.
 *
 * • A failure HALTS the remaining migrations. Applying 045 after 044 failed is how
 *   a database ends up in a state no migration file describes. The process still
 *   boots — refusing to start a monitoring platform over a migration is a worse
 *   outcome than booting with a flag raised — but the failure is recorded, logged
 *   at error level, and exported for a health check. It is never swallowed.
 *
 * • Checksums are stored. If an already-applied file changes on disk, that is
 *   reported: it means the database and the repository disagree about what was
 *   applied, and only a human can say which is right.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Pool } from "pg";

/**
 * Migrations numbered at or below this are treated as history: recorded as
 * applied without being executed. Raise it only as a deliberate re-baselining,
 * never to make a failing migration go away.
 */
const BASELINE_THROUGH = 37;

/** Bumped when the runner's own behaviour changes, so a screenshot of the
 *  diagnostics page identifies which runner produced it. */
export const RUNNER_VERSION = 1;

/** Postgres advisory lock key — prevents two booting instances racing. */
const LOCK_KEY = 4_073_800_047;

const MIGRATION_FILE = /^(\d{3})_[A-Za-z0-9_.-]+\.sql$/;

/**
 * The baseline claims migrations 001–037 are already present. That claim is
 * asserted, not proved — and it was FALSE for production once already, which is
 * how ten migrations went missing. These checks test it before the runner acts.
 *
 * Two severities, because the failure modes are genuinely different:
 *
 *   'fatal' — a core table the baseline range creates does not exist. This is not
 *             a database that has been through the baseline, so the runner's
 *             central assumption is wrong and nothing it does next is sound.
 *             Everything halts.
 *
 *   'warn'  — the tables exist but seed data a later migration depends on does
 *             not. Narrower: 038–047 have no dependency on the workspace model,
 *             and halting over it would block the very recovery this runner was
 *             built to perform. Reported prominently; the dependent migration
 *             fails on its own pre-flight and names itself.
 */
type BaselineCheck = {
  label: string;
  sql: string;
  severity: "fatal" | "warn";
  remedy: string;
};

const BASELINE_CHECKS: BaselineCheck[] = [
  {
    label: "companies table exists",
    sql: `SELECT to_regclass('public.companies') IS NOT NULL AS ok`,
    severity: "fatal",
    remedy: "This database has not been initialised. Run the Drizzle schema push before starting.",
  },
  {
    label: "navigation_modules table exists",
    sql: `SELECT to_regclass('public.navigation_modules') IS NOT NULL AS ok`,
    severity: "fatal",
    remedy: "Portal governance schema (migration 020) is absent — the baseline of 037 is wrong for this database.",
  },
  {
    label: "platform_feature_flags table exists",
    sql: `SELECT to_regclass('public.platform_feature_flags') IS NOT NULL AS ok`,
    severity: "fatal",
    remedy: "Feature-flag schema is absent — the baseline of 037 is wrong for this database.",
  },
  {
    label: "navigation_groups table exists",
    sql: `SELECT to_regclass('public.navigation_groups') IS NOT NULL AS ok`,
    severity: "fatal",
    remedy: "Portal workspace model (migration 031) is absent — the baseline of 037 is wrong for this database.",
  },
  {
    label: "workspace navigation is seeded (migration 031)",
    sql: `SELECT EXISTS (SELECT 1 FROM navigation_groups) AS ok`,
    severity: "warn",
    remedy: "Migration 031 created the table but its seed never ran here. Migrations that attach modules to groups (048) will fail until it does.",
  },
];

export type BaselineResult = {
  label: string;
  ok: boolean;
  severity: "fatal" | "warn";
  remedy: string;
};

export type MigrationDrift = {
  file: string;
  /** Checksum recorded in schema_migrations when the file was applied. */
  recorded: string;
  /** Checksum of the file as it stands in the repository now. */
  actual: string;
};

export type MigrationOutcome = {
  applied: string[];
  baselined: number;
  failed: { file: string; error: string } | null;
  drifted: MigrationDrift[];
  skipped: boolean;
  /** Every baseline check and its result — the passes matter as much as the
   *  failures, because they are the evidence the baseline claim holds. */
  baseline: BaselineResult[];
  /** True when a fatal baseline check failed and nothing was executed. */
  baselineInvalid: boolean;
};

/** Run the baseline checks. A check that cannot be evaluated counts as failed —
 *  an unanswerable question about the schema is not a pass. */
async function validateBaseline(
  client: { query: (sql: string) => Promise<{ rows: any[] }> },
): Promise<BaselineResult[]> {
  const out: BaselineResult[] = [];
  for (const c of BASELINE_CHECKS) {
    let ok = false;
    try {
      const { rows } = await client.query(c.sql);
      ok = rows[0]?.ok === true;
    } catch {
      ok = false;
    }
    out.push({ label: c.label, ok, severity: c.severity, remedy: c.remedy });
  }
  return out;
}

/** Last run's outcome, for /api/health and boot diagnostics. */
let lastOutcome: MigrationOutcome | null = null;
export function getMigrationStatus(): MigrationOutcome | null {
  return lastOutcome;
}

export type LedgerRow = {
  filename: string;
  checksum: string | null;
  appliedAt: Date | null;
  durationMs: number | null;
  baselined: boolean;
  /** Present in the ledger but no longer in the repository. */
  missingFromDisk: boolean;
  /** Checksum of the file on disk right now, when it differs from `checksum`. */
  driftedTo: string | null;
};

/**
 * Full ledger for the admin diagnostics view, with drift recomputed against the
 * files as they stand now rather than replayed from the last boot. An operator
 * should not have to grep logs — or restart the server — to see that the database
 * and the repository disagree about what was applied.
 */
export async function getMigrationLedger(pool: Pool): Promise<{
  rows: LedgerRow[];
  pending: string[];
  drift: MigrationDrift[];
  migrationsDir: string | null;
  baselineThrough: number;
  runnerVersion: number;
  /** Highest migration number the ledger records, baselined or applied. */
  currentMigration: number | null;
  baseline: BaselineResult[];
}> {
  const dir = findMigrationsDir();
  const onDisk = new Map<string, string>();
  if (dir) {
    for (const f of readdirSync(dir).filter((f) => MIGRATION_FILE.test(f))) {
      onDisk.set(f, checksum(readFileSync(join(dir, f), "utf8")));
    }
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      filename: string; checksum: string | null;
      applied_at: Date | null; duration_ms: number | null; baselined: boolean;
    }>(`SELECT filename, checksum, applied_at, duration_ms, baselined
          FROM schema_migrations ORDER BY filename`);

    const drift: MigrationDrift[] = [];
    const ledger: LedgerRow[] = rows.map((r) => {
      const actual = onDisk.get(r.filename) ?? null;
      const drifted = Boolean(r.checksum && actual && r.checksum !== actual);
      if (drifted) drift.push({ file: r.filename, recorded: r.checksum!, actual: actual! });
      return {
        filename: r.filename,
        checksum: r.checksum,
        appliedAt: r.applied_at,
        durationMs: r.duration_ms,
        baselined: r.baselined,
        missingFromDisk: dir !== null && !onDisk.has(r.filename),
        driftedTo: drifted ? actual : null,
      };
    });

    const recorded = new Set(rows.map((r) => r.filename));
    const pending = [...onDisk.keys()].filter((f) => !recorded.has(f)).sort();

    const numbers = rows
      .filter((r) => MIGRATION_FILE.test(r.filename))
      .map((r) => numberOf(r.filename));

    return {
      rows: ledger,
      pending,
      drift,
      migrationsDir: dir,
      baselineThrough: BASELINE_THROUGH,
      runnerVersion: RUNNER_VERSION,
      currentMigration: numbers.length ? Math.max(...numbers) : null,
      // Re-evaluated live, not replayed from boot: a baseline object can be
      // dropped after startup, and the page should say so.
      baseline: await validateBaseline(client),
    };
  } finally {
    client.release();
  }
}

/**
 * Locate migrations/ at runtime. The production bundle is dist/index.cjs, but the
 * deployment runs scripts/start-prod.sh from the repository root, so the repo's
 * files are present and cwd is the repo root. __dirname is checked too so the
 * runner survives being invoked from elsewhere.
 */
function findMigrationsDir(): string | null {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), "migrations"),
    // dist/index.cjs → ../migrations. __dirname exists in the CJS bundle only.
    typeof __dirname !== "undefined" ? resolve(__dirname, "..", "migrations") : undefined,
    typeof __dirname !== "undefined" ? resolve(__dirname, "migrations") : undefined,
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (existsSync(dir) && readdirSync(dir).some((f) => MIGRATION_FILE.test(f))) return dir;
  }
  return null;
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

/** Numeric prefix of a migration filename. Filenames are the identity — number 030
 *  is used by two different files — so this is only ever used for the baseline test. */
function numberOf(file: string): number {
  return Number(MIGRATION_FILE.exec(file)![1]);
}

export async function runFileMigrations(pool: Pool): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = {
    applied: [], baselined: 0, failed: null, drifted: [], skipped: false,
    baseline: [], baselineInvalid: false,
  };

  const dir = findMigrationsDir();
  if (!dir) {
    // Not a failure: a deployment that ships only the bundle has no files to run.
    // Say so plainly rather than reporting a clean run over zero migrations.
    console.warn("[migrate] No migrations directory found — skipping file migrations.");
    outcome.skipped = true;
    lastOutcome = outcome;
    return outcome;
  }

  const files = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f)).sort();
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    VARCHAR(255) PRIMARY KEY,
        checksum    VARCHAR(32),
        applied_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        duration_ms INTEGER,
        baselined   BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);

    // ── Baseline validation ───────────────────────────────────────────────────
    // Prove the baseline claim before acting on it. Recording 001–037 as applied
    // is a statement about this database; if it is false, "baselined" silently
    // converts a missing migration into a permanent lie in the ledger.
    outcome.baseline = await validateBaseline(client);
    const fatal = outcome.baseline.filter((b) => !b.ok && b.severity === "fatal");
    const warned = outcome.baseline.filter((b) => !b.ok && b.severity === "warn");

    for (const w of warned) {
      console.warn(`[migrate] baseline warning — ${w.label} FAILED. ${w.remedy}`);
    }

    if (fatal.length) {
      outcome.baselineInvalid = true;
      outcome.failed = {
        file: "(baseline)",
        error: `Baseline invalid: ${fatal.map((f) => f.label).join("; ")}`,
      };
      console.error(
        `[migrate] BASELINE INVALID — migrations ${String(BASELINE_THROUGH).padStart(3, "0")} and below are assumed present, but:`,
      );
      for (const f of fatal) console.error(`[migrate]   ✗ ${f.label} — ${f.remedy}`);
      console.error("[migrate] Nothing was applied and nothing was recorded. Fix the baseline or lower BASELINE_THROUGH.");
      lastOutcome = outcome;
      return outcome;
    }

    // Serialise across concurrently booting instances. Whoever loses the race waits,
    // then finds every migration already recorded and applies nothing.
    await client.query(`SELECT pg_advisory_lock($1)`, [LOCK_KEY]);

    try {
      const { rows } = await client.query<{ filename: string; checksum: string | null }>(
        `SELECT filename, checksum FROM schema_migrations`,
      );
      const recorded = new Map(rows.map((r) => [r.filename, r.checksum]));

      for (const file of files) {
        const sql = readFileSync(join(dir, file), "utf8");
        const sum = checksum(sql);

        if (recorded.has(file)) {
          const was = recorded.get(file);
          // A changed checksum means the database and the repo disagree about what
          // was applied. Re-running is not automatically safe and skipping silently
          // is not honest, so it is reported and left to a human.
          if (was && was !== sum) {
            outcome.drifted.push({ file, recorded: was, actual: sum });
            console.warn(`[migrate] DRIFT: ${file} changed on disk since it was applied (recorded ${was}, now ${sum}). Not re-run.`);
          }
          continue;
        }

        if (numberOf(file) <= BASELINE_THROUGH) {
          await client.query(
            `INSERT INTO schema_migrations (filename, checksum, baselined) VALUES ($1, $2, TRUE)
             ON CONFLICT (filename) DO NOTHING`,
            [file, sum],
          );
          outcome.baselined++;
          continue;
        }

        // Halt rather than skip: applying 045 on top of a failed 044 produces a
        // database no migration file describes.
        if (outcome.failed) {
          console.warn(`[migrate] ${file} NOT applied — halted after ${outcome.failed.file} failed.`);
          continue;
        }

        const started = Date.now();
        try {
          // Whole file, one query — the file's own BEGIN/COMMIT governs atomicity.
          // This is deliberately identical to scripts/apply-migration.mjs.
          await client.query(sql);
          const ms = Date.now() - started;
          await client.query(
            `INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3)
             ON CONFLICT (filename) DO NOTHING`,
            [file, sum, ms],
          );
          outcome.applied.push(file);
          console.log(`[migrate] applied ${file} (${ms}ms)`);
        } catch (err: any) {
          outcome.failed = { file, error: err?.message ?? "unknown error" };
          console.error(`[migrate] FAILED ${file} — ${err?.message ?? "unknown error"}`);
          // The file's COMMIT never ran, so Postgres rolled it back. Clear the
          // aborted transaction state so the ledger writes below still work.
          await client.query("ROLLBACK").catch(() => {});
        }
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    }
  } catch (err: any) {
    outcome.failed = outcome.failed ?? { file: "(runner)", error: err?.message ?? "unknown error" };
    console.error("[migrate] runner error:", err?.message ?? err);
  } finally {
    client.release();
  }

  if (outcome.failed) {
    console.error(`[migrate] INCOMPLETE — ${outcome.applied.length} applied, then ${outcome.failed.file} failed. Database schema is behind the repository.`);
  } else if (outcome.applied.length) {
    console.log(`[migrate] ${outcome.applied.length} migration(s) applied, ${outcome.baselined} baselined.`);
  } else {
    console.log(`[migrate] Up to date (${files.length} files, ${outcome.baselined} baselined this run).`);
  }

  lastOutcome = outcome;
  return outcome;
}
