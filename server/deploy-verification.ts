/**
 * deploy-verification.ts — did the finance package actually land, and has the
 * running system PROVEN it?
 *
 * WHY THIS IS CODE AND NOT A MARKDOWN CHECKLIST. A checklist cannot fail. It is
 * read on the first deploy, skimmed on the second and skipped on the third —
 * and the third is the one that needed it. A checklist records what someone
 * intended to do; this reports what the running system has demonstrated.
 *
 * ── Three kinds of verification, deliberately separated ────────────────────
 *   SCHEMA    the migrations applied and the columns exist
 *   CODE      the build running right now is the one that was meant to ship
 *   RUNTIME   the nightly process exercised the new code and wrote to it
 *
 * They fail independently and they fail differently. On 2026-09-04 the source
 * tree held the rating fix while production ran commit 4055d7a9 at schema 503:
 * every schema check would have passed on the repository and none of it was
 * deployed. Only asking the running process reveals that.
 *
 * ── Why `pending` is a state and not a failure ─────────────────────────────
 * Migrations 504-507 add columns whose entire purpose is to be filled by the
 * nightly collector. A successful migration proves the schema changed and
 * nothing else. Until a collection has RUN and COMPLETED, the runtime checks
 * are `PENDING`.
 *
 * Collapsing that into `FAIL` pages someone at 03:00 for a deploy that went
 * perfectly. Collapsing it into `PASS` reports the package verified when the
 * only thing verified is that Postgres accepted four ALTER statements. So
 * `ok` (nothing is broken) and `ready` (everything is proven) are separate,
 * and immediately after a good deploy the honest answer is ok=true ready=false.
 *
 * ── The runtime chain ──────────────────────────────────────────────────────
 * "A job started" is not enough — it is exactly the claim that hides a run
 * which started and immediately crashed. The chain is checked link by link:
 *
 *   migration applied → job started → job COMPLETED → retry telemetry written
 *                     → worker metadata written → day sentinel written
 *
 * Each link is its own check so the output names where the chain stopped, and
 * a link whose prerequisite has not happened is PENDING rather than FAIL:
 * telemetry cannot be faulted for being absent when nothing has run to write
 * it. Only a link that HAD its opportunity and did not deliver fails.
 *
 * Pure: no DB, no clock, no I/O. The caller measures; this judges.
 */

export type CheckStatus =
  /** Verified. */
  | 'PASS'
  /** Verified to be wrong. */
  | 'FAIL'
  /** Cannot be true yet, and that is expected. Not a failure. */
  | 'PENDING'
  /**
   * Nothing is broken, and nothing will happen either — the system is in a
   * state that prevents progress until someone acts.
   *
   * Split out of PENDING because the two are operationally opposite. PENDING
   * says "wait"; BLOCKED says "waiting will not help". A disarmed collector
   * reported as PENDING reads as "the nightly window has not come yet" and
   * stays that way forever, which is the exact wait-forever ambiguity this
   * module exists to remove elsewhere.
   */
  | 'BLOCKED'
  /** Could not be measured. Neither reassuring nor alarming. */
  | 'UNKNOWN';

export interface DeployCheck {
  id: string;
  /** The agreed checklist step this belongs to. */
  step: number;
  title: string;
  status: CheckStatus;
  /** What was measured, with the values that produced the verdict. */
  detail: string;
  /** What to do about it. Empty when passing. */
  remedy: string;
  /**
   * The numbers behind the verdict, structured.
   *
   * Not new instrumentation: every value here is already recorded by the
   * collector or the sentinel. Exposing them makes a REGRESSION visible while
   * the check still passes — a run that seals correctly but takes six times as
   * long is a warning that a boolean cannot carry.
   */
  metrics?: Record<string, number | string | null>;
}

