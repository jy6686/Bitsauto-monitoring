import { describe, it, expect } from 'vitest';
import { reconcileAgainstReference, MONEY_TOLERANCE_USD, type ReconRow } from './billing-reconciliation';

const row = (
  customer: string, prefix: string, rate: number, amount: number,
  calls = 0, minutes = 0, currency = 'USD',
): ReconRow => ({ customer, prefix, rate, currency, calls, minutes, amount });

/**
 * The real Sippy Customer Summary for 2026-08-24 → 2026-08-30, from the
 * production screenshot. Its stated total is $683.3934.
 */
const SIPPY_WEEK: ReconRow[] = [
  row('asterisk',         '192',    0.0350, 217.2561, 290578, 6207.32),
  row('asterisk',         '19234',  0.0300,  81.1135,  44873, 2703.78),
  row('asterisk',         '19230',  0.0275,  21.8983,  41619,  796.30),
  row('asterisk',         '1291',   0.1750,  20.6033,   2289,  117.73),
  row('asterisk',         '1880',   0.0098,  12.1575, 135974, 1234.27),
  row('asterisk',         '19232',  0.0275,   8.8101,  24802,  320.37),
  row('asterisk',         '192300', 0.0500,   4.8033,   2245,   96.07),
  row('asterisk',         '192',    0.0010,   0.0021,    260,    2.08),
  row('internal-ptcl',    '192',    0.0275, 284.4174, 439891,10342.45),
  row('internal-ptcl',    '1880',   0.0098,  11.5476, 136046, 1172.35),
  row('internal-eritrea', '1291',   0.1750,  20.7842,   2293,  118.77),
];

describe('the production case — invoice C-2608-0009', () => {
  /**
   * The platform invoiced $167.5063 of a $683.3934 week and every internal
   * check passed, because each of them compares BitsAuto against BitsAuto.
   */
  it('catches the $515.89 that was never billed', () => {
    const platform = [row('asterisk', '192', 0.0350, 167.5063, 100000, 4000)];
    const r = reconcileAgainstReference({
      reference: SIPPY_WEEK, platform, periodLabel: '2026-08-24 – 2026-08-30',
    });

    expect(r.outcome).toBe('FAIL');
    expect(r.totals.reference).toBeCloseTo(683.3934, 4);
    expect(r.totals.platform).toBeCloseTo(167.5063, 4);
    expect(r.totals.delta).toBeCloseTo(-515.8871, 4);
    expect(r.reason).toContain('683.3934');
    expect(r.reason).toContain('-515.8871');
  });

  /**
   * The specific thing no internal check could ever see: a CUSTOMER absent
   * from the platform. internal-ptcl is 43% of the week and produced no
   * discrepancy anywhere, because it produced nothing at all.
   */
  it('names the customers the platform never billed', () => {
    const r = reconcileAgainstReference({
      reference: SIPPY_WEEK,
      platform: SIPPY_WEEK.filter(x => x.customer === 'asterisk'),
    });
    const missing = r.failing.filter(l => l.status === 'missing_from_platform');
    expect(missing.map(l => l.key.customer).sort())
      .toEqual(['internal-eritrea', 'internal-ptcl', 'internal-ptcl']);
    expect(r.totals.delta).toBeCloseTo(-(284.4174 + 11.5476 + 20.7842), 4);
  });

  it('passes when the platform reproduces the reference exactly', () => {
    const r = reconcileAgainstReference({ reference: SIPPY_WEEK, platform: [...SIPPY_WEEK] });
    expect(r.outcome).toBe('PASS');
    expect(r.failing).toEqual([]);
    expect(r.totals.delta).toBeCloseTo(0, 6);
  });
});

describe('money is compared on an absolute band, never a ratio', () => {
  it('accepts a one-cent difference', () => {
    const r = reconcileAgainstReference({
      reference: [row('c', '92', 0.01, 100.00)],
      platform:  [row('c', '92', 0.01, 100.01)],
    });
    expect(r.outcome).toBe('PASS');
  });

  it('rejects two cents, at any scale', () => {
    const small = reconcileAgainstReference({
      reference: [row('c', '92', 0.01, 1.00)],
      platform:  [row('c', '92', 0.01, 1.02)],
    });
    const large = reconcileAgainstReference({
      reference: [row('c', '92', 0.01, 600_000.00)],
      platform:  [row('c', '92', 0.01, 600_000.02)],
    });
    expect(small.outcome).toBe('FAIL');
    // The whole point of an absolute band: a percentage tolerance would wave
    // this through, and 0.5% of a $600k month is $3,000 of undetected error.
    expect(large.outcome).toBe('FAIL');
  });

  it('uses one cent by default', () => {
    expect(MONEY_TOLERANCE_USD).toBe(0.01);
  });
});

