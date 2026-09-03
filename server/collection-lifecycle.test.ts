import { describe, it, expect } from 'vitest';
import {
  decideAccountCollection, normaliseLifecycle, planByLifecycle,
  type AccountLifecycleInput,
} from './collection-lifecycle';

const DAY = '2026-09-02';

/**
 * THE CASE THAT DEFINES THE POLICY.
 *
 * 09:00 customer Active. 11:00 they burn $2,000. 11:05 balance exhausted.
 * 11:06 the Rate Manager switches them to Inactive.
 *
 * The calls already completed and Sippy is holding their CDRs. If the
 * scheduler filters on `status = 'active'` that night, $2,000 of billable
 * traffic is never collected and the invoice is for zero. This is the failure
 * the outstanding-day exception exists to prevent — and the reason the status
 * filter can be introduced at all.
 */
describe('the $2,000 mid-day retirement', () => {
  it('still collects the day the customer was trading', () => {
    const d = decideAccountCollection({
      status: 'inactive',
      lifecycleChangedAtIso: '2026-09-02T11:06:00Z',  // same day
      targetDay: DAY,
      daySealed: false,
    });
    expect(d.collect).toBe(true);
    expect(d.action).toBe('collect_outstanding');
    expect(d.reason).toContain('outstanding day');
    expect(d.reason).toContain('still trading');
  });

  it('holds the invoice rather than sending or suppressing it', () => {
    // The revenue is real and must be billed; a person decides when.
    const d = decideAccountCollection({
      status: 'inactive', lifecycleChangedAtIso: '2026-09-02T11:06:00Z', targetDay: DAY,
    });
    expect(d.invoice).toBe('hold');
    expect(d.invoice).not.toBe('none');
  });

  it('stops collecting days AFTER the retirement, so the rule terminates', () => {
    // Without this, an inactive account is queued every night forever and
    // "excluded from future collection" means nothing.
    const d = decideAccountCollection({
      status: 'inactive',
      lifecycleChangedAtIso: '2026-09-02T11:06:00Z',
      targetDay: '2026-09-05',            // three days after retirement
      daySealed: false,
    });
    expect(d.collect).toBe(false);
    expect(d.action).toBe('skip');
    expect(d.reason).toContain('after retirement');
  });

  it('collects a day from BEFORE the retirement that was never sealed', () => {
    const d = decideAccountCollection({
      status: 'dormant',
      lifecycleChangedAtIso: '2026-09-10T00:00:00Z',
      targetDay: '2026-08-29',            // long before, still owed
      daySealed: false,
    });
    expect(d.collect).toBe(true);
    expect(d.action).toBe('collect_outstanding');
  });
});

describe('a sealed day is never re-collected, whatever the lifecycle', () => {
  for (const status of ['active', 'inactive', 'dormant', null]) {
    it(`skips a sealed day for ${status ?? 'unclassified'}`, () => {
      const d = decideAccountCollection({
        status, lifecycleChangedAtIso: '2026-09-01T00:00:00Z',
        targetDay: DAY, daySealed: true,
      });
      expect(d.collect).toBe(false);
      expect(d.action).toBe('skip');
      expect(d.reason).toContain('already collected');
    });
  }
});

describe('unclassified is active, not inactive', () => {
  it('collects a customer with no status recorded', () => {
    // Treating unclassified as inactive would silently stop collecting for
    // every customer predating the lifecycle feature.
    for (const s of [null, undefined, '', '   ', 'ACTIVE', 'Active']) {
      const d = decideAccountCollection({ status: s as any, targetDay: DAY });
      expect(d.collect).toBe(true);
      expect(d.lifecycle).toBe('active');
    }
  });

  it('marks it as unclassified so the count is visible, not hidden', () => {
    const d = decideAccountCollection({ status: null, targetDay: DAY });
    expect(d.unclassified).toBe(true);
    expect(d.reason).toContain('Unclassified');
    // A genuine 'active' is not flagged.
    expect(decideAccountCollection({ status: 'active', targetDay: DAY }).unclassified).toBe(false);
  });

  it('treats a word this platform does not use as unclassified, not as a new state', () => {
    const d = decideAccountCollection({ status: 'suspended', targetDay: DAY });
    expect(d.lifecycle).toBe('active');
    expect(d.unclassified).toBe(true);
    expect(d.collect).toBe(true);
  });
});

