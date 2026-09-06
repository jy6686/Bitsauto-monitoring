import { describe, it, expect } from 'vitest';
import {
  resolveScheduleAccount, periodOutcomeFromChain, buildRunOutcome, stoppedRun, nextStepFor,
  type PeriodOutcome,
} from './schedule-run-outcome';

const WEEK = { start: '2026-09-01', end: '2026-09-06', accountingMonth: '2026-09', partial: true };
const AUG  = { start: '2026-08-31', end: '2026-08-31', accountingMonth: '2026-08', partial: true };
const at = '2026-09-07T06:00:00.000Z';

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

describe('periodOutcomeFromChain — the chain’s words, not a paraphrase', () => {
  it('records a generated invoice', () => {
    const o = periodOutcomeFromChain(WEEK, { ok: true, invoice: { id: 12, invoiceNumber: 'C-2609-0012', lineCount: 312 } });
    expect(o).toMatchObject({ ok: true, invoiceNumber: 'C-2609-0012', lineCount: 312, start: '2026-09-01', end: '2026-09-06' });
    expect(o.stage).toBeUndefined();
  });

  it('keeps the refusal verbatim and says what to do next', () => {
    const error = 'Period 2026-09-01 – 2026-09-06 is missing 4 of 6 day(s): 2026-09-02, 2026-09-03, 2026-09-04, 2026-09-05 were never collected.';
    const o = periodOutcomeFromChain(WEEK, { ok: false, stage: 'coverage', error });
    expect(o.ok).toBe(false);
    expect(o.stage).toBe('coverage');
    expect(o.reason).toBe(error);
    expect(o.next).toContain('Not retried by the scheduler');
    expect(o.next).toContain('Run now');
  });

  it('tells a zero-traffic customer the truth at certify, not "reconcile first"', () => {
    // noman has no row in the Sippy P&L for the week. The chain seeds
    // nothing, then certify says "no call has been verified" — true, but the
    // fix it suggests is wrong for a customer who simply made no calls.
    const o = periodOutcomeFromChain(WEEK, {
      ok: false, stage: 'certify', error: 'No call has been verified for tariff 2 in 2026-09-01–2026-09-06. Reconcile the period before invoicing it.',
      seed: { fetched: 0, created: 0, skipped: 0 },
    });
    expect(o.next).toContain('returned no calls');
    expect(o.reason).toContain('No call has been verified');   // still the chain's words
  });

  it('does not count a success without an invoice as generated', () => {
    const o = periodOutcomeFromChain(WEEK, { ok: true });
    expect(o.ok).toBe(false);
    expect(o.stage).toBe('generate');
  });

  it('maps an unknown stage to error rather than inventing one', () => {
    const o = periodOutcomeFromChain(WEEK, { ok: false, stage: 'teleport' as any, error: 'x' });
    expect(o.stage).toBe('error');
  });

  it('never leaves a refusal without a reason', () => {
    const o = periodOutcomeFromChain(WEEK, { ok: false, stage: 'seed', error: '   ' });
    expect(o.reason).toMatch(/without giving a reason/);
  });
});

