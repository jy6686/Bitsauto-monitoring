import { describe, it, expect } from 'vitest';
import {
  resolveScheduleAccount, periodOutcomeFromChain, buildRunOutcome, stoppedRun, nextStepFor,
  isRetryable, nextRetryAt, retrySince, previousPeriod, periodKey, selectPeriodsToAttempt,
  MAX_RETRY_ATTEMPTS, RETRY_INTERVAL_HOURS, COLLECTION_WINDOW_UTC,
  type PeriodOutcome, type ScheduleRunOutcome,
} from './schedule-run-outcome';

const WEEK = { start: '2026-09-01', end: '2026-09-06', accountingMonth: '2026-09', partial: true };
const AUG  = { start: '2026-08-31', end: '2026-08-31', accountingMonth: '2026-08', partial: true };
const at = '2026-09-07T06:00:00.000Z';

const account = { iAccount: 96, source: 'company' as const, detail: 'Account 96, from the company record.' };
const coverageFail = { ok: false, stage: 'coverage', error: 'Period 2026-09-01 – 2026-09-06 is missing 4 of 6 day(s).' };

describe('resolveScheduleAccount — the input every data gate is scoped to', () => {
  it('takes the schedule’s own account first', () => {
    const r = resolveScheduleAccount({ iAccount: 315, companyId: 9 }, { sippyIAccount: 96 });
    expect(r).toMatchObject({ iAccount: 315, source: 'schedule' });
  });

  it('falls back to the company record — schedule #2 (noman) in production', () => {
    // invoice_schedules row: iAccount null, companyId 7. companies row 7: sippyIAccount 96.
    const r = resolveScheduleAccount({ iAccount: null, companyId: 7 }, { sippyIAccount: 96 });
    expect(r).toMatchObject({ iAccount: 96, source: 'company' });
    expect(r.detail).toContain('96');
  });

  it('names a missing company — schedule #1 (Internal-PTCL) in production', () => {
    // GET /api/companies/1 → "Company not found", so the runner passes null.
    const r = resolveScheduleAccount({ iAccount: null, companyId: 1 }, null);
    expect(r).toMatchObject({ iAccount: null, source: 'none' });
    expect(r.detail).toContain('Company #1 was not found');
  });

  it('distinguishes a company without an account from no company at all', () => {
    expect(resolveScheduleAccount({ iAccount: null, companyId: 7 }, { sippyIAccount: null }).detail)
      .toContain('has no Sippy account');
    expect(resolveScheduleAccount({ iAccount: null, companyId: null }, null).detail)
      .toContain('names no company');
  });

  it('treats 0, negatives and non-numbers as no account, not as account 0', () => {
    // Number(undefined) || 0 is how silent zeros are born; an account id of 0
    // would be scoped to nothing and pass every gate vacuously.
    for (const bad of [0, -5, 1.5, NaN, '', 'abc'] as any[]) {
      expect(resolveScheduleAccount({ iAccount: bad, companyId: null }, null).iAccount).toBeNull();
    }
    expect(resolveScheduleAccount({ iAccount: '96' as any, companyId: null }, null).iAccount).toBe(96);
  });
});

describe('isRetryable — can waiting change this verdict?', () => {
  it('is true for the gates whose data completes on its own', () => {
    for (const s of ['seed', 'coverage', 'reconcile', 'certify', 'generate'] as const) {
      expect(isRetryable(s)).toBe(true);
    }
  });

  it('is false for a period that is ALREADY invoiced', () => {
    // duplicate is the success case wearing a refusal's clothes.
    expect(isRetryable('duplicate')).toBe(false);
  });

  it('is false at certify when the switch had no calls and the days were collected', () => {
    // Coverage passed, so the days exist; the seed fetched nothing. There is
    // nothing to bill, and no amount of waiting produces some. Retrying would
    // re-fetch the whole period every six hours, forever.
    expect(isRetryable('certify', { fetched: 0 })).toBe(false);
    expect(isRetryable('certify', { fetched: 12 })).toBe(true);
    expect(isRetryable('certify', null)).toBe(true);
  });

  it('does not put freeze on a retry slot — the ordinary cadence reaches it', () => {
    expect(isRetryable('freeze')).toBe(false);
  });
});

