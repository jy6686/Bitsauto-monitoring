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

/** Test Lab Framework version — FROZEN v1.0 (2026-07-11). Bump only on a genuine
 *  architectural change; additions should be consumers, not framework edits. */
export const FRAMEWORK_VERSION = '1.0';
export const RUNNER_VERSION = '1.0';

export type SelfTestStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_RUN' | 'MANUAL' | 'SKIPPED';
export type SelfTestType = 'unit' | 'integration' | 'external' | 'manual';

/**
 * `deterministic` = always identical, CI-safe (parser/mapping/calculations).
 * `environment`   = needs DB / Sippy / portal; Dev/Staging only.
 * Derived from type: unit → deterministic; integration/external/manual → environment.
 */
export function testClass(type: SelfTestType): 'deterministic' | 'environment' {
  return type === 'unit' ? 'deterministic' : 'environment';
}

/** What a test's run() returns. `manual` tests declare MANUAL and are not executed. */
export interface SelfTestOutcome { status: SelfTestStatus; detail: string }

export interface SelfTestDef {
  module: string;
  name: string;
  type: SelfTestType;
  /** Stable id (default `module::name`) — used for dependsOn references. */
  id?: string;
  /** Ids of tests that must PASS first; otherwise this test is SKIPPED. */
  dependsOn?: string[];
  /** Free-form tags for filtering, e.g. vendor, critical, parser, regression. */
  tags?: string[];
  /** Omitted for `manual` tests. Throwing → FAIL. */
  run?: () => SelfTestOutcome | Promise<SelfTestOutcome>;
}

const idOf = (d: SelfTestDef): string => d.id ?? `${d.module}::${d.name}`;

export interface SelfTestResult extends SelfTestOutcome {
  id: string;
  module: string;
  name: string;
  type: SelfTestType;
  tags: string[];
  duration_ms: number;
  commit: string;
  environment: string;
  timestamp: string;
}

/** CI exit code: 0 = PASS (or nothing failed), 1 = WARNING, 2 = FAIL. */
export function exitCode(overall: SelfTestStatus): 0 | 1 | 2 {
  return overall === 'FAIL' ? 2 : overall === 'WARNING' ? 1 : 0;
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

export interface RunFilter {
  module?: string;
  type?: SelfTestType;
  tag?: string;
  /** Only deterministic (unit) tests — for CI. */
  deterministicOnly?: boolean;
}

/**
 * Run registered tests. Honours filters and `dependsOn`: a test whose dependency
 * did not PASS (failed, skipped, not-run, or filtered out) is SKIPPED — so a
 * broken upstream never yields a misleading downstream PASS.
 */
export async function runSelfTests(filter?: RunFilter): Promise<{
  framework_version: string;
  runner_version: string;
  overall: SelfTestStatus;
  exit_code: 0 | 1 | 2;
  ran: number;
  results: SelfTestResult[];
}> {
  const commit = commitHash();
  const environment = process.env.NODE_ENV ?? 'unknown';
  const selected = registry.filter(d =>
    (!filter?.module || d.module === filter.module) &&
    (!filter?.type || d.type === filter.type) &&
    (!filter?.tag || (d.tags ?? []).includes(filter.tag)) &&
    (!filter?.deterministicOnly || testClass(d.type) === 'deterministic'));

  // pass/fail state by id, so dependents can be skipped
  const statusById = new Map<string, SelfTestStatus>();
  const results: SelfTestResult[] = [];

  for (const def of selected) {
    const id = idOf(def);
    const timestamp = new Date().toISOString();
    const base = { id, module: def.module, name: def.name, type: def.type,
      tags: def.tags ?? [], commit, environment, timestamp };

    // dependency gate: any dep not PASS → SKIPPED
    const unmet = (def.dependsOn ?? []).filter(dep => statusById.get(dep) !== 'PASS');
    if (unmet.length) {
      const r: SelfTestResult = { ...base, status: 'SKIPPED',
        detail: `skipped: dependency not passed [${unmet.join(', ')}]`, duration_ms: 0 };
      results.push(r); statusById.set(id, 'SKIPPED'); continue;
    }

    if (!def.run) {
      const status: SelfTestStatus = def.type === 'manual' ? 'MANUAL' : 'NOT_RUN';
      results.push({ ...base, status,
        detail: def.type === 'manual' ? 'Requires human verification' : 'Not auto-runnable here (needs DB/external)',
        duration_ms: 0 });
      statusById.set(id, status); continue;
    }

    const t0 = Date.now();
    try {
      const out = await def.run();
      results.push({ ...base, status: out.status, detail: out.detail, duration_ms: Date.now() - t0 });
      statusById.set(id, out.status);
    } catch (e: any) {
      results.push({ ...base, status: 'FAIL', detail: `threw: ${e?.message ?? e}`, duration_ms: Date.now() - t0 });
      statusById.set(id, 'FAIL');
    }
  }

  // overall = worst executed status (MANUAL/NOT_RUN/SKIPPED don't fail the suite)
  const order: SelfTestStatus[] = ['FAIL', 'WARNING', 'PASS'];
  const executed = results.filter(r => (['FAIL', 'WARNING', 'PASS'] as SelfTestStatus[]).includes(r.status));
  const overall = order.find(s => executed.some(r => r.status === s)) ?? 'NOT_RUN';
  return {
    framework_version: FRAMEWORK_VERSION,
    runner_version: RUNNER_VERSION,
    overall, exit_code: exitCode(overall), ran: executed.length, results,
  };
}

/** Test-only: clear the registry (avoids cross-test leakage). */
export function _resetRegistry(): void { registry.length = 0; }
