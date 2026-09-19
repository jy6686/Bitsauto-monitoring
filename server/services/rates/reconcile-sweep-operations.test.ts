/**
 * The sweep with the operation-row intent source — fakes only, no DB, no Sippy.
 *
 * What is pinned: the job-row source still comes first and behaves exactly as before; the
 * operation source is consulted only when the job row yields nothing; one read per distinct
 * tariff; a verdict per running row, each on its own; pending rows settled as never started; an
 * ambiguous set left untouched; the outage path unchanged; and no dependency that could push.
 */
import { describe, it, expect } from 'vitest';
import { runReconcileSweep, isReconcilable, type ReconcileDeps, type ReconcileJob, type ReadbackResult } from './reconcile-sweep';
import { deriveOperationIntent, type OperationRow, type OperationVerdict, type ReconcileVerdict } from './reconcile-core';

interface Recorder {
  verdicts: { jobId: string; verdict: ReconcileVerdict }[];
  opOutcomes: { jobId: string; verdicts: OperationVerdict[]; notAttempted: string[] }[];
  unavailable: { jobId: string; status: string; verificationResult: string }[];
  jobReads: string[];
  tariffReads: number[];
}

/** What each tariff holds on the switch, for the fake read-back. */
type Switch = Record<number, Array<{ prefix: string; price1: number }> | 'down'>;

function harness(jobs: ReconcileJob[], sw: Switch, opts: { probe?: boolean } = {}) {
  const rec: Recorder = { verdicts: [], opOutcomes: [], unavailable: [], jobReads: [], tariffReads: [] };
  const read = (t: number | null): ReadbackResult => {
    const rows = t == null ? undefined : sw[t];
    if (rows === 'down') return { reachable: false };
    if (!rows) return { reachable: true, readback: { ok: false, complete: false, rows: [] } };
    return { reachable: true, readback: { ok: true, complete: true, rows } };
  };
  const deps: ReconcileDeps = {
    now: () => new Date('2026-09-19T12:00:00Z'),
    staleMs: 30 * 60_000,
    unavailableCeiling: 3,
    probeSippy: async () => opts.probe ?? true,
    listStaleJobs: async () => jobs,
    readbackTariff: async (job) => { rec.jobReads.push(job.jobId); return read(job.iTariff); },
    readbackByTariff: async (t) => { rec.tariffReads.push(t); return read(t); },
    writeVerdict: async (jobId, verdict) => { rec.verdicts.push({ jobId, verdict }); },
    writeOperationOutcome: async (jobId, o) => { rec.opOutcomes.push({ jobId, verdicts: o.verdicts, notAttempted: o.notAttempted }); },
    writeUnavailable: async (job, o) => { rec.unavailable.push({ jobId: job.jobId, status: o.status, verificationResult: o.verificationResult }); },
    log: () => {},
  };
  return { deps, rec };
}

const opRow = (key: string, prefix: string, over: Partial<OperationRow> = {}): OperationRow =>
  ({ operationKey: key, iTariff: 66, fullPrefix: prefix, requestedRate: 0.04, status: 'running', ...over });

/** A push-batch orphan: job row carries no intent (newRate NULL at insert), operation rows do. */
const batchJob = (jobId: string, rows: OperationRow[], over: Partial<ReconcileJob> = {}): ReconcileJob =>
  ({ jobId, status: 'processing', verificationResult: null, iTariff: 66, intents: [], operations: deriveOperationIntent(rows), ...over });

/** A change-client-rates orphan: job-level intent, as before 1b. */
const changeJob = (jobId: string): ReconcileJob =>
  ({ jobId, status: 'processing', verificationResult: null, iTariff: 68, intents: [{ prefix: '1990', newRate: 0.0199, oldRate: null }] });

/** One of the five legacy job-* rows: no tariff, no intent, no operation rows, an old diagnostic. */
const legacyJob = (jobId: string): ReconcileJob =>
  ({ jobId, status: 'pending', verificationResult: 'mismatch', iTariff: null, intents: [], operations: deriveOperationIntent([]) });

const AURA = [opRow('k0', '29230'), opRow('k1', '29233'), opRow('k2', '29232'), opRow('k3', '29231'), opRow('k4', '29237')];
const T66_ALL = AURA.map(r => ({ prefix: r.fullPrefix!, price1: 0.04 }));