describe('nextRetryAt — never inside the collection window', () => {
  const H = (d: Date) => d.getUTCHours();

  it('is RETRY_INTERVAL_HOURS out when that lands outside the window', () => {
    const now = new Date('2026-09-07T08:00:00Z');
    expect(nextRetryAt(now).toISOString()).toBe('2026-09-07T14:00:00.000Z');
  });

  it('is pushed to the window’s end when it would land inside it', () => {
    // 22:00 + 6h = 04:00, mid-collection. The collector owns the switch then.
    const at4am = nextRetryAt(new Date('2026-09-07T22:00:00Z'));
    expect(at4am.toISOString()).toBe('2026-09-08T06:00:00.000Z');
    expect(H(at4am)).toBe(COLLECTION_WINDOW_UTC.endHour);
  });

  it('never returns an instant inside the window, from any hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      const got = nextRetryAt(new Date(Date.UTC(2026, 8, 7, h, 30)));
      const inWindow = H(got) >= COLLECTION_WINDOW_UTC.startHour && H(got) < COLLECTION_WINDOW_UTC.endHour;
      expect(inWindow).toBe(false);
    }
  });

  it('is always in the future', () => {
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 8, 7, h, 30));
      expect(nextRetryAt(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('honours a caller-supplied interval', () => {
    expect(nextRetryAt(new Date('2026-09-07T08:00:00Z'), 1).toISOString()).toBe('2026-09-07T09:00:00.000Z');
    expect(RETRY_INTERVAL_HOURS).toBe(6);
  });

  it('treats the window as [02:00, 06:00) — exactly on each boundary', () => {
    // 20:00 + 6h = 02:00 exactly: inside, pushed out.
    expect(nextRetryAt(new Date('2026-09-07T20:00:00Z')).toISOString()).toBe('2026-09-08T06:00:00.000Z');
    // 00:00 + 6h = 06:00 exactly: the window has ENDED, so it stands.
    expect(nextRetryAt(new Date('2026-09-08T00:00:00Z')).toISOString()).toBe('2026-09-08T06:00:00.000Z');
    // 19:59:59 + 6h = 01:59:59: before the window, untouched.
    expect(nextRetryAt(new Date('2026-09-07T19:59:59Z')).toISOString()).toBe('2026-09-08T01:59:59.000Z');
  });

  it('uses UTC only, so a DST shift cannot move the window', () => {
    // Europe/London springs forward 2026-03-29 01:00 UTC. A local-time
    // implementation would slide the window by an hour on this date; UTC
    // arithmetic cannot. Both sides of the transition behave identically.
    for (const iso of ['2026-03-28T20:00:00Z', '2026-03-29T20:00:00Z', '2026-10-24T20:00:00Z']) {
      expect(nextRetryAt(new Date(iso)).getUTCHours()).toBe(COLLECTION_WINDOW_UTC.endHour);
    }
  });

  it('is minute-exact inside the window, not just hour-exact', () => {
    // 02:30 and 05:59 are both inside; both land on the window's end.
    for (const iso of ['2026-09-07T20:30:00Z', '2026-09-07T23:59:00Z']) {
      const got = nextRetryAt(new Date(iso));
      expect(got.getUTCHours()).toBe(COLLECTION_WINDOW_UTC.endHour);
      expect(got.getUTCMinutes()).toBe(0);
    }
  });
});

