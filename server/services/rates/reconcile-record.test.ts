/**
 * The reconciliation run record — the observable evidence a sweep produces. Pure mapping, pinned.
 *
 * A reconcile run is otherwise invisible without deployment-log access (a silent no-op writes
 * nothing and calls Sippy zero times), which is the diagnosability gap this record closes. The
 * record carries PROVENANCE — the gitCommit and deploymentId it ran under — so a reader can
 * demand `/api/build.gitCommit == record.gitCommit` and the same for deploymentId before trusting
 * it as evidence from the current deployment. And it must NEVER carry a credential or a setting.
 */
import { describe, it, expect } from 'vitest';
import { buildRunRecord } from './reconcile-record';
import { type ReconcileSummary } from './reconcile-sweep';

const summary: ReconcileSummary = {
  sippyReachable: false, examined: 0, success: 0, failure: 0,
  indeterminate: 0, deferred: 0, escalated: 0, skippedNoIntent: 5, circuitTripped: false,
};
const build = { gitCommit: '6022e771', deploymentId: '1e343bf6-f8d4-46cf-95cd-b6201ea32996' };

describe('buildRunRecord — provenance and the full summary, nothing else', () => {
  it('stamps the gitCommit and deploymentId it ran under (the provenance the reader matches)', () => {
    const r = buildRunRecord(summary, build, [], []);
    expect(r.gitCommit).toBe('6022e771');
    expect(r.deploymentId).toBe('1e343bf6-f8d4-46cf-95cd-b6201ea32996');
  });

  it('carries every summary count verbatim', () => {
    const s: ReconcileSummary = { sippyReachable: true, examined: 3, success: 1, failure: 1, indeterminate: 1, deferred: 0, escalated: 0, skippedNoIntent: 2, circuitTripped: false };
    const r = buildRunRecord(s, build, [], []);
    expect(r).toMatchObject({
      sippyReachable: true, examined: 3, success: 1, failure: 1,
      indeterminate: 1, deferred: 0, escalated: 0, skippedNoIntent: 2, circuitTripped: false,
    });
  });

  it('joins job ids for evidence, null when empty', () => {
    const r = buildRunRecord(summary, build, ['job-a', 'job-b'], []);
    expect(r.skippedJobIds).toBe('job-a,job-b');
    expect(r.verdictJobIds).toBeNull();
  });

  it('exposes NO credential- or setting-shaped field — only the allowlisted keys', () => {
    const r = buildRunRecord(summary, build, [], []);
    const allowed = new Set([
      'gitCommit', 'deploymentId', 'sippyReachable', 'examined', 'success', 'failure',
      'indeterminate', 'deferred', 'escalated', 'skippedNoIntent', 'circuitTripped',
      'skippedJobIds', 'verdictJobIds',
    ]);
    for (const k of Object.keys(r)) {
      expect(allowed.has(k), `unexpected key ${k}`).toBe(true);
      expect(k).not.toMatch(/pass|secret|token|cred|key|user|url/i);
    }
  });
});
