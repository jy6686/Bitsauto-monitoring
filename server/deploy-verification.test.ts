import { describe, it, expect } from 'vitest';
import { verifyDeployment, type DeployFacts } from './deploy-verification';

const REQUIRED = [
  '504_seed_job_retry_accounting.sql',
  '505_seed_job_diagnostics.sql',
  '506_company_lifecycle_changed_at.sql',
  '507_seed_job_retry_columns_nullable.sql',
] as const;

const EXPECTED = [
  { table: 'seed_jobs', column: 'retries_total',        mustBeNullable: true },
  { table: 'seed_jobs', column: 'backoff_ms',           mustBeNullable: true },
  { table: 'seed_jobs', column: 'pace_verdict',         mustBeNullable: true },
  { table: 'seed_jobs', column: 'retry_causes',         mustBeNullable: true },
  { table: 'seed_jobs', column: 'worker_id',            mustBeNullable: true },
  { table: 'seed_jobs', column: 'queued_at',            mustBeNullable: true },
  { table: 'seed_jobs', column: 'queue_wait_ms',        mustBeNullable: true },
  { table: 'companies', column: 'lifecycle_changed_at', mustBeNullable: true },
];

const ALL_COLUMNS = EXPECTED.map(e =>
  ({ table: e.table, column: e.column, isNullable: true, hasDefault: false }));

const APPLIED = '2026-09-05T02:00:00Z';

const good = (over: Partial<DeployFacts> = {}): DeployFacts => ({
  targetMigration: REQUIRED[3],
  requiredMigrations: [...REQUIRED],
  ledger: REQUIRED.map(f => ({ filename: f, appliedAt: APPLIED, driftedTo: null })),
  pending: [],
  columns: ALL_COLUMNS,
  expectedColumns: EXPECTED,
  version: {
    gitCommit: 'ed74aec0', gitBranch: 'feature/portal-framework',
    buildTime: '2026-09-05T01:55:00Z', environment: 'production',
    schemaLatest: REQUIRED[3],
  },
  run: {
    migrationAppliedAt: APPLIED,
    jobsStarted: 25, jobsRunning: 0, jobsFailed: 0, jobsCompleted: 25,
    completedWithRetryTelemetry: 25, completedWithWorkerMetadata: 25,
    daySentinels: 1, newestCompletedAt: '2026-09-06T01:14:00Z',
  },
  ...over,
});

const v = (f: DeployFacts) => verifyDeployment(f);
const find = (r: ReturnType<typeof verifyDeployment>, id: string) =>
  r.checks.find(c => c.id === id)!;

describe('a fully verified deployment', () => {
  it('passes every check and reports ready', () => {
    const r = v(good());
    expect(r.checks.every(c => c.status === 'PASS')).toBe(true);
    expect(r.overall).toMatchObject({ status: 'PASS', ok: true, ready: true });
    expect(r.overall.headline).toContain('completed nightly run');
  });

  it('echoes what it is running against, so no second call is needed', () => {
    const r = v(good());
    expect(r.runtime).toMatchObject({
      gitCommit: 'ed74aec0', environment: 'production',
      schemaLatest: REQUIRED[3], expectedSchema: REQUIRED[3],
    });
  });

  it('is JSON-safe and every check carries the agreed contract', () => {
    const r = v(good());
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    for (const c of r.checks) {
      expect(typeof c.id).toBe('string');
      expect(['PASS', 'FAIL', 'PENDING', 'UNKNOWN']).toContain(c.status);
      expect(c.remedy).toBe('');    // nothing to remedy when passing
    }
  });
});

describe('runtime version — the two-day blind spot', () => {
  it('catches source-ahead-of-production by the schema alone', () => {
    // The real 2026-09-04 situation: fixes committed, production on 503.
    const c = find(v(good({
      version: { ...good().version, schemaLatest: '503_remove_commercial_name.sql' },
    })), 'runtime-version');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('Schema is 503_remove_commercial_name.sql');
    expect(c.remedy).toContain('database you think it is');
  });

  it('asserts an expected commit when the caller supplies one', () => {
    // The process cannot know what it was SUPPOSED to be — which is exactly
    // why 4055d7a9 ran unnoticed. CI can, and passes it in.
    const c = find(v(good({
      version: { ...good().version, gitCommit: '4055d7a9', expectedCommit: 'ed74aec0' },
    })), 'runtime-version');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('Running 4055d7a9, expected ed74aec0');
    expect(c.remedy).toContain('every other check below is describing the WRONG BUILD');
  });

  it('passes without an expectedCommit, and says so when given one', () => {
    expect(find(v(good()), 'runtime-version').status).toBe('PASS');
    const withCommit = find(v(good({
      version: { ...good().version, expectedCommit: 'ed74aec0' },
    })), 'runtime-version');
    expect(withCommit.status).toBe('PASS');
    expect(withCommit.detail).toContain('Commit matches');
  });

  it('reports build identity in the detail either way', () => {
    expect(find(v(good()), 'runtime-version').detail)
      .toContain('commit ed74aec0 (feature/portal-framework)');
  });
});