describe('calls and minutes are informational — they never gate', () => {
  it('passes when the money agrees but the call counts do not', () => {
    const r = reconcileAgainstReference({
      reference: [row('c', '92', 0.01, 10.00, 500, 100)],
      platform:  [row('c', '92', 0.01, 10.00, 480,  99)],
    });
    expect(r.outcome).toBe('PASS');
    // Reported, so a persistent count drift is still visible to a human.
    expect(r.lines[0].callsDelta).toBe(-20);
    expect(r.lines[0].minutesDelta).toBeCloseTo(-1, 6);
  });
});

describe('over-billing is caught as well as under-billing', () => {
  it('fails a line the platform billed and the switch did not', () => {
    const r = reconcileAgainstReference({
      reference: [row('c', '92', 0.01, 10.00)],
      platform:  [row('c', '92', 0.01, 10.00), row('c', '880', 0.02, 5.00)],
    });
    expect(r.outcome).toBe('FAIL');
    expect(r.failing[0].status).toBe('missing_from_reference');
    expect(r.totals.delta).toBeCloseTo(5, 6);
  });
});

describe('identity is (customer, prefix, rate, currency)', () => {
  it('treats the same prefix at a different rate as a different line', () => {
    // Real: asterisk bills 192 at both 0.0350 and 0.0010 in the same week.
    const r = reconcileAgainstReference({
      reference: [row('asterisk', '192', 0.0350, 217.2561), row('asterisk', '192', 0.0010, 0.0021)],
      platform:  [row('asterisk', '192', 0.0350, 217.2561)],
    });
    expect(r.outcome).toBe('FAIL');
    expect(r.failing).toHaveLength(1);
    expect(r.failing[0].key.rate).toBe(0.0010);
  });

  it('does not confuse currencies', () => {
    const r = reconcileAgainstReference({
      reference: [row('c', '92', 0.01, 10, 0, 0, 'USD')],
      platform:  [row('c', '92', 0.01, 10, 0, 0, 'AED')],
    });
    expect(r.outcome).toBe('FAIL');
    expect(r.failing).toHaveLength(2);
  });

  it('matches customer names case-insensitively', () => {
    const r = reconcileAgainstReference({
      reference: [row('Acct. Asterisk', '92', 0.01, 10)],
      platform:  [row('acct. asterisk', '92', 0.01, 10)],
    });
    expect(r.outcome).toBe('PASS');
  });
});

describe('REFERENCE_UNAVAILABLE is not PASS', () => {
  /**
   * "We could not check" must never be recorded as "we checked and it was
   * fine" — this platform has produced that defect in five different forms.
   */
  it('reports its own inability rather than passing', () => {
    for (const reference of [null, undefined]) {
      const r = reconcileAgainstReference({ reference, platform: [row('c', '92', 0.01, 10)] });
      expect(r.outcome).toBe('REFERENCE_UNAVAILABLE');
      expect(r.outcome).not.toBe('PASS');
      expect(r.reason).toMatch(/did not happen is not a comparison that passed/);
    }
  });

  it('passes an empty reference against an empty platform — that IS a comparison', () => {
    const r = reconcileAgainstReference({ reference: [], platform: [] });
    expect(r.outcome).toBe('PASS');
  });

  it('fails an empty reference against a platform that billed something', () => {
    const r = reconcileAgainstReference({ reference: [], platform: [row('c', '92', 0.01, 10)] });
    expect(r.outcome).toBe('FAIL');
    expect(r.failing[0].status).toBe('missing_from_reference');
  });
});

describe('failing lines are ordered by the money at stake', () => {
  it('puts the largest discrepancy first', () => {
    const r = reconcileAgainstReference({
      reference: SIPPY_WEEK,
      platform: SIPPY_WEEK.filter(x => x.customer === 'asterisk'),
    });
    expect(r.failing[0].key.customer).toBe('internal-ptcl');
    expect(Math.abs(r.failing[0].amountDelta)).toBeCloseTo(284.4174, 4);
  });
});