export interface DeployOverall {
  /**
   * The top line. PASS only when every check passed; otherwise the most
   * actionable state present, ranked FAIL > BLOCKED > PENDING > UNKNOWN.
   *
   * A MONITOR SHOULD KEY ON THIS, not on `ok`. `ok` answers "has anything
   * failed", which stays true while a BLOCKED deployment sits making no
   * progress forever — green on a system that will never finish.
   */
  status: CheckStatus;
  /** Nothing is known to be BROKEN. Does not mean the deployment is progressing. */
  ok: boolean;
  /** Everything has been exercised successfully. */
  ready: boolean;
  headline: string;
}

export interface DeployVerification {
  overall: DeployOverall;
  checks: DeployCheck[];
  /** Echoed so a caller sees what it is running against without a second call. */
  runtime: VersionFacts & { expectedSchema: string };
}

export interface VersionFacts {
  gitCommit: string | null;
  gitBranch: string | null;
  buildTime: string | null;
  environment: string | null;
  /** Newest migration the DATABASE reports, read live. */
  schemaLatest: string | null;
  /**
   * Optional caller assertion: the commit that was supposed to be deployed.
   * Supplied by CI or an operator; the process cannot know it on its own,
   * which is precisely why the mismatch went unnoticed for two days.
   */
  expectedCommit?: string | null;
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

/** The nightly chain, measured. All counts are since the migration landed. */
export interface RunFacts {
  migrationAppliedAt: string | null;
  jobsStarted: number;
  /** Still in flight. A run in progress is not a failure. */
  jobsRunning: number;
  /** Ended in error, or died without finishing. */
  jobsFailed: number;
  /** Reached status 'done'. */
  jobsCompleted: number;
  /** Of the completed jobs, how many carry a non-null retries_total. */
  completedWithRetryTelemetry: number;
  /** Of the completed jobs, how many carry a non-null worker_id. */
  completedWithWorkerMetadata: number;
  /** `recon-<date>` rows at status done — the day-completion sentinel. */
  daySentinels: number;
  newestCompletedAt: string | null;
  /**
   * The newest SEALED day, and whether it was actually complete.
   *
   * `expectedAccounts` is the roster the planner built, which the sentinel row
   * records as total_slices. `collectedAccounts` counts the per-account rows
   * that actually finished clean. Those are separate quantities from separate
   * writers, which is what makes this a check rather than a restatement: the
   * sealing condition tests ERRORS (failed === 0, no last_error), never counts,
   * so a path that drops an account without recording a failure seals a short
   * day and nothing today would notice.
   */
  coverage: {
    day: string | null;
    expectedAccounts: number;
    collectedAccounts: number;
    /**
     * Accounts that RAN and did not finish clean — a non-done status, or done
     * with last_error set.
     *
     * Measured, never derived as expected − collected. Those two subtractions
     * look identical and mean opposite things: an account that ran and errored
     * left evidence and a reason, while an account the loop never reached left
     * nothing at all. The second is the shape of the 2026-09-02 failure and
     * would be invisible if it were folded into a single "failed" number.
     */
    failedAccounts: number;
    sealedAt: string | null;
  } | null;
  /**
   * The collector's arm state, as the scheduler already publishes it.
   *
   * Read, never inferred: `_forwardCapture.mode` is set every tick from the
   * same ArmState the scheduler gates on, so this reports the decision that
   * actually governs whether a job can exist. No new persistence, no second
   * source of truth to drift.
   */
  arm: {
    /** null when the state could not be read — distinct from disarmed. */
    armed: boolean | null;
    /** flag | env | both | none — the operator's first question. */
    source: string | null;
    /** Composed by forward-capture-arm.ts; names the next action. */
    hint: string | null;
    /** Operating from a remembered flag value because the live read failed. */
    cached: boolean;
  } | null;
  /** Already-recorded numbers, surfaced so a regression is visible early. */
  timings: {
    /** Sentinel started_at → finished_at. */
    sealDurationSeconds: number | null;
    /** Calls stored by the sealed run. */
    rowsWritten: number | null;
    /** Worst queue wait across the sealed day's accounts (migration 505). */
    maxQueueWaitMs: number | null;
    /** Total retry backoff across the sealed day (migration 504). */
    totalBackoffMs: number | null;
  } | null;
}

export interface DeployFacts {
  /** The highest migration this package requires, e.g. '507_...sql'. */
  targetMigration: string;
  requiredMigrations: readonly string[];
  ledger: readonly LedgerEntry[];
  pending: readonly string[];
  columns: readonly ColumnFact[];
  expectedColumns: readonly ExpectedColumn[];
  version: VersionFacts;
  run: RunFacts | null;
  /** Why the runtime chain could not be measured, when it could not. */
  runError?: string | null;
}

const pass = (id: string, step: number, title: string, detail: string): DeployCheck =>
  ({ id, step, title, status: 'PASS', detail, remedy: '' });

const pending = (id: string, step: number, title: string, detail: string, remedy: string): DeployCheck =>
  ({ id, step, title, status: 'PENDING', detail, remedy });

const fail = (id: string, step: number, title: string, detail: string, remedy: string): DeployCheck =>
  ({ id, step, title, status: 'FAIL', detail, remedy });

export function verifyDeployment(f: DeployFacts): DeployVerification {
  const checks: DeployCheck[] = [
    checkRuntimeVersion(f),
    checkMigrationsApplied(f),
    checkColumnsExist(f),
    checkOrmAgreement(f),
    ...checkRuntimeChain(f),
  ];

  const failed  = checks.filter(c => c.status === 'FAIL');
  const blocked = checks.filter(c => c.status === 'BLOCKED');
  const waiting = checks.filter(c => c.status === 'PENDING');
  const unknown = checks.filter(c => c.status === 'UNKNOWN');

  const ok    = failed.length === 0;
  const ready = ok && blocked.length === 0 && waiting.length === 0 && unknown.length === 0;

  // Most actionable first. BLOCKED outranks PENDING because one of them can be
  // resolved and the other can only be waited on.
  const status: CheckStatus =
    failed.length  ? 'FAIL'
  : ready          ? 'PASS'
  : blocked.length ? 'BLOCKED'
  : waiting.length ? 'PENDING'
                   : 'UNKNOWN';

  const headline =
    failed.length  ? `DEPLOY NOT VERIFIED — ${failed.length} check(s) failed: ` +
                     failed.map(c => c.title).join('; ') + '.'
  : ready          ? 'Package verified end to end, including a completed nightly run.'
  : blocked.length ? 'Schema and build verified, but verification CANNOT PROCEED: ' +
                     blocked.map(c => c.title).join('; ') + '. ' +
                     'This will not resolve by waiting — see the remedy.'
  : waiting.length ? `Schema and build verified; ${waiting.length} runtime check(s) cannot be ` +
                     `confirmed yet — ${waiting.map(c => c.title).join('; ')}. Nothing is wrong; ` +
                     're-run after the next nightly collection completes.'
                   : `Verified so far, but ${unknown.length} check(s) could not be measured: ` +
                     unknown.map(c => c.title).join('; ') + '.';

  return {
    overall: { status, ok, ready, headline },
    checks,
    runtime: { ...f.version, expectedSchema: f.targetMigration },
  };
}

// ── 1. Is the running build the one that was meant to ship? ─────────────────

function checkRuntimeVersion(f: DeployFacts): DeployCheck {
  const id = 'runtime-version', step = 1;
  const title = 'Running build and schema are the expected ones';
  const v = f.version;
  const where = `commit ${v.gitCommit ?? 'unknown'} (${v.gitBranch ?? '?'}), built ` +
                `${v.buildTime ?? 'unknown'}, env ${v.environment ?? 'unknown'}`;

  // The caller's assertion, when it supplied one. The process cannot know what
  // it was SUPPOSED to be — which is why 4055d7a9 ran for two days unnoticed.
  if (v.expectedCommit && v.gitCommit && v.expectedCommit !== v.gitCommit) {
    return fail(id, step, title,
      `Running ${v.gitCommit}, expected ${v.expectedCommit}. ${where}. ` +
      `Schema is ${v.schemaLatest ?? '(unreadable)'}.`,
      'The deployment did not pick up the intended commit. Redeploy; every other check ' +
      'below is describing the WRONG BUILD and cannot be trusted as evidence for this one.');
  }

  if (v.schemaLatest !== f.targetMigration) {
    return fail(id, step, title,
      `Schema is ${v.schemaLatest ?? '(unreadable)'}, expected ${f.targetMigration}. ${where}.`,
      v.schemaLatest && v.schemaLatest < f.targetMigration
        ? 'The running build did not apply the new migrations, or the runner halted. Check the ' +
          'boot log for "[migrate] FAILED", and confirm this process is talking to the database ' +
          'you think it is.'
        : 'The database is ahead of what this package expects — update targetMigration.');
  }

  return pass(id, step, title,
    `Schema ${v.schemaLatest} matches the expected ${f.targetMigration}. Running ${where}.` +
    (v.expectedCommit ? ` Commit matches the expected ${v.expectedCommit}.` : ''));
}

// ── 2. Every required migration applied, none pending, none drifted ─────────

function checkMigrationsApplied(f: DeployFacts): DeployCheck {
  const id = 'migrations-applied', step = 2;
  const title = 'All required migrations applied';
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
    return pass(id, step, title,
      `${f.requiredMigrations.length} migration(s) applied with no checksum drift.`);
  }

