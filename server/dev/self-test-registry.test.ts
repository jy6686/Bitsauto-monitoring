/**
 * Self-Test Registry framework + Vendor Rates registrations.
 * Verifies the registry mechanics and that the vendor-rate unit tests all PASS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSelfTest, runSelfTests, listModules, _resetRegistry,
} from './self-test-registry';

describe('self-test registry framework', () => {
  beforeEach(() => _resetRegistry());

  it('runs unit tests and computes worst-status overall', async () => {
    registerSelfTest({ module: 'M', name: 'ok', type: 'unit', run: () => ({ status: 'PASS', detail: 'x' }) });
    registerSelfTest({ module: 'M', name: 'warn', type: 'unit', run: () => ({ status: 'WARNING', detail: 'y' }) });
    const r = await runSelfTests({ module: 'M' });
    expect(r.overall).toBe('WARNING');            // WARNING worse than PASS
    expect(r.ran).toBe(2);
    expect(r.results[0]).toMatchObject({ module: 'M', status: 'PASS', type: 'unit' });
    expect(typeof r.results[0].duration_ms).toBe('number');
    expect(r.results[0].commit).toBeTruthy();
  });

  it('a throwing test → FAIL and makes overall FAIL', async () => {
    registerSelfTest({ module: 'M', name: 'boom', type: 'unit', run: () => { throw new Error('nope'); } });
    const r = await runSelfTests();
    expect(r.overall).toBe('FAIL');
    expect(r.results[0].detail).toContain('nope');
  });

  it('manual → MANUAL, no-run integration → NOT_RUN; neither fails overall', async () => {
    registerSelfTest({ module: 'M', name: 'human', type: 'manual' });
    registerSelfTest({ module: 'M', name: 'db', type: 'integration' });
    registerSelfTest({ module: 'M', name: 'pass', type: 'unit', run: () => ({ status: 'PASS', detail: '' }) });
    const r = await runSelfTests();
    expect(r.results.find(x => x.name === 'human')?.status).toBe('MANUAL');
    expect(r.results.find(x => x.name === 'db')?.status).toBe('NOT_RUN');
    expect(r.overall).toBe('PASS');               // MANUAL/NOT_RUN don't fail suite
  });

  it('type filter selects a subset', async () => {
    registerSelfTest({ module: 'M', name: 'u', type: 'unit', run: () => ({ status: 'PASS', detail: '' }) });
    registerSelfTest({ module: 'M', name: 'e', type: 'external' });
    const r = await runSelfTests({ type: 'unit' });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].name).toBe('u');
  });
});

describe('Vendor Rates registered self-tests', () => {
  it('all unit stages PASS on current code', async () => {
    _resetRegistry();
    await import('./vendor-rates-self-tests');   // re-register after reset
    const r = await runSelfTests({ module: 'Vendor Rates', type: 'unit' });
    const failed = r.results.filter(x => x.status !== 'PASS');
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(r.overall).toBe('PASS');
    expect(listModules()).toContain('Vendor Rates');
  });
});
