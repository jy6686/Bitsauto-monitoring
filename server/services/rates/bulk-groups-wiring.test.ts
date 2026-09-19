/**
 * The route's contract with the group path — asserted against source.
 *
 * Three things a reviewer could undo in one edit: the flag must exist as a recorded OFF row
 * (migration), the route must read THAT key and fail to unchanged behaviour when it cannot, and
 * the group push must reach the runner only under the flag. A flag that is on by accident would
 * put every production push through a transport proven on one workbook.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));
const MIGRATION = join(__dirname, '..', '..', '..', 'migrations', '524_rate_push_bulk_groups_flag.sql');

const PUSH_BATCH = (() => {
  const at = ROUTES.indexOf("app.post('/api/rate-manager/push-batch'");
  expect(at, 'push-batch route must exist').toBeGreaterThan(-1);
  return ROUTES.slice(at, ROUTES.indexOf('const runOutcome = await runRateBatch(', at) + 4000);
})();

describe('the flag is a recorded OFF row', () => {
  it('migration 524 registers rate_push_bulk_groups as FALSE and verifies the row exists', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sqlText = readFileSync(MIGRATION, 'utf8');
    expect(sqlText).toContain("'rate_push_bulk_groups'");
    expect(sqlText).toMatch(/FALSE/);
    expect(sqlText).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sqlText).toMatch(/RAISE EXCEPTION/);
  });
});

describe('push-batch reads the flag and fails to unchanged behaviour', () => {
  it('reads platform_feature_flags.rate_push_bulk_groups', () => {
    expect(PUSH_BATCH).toContain("eq(platformFeatureFlags.key, 'rate_push_bulk_groups')");
  });

  it('a read failure leaves the flag OFF', () => {
    const at = PUSH_BATCH.indexOf("'rate_push_bulk_groups'");
    const after = PUSH_BATCH.slice(at, at + 600);
    expect(after).toMatch(/catch\s*\{[^}]*bulkGroups\s*=\s*false/);
  });

  it('hands the group push to the runner ONLY under the flag', () => {
    expect(PUSH_BATCH).toMatch(/pushGroup:\s*bulkGroups\s*\?\s*pushGroup\s*:\s*undefined/);
  });

  it('the group push calls the group upload primitive with the group verb and activation', () => {
    expect(PUSH_BATCH).toContain('sippy.uploadRateGroup(');
    expect(PUSH_BATCH).toMatch(/uploadRateGroup\([^)]*ctx\.action/s);
  });

  it('records progress on the job row from inside the group push, as the per-operation push does', () => {
    const at = PUSH_BATCH.indexOf('const pushGroup: InjectedGroupPush');
    expect(at).toBeGreaterThan(-1);
    const body = PUSH_BATCH.slice(at, at + 2500);
    expect(body).toContain('lastStep: step');
    expect(body).toContain("mark('queued')");
  });
});