  return fail(id, step, title,
    (missing.length ? `Not applied: ${missing.join(', ')}. ` : '') +
    (stillPending.length ? `Reported pending: ${stillPending.join(', ')}. ` : '') +
    (drifted.length ? `Checksum drift (file changed since it was applied): ${drifted.join(', ')}.` : ''),
    missing.length
      // The runner halts rather than skipping, so the FIRST one is the cause.
      ? `The runner halts after a failure, so ${missing[0]} is the one to diagnose — ` +
        'everything after it was skipped deliberately.'
      : 'A drifted migration was edited after being applied. It is not re-run automatically. ' +
        'Decide whether the database needs the newer version.');
}

// ── 3. The columns exist ────────────────────────────────────────────────────

function checkColumnsExist(f: DeployFacts): DeployCheck {
  const id = 'columns-exist', step = 3, title = 'Diagnostic columns exist';
  const have = new Set(f.columns.map(c => `${c.table}.${c.column}`));
  const absent = f.expectedColumns.map(e => `${e.table}.${e.column}`).filter(k => !have.has(k));

  if (!absent.length) {
    return pass(id, step, title, `All ${f.expectedColumns.length} column(s) present.`);
  }
  return fail(id, step, title,
    `${absent.length} of ${f.expectedColumns.length} missing: ${absent.join(', ')}.`,
    'The migration reported applied but the column is absent — check for a manual schema ' +
    'change, or a database other than the one this process is connected to.');
}

