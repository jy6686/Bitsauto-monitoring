/**
 * The run record after 1b: no schema change, so both kinds of "left untouched" fold into the one
 * skipped count — and that count must agree with skippedJobIds, which lists both.
 */
import { describe, it, expect } from 'vitest';
import { buildRunRecord } from './reconcile-record';
import type { ReconcileSummary } from './reconcile-sweep';

const summary = (over: Partial<ReconcileSummary> = {}): ReconcileSummary => ({
  sippyReachable: true, examined: 1, success: 1, failure: 0, indeterminate: 0, deferred: 0, escalated: 0,
  skippedNoIntent: 5, skippedAmbiguous: 2, viaOperations: 1, circuitTripped: false, ...over,
});

describe('buildRunRecord with the operation-row source', () => {
  it('skippedNoIntent in the record = no-intent + ambiguous, matching the ids listed', () => {
    const ids = ['l1', 'l2', 'l3', 'l4', 'l5', 'amb1', 'amb2'];
    const rec = buildRunRecord(summary(), { gitCommit: 'abc', deploymentId: 'dep' }, ids, ['job-aura']);
    expect(rec.skippedNoIntent).toBe(7);
    expect(rec.skippedJobIds!.split(',')).toHaveLength(7);
    expect(rec.verdictJobIds).toBe('job-aura');
  });

  it('carries no new column: the record shape is unchanged', () => {
    const rec = buildRunRecord(summary(), { gitCommit: null, deploymentId: null }, [], []);
    expect(Object.keys(rec).sort()).toEqual([
      'circuitTripped', 'deferred', 'deploymentId', 'escalated', 'examined', 'failure', 'gitCommit',
      'indeterminate', 'sippyReachable', 'skippedJobIds', 'skippedNoIntent', 'success', 'verdictJobIds',
    ]);
    expect(rec).not.toHaveProperty('viaOperations');
    expect(rec).not.toHaveProperty('skippedAmbiguous');
  });
});
