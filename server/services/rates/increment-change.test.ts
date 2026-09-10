/**
 * Billing increment changes — validation, and the date rule that is the whole contract.
 *
 * The load-bearing assertions are about TIME. A change announced for 20 September must not alter
 * what the switch is sent on 19 September, and must alter it on the 20th. Everything else here
 * exists to stop a promise being made that cannot be kept.
 */
import { describe, it, expect } from "vitest";
import {
  validateIncrementChange, resolveEffectiveIncrement, changesDueForApplication,
  describeChangeForNotification, type IncrementChange,
} from "./increment-change";

const change = (o: Partial<IncrementChange> = {}): IncrementChange => ({
  id: 1, productId: 1, destinationId: 10, catalogueVersionId: 1,
  previousIncrement: '60/1', newIncrement: '30/6',
  effectiveDate: '2026-09-20', status: 'accepted', ...o,
});

describe("validation happens before anything is promised", () => {
  const base = { currentIncrement: '60/1', newIncrement: '30/6', effectiveDate: '2026-09-20', today: '2026-09-11' };

  it("accepts a well-formed change and normalises it", () => {
    const r = validateIncrementChange(base);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.normalised).toBe('30/6'); expect(r.parsed).toEqual({ interval1: 30, intervalN: 6 }); }
  });

  it("normalises spacing, so '30 / 6' is not treated as a different term", () => {
    const r = validateIncrementChange({ ...base, newIncrement: '30 / 6' });
    expect(r.ok && r.normalised).toBe('30/6');
  });

  it("refuses an unreadable increment and says what the format is", () => {
    for (const bad of ['', '30', 'abc', '0/1', '1/0', '4000/1', '30/6/1']) {
      const r = validateIncrementChange({ ...base, newIncrement: bad });
      expect(r.ok, `"${bad}" must be refused`).toBe(false);
      if (!r.ok) expect(r.code).toBe('unreadable');
    }
  });

  it("refuses a change to the SAME increment — clients must not be told about a non-change", () => {
    const r = validateIncrementChange({ ...base, newIncrement: '60/1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_change');
  });

  it("treats '60 / 1' as the same as '60/1' when deciding that", () => {
    // Otherwise re-typing the current value with different spacing emails every client.
    const r = validateIncrementChange({ ...base, newIncrement: '60 / 1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_change');
  });

  it("requires an effective date — there is no 'immediately' for a billing increment", () => {
    const r = validateIncrementChange({ ...base, effectiveDate: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('effective_date_missing');
  });

  it("refuses a date in the past — a change cannot take effect before it is announced", () => {
    const r = validateIncrementChange({ ...base, effectiveDate: '2026-09-10' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('effective_date_in_past');
  });

  it("allows today, which is the earliest a change can honestly be announced for", () => {
    expect(validateIncrementChange({ ...base, effectiveDate: '2026-09-11' }).ok).toBe(true);
  });
});

describe("THE DATE RULE — before the effective date, nothing changes", () => {
  const c = change({ effectiveDate: '2026-09-20', newIncrement: '30/6' });

  it("the day BEFORE, the catalogue increment is still in force", () => {
    const r = resolveEffectiveIncrement('60/1', [c], '2026-09-19');
    expect(r.increment).toEqual({ interval1: 60, intervalN: 1 });
    expect(r.source).toBe('catalogue');
  });

  it("ON the effective date, the new increment is in force", () => {
    const r = resolveEffectiveIncrement('60/1', [c], '2026-09-20');
    expect(r.increment).toEqual({ interval1: 30, intervalN: 6 });
    expect(r.source).toBe('change');
  });

  it("after the effective date it stays in force", () => {
    expect(resolveEffectiveIncrement('60/1', [c], '2026-12-01').increment).toEqual({ interval1: 30, intervalN: 6 });
  });

  it("a pending change is reported as SCHEDULED, so it is visible without being applied", () => {
    const r = resolveEffectiveIncrement('60/1', [c], '2026-09-19');
    expect(r.scheduled).toEqual({ changeId: 1, increment: '30/6', effectiveDate: '2026-09-20' });
  });

  it("a cancelled change never takes effect, even after its date", () => {
    const r = resolveEffectiveIncrement('60/1', [change({ status: 'cancelled' })], '2026-12-01');
    expect(r.increment).toEqual({ interval1: 60, intervalN: 1 });
    expect(r.source).toBe('catalogue');
  });

  it("a failed change does not silently become the truth", () => {
    // The switch was not updated. Reporting the new increment as in force would misdescribe it.
    const r = resolveEffectiveIncrement('60/1', [change({ status: 'failed' })], '2026-12-01');
    expect(r.source).toBe('catalogue');
  });

  it("the LATEST effective change wins when several have passed", () => {
    const r = resolveEffectiveIncrement('60/1', [
      change({ id: 1, effectiveDate: '2026-09-20', newIncrement: '30/6' }),
      change({ id: 2, effectiveDate: '2026-10-01', newIncrement: '1/1' }),
    ], '2026-12-01');
    expect(r.increment).toEqual({ interval1: 1, intervalN: 1 });
    expect(r.changeId).toBe(2);
  });

  it("and the earlier one still governs the window between them", () => {
    const r = resolveEffectiveIncrement('60/1', [
      change({ id: 1, effectiveDate: '2026-09-20', newIncrement: '30/6' }),
      change({ id: 2, effectiveDate: '2026-10-01', newIncrement: '1/1' }),
    ], '2026-09-25');
    expect(r.increment).toEqual({ interval1: 30, intervalN: 6 });
    expect(r.scheduled?.effectiveDate).toBe('2026-10-01');
  });
});

describe("commercial truth and switch state are answered separately", () => {
  it("a change past its date but not applied is flagged as awaiting application", () => {
    // The promise is due and the switch has not been told. That gap must be visible.
    const r = resolveEffectiveIncrement('60/1', [change({ status: 'notified' })], '2026-09-21');
    expect(r.increment).toEqual({ interval1: 30, intervalN: 6 });
    expect(r.awaitingApplication).toBe(true);
  });

  it("once applied, it is no longer awaiting anything", () => {
    const r = resolveEffectiveIncrement('60/1', [change({ status: 'applied', appliedAt: '2026-09-20T00:05:00Z' })], '2026-09-21');
    expect(r.awaitingApplication).toBe(false);
  });

  it("changes due for application are exactly the accepted/notified ones whose date has arrived", () => {
    const due = changesDueForApplication([
      change({ id: 1, effectiveDate: '2026-09-20', status: 'notified' }),
      change({ id: 2, effectiveDate: '2026-09-25', status: 'accepted' }),   // not yet due
      change({ id: 3, effectiveDate: '2026-09-19', status: 'applied' }),    // already done
      change({ id: 4, effectiveDate: '2026-09-18', status: 'cancelled' }),  // withdrawn
    ], '2026-09-21');
    expect(due.map(c => c.id)).toEqual([1]);
  });
});

describe("no change, no resolution", () => {
  it("with no changes the catalogue value stands", () => {
    const r = resolveEffectiveIncrement('60/1', [], '2026-09-20');
    expect(r.increment).toEqual({ interval1: 60, intervalN: 1 });
    expect(r.source).toBe('catalogue');
  });

  it("an unreadable catalogue value with no change resolves to nothing, not to 1/1", () => {
    // Falling back to 1/1 would invent a billing term. The caller decides what to do with null.
    const r = resolveEffectiveIncrement('garbage', [], '2026-09-20');
    expect(r.increment).toBeNull();
    expect(r.source).toBe('none');
  });

  it("a change overrides an unreadable catalogue value", () => {
    const r = resolveEffectiveIncrement(null, [change()], '2026-09-20');
    expect(r.increment).toEqual({ interval1: 30, intervalN: 6 });
  });
});

describe("the notification says the same thing the switch will do", () => {
  it("names the destination, both increments and the date", () => {
    const text = describeChangeForNotification({
      destinationName: 'PAKISTAN - MOBILE JAZZ', previousIncrement: '60/1',
      newIncrement: '30/6', effectiveDate: '2026-09-20',
    });
    expect(text).toContain('PAKISTAN - MOBILE JAZZ');
    expect(text).toContain('from 60/1');
    expect(text).toContain('to 30/6');
    expect(text).toContain('effective 2026-09-20');
  });

  it("reads correctly when there was no previous increment", () => {
    const text = describeChangeForNotification({
      destinationName: 'X', previousIncrement: null, newIncrement: '30/6', effectiveDate: '2026-09-20',
    });
    expect(text).not.toContain('from null');
    expect(text).toContain('to 30/6');
  });
});
