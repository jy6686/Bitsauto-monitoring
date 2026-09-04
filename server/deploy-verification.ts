/**
 * deploy-verification.ts — did the finance package actually land?
 *
 * WHY THIS IS CODE AND NOT A MARKDOWN CHECKLIST. A checklist cannot fail. It
 * gets read once on the day it is written, skimmed on the second deploy, and
 * skipped on the third — and the deploy it was written for is the one nobody
 * needed it on. These are the same five steps, executable, so the answer is a
 * measurement rather than a memory of having looked.
 *
 * ── The distinction that shapes this module ────────────────────────────────
 * A migration applying and the instrumentation WORKING are different claims,
 * and only the first is provable at deploy time. Migrations 504–507 add
 * columns whose whole purpose is to be filled by the nightly collector; a
 * successful migration proves the schema changed and nothing else. Until a
 * collection run has happened, the telemetry check is `pending`, which is a
 * third state — not a pass, and emphatically not a failure.
 *
 * Collapsing `pending` into `fail` would page someone at 03:00 for a deploy
 * that went perfectly. Collapsing it into `pass` would report the package
 * verified when the only thing verified is that Postgres accepted four ALTER
 * statements. So `ok` (nothing is broken) and `ready` (everything is proven)
 * are reported separately.
 *
 * ── Why nullability is checked and not assumed ─────────────────────────────
 * 504 creates retries_total NOT NULL DEFAULT 0; 507 removes both. Drizzle
 * declares the column nullable. If 504 lands and 507 does not — the runner
 * halts on failure, so this is a real sequence — the ORM and the database
 * disagree in a direction tests cannot catch, because tests do not run against
 * production's schema. An insert of NULL then fails at runtime, in the
 * collector, at night.
 *
 * Pure: no DB, no clock, no I/O. The caller measures; this judges.
 */

export type CheckState =
  /** Verified. */
  | 'pass'
  /** Verified to be wrong. */
  | 'fail'
  /** Cannot be true yet, and that is expected. Not a failure. */
  | 'pending'
  /** Could not be measured. Neither reassuring nor alarming. */
  | 'unknown';

export interface DeployCheck {
  id: string;
  /** The owner's step number, so the output maps onto the agreed checklist. */
  step: number;
  title: string;
  state: CheckState;
  /** What was measured, with the values that produced the verdict. */
  detail: string;
  /** What to do about it. Empty when passing. */
  remedy: string;
}

export interface DeployVerification {
  /** True when nothing is broken. A `pending` telemetry check does not clear this. */
  ok: boolean;
  /** True only when every check passes, telemetry included. */
  ready: boolean;
  checks: DeployCheck[];
  headline: string;
}

export interface LedgerEntry {
  filename: string;
  appliedAt: string | null;
  /** Non-null when the file on disk no longer matches what was applied. */
  driftedTo: string | null;
}

export interface ColumnFact {
  table: string;
  column: string;
  isNullable: boolean;
  hasDefault: boolean;
}

export interface ExpectedColumn {
  table: string;
  column: string;
  /** What the ORM declares. A mismatch here is the 504-without-507 case. */
  mustBeNullable: boolean;
}

export interface TelemetryFacts {
  /** When the newest required migration landed. */
  migrationAppliedAt: string | null;
  /** seed_jobs rows created after that moment. */
  rowsSince: number;
  /** Of those, how many carry a non-null retries_total. */
  rowsSinceInstrumented: number;
  /** Newest such row, for the message. */
  newestRowAt: string | null;
}

export interface DeployFacts {
  /** The highest migration this package requires, e.g. '507_...sql'. */
  targetMigration: string;
  /** Every migration the package requires, in order. */
  requiredMigrations: readonly string[];
  ledger: readonly LedgerEntry[];
  /** Migration files known but not applied. */
  pending: readonly string[];
  /** What the database actually has, for the columns below. */
  columns: readonly ColumnFact[];
  /** What the ORM declares. */
  expectedColumns: readonly ExpectedColumn[];
  telemetry: TelemetryFacts | null;
  /** Why telemetry could not be measured, when it could not. */
  telemetryError?: string | null;
}

const pass = (id: string, step: number, title: string, detail: string): DeployCheck =>
  ({ id, step, title, state: 'pass', detail, remedy: '' });

