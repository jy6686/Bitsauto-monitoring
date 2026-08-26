import { describe, it, expect, vi } from 'vitest';

// The rate resolver lives in a module that reaches for storage and the database.
// Neither is needed to probe a pure prefix-matching function, and neither is
// available in a test run, so both are stubbed — the resolver itself is the real
// shipped implementation, which is the entire point of a probe.
vi.mock('./storage', () => ({ storage: {} }));
vi.mock('./db', () => ({ db: {} }));

import { policyConformance, type PolicyCheck } from './policy-conformance';

const find = (checks: PolicyCheck[], fragment: string) =>
  checks.find(c => c.rule.toLowerCase().includes(fragment.toLowerCase()));

describe('policyConformance — it measures rather than asserts', () => {
  it('probes the real rate resolver and reports the known divergence', async () => {
    const checks = await policyConformance();
    const rate = find(checks, 'Rate rows are selected by the date');

    expect(rate).toBeDefined();
    expect(rate!.method).toBe('probed');

    /**
     * BILLING-POLICY §4.1: resolveRate matches on prefix length only and never
     * reads activationDate or expirationDate. Handed a rate that expired in 2020
     * ahead of the current one on the same prefix, it returns the expired row.
     *
     * THIS TEST IS EXPECTED TO FLIP. When the resolver is fixed the probe will
     * report `conforms` and this assertion will fail loudly — which is the
     * intended signal, not a regression. Change it to 'conforms' then, and the
     * flip is the proof the fix landed.
     */
    expect(rate!.status).toBe('diverges');
    expect(rate!.detail).toMatch(/expired in 2020/);
    expect(rate!.reference).toMatch(/§4\.1/);
  });

  it('probes the period module and finds it conforming', async () => {
    const checks = await policyConformance();
    const periods = find(checks, 'Periods are half-open');

    expect(periods).toBeDefined();
    expect(periods!.method).toBe('probed');
    // billing-periods.ts is the one component already built to the frozen policy.
    expect(periods!.status).toBe('conforms');
    expect(periods!.detail).toMatch(/Monday/);
  });

  it('probes the clock rather than reading a zone name', async () => {
    const checks = await policyConformance();
    const clock = find(checks, 'UTC is the only billing clock');

    expect(clock).toBeDefined();
    expect(clock!.method).toBe('probed');
    // Whichever way it lands, the answer must be derived from this host, so it
    // is asserted against the same expression the code under test uses rather
    // than against a hard-coded expectation about the machine running the suite.
    const hostIsUtc = new Date('2026-01-01T00:00:00').getUTCHours() === 0;
    expect(clock!.status).toBe(hostIsUtc ? 'conforms' : 'diverges');
  });
});

describe('policyConformance — declared facts are labelled as such', () => {
  it('never presents a code-review fact as a measurement', async () => {
    const checks = await policyConformance();
    const declared = checks.filter(c => c.method === 'declared');

    expect(declared.length).toBeGreaterThan(0);
    // A declared fact goes stale silently, so every one must carry the place it
    // was read from for the next reader to re-check rather than trust.
    for (const c of declared) {
      expect(c.reference).toMatch(/\.(ts|md)/);
      expect(c.detail.length).toBeGreaterThan(40);
    }
  });

  it('records the two divergences this platform currently carries', async () => {
    const checks = await policyConformance();

    expect(find(checks, 'CDR ingestion builds its fetch window in UTC')!.status).toBe('diverges');
    expect(find(checks, 'The DMR independently reconciles')!.status).toBe('diverges');
  });

  it('reports every check with a status, a method and a reference', async () => {
    const checks = await policyConformance();
    expect(checks.length).toBeGreaterThanOrEqual(6);
    for (const c of checks) {
      expect(['conforms', 'diverges', 'unknown']).toContain(c.status);
      expect(['probed', 'declared']).toContain(c.method);
      expect(c.rule).toBeTruthy();
      expect(c.reference).toBeTruthy();
    }
  });
});