describe('the runtime chain stops where the evidence stops', () => {
  const chain = ['runtime-job', 'retry-telemetry', 'worker-metadata', 'day-sentinel'];

  it('is PENDING all the way down before anything runs', () => {
    const r = v(good({
      run: { migrationAppliedAt: APPLIED, jobsStarted: 0, jobsRunning: 0, jobsFailed: 0,
             jobsCompleted: 0, completedWithRetryTelemetry: 0, completedWithWorkerMetadata: 0,
             daySentinels: 0, newestCompletedAt: null },
    }));
    for (const id of chain) expect(find(r, id).status).toBe('PENDING');
    // Nothing broken, nothing proven.
    expect(r.overall).toMatchObject({ status: 'PENDING', ok: true, ready: false });
    expect(r.overall.headline).toContain('Nothing is wrong');
  });

  it('treats a run IN FLIGHT as pending, not failed', () => {
    const r = v(good({
      run: { migrationAppliedAt: APPLIED, jobsStarted: 3, jobsRunning: 3, jobsFailed: 0,
             jobsCompleted: 0, completedWithRetryTelemetry: 0, completedWithWorkerMetadata: 0,
             daySentinels: 0, newestCompletedAt: null },
    }));
    expect(find(r, 'runtime-job').status).toBe('PENDING');
    expect(find(r, 'runtime-job').detail).toContain('still running');
    expect(r.overall.ok).toBe(true);
  });

  it('FAILS when the first run started and did not survive', () => {
    // The case a migration-only check reports as a successful deploy.
    const r = v(good({
      run: { migrationAppliedAt: APPLIED, jobsStarted: 4, jobsRunning: 0, jobsFailed: 4,
             jobsCompleted: 0, completedWithRetryTelemetry: 0, completedWithWorkerMetadata: 0,
             daySentinels: 0, newestCompletedAt: null },
    }));
    const job = find(r, 'runtime-job');
    expect(job.status).toBe('FAIL');
    expect(job.detail).toContain('NONE completed');
    expect(job.remedy).toContain('migration-only check would have reported as a successful deploy');
    // Downstream links are blocked, not independently failed.
    for (const id of chain.slice(1)) {
      expect(find(r, id).status).toBe('PENDING');
      expect(find(r, id).remedy).toContain('Blocked by the failed run above');
    }
    expect(r.overall).toMatchObject({ status: 'FAIL', ok: false, ready: false });
  });

  it('does not fault telemetry that never had an opportunity', () => {
    const r = v(good({
      run: { migrationAppliedAt: APPLIED, jobsStarted: 0, jobsRunning: 0, jobsFailed: 0,
             jobsCompleted: 0, completedWithRetryTelemetry: 0, completedWithWorkerMetadata: 0,
             daySentinels: 0, newestCompletedAt: null },
    }));
    expect(find(r, 'retry-telemetry').status).toBe('PENDING');
    expect(find(r, 'retry-telemetry').detail).toContain('Waiting on the first completed');
  });
});

describe('telemetry that ran and did not deliver', () => {
  const completedBut = (over: Record<string, number>) => good({
    run: {
      migrationAppliedAt: APPLIED, jobsStarted: 25, jobsRunning: 0, jobsFailed: 0,
      jobsCompleted: 25, completedWithRetryTelemetry: 25, completedWithWorkerMetadata: 25,
      daySentinels: 1, newestCompletedAt: '2026-09-06T01:14:00Z', ...over,
    },
  });

  it('fails when jobs completed and NONE recorded retries', () => {
    const c = find(v(completedBut({ completedWithRetryTelemetry: 0 })), 'retry-telemetry');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('NONE carries retry accounting');
    expect(c.remedy).toContain('build stamp above');
  });

  it('fails a PARTIAL rollout, which is the harder one to spot', () => {
    const c = find(v(completedBut({ completedWithRetryTelemetry: 19 })), 'retry-telemetry');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('19 of 25');
    expect(c.remedy).toContain('indistinguishable from a pre-instrumentation row');
  });

  it('checks worker attribution independently of retry accounting', () => {
    const r = v(completedBut({ completedWithWorkerMetadata: 0 }));
    expect(find(r, 'retry-telemetry').status).toBe('PASS');
    expect(find(r, 'worker-metadata').status).toBe('FAIL');
    expect(find(r, 'worker-metadata').remedy).toContain('worker_id');
  });

  it('fails when jobs completed but the day was never sealed', () => {
    // Per-account done rows prove those accounts ran, never that the day
    // finished. A sentinel-less day is re-collected in full next pass.
    const c = find(v(completedBut({ daySentinels: 0 })), 'day-sentinel');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('never that the day finished');
    expect(c.remedy).toContain('only written when all of them do');
  });
});