describe('1. newRate NULL + valid operation rows → verifiable, read back, verdicts written', () => {
  it('the interrupted Aura shape: one read of tariff 66, five confirmed rows, job counted as success', async () => {
    const { deps, rec } = harness([batchJob('job-aura', AURA)], { 66: T66_ALL });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ examined: 1, success: 1, viaOperations: 1, skippedNoIntent: 0, skippedAmbiguous: 0 });
    expect(rec.tariffReads).toEqual([66]);
    expect(rec.jobReads).toEqual([]);
    expect(rec.opOutcomes).toEqual([{ jobId: 'job-aura', notAttempted: [], verdicts: AURA.map(r => ({ operationKey: r.operationKey, verdict: 'success' })) }]);
    expect(rec.verdicts).toEqual([]);   // the job-level verdict writer is not used on this path
  });

  it('isReconcilable: job-level intent, or operation intent only when the job row has none', () => {
    expect(isReconcilable(changeJob('c'))).toBe(true);
    expect(isReconcilable(batchJob('b', AURA))).toBe(true);
    expect(isReconcilable(legacyJob('l'))).toBe(false);
    // A job WITH job-level intent never falls through to its operation rows, whatever they say.
    expect(isReconcilable({ ...changeJob('c'), iTariff: null, operations: deriveOperationIntent(AURA) })).toBe(false);
  });
});

describe('2/6. no operation rows → still no intent; the legacy five stay exactly as they are', () => {
  it('a no-intent job with no rows is skipped: no read, no write, diagnostic untouched', async () => {
    const { deps, rec } = harness([legacyJob('job-1782159074691')], { 66: T66_ALL });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ examined: 0, skippedNoIntent: 1, skippedAmbiguous: 0, sippyReachable: false });
    expect(rec.tariffReads).toEqual([]);
    expect(rec.jobReads).toEqual([]);
    expect(rec.opOutcomes).toEqual([]);
    expect(rec.verdicts).toEqual([]);
    expect(rec.unavailable).toEqual([]);
  });

  it('all five legacy shapes beside a real orphan: five skipped untouched, the orphan reconciled', async () => {
    const legacy = ['job-1782159074691', 'job-1782159132515', 'job-1784405010496', 'job-1788118802847', 'job-1788385371603'].map(legacyJob);
    const { deps, rec } = harness([...legacy, batchJob('job-aura', AURA)], { 66: T66_ALL });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ examined: 1, success: 1, skippedNoIntent: 5 });
    expect(rec.opOutcomes.map(o => o.jobId)).toEqual(['job-aura']);
    expect(rec.unavailable).toEqual([]);
  });
});

describe('3. an ambiguous operation set is not reconstructed — not even partly', () => {
  it('one running row with no tariff → the whole job skipped as ambiguous, zero reads, zero writes', async () => {
    const rows = [opRow('k0', '29230'), opRow('k1', '29233', { iTariff: null }), opRow('k2', '29232')];
    const { deps, rec } = harness([batchJob('job-amb', rows)], { 66: T66_ALL });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ examined: 0, skippedAmbiguous: 1, skippedNoIntent: 0 });
    expect(rec.tariffReads).toEqual([]);
    expect(rec.opOutcomes).toEqual([]);
  });
});

describe('4. an interrupted group is read back once and judged row by row', () => {
  it('three running rows on one tariff: ONE read; 2 confirmed + 1 absent stay three verdicts; job is partial → indeterminate', async () => {
    const rows = [opRow('k0', '29230'), opRow('k1', '29233'), opRow('k2', '29232')];
    const { deps, rec } = harness([batchJob('job-g', rows)], { 66: [{ prefix: '29230', price1: 0.04 }, { prefix: '29233', price1: 0.04 }] });
    const s = await runReconcileSweep(deps);
    expect(rec.tariffReads).toEqual([66]);
    expect(rec.opOutcomes[0].verdicts).toEqual([
      { operationKey: 'k0', verdict: 'success' }, { operationKey: 'k1', verdict: 'success' }, { operationKey: 'k2', verdict: 'failure' },
    ]);
    expect(s).toMatchObject({ success: 0, failure: 0, indeterminate: 1 });
  });

  it('a multi-client batch spanning two tariffs: one read per tariff, each row judged against its own', async () => {
    const rows = [opRow('a', '29230', { iTariff: 66 }), opRow('b', '19230', { iTariff: 68 }), opRow('c', '29233', { iTariff: 66 })];
    const { deps, rec } = harness([batchJob('job-2t', rows)], { 66: [{ prefix: '29230', price1: 0.04 }, { prefix: '29233', price1: 0.04 }], 68: [] });
    await runReconcileSweep(deps);
    expect([...rec.tariffReads].sort()).toEqual([66, 68]);
    expect(rec.tariffReads).toHaveLength(2);
    expect(rec.opOutcomes[0].verdicts).toEqual([
      { operationKey: 'a', verdict: 'success' }, { operationKey: 'b', verdict: 'failure' }, { operationKey: 'c', verdict: 'success' },
    ]);
  });

  it('a row present at a different rate is indeterminate on its own; its neighbours keep their verdicts', async () => {
    const rows = [opRow('k0', '29230'), opRow('k1', '29233')];
    const { deps, rec } = harness([batchJob('job-x', rows)], { 66: [{ prefix: '29230', price1: 0.04 }, { prefix: '29233', price1: 0.05 }] });
    const s = await runReconcileSweep(deps);
    expect(rec.opOutcomes[0].verdicts).toEqual([{ operationKey: 'k0', verdict: 'success' }, { operationKey: 'k1', verdict: 'indeterminate' }]);
    expect(s.indeterminate).toBe(1);
  });
});

