import { describe, it, expect } from 'vitest';
import { reconcileAccounts, type AccountFigures } from './account-reconciliation';

const acct = (name: string, amount: number, calls = 0, minutes = 0): AccountFigures =>
  ({ name, amount, calls, minutes });

/** The production week, 2026-08-24 → 2026-08-30, from Sippy's own summary. */
const REFERENCE: AccountFigures[] = [
  acct('asterisk',         366.6442, 562640, 11477.92),
  acct('internal-ptcl',    295.9650, 575937, 11514.80),
  acct('internal-eritrea',  20.7842,   2293,   118.77),
  acct('PUSHTOTALK',         0.0000,     25,      0),
  acct('Route-Inspector',    0.0000,     20,      0),
];

describe('the production week — what no internal check could see', () => {
  it('fails, and names the two customers the platform never billed', () => {
    const r = reconcileAccounts({
      reference: REFERENCE,
      platform: [acct('asterisk', 167.5063), acct('PUSHTOTALK', 0), acct('Route-Inspector', 0)],
      periodLabel: '2026-08-24 – 2026-08-30',
    });

    expect(r.outcome).toBe('FAIL');
    const missing = r.failing.filter(a => a.status === 'missing_from_platform').map(a => a.customer);
    expect(missing.sort()).toEqual(['internal-eritrea', 'internal-ptcl']);
    expect(r.summary.delta).toBeCloseTo(-515.8871, 4);
    expect(r.summary.referenceTotal).toBeCloseTo(683.3934, 4);
  });

  it('ranks the largest loss first — internal-ptcl at $295.97', () => {
    const r = reconcileAccounts({
      reference: REFERENCE,
      platform: [acct('asterisk', 167.5063)],
    });
    expect(r.failing[0].customer).toBe('internal-ptcl');
    expect(Math.abs(r.failing[0].amountDelta)).toBeCloseTo(295.9650, 4);
  });

  it('explains WHY an absent account is invisible to internal checks', () => {
    const r = reconcileAccounts({ reference: REFERENCE, platform: [] });
    const ptcl = r.accounts.find(a => a.customer === 'internal-ptcl')!;
    expect(ptcl.reason).toMatch(/produces no discrepancy/);
  });

  it('certifies an account that agrees, even at zero', () => {
    const r = reconcileAccounts({
      reference: REFERENCE,
      platform: REFERENCE.map(a => ({ ...a })),
    });
    expect(r.outcome).toBe('PASS');
    expect(r.summary.certified).toBe(5);
    // PUSHTOTALK and Route-Inspector billed nothing on both sides — agreement,
    // not absence. A zero that both sides agree on is certified.
    expect(r.accounts.find(a => a.customer === 'PUSHTOTALK')!.status).toBe('certified');
  });
});

describe('identity — a name that maps to two accounts is refused, never merged', () => {
  /**
   * Production holds `Internal-ptcl` (account 76) and `internal-ptcl`
   * (account 588) — different customers differing only in case, and
   * SippyAccountStatRow carries no account id. Case-insensitive matching would
   * sum two customers into one line and report the sum as agreement.
   */
  it('refuses a case-colliding name rather than merging two customers', () => {
    const r = reconcileAccounts({
      reference: [acct('Internal-ptcl', 100), acct('internal-ptcl', 295.965)],
      platform:  [acct('internal-ptcl', 395.965)],
    });
    const amb = r.accounts.filter(a => a.status === 'ambiguous_identity');
    expect(amb).toHaveLength(1);
    expect(r.outcome).toBe('FAIL');
    // Crucially it did NOT certify: 100 + 295.965 = 395.965 would have matched
    // the platform exactly and passed, hiding both accounts.
    expect(r.accounts.some(a => a.status === 'certified')).toBe(false);
  });

  it('says why, and asks for a stable identifier', () => {
    const r = reconcileAccounts({
      reference: [acct('Ktel.', 5), acct('ktel.', 7)],
      platform:  [],
    });
    const amb = r.accounts.find(a => a.status === 'ambiguous_identity')!;
    expect(amb.reason).toMatch(/differ only in case/);
    expect(amb.reason).toMatch(/stable account id/);
  });

  it('leaves unambiguous accounts certifiable in the same run', () => {
    const r = reconcileAccounts({
      reference: [acct('Internal-ptcl', 100), acct('internal-ptcl', 200), acct('asterisk', 50)],
      platform:  [acct('asterisk', 50)],
    });
    expect(r.accounts.find(a => a.customer === 'asterisk')!.status).toBe('certified');
    expect(r.accounts.filter(a => a.status === 'ambiguous_identity')).toHaveLength(1);
  });

  it('tolerates ordinary case differences when only ONE account uses the name', () => {
    const r = reconcileAccounts({
      reference: [acct('Acct. Asterisk', 50)],
      platform:  [acct('acct. asterisk', 50)],
    });
    expect(r.outcome).toBe('PASS');
  });
});

describe('REFERENCE_UNAVAILABLE — the cache must never stand in for the switch', () => {
  /**
   * The DMR falls back to the local CDR cache when Sippy stats are missing.
   * That fallback keeps dashboards alive and must never reach certification:
   * it would compare the platform against its own data and call it agreement.
   */
  it('reports unavailable rather than certifying', () => {
    for (const reference of [null, undefined]) {
      const r = reconcileAccounts({ reference, platform: [acct('asterisk', 167)] });
      expect(r.outcome).toBe('REFERENCE_UNAVAILABLE');
      expect(r.outcome).not.toBe('PASS');
      expect(r.reason).toMatch(/certify it against itself/);
      expect(r.accounts).toEqual([]);
    }
  });
});

describe('money band and informational dimensions', () => {
  it('certifies a one-cent difference', () => {
    const r = reconcileAccounts({
      reference: [acct('a', 100.00)], platform: [acct('a', 100.01)],
    });
    expect(r.outcome).toBe('PASS');
  });

  it('fails two cents at any scale', () => {
    const r = reconcileAccounts({
      reference: [acct('a', 600_000.00)], platform: [acct('a', 600_000.02)],
    });
    expect(r.outcome).toBe('FAIL');
  });

  it('does not fail on call or minute drift alone', () => {
    const r = reconcileAccounts({
      reference: [acct('a', 100, 5000, 900)],
      platform:  [acct('a', 100, 4980, 899)],
    });
    expect(r.outcome).toBe('PASS');
    const a = r.accounts[0];
    expect(a.callsDelta).toBe(-20);
    expect(a.minutesDelta).toBeCloseTo(-1, 6);
  });
});

describe('over-billing', () => {
  it('fails an account the platform billed and the switch did not', () => {
    const r = reconcileAccounts({
      reference: [acct('a', 100)],
      platform:  [acct('a', 100), acct('ghost', 42)],
    });
    expect(r.outcome).toBe('FAIL');
    const ghost = r.failing.find(x => x.customer === 'ghost')!;
    expect(ghost.status).toBe('missing_from_reference');
    expect(r.summary.delta).toBeCloseTo(42, 6);
  });
});