describe('missing change date fails SAFE', () => {
  it('collects an unsealed day when the change date is unknown', () => {
    // An account predating migration 506 has no stamp. We cannot tell whether
    // the day falls before or after retirement, and refusing to collect risks
    // dropping billable traffic — the exact failure this policy prevents.
    for (const iso of [null, undefined, 'not-a-date']) {
      const d = decideAccountCollection({
        status: 'dormant', lifecycleChangedAtIso: iso as any, targetDay: DAY, daySealed: false,
      });
      expect(d.collect).toBe(true);
      expect(d.action).toBe('collect_outstanding');
      expect(d.reason).toContain('no recorded change date');
    }
  });

  it('says the decision rested on incomplete evidence', () => {
    const d = decideAccountCollection({ status: 'inactive', targetDay: DAY });
    expect(d.reason).toContain('rather than risk dropping billable traffic');
  });
});

describe('invoice policy follows the lifecycle, never the collection outcome', () => {
  const at = (status: string | null) =>
    decideAccountCollection({ status, targetDay: DAY }).invoice;

  it('allows for active, holds for inactive, none for dormant', () => {
    expect(at('active')).toBe('allow');
    expect(at(null)).toBe('allow');       // unclassified → active
    expect(at('inactive')).toBe('hold');
    expect(at('dormant')).toBe('none');
  });

  it('does not change because a day was already sealed', () => {
    // Whether we collect tonight and whether an invoice may be raised are
    // different questions with different owners.
    const sealed = decideAccountCollection({
      status: 'inactive', targetDay: DAY, daySealed: true,
      lifecycleChangedAtIso: '2026-09-01T00:00:00Z',
    });
    expect(sealed.collect).toBe(false);
    expect(sealed.invoice).toBe('hold');
  });
});

describe('normaliseLifecycle', () => {
  it('is case- and whitespace-insensitive on the three real values', () => {
    expect(normaliseLifecycle('  Dormant ')).toEqual({ lifecycle: 'dormant', unclassified: false });
    expect(normaliseLifecycle('INACTIVE')).toEqual({ lifecycle: 'inactive', unclassified: false });
  });
});

describe('planByLifecycle', () => {
  type Acct = { name: string; status: string | null; changed?: string | null; sealed?: boolean };
  const read = (a: Acct): AccountLifecycleInput => ({
    status: a.status, lifecycleChangedAtIso: a.changed ?? null,
    targetDay: DAY, daySealed: a.sealed,
  });

  const accounts: Acct[] = [
    { name: 'alpha',  status: 'active' },
    { name: 'bravo',  status: 'active', sealed: true },
    { name: 'charlie', status: 'inactive', changed: '2026-09-02T11:06:00Z' }, // outstanding
    { name: 'delta',  status: 'inactive', changed: '2026-08-01T00:00:00Z' },  // retired long ago
    { name: 'echo',   status: 'dormant',  changed: '2026-08-01T00:00:00Z' },
    { name: 'foxtrot', status: null },                                        // unclassified
  ];

  it('splits collect from skipped and preserves order', () => {
    const p = planByLifecycle(accounts, read);
    expect(p.collect.map(x => x.account.name)).toEqual(['alpha', 'charlie', 'foxtrot']);
    expect(p.skipped.map(x => x.account.name)).toEqual(['bravo', 'delta', 'echo']);
  });

  it('counts the lifecycles and the outstanding exceptions separately', () => {
    const p = planByLifecycle(accounts, read);
    // alpha, bravo, and foxtrot (unclassified → active) = 3.
    expect(p.counts.active).toBe(3);
    expect(p.counts.inactive).toBe(2);
    expect(p.counts.dormant).toBe(1);
    expect(p.counts.unclassified).toBe(1);
    // The number worth watching: only charlie was collected as an exception.
    expect(p.counts.outstanding).toBe(1);
  });

  it('summarises in one line, naming the outstanding count when non-zero', () => {
    const p = planByLifecycle(accounts, read);
    expect(p.summary).toContain('3 to collect');
    expect(p.summary).toContain('1 outstanding-day');
    expect(p.summary).toContain('1 unclassified→active');
  });

  it('omits the outstanding clause when there are none', () => {
    const p = planByLifecycle([{ name: 'solo', status: 'active' }], read);
    expect(p.summary).not.toContain('outstanding-day');
    expect(p.counts.outstanding).toBe(0);
  });

  it('handles an empty account list', () => {
    const p = planByLifecycle([] as Acct[], read);
    expect(p.collect).toEqual([]);
    expect(p.skipped).toEqual([]);
    expect(p.summary).toContain('0 to collect');
  });

  it('every skipped account carries a reason — nothing drops out silently', () => {
    const p = planByLifecycle(accounts, read);
    for (const s of p.skipped) {
      expect(s.decision.reason.length).toBeGreaterThan(10);
    }
  });
});
