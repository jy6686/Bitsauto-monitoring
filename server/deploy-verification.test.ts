import { describe, it, expect } from 'vitest';
import { verifyDeployment, type DeployFacts } from './deploy-verification';

const REQUIRED = [
  '504_seed_job_retry_accounting.sql',
  '505_seed_job_diagnostics.sql',
  '506_company_lifecycle_changed_at.sql',
  '507_seed_job_retry_columns_nullable.sql',
] as const;

const EXPECTED = [
  { table: 'seed_jobs', column: 'retries_total',        mustBeNullable: true  },
  { table: 'seed_jobs', column: 'backoff_ms',           mustBeNullable: true  },
  { table: 'seed_jobs', column: 'pace_verdict',         mustBeNullable: true  },
  { table: 'seed_jobs', column: 'retry_causes',         mustBeNullable: true  },
  { table: 'seed_jobs', column: 'worker_id',            mustBeNullable: true  },
  { table: 'seed_jobs', column: 'queued_at',            mustBeNullable: true  },
  { table: 'seed_jobs', column: 'queue_wait_ms',        mustBeNullable: true  },
  { table: 'companies', column: 'lifecycle_changed_at', mustBeNullable: true  },
];

const ALL_COLUMNS = EXPECTED.map(e =>
  ({ table: e.table, column: e.column, isNullable: true, hasDefault: false }));

const good = (over: Partial<DeployFacts> = {}): DeployFacts => ({
  targetMigration: '507_seed_job_retry_columns_nullable.sql',
  requiredMigrations: [...REQUIRED],
  ledger: REQUIRED.map(f => ({ filename: f, appliedAt: '2026-09-05T02:00:00Z', driftedTo: null })),
  pending: [],
  columns: ALL_COLUMNS,
  expectedColumns: EXPECTED,
  telemetry: {
    migrationAppliedAt: '2026-09-05T02:00:00Z',
    rowsSince: 25, rowsSinceInstrumented: 25, newestRowAt: '2026-09-06T01:14:00Z',
  },
  ...over,
});

const find = (v: ReturnType<typeof verifyDeployment>, id: string) =>
  v.checks.find(c => c.id === id)!;

describe('a fully verified deployment', () => {
  it('passes all five and reports ready', () => {
    const v = verifyDeployment(good());
    expect(v.checks).toHaveLength(5);
    expect(v.checks.every(c => c.state === 'pass')).toBe(true);
    expect(v.ok).toBe(true);
    expect(v.ready).toBe(true);
    expect(v.headline).toContain('verified end to end');
  });

  it('maps onto the agreed checklist steps 1-5', () => {
    expect(verifyDeployment(good()).checks.map(c => c.step)).toEqual([1, 2, 3, 4, 5]);
  });

  it('says nothing to remedy when passing', () => {
    for (const c of verifyDeployment(good()).checks) expect(c.remedy).toBe('');
  });
});

describe('pending is a third state, not a failure', () => {
  // The distinction the module exists for: a successful migration proves the
  // schema changed and nothing else.
  const justDeployed = good({
    telemetry: {
      migrationAppliedAt: '2026-09-05T02:00:00Z',
      rowsSince: 0, rowsSinceInstrumented: 0, newestRowAt: null,
    },
  });

  it('does not fail a deployment that simply has not run yet', () => {
    const v = verifyDeployment(justDeployed);
    expect(find(v, 'telemetry-flowing').state).toBe('pending');
    // ok, because nothing is broken. NOT ready, because nothing is proven.
    expect(v.ok).toBe(true);
    expect(v.ready).toBe(false);
  });

  it('says so in words an operator will not misread at 03:00', () => {
    const c = find(verifyDeployment(justDeployed), 'telemetry-flowing');
    expect(c.detail).toContain('only a run proves the instrumentation records');
    expect(c.remedy).toContain('Nothing is wrong yet');
    expect(verifyDeployment(justDeployed).headline).toContain('Nothing is wrong');
  });

  it('is pending, not failing, when the migration has not landed at all', () => {
    const v = verifyDeployment(good({
      telemetry: { migrationAppliedAt: null, rowsSince: 0, rowsSinceInstrumented: 0, newestRowAt: null },
    }));
    expect(find(v, 'telemetry-flowing').state).toBe('pending');
  });
});

describe('telemetry that should fail', () => {
  it('fails when jobs ran and NONE recorded', () => {
    // Schema landed, code did not. The columns exist and stay empty.
    const v = verifyDeployment(good({
      telemetry: {
        migrationAppliedAt: '2026-09-05T02:00:00Z',
        rowsSince: 25, rowsSinceInstrumented: 0, newestRowAt: '2026-09-06T01:14:00Z',
      },
    }));
    const c = find(v, 'telemetry-flowing');
    expect(c.state).toBe('fail');
    expect(c.detail).toContain('NONE carries retry accounting');
    expect(c.remedy).toContain('build stamp');
    expect(v.ok).toBe(false);
  });

  it('fails a PARTIAL rollout, which is harder to spot than none', () => {
    // A NULL here is indistinguishable from a pre-instrumentation row, so the
    // gap never announces itself.
    const v = verifyDeployment(good({
      telemetry: {
        migrationAppliedAt: '2026-09-05T02:00:00Z',
        rowsSince: 25, rowsSinceInstrumented: 19, newestRowAt: '2026-09-06T01:14:00Z',
      },
    }));
    expect(find(v, 'telemetry-flowing').state).toBe('fail');
    expect(find(v, 'telemetry-flowing').detail).toContain('19 of 25');
  });

  it('is unknown, not failed, when the measurement could not be taken', () => {
    const v = verifyDeployment(good({ telemetry: null, telemetryError: 'query timed out' }));
    expect(find(v, 'telemetry-flowing').state).toBe('unknown');
    expect(v.ok).toBe(true);        // nothing is known to be broken
    expect(v.ready).toBe(false);    // but nothing is proven either
    expect(v.headline).toContain('could not be measured');
  });
});

