/**
 * Test Lab Fixture Engine (platform resource — all subsystems share it).
 *
 * Layout (never mix synthetic and real):
 *   server/dev/fixtures/synthetic/   — hand-made deterministic inputs
 *   server/dev/fixtures/regression/  — a saved workbook that once triggered a bug
 *   server/dev/fixtures/expected/    — versioned baseline models (schema-tagged)
 *   server/dev/fixtures/production/   — NO customer files; anonymization guide only
 *
 * Baselines compare **normalized models**, not raw JSON, so harmless ordering
 * differences don't fail tests.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export type FixtureKind = 'synthetic' | 'regression';
// Resolve from the repo root (process.cwd()), not __dirname: the server bundles
// to dist/ in production, so __dirname would miss the source-tree fixtures. On
// Replit both dev (tsx) and prod (node dist) run with cwd = repo root.
const ROOT = join(process.cwd(), 'server', 'dev', 'fixtures');

/** Load a fixture workbook as base64 (the shape parseFile expects). */
export function loadFixtureBase64(kind: FixtureKind, name: string): string {
  return readFileSync(join(ROOT, kind, name)).toString('base64');
}

export function listFixtures(kind: FixtureKind): string[] {
  const dir = join(ROOT, kind);
  return existsSync(dir) ? readdirSync(dir).filter(f => /\.(xlsx|xls|csv)$/i.test(f)).sort() : [];
}

/** A versioned, order-independent baseline model for a parsed rate sheet. */
export interface RateSheetBaseline {
  schema: number;
  headers: string[];       // order significant (column identity)
  rowCount: number;
  /** normalized rows: `${prefix}|${rate}` sorted — order-independent */
  rows: string[];
}

export function loadBaseline(name: string): RateSheetBaseline {
  return JSON.parse(readFileSync(join(ROOT, 'expected', name), 'utf8'));
}

/**
 * Build the normalized model from parser output + a column mapping so the diff is
 * order-independent. `prefixCol`/`rateCol` are header names.
 */
export function normalizeRateSheet(
  headers: string[], dataRows: any[][], prefixCol: string, rateCol: string,
): RateSheetBaseline {
  const pi = headers.indexOf(prefixCol);
  const ri = headers.indexOf(rateCol);
  const rows = dataRows
    .filter(r => r[pi] != null && String(r[pi]).trim() !== '')
    .map(r => `${String(r[pi]).trim()}|${String(r[ri] ?? '').trim()}`)
    .sort();
  return { schema: 1, headers, rowCount: rows.length, rows };
}

/** Diff two baselines; returns [] when equal, else human-readable differences. */
export function diffBaseline(actual: RateSheetBaseline, expected: RateSheetBaseline): string[] {
  const diffs: string[] = [];
  if (actual.schema !== expected.schema) diffs.push(`schema ${actual.schema} ≠ ${expected.schema}`);
  if (JSON.stringify(actual.headers) !== JSON.stringify(expected.headers))
    diffs.push(`headers ${JSON.stringify(actual.headers)} ≠ ${JSON.stringify(expected.headers)}`);
  if (actual.rowCount !== expected.rowCount) diffs.push(`rowCount ${actual.rowCount} ≠ ${expected.rowCount}`);
  if (JSON.stringify(actual.rows) !== JSON.stringify(expected.rows))
    diffs.push(`rows differ (${actual.rows.length} vs ${expected.rows.length})`);
  return diffs;
}