export function verifyDeployment(f: DeployFacts): DeployVerification {
  const checks: DeployCheck[] = [
    checkSchemaVersion(f),
    checkMigrationsApplied(f),
    checkColumnsExist(f),
    checkOrmAgreement(f),
    checkTelemetryFlowing(f),
  ];

  const failed  = checks.filter(c => c.state === 'fail');
  const pending = checks.filter(c => c.state === 'pending');
  const unknown = checks.filter(c => c.state === 'unknown');

  const ok    = failed.length === 0;
  const ready = ok && pending.length === 0 && unknown.length === 0;

  const headline =
    !ok      ? `DEPLOY NOT VERIFIED — ${failed.length} check(s) failed: ` +
               failed.map(c => c.title).join('; ') + '.'
  : ready    ? 'Package verified end to end, including live telemetry.'
  : pending.length
             ? `Schema verified; ${pending.length} check(s) cannot be confirmed yet — ` +
               pending.map(c => c.title).join('; ') +
               '. Nothing is wrong; re-run after the next nightly collection.'
             : `Schema verified, but ${unknown.length} check(s) could not be measured: ` +
               unknown.map(c => c.title).join('; ') + '.';

  return { ok, ready, checks, headline };
}

// ── 1. The build reports the expected schema version ────────────────────────

function checkSchemaVersion(f: DeployFacts): DeployCheck {
  const applied = f.ledger.filter(e => e.appliedAt).map(e => e.filename).sort();
  const latest  = applied.length ? applied[applied.length - 1] : null;

  if (latest === f.targetMigration) {
    return pass('schema-version', 1, 'schemaLatest is the target migration',
      `Newest applied migration is ${latest}.`);
  }
  return {
    id: 'schema-version', step: 1, title: 'schemaLatest is the target migration',
    state: 'fail',
    detail: `Newest applied migration is ${latest ?? '(none)'}, expected ${f.targetMigration}.`,
    remedy: latest && latest < f.targetMigration
      ? 'The deployment did not boot with the new files, or the runner halted. Check the ' +
        'boot log for "[migrate] FAILED".'
      : 'The deployed build is ahead of what this check expects — update targetMigration.',
  };
}

// ── 2. Every required migration is applied, none pending, none drifted ──────

function checkMigrationsApplied(f: DeployFacts): DeployCheck {
  const byName = new Map(f.ledger.map(e => [e.filename, e]));
  const missing: string[] = [];
  const drifted: string[] = [];

  for (const name of f.requiredMigrations) {
    const e = byName.get(name);
    if (!e || !e.appliedAt) { missing.push(name); continue; }
    if (e.driftedTo) drifted.push(name);
  }

  const stillPending = f.requiredMigrations.filter(m => f.pending.includes(m));

  if (!missing.length && !drifted.length) {
    return pass('migrations-applied', 2, 'All required migrations applied',
      `${f.requiredMigrations.length} migration(s) applied with no checksum drift.`);
  }

  return {
    id: 'migrations-applied', step: 2, title: 'All required migrations applied',
    state: 'fail',
    detail:
      (missing.length ? `Not applied: ${missing.join(', ')}. ` : '') +
      (stillPending.length ? `Reported pending: ${stillPending.join(', ')}. ` : '') +
      (drifted.length ? `Checksum drift (file changed since it was applied): ${drifted.join(', ')}.` : ''),
    remedy: missing.length
      // The runner halts rather than skipping, so the FIRST missing one is the cause.
      ? `The runner halts after a failure, so ${missing[0]} is the one to diagnose — ` +
        'everything after it was skipped deliberately.'
      : 'A drifted migration was edited after being applied. It is not re-run automatically. ' +
        'Decide whether the database needs the newer version.',
  };
}

// ── 3. The columns exist ────────────────────────────────────────────────────

function checkColumnsExist(f: DeployFacts): DeployCheck {
  const have = new Set(f.columns.map(c => `${c.table}.${c.column}`));
  const absent = f.expectedColumns
    .map(e => `${e.table}.${e.column}`)
    .filter(k => !have.has(k));

  if (!absent.length) {
    return pass('columns-exist', 3, 'Diagnostic columns exist',
      `All ${f.expectedColumns.length} column(s) present.`);
  }
  return {
    id: 'columns-exist', step: 3, title: 'Diagnostic columns exist',
    state: 'fail',
    detail: `${absent.length} of ${f.expectedColumns.length} missing: ${absent.join(', ')}.`,
    remedy: 'The migration reported applied but the column is absent — check for a manual ' +
            'schema change, or a database other than the one the app is connected to.',
  };
}