describe('periodOutcomeFromChain — the chain’s words, not a paraphrase', () => {
  it('records a generated invoice', () => {
    const o = periodOutcomeFromChain(WEEK, { ok: true, invoice: { id: 12, invoiceNumber: 'C-2609-0012', lineCount: 312 } });
    expect(o).toMatchObject({ ok: true, invoiceNumber: 'C-2609-0012', lineCount: 312, start: '2026-09-01', end: '2026-09-06' });
    expect(o.stage).toBeUndefined();
  });

  it('keeps the refusal verbatim and promises the retry', () => {
    const o = periodOutcomeFromChain(WEEK, coverageFail);
    expect(o).toMatchObject({ ok: false, stage: 'coverage', retryable: true, attempt: 1 });
    expect(o.reason).toBe(coverageFail.error);
    expect(o.next).toContain('once the missing days are collected');
    expect(o.next).toContain(`${MAX_RETRY_ATTEMPTS - 1} automatic attempt(s) left`);
  });

  it('counts attempts across runs, from the previous outcome', () => {
    let prev: PeriodOutcome | null = null;
    for (let n = 1; n < MAX_RETRY_ATTEMPTS; n++) {
      const o = periodOutcomeFromChain(WEEK, coverageFail, prev);
      expect(o).toMatchObject({ attempt: n, retryable: true });
      expect(o.exhausted).toBeUndefined();
      prev = o;
    }
    const last = periodOutcomeFromChain(WEEK, coverageFail, prev);
    expect(last).toMatchObject({ attempt: MAX_RETRY_ATTEMPTS, retryable: false, exhausted: true });
    expect(last.next).toContain('stopped retrying');
  });

  it('resets the count after a success — a period billed later starts clean', () => {
    const ok = periodOutcomeFromChain(WEEK, { ok: true, invoice: { id: 1, invoiceNumber: 'X', lineCount: 1 } });
    expect(periodOutcomeFromChain(WEEK, coverageFail, ok).attempt).toBe(1);
  });

  it('marks a zero-traffic certify refusal terminal, not retryable', () => {
    // noman: no reference row, no calls. Retrying re-fetches the week every
    // six hours to learn the same thing.
    const o = periodOutcomeFromChain(WEEK, {
      ok: false, stage: 'certify',
      error: 'No call has been verified for tariff 2 in 2026-09-01–2026-09-06. Reconcile the period before invoicing it.',
      seed: { fetched: 0, created: 0, skipped: 0 },
    });
    expect(o.retryable).toBe(false);
    expect(o.exhausted).toBeUndefined();
    expect(o.next).toContain('nothing to invoice');
    expect(o.reason).toContain('No call has been verified');   // still the chain's words
  });

  it('does not count a success without an invoice as generated', () => {
    const o = periodOutcomeFromChain(WEEK, { ok: true });
    expect(o).toMatchObject({ ok: false, stage: 'generate', retryable: true });
  });

  it('maps an unknown stage to error rather than inventing one', () => {
    expect(periodOutcomeFromChain(WEEK, { ok: false, stage: 'teleport' as any, error: 'x' }).stage).toBe('error');
  });

  it('never leaves a refusal without a reason', () => {
    expect(periodOutcomeFromChain(WEEK, { ok: false, stage: 'seed', error: '   ' }).reason)
      .toMatch(/without giving a reason/);
  });
});

describe('retrySince — what makes a refused period come back', () => {
  const refused = (p: typeof WEEK) => periodOutcomeFromChain(p, coverageFail);

  it('is the OLDEST still-retryable period, so nothing older is dropped', () => {
    const prev = buildRunOutcome({ at, trigger: 'scheduler', account,
      periods: [refused(WEEK), refused(AUG)], retryAt: new Date(at) });
    expect(retrySince(prev)).toBe('2026-08-31');
  });

  it('is undefined when every period succeeded — the ordinary cadence applies', () => {
    const prev = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [
      periodOutcomeFromChain(WEEK, { ok: true, invoice: { id: 1, invoiceNumber: 'X', lineCount: 3 } }),
    ] });
    expect(retrySince(prev)).toBeUndefined();
  });

  it('is undefined for a terminal refusal — it must not be re-fetched forever', () => {
    const prev = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [
      periodOutcomeFromChain(WEEK, { ok: false, stage: 'certify', error: 'no calls', seed: { fetched: 0, created: 0, skipped: 0 } }),
    ] });
    expect(retrySince(prev)).toBeUndefined();
  });

  it('is undefined once the attempts are exhausted', () => {
    let prev: PeriodOutcome | null = null;
    for (let n = 0; n < MAX_RETRY_ATTEMPTS; n++) prev = periodOutcomeFromChain(WEEK, coverageFail, prev);
    const run = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [prev!] });
    expect(prev!.exhausted).toBe(true);
    expect(retrySince(run)).toBeUndefined();
  });

  it('is undefined with no previous run at all', () => {
    expect(retrySince(null)).toBeUndefined();
    expect(retrySince(undefined)).toBeUndefined();
    expect(retrySince({ periods: [] } as any)).toBeUndefined();
  });
});