// ── 4. The database and the ORM agree ───────────────────────────────────────

function checkOrmAgreement(f: DeployFacts): DeployCheck {
  const id = 'orm-agreement', step = 4;
  const title = 'Database nullability matches the ORM';
  const byKey = new Map(f.columns.map(c => [`${c.table}.${c.column}`, c]));
  const disagreements: string[] = [];

  // Counted, not assumed. Reporting expectedColumns.length as "agree" claimed
  // agreement about columns this check never saw — the same absence-as-evidence
  // fault the rest of this file exists to prevent.
  let verified = 0;

  for (const e of f.expectedColumns) {
    const key = `${e.table}.${e.column}`;
    const actual = byKey.get(key);
    if (!actual) continue;                      // check 3 owns absence
    verified++;
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
    const unseen = f.expectedColumns.length - verified;
    return pass(id, step, title,
      `${verified} of ${f.expectedColumns.length} column(s) agree, defaults included.` +
      (unseen > 0 ? ` ${unseen} not present to compare — see “Diagnostic columns exist”.` : ''));
  }
  return fail(id, step, title, disagreements.join('; ') + '.',
    'This is the 504-applied-without-507 case. Tests cannot catch it because they do not run ' +
    'against production schema; it surfaces as a runtime insert failure in the collector, at ' +
    'night. Apply the outstanding migration.');
}