describe('the 504-without-507 case', () => {
  const halfApplied = good({
    ledger: [
      { filename: REQUIRED[0], appliedAt: APPLIED, driftedTo: null },
      { filename: REQUIRED[1], appliedAt: null, driftedTo: null },
      { filename: REQUIRED[2], appliedAt: null, driftedTo: null },
      { filename: REQUIRED[3], appliedAt: null, driftedTo: null },
    ],
    pending: [REQUIRED[1], REQUIRED[2], REQUIRED[3]],
    columns: [
      { table: 'seed_jobs', column: 'retries_total', isNullable: false, hasDefault: true },
      { table: 'seed_jobs', column: 'backoff_ms',    isNullable: false, hasDefault: true },
      { table: 'seed_jobs', column: 'pace_verdict',  isNullable: true,  hasDefault: false },
    ],
    version: { ...good().version, schemaLatest: REQUIRED[0] },
  });

  it('catches the ORM/database disagreement', () => {
    const c = find(v(halfApplied), 'orm-agreement');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('database NOT NULL, ORM declares nullable');
    expect(c.remedy).toContain('runtime insert failure in the collector, at night');
  });

  it('names the FIRST missing migration as the one to diagnose', () => {
    const c = find(v(halfApplied), 'migrations-applied');
    expect(c.remedy).toContain('505_seed_job_diagnostics.sql is the one to diagnose');
    expect(c.remedy).toContain('skipped deliberately');
  });

  it('reports missing columns separately from nullability', () => {
    const r = v(halfApplied);
    expect(find(r, 'columns-exist').detail).toContain('retry_causes');
    expect(find(r, 'orm-agreement').detail).not.toContain('retry_causes');
  });
});

describe('a surviving DEFAULT on a nullable column', () => {
  it('is caught even though nullability is correct', () => {
    // Dropping only the NOT NULL leaves every new row with a fabricated 0 —
    // the exact defect 507 exists to end.
    const c = find(v(good({
      columns: ALL_COLUMNS.map(x => x.column === 'retries_total' ? { ...x, hasDefault: true } : x),
    })), 'orm-agreement');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('still carries a DEFAULT');
    expect(c.detail).toContain('never measured');
  });
});

describe('checksum drift', () => {
  it('is a failure with its own remedy', () => {
    const c = find(v(good({
      ledger: good().ledger.map(e =>
        e.filename === REQUIRED[3] ? { ...e, driftedTo: 'abc123' } : e),
    })), 'migrations-applied');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('Checksum drift');
    expect(c.remedy).toContain('not re-run automatically');
  });
});

describe('unmeasurable is not the same as broken', () => {
  it('reports UNKNOWN and clears neither ok nor ready', () => {
    const r = v(good({ run: null, runError: 'query timed out' }));
    expect(find(r, 'runtime-job').status).toBe('UNKNOWN');
    expect(r.overall.ok).toBe(true);       // nothing KNOWN to be broken
    expect(r.overall.ready).toBe(false);   // nothing proven either
    expect(r.overall.status).toBe('UNKNOWN');
    expect(r.overall.headline).toContain('could not be measured');
  });

  it('lets a real failure outrank an unmeasurable check', () => {
    const r = v(good({
      run: null, runError: 'query timed out',
      version: { ...good().version, schemaLatest: '503_remove_commercial_name.sql' },
    }));
    // A FAIL anywhere outranks UNKNOWN: "we could not measure one thing" must
    // never soften "this other thing is definitely wrong".
    expect(r.overall.status).toBe('FAIL');
    expect(r.overall.headline.startsWith('DEPLOY NOT VERIFIED')).toBe(true);
    expect(r.overall.ok).toBe(false);
  });
});

describe('overall — ok and ready are different questions', () => {
  it('ok=true ready=false is the honest answer right after a good deploy', () => {
    const r = v(good({
      run: { migrationAppliedAt: APPLIED, jobsStarted: 0, jobsRunning: 0, jobsFailed: 0,
             jobsCompleted: 0, completedWithRetryTelemetry: 0, completedWithWorkerMetadata: 0,
             daySentinels: 0, newestCompletedAt: null },
    }));
    expect(r.overall.ok).toBe(true);
    expect(r.overall.ready).toBe(false);
  });

  it('a pending runtime check never dilutes a real failure in the headline', () => {
    const r = v(good({
      pending: [...REQUIRED], ledger: [],
      run: { migrationAppliedAt: null, jobsStarted: 0, jobsRunning: 0, jobsFailed: 0,
             jobsCompleted: 0, completedWithRetryTelemetry: 0, completedWithWorkerMetadata: 0,
             daySentinels: 0, newestCompletedAt: null },
    }));
    expect(r.overall.status).toBe('FAIL');
    expect(r.overall.headline).not.toContain('Nothing is wrong');
  });
});