describe('selectPeriodsToAttempt — a backlog must not starve this week', () => {
  const wk = (n: number) => ({ start: `2026-0${n < 5 ? 8 : 9}-${String(n * 7 - 4).padStart(2, '0')}`,
                               end:   `2026-0${n < 5 ? 8 : 9}-${String(n * 7 + 2).padStart(2, '0')}` });
  const W1 = { start: '2026-08-03', end: '2026-08-09' };
  const W2 = { start: '2026-08-10', end: '2026-08-16' };
  const W3 = { start: '2026-08-17', end: '2026-08-23' };
  const W4 = { start: '2026-08-24', end: '2026-08-30' };
  const W5 = { start: '2026-09-01', end: '2026-09-06' };
  const ALL = [W1, W2, W3, W4, W5];

  const runWith = (periods: PeriodOutcome[]): ScheduleRunOutcome =>
    buildRunOutcome({ at, trigger: 'scheduler', account, periods, retryAt: new Date(at) });

  it('attempts everything when it fits', () => {
    expect(selectPeriodsToAttempt([W4, W5], null)).toEqual([W4, W5]);
  });

  it('ALWAYS keeps the newest — week 1 cannot block weeks 2-5', () => {
    // The owner's scenario: an old period that keeps failing, newer ones ready.
    const got = selectPeriodsToAttempt(ALL, null, 4);
    expect(got).toHaveLength(4);
    expect(got[got.length - 1]).toEqual(W5);        // this week is attempted
    expect(got).toEqual([W1, W2, W3, W5]);          // and the backlog drains oldest-first
  });

  it('gives the single slot to the newest, not the oldest', () => {
    expect(selectPeriodsToAttempt(ALL, null, 1)).toEqual([W5]);
  });

  it('does not re-seed a period whose retries are spent', () => {
    let spent: PeriodOutcome | null = null;
    for (let n = 0; n < MAX_RETRY_ATTEMPTS; n++) spent = periodOutcomeFromChain(W1, coverageFail, spent);
    expect(spent!.exhausted).toBe(true);
    const got = selectPeriodsToAttempt(ALL, runWith([spent!]), 4);
    expect(got).not.toContainEqual(W1);
    expect(got).toEqual([W2, W3, W4, W5]);
  });

  it('does not re-seed a terminal refusal', () => {
    const terminal = periodOutcomeFromChain(W1, {
      ok: false, stage: 'certify', error: 'no calls', seed: { fetched: 0, created: 0, skipped: 0 },
    });
    expect(selectPeriodsToAttempt(ALL, runWith([terminal]), 4)).not.toContainEqual(W1);
  });

  it('does not spend a slot on a period already invoiced', () => {
    const done = periodOutcomeFromChain(W1, { ok: true, invoice: { id: 1, invoiceNumber: 'C-1', lineCount: 5 } });
    const got = selectPeriodsToAttempt(ALL, runWith([done]), 4);
    expect(got).toEqual([W2, W3, W4, W5]);
  });

  it('keeps re-attempting a period that is still retryable', () => {
    const pending = periodOutcomeFromChain(W1, coverageFail);
    expect(selectPeriodsToAttempt(ALL, runWith([pending]), 4)).toContainEqual(W1);
  });

  it('reaches the newest week on EVERY run while it is still retryable', () => {
    // Five open weeks, four slots, everything failing at coverage. The
    // starvation bug this guards: the oldest four fill the cap and the week
    // the customer is waiting on is never attempted.
    let prev: ScheduleRunOutcome | null = null;
    for (let run = 0; run < MAX_RETRY_ATTEMPTS; run++) {
      const chosen = selectPeriodsToAttempt(ALL, prev, 4);
      expect(chosen).toContainEqual(W5);
      prev = runWith(chosen.map(p => periodOutcomeFromChain(p, coverageFail, previousPeriod(prev, p))));
    }
    // Its attempts are now spent — it stops being re-fetched, which is the
    // bounded-retry contract, and it is still on the record as needing a person.
    const w5 = previousPeriod(prev, W5)!;
    expect(w5).toMatchObject({ attempt: MAX_RETRY_ATTEMPTS, exhausted: true, retryable: false });
    expect(selectPeriodsToAttempt(ALL, prev, 4)).not.toContainEqual(W5);
  });

  it('drains a backlog rather than stalling on it', () => {
    // W4 is squeezed out while three older weeks hold slots; once they spend
    // their attempts it gets its turn, so nothing is permanently skipped.
    let prev: ScheduleRunOutcome | null = null;
    let everChose4 = false;
    for (let run = 0; run < MAX_RETRY_ATTEMPTS + 2; run++) {
      const chosen = selectPeriodsToAttempt(ALL, prev, 4);
      if (chosen.some(p => p.start === W4.start)) everChose4 = true;
      prev = runWith(chosen.map(p => periodOutcomeFromChain(p, coverageFail, previousPeriod(prev, p))));
    }
    expect(everChose4).toBe(true);
    // And a run that keeps failing eventually stops costing fetches entirely.
    expect(selectPeriodsToAttempt(ALL, prev, 4).length).toBeLessThan(ALL.length);
  });

  it('returns nothing rather than something when given no slots', () => {
    expect(selectPeriodsToAttempt(ALL, null, 0)).toEqual([]);
    expect(selectPeriodsToAttempt([], null)).toEqual([]);
  });

  it('preserves chronological order', () => {
    const got = selectPeriodsToAttempt(ALL, null, 3);
    expect(got.map(p => p.start)).toEqual([...got.map(p => p.start)].sort());
    expect(wk(1).start < wk(2).start).toBe(true);   // the helper orders as assumed
  });
});

