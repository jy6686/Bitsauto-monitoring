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

describe('the run record is written AFTER the sweep, and cannot precede its summary', () => {
  it('the record insert appears after runReconcileSweep returns', () => {
    const sweepAt  = BOOT.indexOf('await runReconcileSweep(deps)');
    const recordAt = BOOT.indexOf('db.insert(rateReconcileRuns)');
    expect(sweepAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(sweepAt); // ordering: sweep first, then persist
  });

  it('the record is built from the sweep summary — so it structurally cannot exist before the sweep', () => {
    // buildRunRecord takes `summary`, which is const-assigned from the awaited sweep; there is no
    // path that persists a record without a summary to build it from.
    expect(BOOT).toMatch(/buildRunRecord\(\s*summary\s*,/);
  });

  it('the record write is non-fatal and never retries — its own try/catch, no mutation call inside', () => {
    const start = BOOT.indexOf('db.insert(rateReconcileRuns)');
    const block = BOOT.slice(BOOT.lastIndexOf('try {', start), BOOT.indexOf('run-record write failed'));
    expect(block).toContain('catch');
    for (const forbidden of ['setSippyRateEntry', 'pushRate', 'uploadRates']) {
      expect(block).not.toContain(forbidden);
    }
  });
});

describe('the reconcile-status endpoint is authenticated, read-only, and leaks nothing sensitive', () => {
  const SRC = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));
  const ROUTE = (() => {
    const at = SRC.indexOf("app.get('/api/rate-manager/reconcile-status'");
    expect(at, 'reconcile-status route must exist').toBeGreaterThan(-1);
    return SRC.slice(at, SRC.indexOf('app.get', at + 10));
  })();

  it('requires an admin/management role', () => {
    expect(ROUTE).toContain("requireRole(['admin', 'management']");
  });

  it('only reads rate_reconcile_runs — no write, no other table', () => {
    expect(ROUTE).toContain('db.select().from(rateReconcileRuns)');
    for (const forbidden of ['db.insert', 'db.update', 'db.delete']) {
      expect(ROUTE).not.toContain(forbidden);
    }
  });

  it('returns the run rows and does not read settings or credentials into the response', () => {
    expect(ROUTE).toContain('res.json({ runs })');
    for (const forbidden of ['getSettings', 'apiAdminPass', 'portalPass', 'sippyRateAdminPass', 'DATABASE_URL']) {
      expect(ROUTE).not.toContain(forbidden);
    }
  });
});
