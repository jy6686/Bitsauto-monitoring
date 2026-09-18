/**
 * Boot-time reconciliation orchestrator — the sweep behaviour, pinned with fakes (no DB, no Sippy).
 *
 * These tests assert the properties that make the sweep safe to run unattended on every boot:
 * the circuit breaker actually stops the queue; an outage leaves jobs eligible and never writes a
 * verdict; nothing retries a mutation; and a mid-sweep Sippy death is deferred, not called
 * indeterminate.
 */
import { describe, it, expect } from 'vitest';
import { runReconcileSweep, type ReconcileDeps, type ReconcileJob, type ReadbackResult } from './reconcile-sweep';
import { type ReconcileVerdict } from './reconcile-core';

const STALE = 30 * 60_000;

interface Recorder {
  verdicts: { jobId: string; verdict: ReconcileVerdict }[];
  unavailable: { jobId: string; status: string; verificationResult: string }[];
  readbackCalls: string[];
}

function harness(jobs: ReconcileJob[], opts: {
  probe?: boolean;
  readback?: (job: ReconcileJob) => ReadbackResult;
} = {}): { deps: ReconcileDeps; rec: Recorder } {
  const rec: Recorder = { verdicts: [], unavailable: [], readbackCalls: [] };
  const deps: ReconcileDeps = {
    now: () => new Date('2026-09-18T18:00:00Z'),
    staleMs: STALE,
    unavailableCeiling: 3,
    probeSippy: async () => opts.probe ?? true,
    listStaleJobs: async () => jobs,
    readbackTariff: async (job) => {
      rec.readbackCalls.push(job.jobId);
      return opts.readback
        ? opts.readback(job)
        : { reachable: true, readback: { ok: true, complete: true, rows: [{ prefix: job.intents[0].prefix, price1: job.intents[0].newRate }] } };
    },
    writeVerdict: async (jobId, verdict) => { rec.verdicts.push({ jobId, verdict }); },
    writeUnavailable: async (job, outcome) => {
      rec.unavailable.push({ jobId: job.jobId, status: outcome.status, verificationResult: outcome.verificationResult });
    },
    log: () => {},
  };
  return { deps, rec };
}

const job = (jobId: string, over: Partial<ReconcileJob> = {}): ReconcileJob => ({
  jobId, status: 'processing', verificationResult: null, iTariff: 68,
  intents: [{ prefix: '1990', newRate: 0.0199, oldRate: null }], ...over,
});

describe('happy path — each stale job is read back and given a verdict', () => {
  it('classifies a landed mutation as success and writes it', async () => {
    const { deps, rec } = harness([job('change-1')]);
    const s = await runReconcileSweep(deps);
    expect(s.sippyReachable).toBe(true);
    expect(s.success).toBe(1);
    expect(rec.verdicts).toEqual([{ jobId: 'change-1', verdict: 'success' }]);
  });

  it('never issues a mutation — the deps expose no push/upload, only read-back and write-verdict', () => {
    // Structural: the dependency surface has no way to re-push. If a retry is ever added, it can
    // only arrive as a new dep, which this assertion (and review) would force into the open.
    const { deps } = harness([job('change-1')]);
    expect(Object.keys(deps)).not.toContain('pushRate');
    expect(Object.keys(deps)).not.toContain('reupload');
    expect(Object.keys(deps).some(k => /push|upload|retry|resend/i.test(k))).toBe(false);
  });
});

describe('circuit breaker — probe down', () => {
  it('writes NO verdict, reads back NOTHING, and leaves every job eligible with the counter advanced', async () => {
    const { deps, rec } = harness([job('a'), job('b')], { probe: false });
    const s = await runReconcileSweep(deps);
    expect(s.sippyReachable).toBe(false);
    expect(rec.readbackCalls).toEqual([]);         // nothing was queried
    expect(rec.verdicts).toEqual([]);              // nothing was verdicted
    expect(rec.unavailable.map(u => u.verificationResult)).toEqual(['unavailable:1', 'unavailable:1']);
    expect(rec.unavailable.every(u => u.status === 'processing')).toBe(true); // still eligible
    expect(s.deferred).toBe(2);
  });

  it('an unavailable outcome is never recorded as indeterminate', async () => {
    const { deps, rec } = harness([job('a')], { probe: false });
    await runReconcileSweep(deps);
    expect(rec.unavailable[0].status).not.toBe('indeterminate');
    expect(rec.unavailable[0].verificationResult).not.toMatch(/indeterminate/);
  });

  it('escalates to needs_review once the ceiling is reached — distinct from indeterminate', async () => {
    const { deps, rec } = harness([job('a', { verificationResult: 'unavailable:2' })], { probe: false });
    const s = await runReconcileSweep(deps);
    expect(s.escalated).toBe(1);
    expect(rec.unavailable[0].status).toBe('needs_review');
    expect(rec.unavailable[0].verificationResult).toBe('unavailable_escalated:3');
  });
});

describe('circuit breaker — Sippy dies mid-sweep', () => {
  it('defers the failing job and every job after it, and writes no verdict for them', async () => {
    const jobs = [job('a'), job('b'), job('c')];
    // 'a' reads back fine; 'b' is unreachable → stop.
    const readback = (j: ReconcileJob): ReadbackResult =>
      j.jobId === 'a'
        ? { reachable: true, readback: { ok: true, complete: true, rows: [{ prefix: '1990', price1: 0.0199 }] } }
        : { reachable: false };
    const { deps, rec } = harness(jobs, { readback });
    const s = await runReconcileSweep(deps);

    expect(s.circuitTripped).toBe(true);
    expect(rec.verdicts).toEqual([{ jobId: 'a', verdict: 'success' }]); // only 'a' verdicted
    expect(rec.unavailable.map(u => u.jobId)).toEqual(['b', 'c']);       // b and c deferred
    expect(rec.readbackCalls).toEqual(['a', 'b']);                       // 'c' never even queried
    expect(rec.unavailable.every(u => u.status === 'processing')).toBe(true);
  });

  it('a mid-sweep unreachable read is deferred, NOT classified indeterminate', async () => {
    const { deps, rec } = harness([job('a')], { readback: () => ({ reachable: false }) });
    await runReconcileSweep(deps);
    expect(rec.verdicts).toEqual([]);                       // no indeterminate verdict written
    expect(rec.unavailable[0].verificationResult).toBe('unavailable:1');
  });
});

describe('verdicts flow through from the read-back', () => {
  it('a complete read-back missing a new prefix → failure', async () => {
    const readback = (): ReadbackResult => ({ reachable: true, readback: { ok: true, complete: true, rows: [{ prefix: '999', price1: 0.05 }] } });
    const { deps, rec } = harness([job('a')], { readback });
    const s = await runReconcileSweep(deps);
    expect(s.failure).toBe(1);
    expect(rec.verdicts[0].verdict).toBe('failure');
  });

  it('a truncated read-back → indeterminate (reachable, but not trustworthy)', async () => {
    const readback = (): ReadbackResult => ({ reachable: true, readback: { ok: true, complete: false, rows: [{ prefix: '1990', price1: 0.0199 }] } });
    const { deps, rec } = harness([job('a')], { readback });
    const s = await runReconcileSweep(deps);
    expect(s.indeterminate).toBe(1);
    expect(rec.verdicts[0].verdict).toBe('indeterminate');
  });
});