describe('previousPeriod — matching a period across runs', () => {
  it('matches on the exact span, not on overlap', () => {
    const prev = buildRunOutcome({ at, trigger: 'scheduler', account,
      periods: [periodOutcomeFromChain(WEEK, coverageFail)] });
    expect(previousPeriod(prev, WEEK)?.attempt).toBe(1);
    expect(previousPeriod(prev, AUG)).toBeNull();
    expect(previousPeriod(prev, { start: '2026-09-01', end: '2026-09-07' })).toBeNull();
    expect(previousPeriod(null, WEEK)).toBeNull();
  });

  it('keys a period by its inclusive span', () => {
    expect(periodKey(WEEK)).toBe('2026-09-01..2026-09-06');
  });
});

describe('buildRunOutcome — tomorrow, as it would be recorded', () => {
  it('two periods, both refused and both coming back', () => {
    const periods: PeriodOutcome[] = [
      periodOutcomeFromChain(AUG,  { ok: false, stage: 'reconcile', error: 'FAIL: noman: platform $0.0000 vs switch $1.2000.' }),
      periodOutcomeFromChain(WEEK, coverageFail),
    ];
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods, retryAt: new Date('2026-09-07T12:00:00Z') });
    expect(r).toMatchObject({ status: 'refused', generated: 0, refused: 2, retryable: 2, exhausted: 0 });
    expect(r.retryAt).toBe('2026-09-07T12:00:00.000Z');
    expect(r.headline).toContain('will be re-attempted');
  });

  it('leads the headline with an exhausted period, not merely the first', () => {
    let spent: PeriodOutcome | null = null;
    for (let n = 0; n < MAX_RETRY_ATTEMPTS; n++) spent = periodOutcomeFromChain(AUG, coverageFail, spent);
    const r = buildRunOutcome({ at, trigger: 'scheduler', account,
      periods: [periodOutcomeFromChain(WEEK, coverageFail), spent!], retryAt: new Date(at) });
    expect(r.exhausted).toBe(1);
    expect(r.headline).toContain('2026-08-31');
    expect(r.headline).toContain('needs attention, no automatic retry left');
  });

  it('reports no retry instant when nothing is waiting on one', () => {
    // A retryAt beside zero retryable periods would show the schedule as
    // pending work it does not have.
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, retryAt: new Date(at), periods: [
      periodOutcomeFromChain(WEEK, { ok: true, invoice: { id: 1, invoiceNumber: 'C-2609-0012', lineCount: 312 } }),
    ] });
    expect(r).toMatchObject({ status: 'generated', retryAt: null, retryable: 0 });
    expect(r.headline).toBe('1 invoice(s) generated: C-2609-0012 (312 line(s), 2026-09-01→2026-09-06)');
  });

  it('reports partial when one of two periods billed', () => {
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [
      periodOutcomeFromChain(AUG,  { ok: true, invoice: { id: 1, invoiceNumber: 'C-2608-0010', lineCount: 40 } }),
      periodOutcomeFromChain(WEEK, coverageFail),
    ], retryAt: new Date(at) });
    expect(r.status).toBe('partial');
    expect(r.headline).toMatch(/^1 generated \(C-2608-0010 \(40 line\(s\), 2026-08-31\)\); 1 refused/);
  });

  it('trims the headline but keeps the full reason on the period', () => {
    const long = 'x'.repeat(400);
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [
      periodOutcomeFromChain(WEEK, { ok: false, stage: 'reconcile', error: long }),
    ], retryAt: new Date(at) });
    expect(r.headline.length).toBeLessThan(240);
    expect(r.periods[0].reason).toBe(long);
  });

  it('is JSON-safe — it is persisted on the schedule row and read back next run', () => {
    const r = buildRunOutcome({ at, trigger: 'scheduler', account,
      periods: [periodOutcomeFromChain(WEEK, coverageFail)], retryAt: new Date(at) });
    const round: ScheduleRunOutcome = JSON.parse(JSON.stringify(r));
    expect(round).toEqual(r);
    // and the round-tripped copy still drives the next run's decisions
    expect(retrySince(round)).toBe('2026-09-01');
    expect(previousPeriod(round, WEEK)?.attempt).toBe(1);
  });
});