// ── 4. The database and the ORM agree about nullability ─────────────────────

function checkOrmAgreement(f: DeployFacts): DeployCheck {
  const byKey = new Map(f.columns.map(c => [`${c.table}.${c.column}`, c]));
  const disagreements: string[] = [];

  for (const e of f.expectedColumns) {
    const key = `${e.table}.${e.column}`;
    const actual = byKey.get(key);
    if (!actual) continue;                      // check 3 owns absence
    if (actual.isNullable !== e.mustBeNullable) {
      disagreements.push(
        `${key}: database ${actual.isNullable ? 'nullable' : 'NOT NULL'}, ` +
        `ORM declares ${e.mustBeNullable ? 'nullable' : 'NOT NULL'}`);
    } else if (e.mustBeNullable && actual.hasDefault) {
      // 507 drops the DEFAULT as well as the NOT NULL. A surviving default
      // silently restores the confident zero the migration exists to remove.
      disagreements.push(`${key}: nullable but still carries a DEFAULT, which reinstates a ` +
                         `fabricated value for rows that were never measured`);
    }
  }

  if (!disagreements.length) {
    return pass('orm-agreement', 4, 'Database nullability matches the ORM',
      `${f.expectedColumns.length} column(s) agree, defaults included.`);
  }
  return {
    id: 'orm-agreement', step: 4, title: 'Database nullability matches the ORM',
    state: 'fail',
    detail: disagreements.join('; ') + '.',
    remedy: 'This is the 504-applied-without-507 case. Tests cannot catch it because they do ' +
            'not run against production schema; it surfaces as a runtime insert failure in ' +
            'the collector, at night. Apply the outstanding migration.',
  };
}

// ── 5. The instrumentation is recording, not merely present ─────────────────

function checkTelemetryFlowing(f: DeployFacts): DeployCheck {
  const id = 'telemetry-flowing', step = 5;
  const title = 'New telemetry is being populated';

  if (f.telemetryError) {
    return { id, step, title, state: 'unknown',
      detail: `Could not measure: ${f.telemetryError}`,
      remedy: 'Re-run this check once the query can complete.' };
  }
  const t = f.telemetry;
  if (!t) {
    return { id, step, title, state: 'unknown',
      detail: 'No telemetry measurement was supplied.',
      remedy: 'The caller must query seed_jobs for rows created after the migration.' };
  }
  if (!t.migrationAppliedAt) {
    return { id, step, title, state: 'pending',
      detail: 'The migration has not been applied, so no row could carry the new columns yet.',
      remedy: 'Resolve the migration checks above first.' };
  }

  // The distinction this whole check exists for.
  if (t.rowsSince === 0) {
    return { id, step, title, state: 'pending',
      detail: `No collection job has run since the migration landed at ${t.migrationAppliedAt}. ` +
              'A successful migration proves the schema changed; only a run proves the ' +
              'instrumentation records anything.',
      remedy: 'Re-run this check after the next nightly collection. Nothing is wrong yet.' };
  }

  if (t.rowsSinceInstrumented === 0) {
    return { id, step, title, state: 'fail',
      detail: `${t.rowsSince} job(s) have run since ${t.migrationAppliedAt} and NONE carries ` +
              'retry accounting. The columns exist and the collector is not writing them.',
      remedy: 'The schema landed but the code that fills it did not, or the deployed build ' +
              'predates it. Compare the build stamp against the commit that added the ' +
              'instrumented loop.' };
  }

  if (t.rowsSinceInstrumented < t.rowsSince) {
    return { id, step, title, state: 'fail',
      detail: `${t.rowsSinceInstrumented} of ${t.rowsSince} job(s) since the migration carry ` +
              'retry accounting. A partial rollout writes the columns on some paths and not ' +
              'others, which is harder to spot than none at all.',
      remedy: 'Find the job path that does not record. A NULL here is indistinguishable from ' +
              'a pre-instrumentation row, so the gap will not announce itself later.' };
  }

  return pass(id, step, title,
    `All ${t.rowsSince} job(s) since ${t.migrationAppliedAt} carry retry accounting` +
    (t.newestRowAt ? `, most recently ${t.newestRowAt}.` : '.'));
}