describe('the 504-without-507 case', () => {
  // The sequence that actually threatens this deploy: the runner halts on
  // failure, so a failed 505 leaves 504 applied and 507 not.
  const halfApplied = good({
    ledger: [
      { filename: REQUIRED[0], appliedAt: '2026-09-05T02:00:00Z', driftedTo: null },
      { filename: REQUIRED[1], appliedAt: null, driftedTo: null },
      { filename: REQUIRED[2], appliedAt: null, driftedTo: null },
      { filename: REQUIRED[3], appliedAt: null, driftedTo: null },
    ],
    pending: [REQUIRED[1], REQUIRED[2], REQUIRED[3]],
    columns: [
      // 504 landed: NOT NULL DEFAULT 0, exactly what 507 would have removed.
      { table: 'seed_jobs', column: 'retries_total', isNullable: false, hasDefault: true },
      { table: 'seed_jobs', column: 'backoff_ms',    isNullable: false, hasDefault: true },
      { table: 'seed_jobs', column: 'pace_verdict',  isNullable: true,  hasDefault: false },
    ],
  });

  it('catches the ORM/database disagreement', () => {
    const c = find(verifyDeployment(halfApplied), 'orm-agreement');
    expect(c.state).toBe('fail');
    expect(c.detail).toContain('database NOT NULL, ORM declares nullable');
    expect(c.remedy).toContain('runtime insert failure in the collector, at night');
  });

  it('names the FIRST missing migration as the one to diagnose', () => {
    // The runner halts rather than skipping, so everything after the first
    // failure was skipped deliberately and is not itself the problem.
    const c = find(verifyDeployment(halfApplied), 'migrations-applied');
    expect(c.state).toBe('fail');
    expect(c.remedy).toContain('505_seed_job_diagnostics.sql is the one to diagnose');
    expect(c.remedy).toContain('skipped deliberately');
  });

  it('reports the missing columns separately from the nullability', () => {
    const v = verifyDeployment(halfApplied);
    expect(find(v, 'columns-exist').state).toBe('fail');
    expect(find(v, 'columns-exist').detail).toContain('retry_causes');
    // Absence is check 3's business; check 4 does not double-report it.
    expect(find(v, 'orm-agreement').detail).not.toContain('retry_causes');
  });

  it('fails the schema-version check too, and says the runner halted', () => {
    const c = find(verifyDeployment(halfApplied), 'schema-version');
    expect(c.state).toBe('fail');
    expect(c.detail).toContain('expected 507_seed_job_retry_columns_nullable.sql');
    expect(c.remedy).toContain('[migrate] FAILED');
  });
});

describe('a surviving DEFAULT is caught even when nullability is right', () => {
  it('flags nullable-but-still-defaulted', () => {
    // 507 drops the NOT NULL and the DEFAULT. Dropping only the first leaves
    // every new row with a fabricated 0 — the exact defect 507 exists to end.
    const v = verifyDeployment(good({
      columns: ALL_COLUMNS.map(c =>
        c.column === 'retries_total' ? { ...c, hasDefault: true } : c),
    }));
    const c = find(v, 'orm-agreement');
    expect(c.state).toBe('fail');
    expect(c.detail).toContain('still carries a DEFAULT');
    expect(c.detail).toContain('never measured');
  });
});

describe('checksum drift', () => {
  it('is a failure with its own remedy, not silently tolerated', () => {
    // These four were rewritten to add BEGIN/COMMIT after being authored. A
    // database that ran the older text reports drift and is NOT re-run.
    const v = verifyDeployment(good({
      ledger: good().ledger.map(e =>
        e.filename === REQUIRED[3] ? { ...e, driftedTo: 'abc123' } : e),
    }));
    const c = find(v, 'migrations-applied');
    expect(c.state).toBe('fail');
    expect(c.detail).toContain('Checksum drift');
    expect(c.remedy).toContain('not re-run automatically');
  });
});

describe('the headline is what gets read first', () => {
  it('leads with failures when there are any', () => {
    const v = verifyDeployment(good({ pending: [...REQUIRED], ledger: [] }));
    expect(v.headline.startsWith('DEPLOY NOT VERIFIED')).toBe(true);
    expect(v.ok).toBe(false);
    // A pending telemetry check must not dilute a real failure.
    expect(v.headline).not.toContain('Nothing is wrong');
  });

  it('distinguishes "verified" from "verified so far"', () => {
    expect(verifyDeployment(good()).headline).toContain('end to end');
    expect(verifyDeployment(good({
      telemetry: { migrationAppliedAt: '2026-09-05T02:00:00Z', rowsSince: 0, rowsSinceInstrumented: 0, newestRowAt: null },
    })).headline).toContain('cannot be confirmed yet');
  });
});
