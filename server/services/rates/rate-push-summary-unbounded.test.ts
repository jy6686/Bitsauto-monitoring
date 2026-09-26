/**
 * The batch-level rate-push summaries must stay unbounded.
 *
 * `rate_push_jobs` is written BEFORE the first mutation-capable request, deliberately, so that
 * no push can run unrecorded. That makes a too-narrow column not merely a loss of audit detail
 * but a hard block on the operation: on 2026-09-18 a five-prefix Send Rate for "aura" was
 * refused with "value too long for type character varying(32)". Four prefixes would have fitted.
 *
 * Each of these three fields holds one entry per destination in the batch, so ANY fixed width is
 * a cap on how many destinations may be pushed at once. 32, 128 and 256 were three different
 * places for the same wall. `client_names` in the same table was already TEXT and already
 * written whole; this pins its siblings to that pattern.
 *
 * Source-scanning rather than behavioural because the insert sits inside a large route handler
 * and the thing worth protecting is the CONTRACT — a column type and the absence of a cap —
 * which a reviewer can reintroduce in one character without any test noticing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const schema = readFileSync(join(root, 'shared', 'schema.ts'), 'utf8');
const routes = readFileSync(join(root, 'server', 'routes.ts'), 'utf8');

/** The `ratePushJobs` table block only — other tables have their own `full_prefix` columns. */
function ratePushJobsBlock(): string {
  const start = schema.indexOf('export const ratePushJobs');
  expect(start).toBeGreaterThan(-1);
  const end = schema.indexOf('export const', start + 10);
  return schema.slice(start, end > start ? end : start + 4000);
}

describe('rate_push_jobs batch summaries are unbounded', () => {
  const block = ratePushJobsBlock();

  for (const col of ['full_prefix', 'dial_prefix', 'destination_name']) {
    it(`${col} is TEXT, not a varchar with a destination cap`, () => {
      expect(block).toMatch(new RegExp(`text\\("${col}"\\)`));
      // The specific regression: a length-bounded varchar returning for this column.
      expect(block).not.toMatch(new RegExp(`varchar\\("${col}"[^)]*length`));
    });
  }

  it('client_names stays TEXT — it is the precedent the others were brought to', () => {
    expect(block).toMatch(/text\("client_names"\)/);
  });

  it('per-operation full_prefix stays bounded — it holds ONE prefix, not a list', () => {
    const start = schema.indexOf('export const ratePushOperations');
    const ops = schema.slice(start, start + 3000);
    expect(ops).toMatch(/varchar\("full_prefix",\s*\{\s*length:\s*32\s*\}\)/);
  });
});

describe('the push-record insert does not truncate its summaries', () => {
  /**
   * The rows built for the insert that refuses the batch when it cannot be recorded.
   *
   * The summaries are now built from each JOB's OWN operations rather than from the submission's
   * destination list — one job per account, so a row describes the work it owns. The property
   * under test is unchanged and is about truncation, not about where the list comes from.
   */
  const insert = (() => {
    const i = routes.indexOf('Could not record this push');
    expect(i).toBeGreaterThan(-1);
    const start = routes.lastIndexOf('const jobRows = plan.jobs.map(', i);
    expect(start).toBeGreaterThan(-1);
    return routes.slice(start, i);
  })();

  it('joins every destination without a substring cap', () => {
    expect(insert).toMatch(/fullPrefix:\s*ops\.map\(o => o\.fullPrefix\)\.join\(', '\),/);
    expect(insert).toMatch(/dialPrefix:\s*ops\.map\(o => o\.dialPrefix\)\.join\(', '\),/);
  });

  it('caps none of the three summaries — 255, 128 and 32 were each "the limit" once', () => {
    // Ban the mechanism on these fields, not the number. `switchName` keeps its substring
    // legitimately: switch_name really is varchar(128) and holds ONE name, not a list.
    for (const field of ['fullPrefix', 'dialPrefix', 'destinationName']) {
      for (const line of insert.split('\n').filter(l => l.includes(`${field}:`))) {
        expect(line).not.toMatch(/\.substring\(/);
      }
    }
  });

  it('still refuses the batch when the record cannot be written', () => {
    // The guard is the reason a narrow column blocked a push rather than silently losing it.
    // If this ever becomes tolerated, an unrecorded Sippy write becomes possible again.
    expect(routes).toMatch(/Refusing to run it unrecorded/);
  });
});
