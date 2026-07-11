/**
 * Self-Test Registry — the platform's operational verification framework.
 *
 * Any subsystem registers its own checks via registerSelfTest({...}); the
 * Developer Test Lab renders whatever is registered. This scales far better than
 * per-subsystem one-off endpoints.
 *
 * Result model (per owner spec):
 *   status: PASS | WARNING | FAIL | NOT_RUN | MANUAL
 *   type:   unit | integration | external | manual
 *   + duration_ms, commit, environment, timestamp
 */

export type SelfTestStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_RUN' | 'MANUAL';
export type SelfTestType = 'unit' | 'integration' | 'external' | 'manual';

/** What a test's run() returns. `manual` tests declare MANUAL and are not executed. */
export interface SelfTestOutcome { status: SelfTestStatus; detail: string }

export interface SelfTestDef {
  module: string;
  name: string;
  type: SelfTestType;
  /** Omitted for `manual` tests. Throwing → FAIL. */
  run?: () => SelfTestOutcome | Promise<SelfTestOutcome>;
}

export interface SelfTestResult extends SelfTestOutcome {
  module: string;
  name: string;
  type: SelfTestType;
  duration_ms: number;
  commit: string;
  environment: string;
  timestamp: string;
}

const registry: SelfTestDef[] = [];

/** Register a self-test. Idempotent per (module,name) — re-registration replaces. */
export function registerSelfTest(def: SelfTestDef): void {
  const i = registry.findIndex(d => d.module === def.module && d.name === def.name);
  if (i >= 0) registry[i] = def; else registry.push(def);
}

export function listModules(): string[] {
  return [...new Set(registry.map(d => d.module))].sort();
}

function commitHash(): string {
  return (
    process.env.GIT_COMMIT ??
    process.env.REPL_COMMIT ??
    process.env.SOURCE_VERSION ??
    'unknown'
  ).slice(0, 12);
}

/** Run registered tests, optionally filtered by module and/or type. */
export async function runSelfTests(filter?: { module?: string; type?: SelfTestType }): Promise<{
  overall: SelfTestStatus;
  ran: number;
  results: SelfTestResult[];
}> {
  const commit = commitHash();
  const environment = process.env.NODE_ENV ?? 'unknown';
  const selected = registry.filter(d =>
    (!filter?.module || d.module === filter.module) &&
    (!filter?.type || d.type === filter.type));

  const results: SelfTestResult[] = [];
  for (const def of selected) {
    const timestamp = new Date().toISOString();
    // Tests with no run(): manual → MANUAL (human), others → NOT_RUN (not yet
    // implemented / needs DB or external system).
    if (!def.run) {
      results.push({ module: def.module, name: def.name, type: def.type,
        status: def.type === 'manual' ? 'MANUAL' : 'NOT_RUN',
        detail: def.type === 'manual' ? 'Requires human verification' : 'Not auto-runnable here (needs DB/external)',
        duration_ms: 0, commit, environment, timestamp });
      continue;
    }
    const t0 = Date.now();
    try {
      const out = await def.run();
      results.push({ module: def.module, name: def.name, type: def.type,
        status: out.status, detail: out.detail, duration_ms: Date.now() - t0,
        commit, environment, timestamp });
    } catch (e: any) {
      results.push({ module: def.module, name: def.name, type: def.type,
        status: 'FAIL', detail: `threw: ${e?.message ?? e}`, duration_ms: Date.now() - t0,
        commit, environment, timestamp });
    }
  }

  // overall = worst executed status (MANUAL/NOT_RUN don't fail the suite)
  const order: SelfTestStatus[] = ['FAIL', 'WARNING', 'PASS'];
  const executed = results.filter(r => r.status === 'FAIL' || r.status === 'WARNING' || r.status === 'PASS');
  const overall = order.find(s => executed.some(r => r.status === s)) ?? 'NOT_RUN';
  return { overall, ran: executed.length, results };
}

/** Test-only: clear the registry (avoids cross-test leakage). */
export function _resetRegistry(): void { registry.length = 0; }