describe('buildRunOutcome — tomorrow, as it would be recorded', () => {
  const account = { iAccount: 96, source: 'company' as const, detail: 'Account 96, from the company record.' };

  it('two periods, both refused — the 2026-09-07 06:00 run for schedule #2', () => {
    const periods: PeriodOutcome[] = [
      periodOutcomeFromChain(AUG,  { ok: false, stage: 'reconcile', error: 'FAIL: 1 of 1 account(s) do not agree with the switch. noman: platform $0.0000 vs switch $1.2000 (delta $-1.2000).' }),
      periodOutcomeFromChain(WEEK, { ok: false, stage: 'coverage',  error: 'Period 2026-09-01 – 2026-09-06 is missing 4 of 6 day(s).' }),
    ];
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods });
    expect(r).toMatchObject({ generated: 0, refused: 2, trigger: 'scheduler' });
    expect(r.headline).toMatch(/^Refused 2 period\(s\) — first: 2026-08-31 at reconcile:/);
    expect(r.stopped).toBeUndefined();
  });

  it('one generated, one refused — a split week where only August was complete', () => {
    const periods: PeriodOutcome[] = [
      periodOutcomeFromChain(AUG,  { ok: true, invoice: { id: 1, invoiceNumber: 'C-2608-0010', lineCount: 40 } }),
      periodOutcomeFromChain(WEEK, { ok: false, stage: 'coverage', error: 'missing days' }),
    ];
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods });
    expect(r).toMatchObject({ generated: 1, refused: 1 });
    expect(r.headline).toBe('1 generated (C-2608-0010 (40 line(s), 2026-08-31)); 1 refused — 2026-09-01→2026-09-06 at coverage: missing days');
  });

  it('all generated', () => {
    const r = buildRunOutcome({ at, trigger: 'manual', account, periods: [
      periodOutcomeFromChain(WEEK, { ok: true, invoice: { id: 1, invoiceNumber: 'C-2609-0012', lineCount: 312 } }),
    ] });
    expect(r.headline).toBe('1 invoice(s) generated: C-2609-0012 (312 line(s), 2026-09-01→2026-09-06)');
  });

  it('trims the headline but keeps the full reason on the period', () => {
    const long = 'x'.repeat(400);
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [
      periodOutcomeFromChain(WEEK, { ok: false, stage: 'reconcile', error: long }),
    ] });
    expect(r.headline.length).toBeLessThan(220);
    expect(r.headline.endsWith('…')).toBe(true);
    expect(r.periods[0].reason).toBe(long);
  });

  it('is JSON-safe — it is persisted on the schedule row', () => {
    const r = buildRunOutcome({ at, trigger: 'scheduler', account, periods: [
      periodOutcomeFromChain(WEEK, { ok: false, stage: 'coverage', error: 'missing days' }),
    ] });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('stoppedRun — the run never reached a period', () => {
  it('no tariff: the row now says so instead of only the log', () => {
    const r = stoppedRun({ at, trigger: 'scheduler', stage: 'no-tariff', reason: 'Schedule #3 has no tariff.' });
    expect(r).toMatchObject({ generated: 0, refused: 0, periods: [], headline: 'Schedule #3 has no tariff.' });
    expect(r.stopped).toMatchObject({ stage: 'no-tariff' });
    expect(r.stopped!.next).toContain('Set a tariff');
    expect(r.account.source).toBe('none');
  });

  it('error: says it will be retried, because the clock did not advance', () => {
    const r = stoppedRun({ at, trigger: 'scheduler', stage: 'error', reason: 'timeout exceeded when trying to connect' });
    expect(r.stopped!.next).toContain('retried automatically');
    expect(r.headline).toBe('timeout exceeded when trying to connect');
  });

  it('keeps a resolved account when the caller had one', () => {
    const account = { iAccount: 96, source: 'company' as const, detail: 'Account 96, from the company record.' };
    expect(stoppedRun({ at, trigger: 'manual', account, stage: 'no-period', reason: 'No closed weekly period yet.' }).account).toEqual(account);
  });
});

describe('nextStepFor — every stage has an answer', () => {
  it('covers each stage with non-empty guidance', () => {
    const stages = ['duplicate','seed','freeze','coverage','reconcile','certify','generate','no-tariff','no-period','error'] as const;
    for (const s of stages) expect(nextStepFor(s).length).toBeGreaterThan(20);
  });

  it('only duplicate and freeze are safe to ignore', () => {
    // Everything else needs a person, and says so.
    for (const s of ['seed','coverage','reconcile','certify','generate'] as const) {
      expect(nextStepFor(s)).toContain('Not retried by the scheduler');
    }
    expect(nextStepFor('duplicate')).not.toContain('Not retried');
    expect(nextStepFor('freeze')).not.toContain('Not retried');
  });
});
