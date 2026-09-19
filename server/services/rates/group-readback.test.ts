/**
 * One upload, N verdicts. The preservation rule, as tests.
 *
 * A group is a transport optimisation and nothing else: the audit and reconciliation granularity
 * stays per prefix. Five prefixes uploaded together and read back as 4 confirmed + 1 mismatch must
 * produce five results, four success and one failure — never one "mostly worked".
 *
 * The boundary, by contrast, IS per upload: either the file left this process or it did not, and
 * every row in it shares that fact.
 */
import { describe, it, expect } from "vitest";
import { groupVerdicts, type GroupRow } from "./group-readback";

const rows: GroupRow[] = [
  { operationKey: 'm',  prefix: '29230', rate: 0.04, effectiveFrom: '2026-09-19 10:51:00' },
  { operationKey: 'u',  prefix: '29233', rate: 0.04, effectiveFrom: '2026-09-19 10:51:00' },
  { operationKey: 'w',  prefix: '29232', rate: 0.04, effectiveFrom: '2026-09-19 10:51:00' },
  { operationKey: 'z1', prefix: '29231', rate: 0.04, effectiveFrom: '2026-09-19 10:51:00' },
  { operationKey: 'z2', prefix: '29237', rate: 0.04, effectiveFrom: '2026-09-19 10:51:00' },
];
const found = (prefix: string, rate: number, effectiveFrom = '20260919T10:51:00') => ({ prefix, rate, effectiveFrom });

describe("boundary — shared by every row of the upload", () => {
  it("token failed: nothing was sent, so every row is a failure with the tariff provably untouched", () => {
    const out = groupVerdicts(rows, { kind: 'token_failed', message: 'getUploadToken faultCode 500' });
    expect(out).toHaveLength(5);
    expect(out.every(r => !r.success && r.refusedBeforeWrite === true)).toBe(true);
    expect(out.every(r => r.verificationResult === 'skip')).toBe(true);
    expect(out[0].message).toContain('getUploadToken faultCode 500');
  });

  it("file rejected by the far end: it WAS sent, so every row is indeterminate", () => {
    const out = groupVerdicts(rows, { kind: 'upload_rejected', message: 'HTTP 500', uploadToken: 'tok' });
    expect(out.every(r => !r.success && r.refusedBeforeWrite === false && r.verificationResult === 'skip')).toBe(true);
    expect(out.every(r => r.uploadToken === 'tok')).toBe(true);
  });

  it("read-back unavailable after upload: every row is indeterminate, never failure", () => {
    const out = groupVerdicts(rows, { kind: 'readback_unavailable', message: 'read timed out', uploadToken: 'tok', uploadStatus: 'DONE' });
    expect(out.every(r => !r.success && r.refusedBeforeWrite === false && r.verificationResult === 'skip')).toBe(true);
    expect(out.every(r => r.uploadStatus === 'DONE')).toBe(true);
  });
});

describe("verdicts — one per row, judged independently from ONE read", () => {
  const readback = (rates: ReturnType<typeof found>[], complete = true) =>
    ({ kind: 'readback' as const, rates, complete, uploadToken: 'tok', uploadStatus: 'DONE' });

  it("4 confirmed + 1 mismatch stays five results: four success, one failure", () => {
    const out = groupVerdicts(rows, readback([
      found('29230', 0.04), found('29233', 0.04), found('29232', 0.04), found('29231', 0.04), found('29237', 0.05),
    ]));
    expect(out.map(r => [r.operationKey, r.success, r.verificationResult])).toEqual([
      ['m', true, 'confirmed'], ['u', true, 'confirmed'], ['w', true, 'confirmed'], ['z1', true, 'confirmed'],
      ['z2', false, 'mismatch'],
    ]);
    expect(out.every(r => r.refusedBeforeWrite === false && r.method === 'upload_token')).toBe(true);
  });

  it("a prefix absent from a COMPLETE read-back is a mismatch — the tariff was read and does not hold it", () => {
    const out = groupVerdicts(rows, readback([found('29230', 0.04)]));
    expect(out.find(r => r.operationKey === 'u')).toMatchObject({ success: false, verificationResult: 'mismatch' });
  });

  it("a prefix absent from a PARTIAL read-back (capped list) is NOT a mismatch — we could not see", () => {
    const out = groupVerdicts(rows, readback([found('29230', 0.04)], false));
    expect(out.find(r => r.operationKey === 'm')).toMatchObject({ success: true, verificationResult: 'confirmed' });
    expect(out.find(r => r.operationKey === 'u')).toMatchObject({ success: false, verificationResult: 'skip', refusedBeforeWrite: false });
  });

  it("judges the row activating on the requested date, not the live row still at the old price", () => {
    const out = groupVerdicts([rows[0]], readback([
      found('29230', 0.038, '20260801T00:00:00'),   // live row, old price, Sippy will close it
      found('29230', 0.04,  '20260919T10:51:00'),   // the scheduled row we wrote
    ]));
    expect(out[0]).toMatchObject({ success: true, verificationResult: 'confirmed' });
  });

  it("names the upload status and the tariff size in every message, so a row explains itself", () => {
    const out = groupVerdicts(rows, readback([found('29230', 0.04)]));
    expect(out[0].message).toContain('DONE');
    expect(out[1].message).toMatch(/holds 1 rate/);
  });

  it("never returns a count of results different from the rows given", () => {
    for (const phase of [
      { kind: 'token_failed' as const, message: 'x' },
      { kind: 'upload_rejected' as const, message: 'x', uploadToken: 't' },
      { kind: 'readback_unavailable' as const, message: 'x', uploadToken: 't', uploadStatus: 'FAIL' },
      readback([]),
    ]) {
      expect(groupVerdicts(rows, phase)).toHaveLength(rows.length);
      expect(groupVerdicts(rows, phase).map(r => r.operationKey)).toEqual(rows.map(r => r.operationKey));
    }
  });
});
