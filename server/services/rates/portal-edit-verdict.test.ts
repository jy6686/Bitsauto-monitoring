/**
 * What the SA (immediate-change) path may conclude after a portal edit — the decision table,
 * exercised by calling it rather than by matching source.
 *
 * THE DEFECT. Sippy's edit form is `method="GET"`, so the request that asks IS the request that
 * changes; `boundary.crossed` is set before it is sent. If the read-back that follows then hits a
 * reset or a timeout, `readBackRateWithIntervals` answers `{confirmed:false}` — the same shape it
 * uses for "the tariff was read and does not hold it" — and `classifyPortalWrite` falls to its
 * bottom branch, reporting `success:false` with the sentence "The tariff does not show <prefix> at
 * <rate>". Nothing established that. The SA path then treats the failure as a reason to try the
 * NEXT write method and falls through to getUploadToken + uploadBinaryFile: a second mutation on a
 * tariff we have just written and cannot read.
 *
 * The discriminator was already in scope and unused — `boundary.crossed`. A portal edit that never
 * issued its GET (no rates-capable session, login refused, the i_rate guard) is a proven non-event
 * and must still fall through; one that DID issue it and cannot be verified must stop.
 */
import { describe, it, expect } from 'vitest';
import { portalEditVerdict, type PortalEditInput } from './portal-write-outcome';

const base: PortalEditInput = {
  editSuccess: false, unverified: false, boundaryCrossed: true, locked: false,
  message: 'Rate edit: Sippy returned HTTP 200 (18204B) with no error',
};

describe('THE SAFETY PROPERTY: a mutation we cannot verify never opens another write path', () => {
  it('unverified after a crossed boundary → skip, no fallback, and the write is NOT disclaimed', () => {
    const v = portalEditVerdict({ ...base, unverified: true, boundaryCrossed: true });
    expect(v.verificationResult).toBe('skip');
    expect(v.success).toBe(false);
    expect(v.fallbackAllowed).toBe(false);
    // The edit WAS issued, so the tariff is not provably untouched.
    expect(v.refusedBeforeWrite).toBe(false);
  });

  it('holds however the page looked — a lock banner or an error page changes nothing', () => {
    for (const extra of [{ locked: true }, { locked: false }, { editSuccess: true }]) {
      const v = portalEditVerdict({ ...base, unverified: true, boundaryCrossed: true, ...extra });
      expect(v.fallbackAllowed, JSON.stringify(extra)).toBe(false);
      expect(v.verificationResult, JSON.stringify(extra)).toBe('skip');
    }
  });

  it('EXHAUSTIVE: nothing that crossed the boundary unverified may ever permit a fallback', () => {
    for (const editSuccess of [true, false]) {
      for (const locked of [true, false]) {
        for (const verifyOutcome of [undefined, 'confirmed', 'absent', 'unavailable'] as const) {
          const v = portalEditVerdict({ ...base, editSuccess, locked, verifyOutcome, unverified: true, boundaryCrossed: true });
          expect(v.fallbackAllowed, `${editSuccess}/${locked}/${verifyOutcome}`).toBe(false);
        }
      }
    }
  });

  it('says the outcome is unknown, and never that the tariff does not show the rate', () => {
    const m = portalEditVerdict({ ...base, unverified: true, boundaryCrossed: true }).message;
    expect(m).toMatch(/UNKNOWN|could not be (read|verified)|not established/i);
    expect(m).not.toMatch(/does not show|unchanged|nothing was applied/i);
    expect(m).toMatch(/read the tariff|before (any|writing|retrying)/i);
  });
});

describe('a portal edit that never issued its GET is a proven non-event', () => {
  it('unverified WITHOUT a crossed boundary still falls through — nothing was sent', () => {
    const v = portalEditVerdict({ ...base, unverified: true, boundaryCrossed: false });
    expect(v.fallbackAllowed).toBe(true);
    expect(v.refusedBeforeWrite).toBe(true);
  });

  it('so does an ordinary pre-write refusal (no session, login rejected, i_rate guard)', () => {
    const v = portalEditVerdict({ ...base, boundaryCrossed: false, message: 'No credential pair has access to the Sippy rates page.' });
    expect(v.fallbackAllowed).toBe(true);
    expect(v.refusedBeforeWrite).toBe(true);
  });
});

describe('the established cases keep their present meaning — scope is not widened', () => {
  it('an edit whose read-back established ABSENCE still falls through to the other methods', () => {
    const v = portalEditVerdict({ ...base, editSuccess: false, unverified: false, boundaryCrossed: true });
    expect(v.fallbackAllowed).toBe(true);
    expect(v.refusedBeforeWrite).toBe(false);
  });

  it('a tariff-lock banner still stops everything, as it does today', () => {
    const v = portalEditVerdict({ ...base, locked: true, unverified: false });
    expect(v).toMatchObject({ success: false, verificationResult: 'skip', fallbackAllowed: false });
  });

  it('edit succeeded and the follow-up verification CONFIRMED it → success, nothing further', () => {
    const v = portalEditVerdict({ ...base, editSuccess: true, verifyOutcome: 'confirmed' });
    expect(v).toMatchObject({ success: true, verificationResult: 'confirmed', fallbackAllowed: false });
  });

  it('edit succeeded but the tariff was READ and does not hold it → mismatch, no bulk upload', () => {
    const v = portalEditVerdict({ ...base, editSuccess: true, verifyOutcome: 'absent' });
    expect(v).toMatchObject({ success: false, verificationResult: 'mismatch', fallbackAllowed: false });
    expect(v.message).toMatch(/no bulk upload|not started|unchanged/i);
  });
});

describe('CONTRACT 5: a successful edit whose verification could not be performed', () => {
  it('is skip / indeterminate — never mismatch / failure', () => {
    const v = portalEditVerdict({ ...base, editSuccess: true, verifyOutcome: 'unavailable' });
    expect(v.verificationResult).toBe('skip');
    expect(v.success).toBe(false);
    expect(v.refusedBeforeWrite).toBe(false);
    expect(v.fallbackAllowed).toBe(false);
    expect(v.message).not.toMatch(/unchanged|does not show/i);
  });
});
