/**
 * The operation-row intent source — pure decisions.
 *
 * push-batch never stamps newRate on its job row, so its orphans parsed to no intent and were
 * skipped. The operation rows carry the intent. These pin what that source may and may not
 * conclude: nothing from no rows; nothing at all from a set with an unverifiable running row; a
 * verdict per running row, each on its own; and never an inference that a pending row was sent.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveOperationIntent, hasOperationIntent, classifyOperation, jobVerdictFromOperations,
  hasVerifiableIntent, OPERATION_RECONCILE_STATE,
  type OperationRow, type Readback,
} from './reconcile-core';

const row = (key: string, over: Partial<OperationRow> = {}): OperationRow =>
  ({ operationKey: key, iTariff: 66, fullPrefix: `2923${key}`, requestedRate: 0.04, status: 'running', ...over });

describe('deriveOperationIntent — what the rows may establish', () => {
  it('no rows → no intent (the five legacy orphans predate migration 511)', () => {
    expect(deriveOperationIntent([])).toEqual({ kind: 'none' });
    expect(hasOperationIntent(deriveOperationIntent([]))).toBe(false);
  });

  it('newRate NULL on the job row is irrelevant here: valid running rows are verifiable intent', () => {
    const set = deriveOperationIntent([row('0'), row('1'), row('2')]);
    expect(set.kind).toBe('verifiable');
    if (set.kind !== 'verifiable') return;
    expect(set.running.map(o => o.operationKey)).toEqual(['0', '1', '2']);
    expect(set.running[0].intent).toEqual({ prefix: '29230', newRate: 0.04, oldRate: null });
    expect(set.pending).toEqual([]);
  });

  it('a running row with no tariff makes the WHOLE set ambiguous — nothing partially reconstructed', () => {
    const set = deriveOperationIntent([row('0'), row('1', { iTariff: null }), row('2')]);
    expect(set).toMatchObject({ kind: 'ambiguous' });
    expect((set as any).reason).toContain('1');
    expect(hasOperationIntent(set)).toBe(false);
  });

  it('a running row with no prefix or no parseable rate is likewise ambiguous', () => {
    expect(deriveOperationIntent([row('0', { fullPrefix: '' })])).toMatchObject({ kind: 'ambiguous' });
    expect(deriveOperationIntent([row('0', { fullPrefix: null })])).toMatchObject({ kind: 'ambiguous' });
    expect(deriveOperationIntent([row('0', { requestedRate: null })])).toMatchObject({ kind: 'ambiguous' });
    expect(deriveOperationIntent([row('0', { requestedRate: NaN })])).toMatchObject({ kind: 'ambiguous' });
  });

  it('pending rows are named for settlement, never verified — nothing was sent for them', () => {
    const set = deriveOperationIntent([row('0'), row('1', { status: 'pending' }), row('2', { status: 'pending', iTariff: null })]);
    expect(set).toEqual({
      kind: 'verifiable',
      running: [{ operationKey: '0', iTariff: 66, intent: { prefix: '29230', newRate: 0.04, oldRate: null } }],
      pending: ['1', '2'],
    });
  });

  it('terminal rows are left to the run that wrote them: neither verified nor settled', () => {
    const set = deriveOperationIntent([
      row('0', { status: 'succeeded' }), row('1', { status: 'failed' }), row('2', { status: 'not_attempted', iTariff: null }),
      row('3'),
    ]);
    expect(set).toMatchObject({ kind: 'verifiable', pending: [] });
    expect((set as any).running.map((o: any) => o.operationKey)).toEqual(['3']);
  });

  it('an all-terminal set is still verifiable with nothing to read — the parent just needs stamping', () => {
    const set = deriveOperationIntent([row('0', { status: 'succeeded' })]);
    expect(set).toEqual({ kind: 'verifiable', running: [], pending: [] });
  });

  it('the job-level guard is untouched: it still needs a tariff AND a parsed intent', () => {
    expect(hasVerifiableIntent(null, [{ prefix: '1990', newRate: 0.0199, oldRate: null }])).toBe(false);
    expect(hasVerifiableIntent(68, [])).toBe(false);
    expect(hasVerifiableIntent(68, [{ prefix: '1990', newRate: 0.0199, oldRate: null }])).toBe(true);
  });
});

describe('classifyOperation — one row, judged from its tariff read', () => {
  const rb = (rows: Array<[string, number]>, complete = true): Readback =>
    ({ ok: true, complete, rows: rows.map(([prefix, price1]) => ({ prefix, price1 })) });
  const op = { operationKey: 'k', iTariff: 66, intent: { prefix: '29237', newRate: 0.04, oldRate: null } };

  it('present at the rate → success', () => {
    expect(classifyOperation(op, rb([['29237', 0.04]]))).toBe('success');
  });
  it('absent on a complete read → failure (nothing was applied for this row)', () => {
    expect(classifyOperation(op, rb([['29230', 0.04]]))).toBe('failure');
  });
  it('absent on a CAPPED read → indeterminate (unseen is not absent)', () => {
    expect(classifyOperation(op, rb([['29230', 0.04]], false))).toBe('indeterminate');
  });
  it('present at another rate → indeterminate (no prior rate is recorded, so it cannot be judged)', () => {
    expect(classifyOperation(op, rb([['29237', 0.05]]))).toBe('indeterminate');
  });
  it('a failed read → indeterminate', () => {
    expect(classifyOperation(op, { ok: false, complete: false, rows: [] })).toBe('indeterminate');
  });
});

describe('jobVerdictFromOperations — the parent for the run summary', () => {
  const v = (...verdicts: Array<'success' | 'failure' | 'indeterminate'>) => verdicts.map((verdict, i) => ({ operationKey: String(i), verdict }));

  it('all confirmed → success', () => { expect(jobVerdictFromOperations(v('success', 'success'), 0)).toBe('success'); });
  it('all absent → failure; absent plus never-started → failure (nothing landed)', () => {
    expect(jobVerdictFromOperations(v('failure', 'failure'), 0)).toBe('failure');
    expect(jobVerdictFromOperations(v('failure'), 3)).toBe('failure');
    expect(jobVerdictFromOperations([], 3)).toBe('failure');
  });
  it('any indeterminate row → indeterminate', () => { expect(jobVerdictFromOperations(v('success', 'indeterminate'), 0)).toBe('indeterminate'); });
  it('4 confirmed + 1 absent is a PARTIAL job: counted as indeterminate, a person must look', () => {
    expect(jobVerdictFromOperations(v('success', 'success', 'success', 'success', 'failure'), 0)).toBe('indeterminate');
    expect(jobVerdictFromOperations(v('success'), 1)).toBe('indeterminate');
  });
});

describe('the per-row terminal shapes mirror the job-level ones', () => {
  it('success/failure/indeterminate map to succeeded/failed/indeterminate with reconciled_* results', () => {
    expect(OPERATION_RECONCILE_STATE.success).toEqual({ status: 'succeeded', verificationResult: 'reconciled_confirmed' });
    expect(OPERATION_RECONCILE_STATE.failure).toEqual({ status: 'failed', verificationResult: 'reconciled_absent' });
    expect(OPERATION_RECONCILE_STATE.indeterminate).toEqual({ status: 'indeterminate', verificationResult: 'reconciled_indeterminate' });
  });
});
