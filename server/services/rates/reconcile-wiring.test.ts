/**
 * The reconciliation feature's CONTRACT with the rest of the app, asserted against source — the
 * few properties a reviewer could regress in one edit without any behavioural test noticing:
 *
 *   - it ships OFF: gated on RATE_RECONCILE_ON_BOOT, and the guard returns BEFORE any DB/Sippy work;
 *   - it is actually wired into boot (or it can never run);
 *   - the terminal writes are CONDITIONAL on the row still being non-terminal (the logical claim);
 *   - the reconciliation path contains NO mutation call — verify, never retry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const BOOT  = strip(readFileSync(join(__dirname, 'reconcile-boot.ts'), 'utf8'));
const INDEX = strip(readFileSync(join(__dirname, '..', '..', 'index.ts'), 'utf8'));

describe('it ships OFF and cannot run by accident', () => {
  it('the entry point returns unless RATE_RECONCILE_ON_BOOT is exactly "1"', () => {
    expect(BOOT).toMatch(/if \(process\.env\.RATE_RECONCILE_ON_BOOT !== '1'\) return;/);
  });

  it('the flag check precedes any DB query or Sippy call in the entry point', () => {
    const entry = BOOT.slice(BOOT.indexOf('export async function reconcileOrphanedRatePushesOnBoot'));
    const guard = entry.indexOf("RATE_RECONCILE_ON_BOOT !== '1'");
    const firstDb = entry.indexOf('loadStaleJobs');
    const firstSippy = entry.indexOf('sippy.');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstDb);
    if (firstSippy > -1) expect(guard).toBeLessThan(firstSippy);
  });
});

describe('it is wired into startup', () => {
  it('index.ts invokes the boot entry point', () => {
    expect(INDEX).toContain("import('./services/rates/reconcile-boot')");
    expect(INDEX).toContain('reconcileOrphanedRatePushesOnBoot()');
  });
});

describe('the terminal writes are conditional — the logical claim', () => {
  it('writeVerdict only lands while the row is still pending/processing', () => {
    const fn = BOOT.slice(BOOT.indexOf('async function writeVerdict'), BOOT.indexOf('async function writeUnavailable'));
    expect(fn).toContain("inArray(ratePushJobs.status, ['pending', 'processing'])");
  });

  it('writeUnavailable is likewise conditional, so an escalated/verdicted row is never resurrected', () => {
    const fn = BOOT.slice(BOOT.indexOf('async function writeUnavailable'), BOOT.indexOf('function makeReadback'));
    expect(fn).toContain("inArray(ratePushJobs.status, ['pending', 'processing'])");
  });
});

describe('verify, never retry — the reconciliation path issues no mutation', () => {
  it('reconcile-boot calls only the read-back, never a push/upload/set/delete', () => {
    // The only Sippy call permitted here is getTariffRatesListFull (read). Any writer would be a retry.
    const sippyCalls = [...BOOT.matchAll(/sippy\.([A-Za-z0-9_]+)/g)].map(m => m[1]);
    expect(new Set(sippyCalls)).toEqual(new Set(['getTariffRatesListFull']));
    for (const forbidden of ['pushRate', 'uploadRates', 'setSippyRateEntry', 'addRate', 'deleteAllRates', 'deleteSippyRateEntry', 'buildRateXlsx', 'uploadRatesWorkbook']) {
      expect(BOOT).not.toContain(forbidden);
    }
  });
});