describe('stoppedRun — the run never reached a period', () => {
  it('no tariff: the row now says so instead of only the log', () => {
    const r = stoppedRun({ at, trigger: 'scheduler', stage: 'no-tariff', reason: 'Schedule #3 has no tariff.' });
    expect(r).toMatchObject({ status: 'stopped', generated: 0, refused: 0, retryAt: null, headline: 'Schedule #3 has no tariff.' });
    expect(r.stopped).toMatchObject({ stage: 'no-tariff', retryable: false });
    expect(r.stopped!.next).toContain('Set a tariff');
    expect(r.account.source).toBe('none');
  });

  it('error: retryable, because the clock did not advance', () => {
    const r = stoppedRun({ at, trigger: 'scheduler', stage: 'error', reason: 'timeout exceeded when trying to connect' });
    expect(r.stopped).toMatchObject({ stage: 'error', retryable: true });
    expect(r.stopped!.next).toContain('within 30 minutes');
  });

  it('keeps a resolved account when the caller had one', () => {
    expect(stoppedRun({ at, trigger: 'manual', account, stage: 'no-period', reason: 'No closed weekly period yet.' }).account)
      .toEqual(account);
  });
});

describe('nextStepFor — every stage has an answer', () => {
  it('covers each stage with non-empty guidance', () => {
    const stages = ['duplicate','seed','freeze','coverage','reconcile','certify','generate','no-tariff','no-period','error'] as const;
    for (const s of stages) expect(nextStepFor(s).length).toBeGreaterThan(20);
  });

  it('promises the retry when one is coming, and asks for a person when it is not', () => {
    expect(nextStepFor('coverage', { retryable: true, attempt: 1 })).toContain('automatic attempt(s) left');
    expect(nextStepFor('coverage', { retryable: false, exhausted: true, attempt: 6 })).toContain('Run now');
    expect(nextStepFor('duplicate')).toContain('Already invoiced');
  });
});