describe('10. pending rows are settled as never started — never inferred to have been sent', () => {
  it('running rows are read back; pending rows go to notAttempted without a read for them', async () => {
    const rows = [opRow('k0', '29230'), opRow('k1', '29233', { status: 'pending' }), opRow('k2', '29232', { status: 'pending', iTariff: 68 })];
    const { deps, rec } = harness([batchJob('job-p', rows)], { 66: T66_ALL });
    const s = await runReconcileSweep(deps);
    expect(rec.tariffReads).toEqual([66]);   // 68 is never read: nothing was sent to it
    expect(rec.opOutcomes).toEqual([{ jobId: 'job-p', verdicts: [{ operationKey: 'k0', verdict: 'success' }], notAttempted: ['k1', 'k2'] }]);
    expect(s.indeterminate).toBe(1);   // one landed, two never started → partial → a person looks
  });

  it('a job whose rows are all terminal needs no read at all — only the parent is stamped', async () => {
    const rows = [opRow('k0', '29230', { status: 'succeeded' }), opRow('k1', '29233', { status: 'failed' })];
    const { deps, rec } = harness([batchJob('job-t', rows)], { 66: T66_ALL });
    await runReconcileSweep(deps);
    expect(rec.tariffReads).toEqual([]);
    expect(rec.opOutcomes).toEqual([{ jobId: 'job-t', verdicts: [], notAttempted: [] }]);
  });
});

describe('5. change-client-rates reconciliation is unchanged', () => {
  it('a job-level orphan takes the job-level read and the job-level verdict writer, exactly as before', async () => {
    const { deps, rec } = harness([changeJob('change-1')], { 68: [{ prefix: '1990', price1: 0.0199 }] });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ examined: 1, success: 1, viaOperations: 0 });
    expect(rec.jobReads).toEqual(['change-1']);
    expect(rec.tariffReads).toEqual([]);
    expect(rec.verdicts).toEqual([{ jobId: 'change-1', verdict: 'success' }]);
    expect(rec.opOutcomes).toEqual([]);
  });

  it('mixed sweep: the job-level orphan and the operation-row orphan each take their own path', async () => {
    const { deps, rec } = harness([changeJob('change-1'), batchJob('job-aura', AURA)], { 68: [{ prefix: '1990', price1: 0.0199 }], 66: T66_ALL });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ examined: 2, success: 2, viaOperations: 1 });
    expect(rec.verdicts).toEqual([{ jobId: 'change-1', verdict: 'success' }]);
    expect(rec.opOutcomes.map(o => o.jobId)).toEqual(['job-aura']);
  });
});

describe('7. Sippy unavailable → deferred, never classified; operation rows untouched', () => {
  it('probe down: the operation-row job is deferred on its job row with the counter advanced', async () => {
    const { deps, rec } = harness([batchJob('job-aura', AURA)], { 66: T66_ALL }, { probe: false });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ sippyReachable: false, deferred: 1, success: 0, indeterminate: 0 });
    expect(rec.unavailable).toEqual([{ jobId: 'job-aura', status: 'processing', verificationResult: 'unavailable:1' }]);
    expect(rec.opOutcomes).toEqual([]);
    expect(rec.tariffReads).toEqual([]);
  });

  it('mid-sweep: a job spanning two tariffs whose SECOND read fails is deferred whole — nothing half-written', async () => {
    const rows = [opRow('a', '29230', { iTariff: 66 }), opRow('b', '19230', { iTariff: 68 })];
    const { deps, rec } = harness([batchJob('job-2t', rows), batchJob('job-next', AURA)], { 66: T66_ALL, 68: 'down' });
    const s = await runReconcileSweep(deps);
    expect(s).toMatchObject({ circuitTripped: true, deferred: 2, success: 0 });
    expect(rec.opOutcomes).toEqual([]);
    expect(rec.unavailable.map(u => u.jobId)).toEqual(['job-2t', 'job-next']);
  });
});

describe('8. no mutation dependency exists on this path', () => {
  it('the deps surface has read-backs and conditional writers only', () => {
    const { deps } = harness([], {});
    const names = Object.keys(deps);
    expect(names).toEqual(expect.arrayContaining(['readbackTariff', 'readbackByTariff', 'writeVerdict', 'writeOperationOutcome', 'writeUnavailable']));
    for (const forbidden of ['pushRate', 'uploadRate', 'uploadRateGroup', 'setSippyRateEntry', 'retry', 'resume']) {
      expect(names.some(n => n.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
  });
});