// ── 5. The runtime chain, link by link ──────────────────────────────────────

function checkRuntimeChain(f: DeployFacts): DeployCheck[] {
  const step = 5;
  const ids = ['runtime-job', 'retry-telemetry', 'worker-metadata',
               'day-sentinel', 'day-coverage'] as const;
  const titles: Record<typeof ids[number], string> = {
    'runtime-job':     'A nightly collection has COMPLETED',
    'retry-telemetry': 'Retry accounting is being written',
    'worker-metadata': 'Worker attribution is being written',
    'day-sentinel':    'A day-completion sentinel has been written',
    'day-coverage':    'The sealed day covered every expected account',
  };

  const allWith = (status: CheckStatus, detail: string, remedy: string): DeployCheck[] =>
    ids.map(id => ({ id, step, title: titles[id], status, detail, remedy }));

  if (f.runError) {
    return allWith('UNKNOWN', `Could not measure: ${f.runError}`,
      'Re-run this check once the query can complete.');
  }
  const r = f.run;
  if (!r) {
    return allWith('UNKNOWN', 'No runtime measurement was supplied.',
      'The caller must query seed_jobs for activity since the migration.');
  }
  if (!r.migrationAppliedAt) {
    return allWith('PENDING',
      'The migration has not been applied, so nothing could have exercised it yet.',
      'Resolve the migration checks above first.');
  }

  const since = `since the migration landed at ${r.migrationAppliedAt}`;

  // ── Link 1: a job started, and one COMPLETED ──────────────────────────────
  // "Started" alone is the claim that hides a run which crashed immediately,
  // which is exactly the failure this deploy is most exposed to.
  let job: DeployCheck;
  if (r.jobsStarted === 0 && r.arm?.armed === false) {
    // BLOCKED, not PENDING. The nightly tick returns before the reconciliation
    // when disarmed, so it creates no job rows at all — waiting for the window
    // cannot change this, and reporting "nothing is wrong yet" would be a
    // wait-forever answer to a question with an action attached.
    job = {
      id: ids[0], step, title: titles[ids[0]], status: 'BLOCKED',
      detail: `No collection job has started ${since}, and the collector is DISARMED ` +
              `(source: ${r.arm.source ?? 'unknown'}` +
              (r.arm.cached ? ', from a cached flag value' : '') + '). ' +
              'The nightly tick reports what it WOULD collect and fetches nothing, so no job ' +
              'row can appear however long you wait.',
      remedy: r.arm.hint
        ? `Arm the collector, then re-run this check. ${r.arm.hint}`
        : 'Arm the collector, then re-run this check.',
      metrics: { armed: 0, armSource: r.arm.source ?? null, armCached: r.arm.cached ? 1 : 0 },
    };
  } else if (r.jobsStarted === 0) {
    // Armed, or the arm state could not be read. Either way nothing has run
    // yet and waiting is still the right advice — but say which it is.
    const unreadable = r.arm == null || r.arm.armed == null;
    job = pending(ids[0], step, titles[ids[0]],
      `No collection job has started ${since}.` +
      (unreadable
        ? ' The collector\'s arm state could not be read, so this cannot distinguish ' +
          '"the window has not come" from "the collector is disarmed".'
        : ` The collector is armed (source: ${r.arm!.source ?? 'unknown'}), so the next ` +
          'window should produce one.'),
      unreadable
        ? 'Re-run after the next nightly collection. If it is still PENDING, check the boot ' +
          'log for "OBSERVE-ONLY" before concluding you are still waiting.'
        : 'Re-run after the next nightly collection. Nothing is wrong yet.');
  } else if (r.jobsCompleted > 0) {
    job = pass(ids[0], step, titles[ids[0]],
      `${r.jobsCompleted} of ${r.jobsStarted} job(s) ${since} reached status done` +
      (r.newestCompletedAt ? `, most recently ${r.newestCompletedAt}.` : '.'));
  } else if (r.jobsRunning > 0) {
    job = pending(ids[0], step, titles[ids[0]],
      `${r.jobsRunning} job(s) started ${since} and are still running. None has completed yet.`,
      'Re-run when the collection finishes. A run in progress is not a failure.');
  } else {
    job = fail(ids[0], step, titles[ids[0]],
      `${r.jobsStarted} job(s) started ${since} and NONE completed — ` +
      `${r.jobsFailed} ended in error or died. The schema landed and the first run did not survive.`,
      'This is the case a migration-only check would have reported as a successful deploy. ' +
      'Read the newest seed_jobs row\'s last_error, and retry_causes if it was populated.');
  }

  // Downstream links have had no opportunity unless something completed.
  // Downstream links carry ONE cause, not five copies of it. They stay PENDING
  // and point at the link that actually needs acting on — the same shape used
  // for a failed run, so an operator reads one row and acts once.
  const noOpportunity = (id: typeof ids[number]): DeployCheck =>
    pending(id, step, titles[id],
      job.status === 'FAIL'    ? 'No job has completed, so nothing could have written this.'
    : job.status === 'BLOCKED' ? 'The collector is disarmed, so no job can write this.'
                               : `Waiting on the first completed collection ${since}.`,
      job.status === 'FAIL'    ? 'Blocked by the failed run above; fix that first.'
    : job.status === 'BLOCKED' ? 'Blocked by the disarmed collector above; arm it first.'
                               : 'Re-run after the next nightly collection completes. Nothing is wrong yet.');

  const populated = (
    id: typeof ids[number], count: number, what: string, column: string,
  ): DeployCheck => {
    if (r.jobsCompleted === 0) return noOpportunity(id);
    if (count === 0) {
      return fail(id, step, titles[id],
        `${r.jobsCompleted} job(s) completed ${since} and NONE carries ${what}. ` +
        `The column ${column} exists and the collector is not writing it.`,
        `Nothing writes ${column}. The schema landed but the code that fills it did not, or the ` +
        'deployed build predates the instrumented loop. Compare the build stamp above against ' +
        'the commit that added it.');
    }
    if (count < r.jobsCompleted) {
      return fail(id, step, titles[id],
        `${count} of ${r.jobsCompleted} completed job(s) carry ${what}. A partial rollout ` +
        'writes the column on some paths and not others.',
        `Find the job path that does not record ${column}. A NULL there is indistinguishable ` +
        'from a pre-instrumentation row, so the gap will not announce itself later.');
    }
    return pass(id, step, titles[id],
      `All ${r.jobsCompleted} completed job(s) ${since} carry ${what}.`);
  };

  const retry  = populated(ids[1], r.completedWithRetryTelemetry, 'retry accounting', 'retries_total');
  const worker = populated(ids[2], r.completedWithWorkerMetadata, 'worker attribution', 'worker_id');

  // ── Link 4: the day sentinel ──────────────────────────────────────────────
  // Per-account done rows prove those accounts ran, never that the day
  // finished. `recon-<date>` at status done is the platform's own claim that a
  // business day is complete, and it is the only thing that means collected.
  let sentinel: DeployCheck;
  if (r.jobsCompleted === 0) {
    sentinel = noOpportunity(ids[3]);
  } else if (r.daySentinels > 0) {
    sentinel = pass(ids[3], step, titles[ids[3]],
      `${r.daySentinels} day sentinel(s) written ${since}.`);
  } else {
    sentinel = fail(ids[3], step, titles[ids[3]],
      `${r.jobsCompleted} job(s) completed ${since} but no day-completion sentinel was written. ` +
      'Per-account done rows prove those accounts ran, never that the day finished — a ' +
      'sentinel-less day is re-collected in full on the next pass.',
      'The run completed per account and stopped before sealing the day. Check whether every ' +
      'account in scope reached done; the sentinel is only written when all of them do.');
  }

  // ── Link 5: did the sealed day actually cover every account? ──────────────
  // A sentinel proves the scheduler BELIEVED the day finished. It does not
  // prove every expected account was processed, because the sealing condition
  // tests errors — `failed === 0` and no last_error — and never counts. A path
  // that drops an account without recording a failure seals a short day, and
  // sealing is irreversible in practice: nightly-ingest-due treats a done
  // sentinel as collected forever. This is the guard for that.
  const coverage = checkDayCoverage(r, sentinel, ids[4], step, titles[ids[4]], noOpportunity);

  return [
    withMetrics(job, {
      jobsStarted: r.jobsStarted, jobsCompleted: r.jobsCompleted,
      jobsRunning: r.jobsRunning, jobsFailed: r.jobsFailed,
      sealDurationSeconds: r.timings?.sealDurationSeconds ?? null,
      // Present on every runtime-job result, not only when it blocks: "the
      // collector was armed" is context for a PASS as much as for a stall.
      armed: r.arm?.armed == null ? null : (r.arm.armed ? 1 : 0),
    }),
    withMetrics(retry, {
      completedJobs: r.jobsCompleted,
      withRetryTelemetry: r.completedWithRetryTelemetry,
      rowsWritten: r.timings?.rowsWritten ?? null,
      totalBackoffMs: r.timings?.totalBackoffMs ?? null,
    }),
    withMetrics(worker, {
      completedJobs: r.jobsCompleted,
      withWorkerMetadata: r.completedWithWorkerMetadata,
      maxQueueWaitMs: r.timings?.maxQueueWaitMs ?? null,
    }),
    withMetrics(sentinel, { daySentinels: r.daySentinels }),
    coverage,
  ];
}

