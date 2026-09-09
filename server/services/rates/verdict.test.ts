/**
 * Every case here is taken from a real job on this switch, so the mapping is anchored to observed
 * behaviour rather than to what the primitive's field names suggest.
 */
import { describe, it, expect } from "vitest";
import { verdictFromPush } from "./verdict";

describe("verdictFromPush", () => {
  it("JOB #34: upload confirmed by read-back -> success", () => {
    const v = verdictFromPush({
      success: true, message: 'Rate updated — XLSX uploaded, verified (prefix=19232 rate=0.038)',
      method: 'upload_token', verificationResult: 'confirmed',
    });
    expect(v.verdict).toBe('success');
    expect(v.method).toBe('upload_token');
  });

  it("read-back ran and the rate was not there -> failure, which may be retried", () => {
    const v = verdictFromPush({
      success: false, message: 'Portal CSV accepted but rate unchanged: prefix 79230 not found in tariff 2',
      method: 'portal_csv', verificationResult: 'mismatch',
    });
    expect(v.verdict).toBe('failure');
  });

  it("JOB #44/#45: a pre-write refusal is a failure — the tariff is provably untouched", () => {
    // The add path declining to guess an i_rate is the guard working. It must not halt the lane.
    const v = verdictFromPush({
      success: false,
      message: "Rate add refused: Sippy's add form did not return an i_rate field.",
      method: 'portal_csv', verificationResult: 'skip', refusedBeforeWrite: true,
    });
    expect(v.verdict).toBe('failure');
    expect(v.message).toContain('the tariff is unchanged');
  });

  it("DEFAULT: no read-back and no proof a request was withheld -> indeterminate", () => {
    // The conservative direction. Calling this a failure would let the engine retry a mutation
    // whose outcome nobody established.
    const v = verdictFromPush({
      success: false, message: 'Tariff 64 is locked — processing of uploaded file is in progress.',
      method: 'portal_edit', verificationResult: 'skip',
    });
    expect(v.verdict).toBe('indeterminate');
    expect(v.message).toContain('mutate before it can report');
  });

  it("JOB #43: a lock banner with no read-back is NOT a failure, however clear the message reads", () => {
    // #43 reported exactly this while the tariff had in fact been rewritten and a rate destroyed.
    const v = verdictFromPush({
      success: false,
      message: 'Tariff 64 is locked — Sippy is still processing an earlier upload, so this rate was not applied.',
      verificationResult: 'skip',
    });
    expect(v.verdict).toBe('indeterminate');
  });

  it("treats a missing verificationResult as no read-back", () => {
    expect(verdictFromPush({ success: true, message: 'Rate saved via setRate' }).verdict).toBe('indeterminate');
  });

  it("refuses to resolve a primitive that contradicts itself", () => {
    const v = verdictFromPush({ success: false, message: 'Rate applied', verificationResult: 'confirmed' });
    expect(v.verdict).toBe('indeterminate');
    expect(v.message).toContain('the two disagree');
  });

  it("carries method and iRate through, so an operation record can be reconstructed", () => {
    const v = verdictFromPush({
      success: true, message: 'ok', method: 'portal_edit', iRate: 9200, verificationResult: 'confirmed',
    });
    expect(v).toMatchObject({ verdict: 'success', method: 'portal_edit', iRate: 9200 });
  });

  it("refusedBeforeWrite:false is not the same as true — it still means unestablished", () => {
    const v = verdictFromPush({ success: false, message: 'something went wrong', verificationResult: 'skip', refusedBeforeWrite: false });
    expect(v.verdict).toBe('indeterminate');
  });
});