/**
 * Add the general metrics without discarding any a check set for itself.
 *
 * Merged, not replaced: the BLOCKED branch records the arm state that produced
 * its verdict, and a blanket assignment here silently threw that away — the
 * evidence for a check vanishing on its way out of the function.
 */
function withMetrics(c: DeployCheck, metrics: Record<string, number | string | null>): DeployCheck {
  return { ...c, metrics: { ...(c.metrics ?? {}), ...metrics } };
}

function checkDayCoverage(
  r: RunFacts,
  sentinel: DeployCheck,
  id: string, step: number, title: string,
  noOpportunity: (id: any) => DeployCheck,
): DeployCheck {
  // Nothing sealed means nothing to measure coverage OF. Not a failure — the
  // sentinel check above already owns the "should have sealed" question.
  if (sentinel.status !== 'PASS') {
    const c = noOpportunity(id);
    return { ...c, id, title,
      detail: sentinel.status === 'FAIL'
        ? 'No day has been sealed, so there is no sealed day to check the coverage of.'
        : c.detail };
  }

  const cov = r.coverage;
  if (!cov || cov.day == null) {
    return { id, step, title, status: 'UNKNOWN',
      detail: 'A sentinel exists but its account roster could not be read.',
      remedy: 'Without the roster this cannot distinguish a complete day from a short one. ' +
              'Check that the sentinel row carries total_slices.',
      metrics: { expectedAccounts: null, collectedAccounts: null } };
  }

  // Three buckets, not two. Whatever is neither collected nor failed was never
  // attempted — the loop did not reach it — and that is a different fault from
  // an account that ran and errored. Clamped at zero so a roster smaller than
  // the rows collected cannot produce a negative count.
  const notAttempted = Math.max(0,
    cov.expectedAccounts - cov.collectedAccounts - cov.failedAccounts);

  // Convenience for dashboards. The counts above remain authoritative; this is
  // null rather than 0 when there is no denominator, for the same reason an
  // unreadable figure is never zero.
  const percentage = cov.expectedAccounts > 0
    ? Math.round((cov.collectedAccounts / cov.expectedAccounts) * 1000) / 10
    : null;

  const m = {
    day: cov.day,
    expected:     cov.expectedAccounts,
    completed:    cov.collectedAccounts,
    failed:       cov.failedAccounts,
    notAttempted,
    percentage,
    sealedAt: cov.sealedAt,
  };

  if (cov.expectedAccounts === 0) {
    return { id, step, title, status: 'UNKNOWN',
      detail: `${cov.day} sealed with an empty roster (total_slices 0), so there is nothing ` +
              'to compare the collected accounts against.',
      remedy: 'A day sealed against no accounts is either a genuinely empty roster or a ' +
              'planner that returned nothing. Confirm which before trusting the seal.',
      metrics: m };
  }

  if (cov.collectedAccounts < cov.expectedAccounts) {
    // Name the two shortfalls separately — they point at different code.
    const shortfall = [
      cov.failedAccounts ? `${cov.failedAccounts} ran and failed` : null,
      notAttempted ? `${notAttempted} never attempted` : null,
    ].filter(Boolean).join(', ');

    return { id, step, title, status: 'FAIL',
      detail: `${cov.day} was SEALED with only ${cov.collectedAccounts} of ` +
              `${cov.expectedAccounts} expected account(s) collected (${percentage}%)` +
              (shortfall ? ` — ${shortfall}.` : '.') +
              ' The sentinel says the day is finished; the per-account rows say it is not.',
      remedy: 'FIRST, rule out a duplicate roster entry: `expected` is the planner\'s ' +
              'ready.length, and neither the roster query nor planByLifecycle applies DISTINCT ' +
              'on sippy_i_account — so two company rows sharing one account inflate `expected` ' +
              'while producing a single recon-<date>-<account> row, and this check fails on a ' +
              'collector that ran perfectly. Compare against ' +
              'SELECT sippy_i_account, count(*) FROM companies WHERE sippy_i_account IS NOT NULL ' +
              'GROUP BY 1 HAVING count(*) > 1. ' +
              'If the roster is clean, this is a day that will never be re-collected — ' +
              'nightly-ingest-due treats a done sentinel as collected forever, so the missing ' +
              'accounts are permanently unbilled unless the seal is removed. ' +
              (notAttempted
                ? `${notAttempted} account(s) left NO row at all, so start with why the loop ` +
                  'did not reach them rather than with the ones that errored. '
                : '') +
              `Identify the accounts with no clean recon-${cov.day}-<account> row.`,
      metrics: m };
  }

  if (cov.collectedAccounts > cov.expectedAccounts) {
    // Not a completeness risk — more was collected than planned, which happens
    // if the roster shrank mid-run. Reported rather than failed.
    return { id, step, title, status: 'PASS',
      detail: `${cov.day} sealed with ${cov.collectedAccounts} account(s) collected against a ` +
              `roster of ${cov.expectedAccounts}. More than expected is not a completeness ` +
              'risk — the roster likely shrank mid-run — but the two should normally agree.',
      remedy: '', metrics: m };
  }

  return { id, step, title, status: 'PASS',
    detail: `${cov.day} sealed with all ${cov.expectedAccounts} expected account(s) collected (100%)` +
            (cov.sealedAt ? ` at ${cov.sealedAt}.` : '.'),
    remedy: '', metrics: m };
}
