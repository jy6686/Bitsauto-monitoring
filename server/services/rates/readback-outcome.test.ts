/**
 * The verification read-back, as a tri-state — and what an upload may conclude from it.
 *
 * THE DEFECT THIS EXISTS FOR. `verifySippyRate` collapses "the tariff was read and does not hold
 * the rate" and "the tariff could not be read at all" into one `confirmed: false`. After a
 * successful upload that becomes `verificationResult: 'mismatch'` → verdict `failure` — the one
 * verdict the batch engine is allowed to retry — with the message "rate unchanged". So on
 * 2026-09-19, when Sippy reads were taking 70+ s and resetting, a push that DID land would have
 * been recorded as failed, told the operator nothing was applied, and invited a second write.
 *
 * Two ideas separate the three cases for good:
 *
 *   classifyVerificationRead   a read that did not happen is `unavailable`, never `absent`.
 *                              Absence is a claim about the tariff and may only be made by a read
 *                              that succeeded.
 *
 *   uploadVerdict              owns the (uploadStatus × outcome) table, including whether any
 *                              further write path may be tried. `unavailable` never permits one:
 *                              the file is already on the switch and may still be processing.
 *
 * A read is idempotent, so retrying it is always safe — unlike anything on the write side. That
 * asymmetry is why the retry policy here applies to `unavailable` alone.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyVerificationRead, uploadVerdict, verificationResultFor, shouldRetryRead, readRetryDelayMs,
  rateListFailureKind, faultFailureKind,
  READBACK_TIMEOUT_MS, READBACK_MAX_ATTEMPTS,
  type RateListRead, type ReadbackOutcome, type VerificationWant,
} from './readback-outcome';

const want: VerificationWant = { tariffId: '64', prefix: '69230', rate: 0.0199 };
const ok = (rates: Array<{ prefix: string; rate: number; effectiveFrom?: string }>): RateListRead => ({ ok: true, rates });
const failed = (kind: any, message: string): RateListRead => ({ ok: false, failure: { kind, message } });

describe('classifyVerificationRead — absence is a claim only a successful read may make', () => {
  it('read succeeded and the prefix is there at the rate → confirmed', () => {
    const r = classifyVerificationRead(ok([{ prefix: '69230', rate: 0.0199 }]), want);
    expect(r.outcome).toBe('confirmed');
    expect(r.foundRate).toBe(0.0199);
  });

  it('read succeeded and the prefix is absent → absent (the tariff was seen)', () => {
    const r = classifyVerificationRead(ok([{ prefix: '69370', rate: 0.0199 }]), want);
    expect(r.outcome).toBe('absent');
    expect(r.message).toMatch(/not found|absent/i);
    expect(r.message).toMatch(/holds 1 rate/);
  });

  it('read succeeded and the prefix is there at a DIFFERENT rate → absent, naming both rates', () => {
    const r = classifyVerificationRead(ok([{ prefix: '69230', rate: 0.05 }]), want);
    expect(r.outcome).toBe('absent');
    expect(r.foundRate).toBe(0.05);
    expect(r.message).toContain('0.05');
    expect(r.message).toContain('0.0199');
  });

  it('an EMPTY tariff that was genuinely read is absent, not unavailable', () => {
    expect(classifyVerificationRead(ok([]), want).outcome).toBe('absent');
  });

  for (const [kind, msg] of [
    ['transport', 'read ECONNRESET'],
    ['timeout', 'Request timed out'],
    ['fault', 'faultCode 500: Fatal error'],
    ['unsupported', 'no rate-list method answered'],
    ['unknown', 'something else'],
  ] as const) {
    it(`a read that failed (${kind}) → unavailable, and the message names the reason`, () => {
      const r = classifyVerificationRead(failed(kind, msg), want);
      expect(r.outcome).toBe('unavailable');
      expect(r.message).toContain(msg);
      expect(r.message).toMatch(new RegExp(kind, 'i'));
      // It must never read as a statement about the tariff's contents.
      expect(r.message).not.toMatch(/unchanged|not found|nothing was applied/i);
    });
  }

  it('judges the row activating on the requested date, not the live row still at the old price (SMP-006)', () => {
    const r = classifyVerificationRead(ok([
      { prefix: '69230', rate: 0.04,   effectiveFrom: '20260801T00:00:00' },
      { prefix: '69230', rate: 0.0199, effectiveFrom: '20260919T16:30:00' },
    ]), { ...want, effectiveFrom: '2026-09-19 16:30:00' });
    expect(r.outcome).toBe('confirmed');
  });

  it('a malformed read (ok, but no rates array) is unavailable — it saw nothing, it proves nothing', () => {
    expect(classifyVerificationRead({ ok: true } as RateListRead, want).outcome).toBe('unavailable');
  });
});

describe('why a read failed is preserved, not flattened', () => {
  it('names the transport causes seen in production', () => {
    expect(rateListFailureKind('read ECONNRESET')).toBe('transport');
    expect(rateListFailureKind('socket hang up')).toBe('transport');
    expect(rateListFailureKind('connect ECONNREFUSED 1.2.3.4:443')).toBe('transport');
    expect(rateListFailureKind('getaddrinfo ENOTFOUND sippy.example')).toBe('transport');
  });

  it('separates a timeout from a reset — different causes, different fixes', () => {
    expect(rateListFailureKind('Request timed out')).toBe('timeout');
    expect(rateListFailureKind('ETIMEDOUT')).toBe('timeout');
  });

  it('anything unrecognised is unknown, never silently a transport failure', () => {
    expect(rateListFailureKind('Cannot read properties of undefined')).toBe('unknown');
  });

  it('a fault naming a missing method is unsupported; any other fault is a fault', () => {
    expect(faultFailureKind('Unknown method: tariff.getRates')).toBe('unsupported');
    expect(faultFailureKind('Method not supported')).toBe('unsupported');
    expect(faultFailureKind('Fatal error')).toBe('fault');
    expect(faultFailureKind('Tariff is locked — processing of uploaded file is in progress')).toBe('fault');
  });
});

describe('verificationResultFor — the wire values the verdict layer already understands', () => {
  it('confirmed → confirmed, absent → mismatch, unavailable → skip', () => {
    expect(verificationResultFor('confirmed')).toBe('confirmed');
    expect(verificationResultFor('absent')).toBe('mismatch');
    // `skip` + refusedBeforeWrite:false is what verdict.ts already maps to `indeterminate`.
    expect(verificationResultFor('unavailable')).toBe('skip');
  });
});

describe('uploadVerdict — THE REGRESSION: a sent upload plus an unreadable tariff', () => {
  const STATUSES = ['DONE', 'FAIL', 'FILE_UPLOADED', 'PROCESSING', 'UNKNOWN'];

  it('can NEVER be failed/mismatch, and can NEVER permit another Sippy mutation', () => {
    for (const uploadStatus of STATUSES) {
      const v = uploadVerdict({ uploadStatus, outcome: 'unavailable', readMessage: 'read ECONNRESET', want });
      expect(v.success, uploadStatus).toBe(false);
      expect(v.verificationResult, uploadStatus).toBe('skip');
      expect(v.fallbackAllowed, uploadStatus).toBe(false);
    }
  });

  it('says the outcome is unknown, and never that the tariff is unchanged', () => {
    for (const uploadStatus of STATUSES) {
      const m = uploadVerdict({ uploadStatus, outcome: 'unavailable', readMessage: 'Request timed out', want }).message;
      expect(m, uploadStatus).toMatch(/UNKNOWN|could not be read|not established/i);
      expect(m, uploadStatus).not.toMatch(/unchanged|nothing was applied|not applied|rate unchanged/i);
      // The operator's next move has to be in the sentence.
      expect(m, uploadStatus).toMatch(/read the tariff|before (any|writing)/i);
    }
  });
});

describe('uploadVerdict — the established cases keep their existing meaning', () => {
  it('confirmed is success at any status, including FAIL (Sippy has reported FAIL on an upload that landed)', () => {
    for (const uploadStatus of ['DONE', 'FILE_UPLOADED', 'FAIL']) {
      const v = uploadVerdict({ uploadStatus, outcome: 'confirmed', readMessage: 'verified', want });
      expect(v, uploadStatus).toMatchObject({ success: true, verificationResult: 'confirmed', fallbackAllowed: false });
    }
  });

  it('DONE + absent stays a mismatch and does not fall through', () => {
    expect(uploadVerdict({ uploadStatus: 'DONE', outcome: 'absent', readMessage: 'prefix not found', want }))
      .toMatchObject({ success: false, verificationResult: 'mismatch', fallbackAllowed: false });
  });

  it('FAIL + absent stays a mismatch and may say the tariff is unchanged — the read established it', () => {
    const v = uploadVerdict({ uploadStatus: 'FAIL', outcome: 'absent', readMessage: 'prefix not found', want, reportUrl: 'https://x/report' });
    expect(v).toMatchObject({ success: false, verificationResult: 'mismatch', fallbackAllowed: false });
    expect(v.message).toMatch(/unchanged|nothing was applied/i);
    expect(v.message).toContain('https://x/report');
  });

  it('FILE_UPLOADED + absent keeps the existing fall-through — unchanged scope, deliberately', () => {
    expect(uploadVerdict({ uploadStatus: 'FILE_UPLOADED', outcome: 'absent', readMessage: 'prefix not found', want }))
      .toMatchObject({ success: false, verificationResult: 'mismatch', fallbackAllowed: true });
  });
});

describe('the retry is for READS only', () => {
  it('retries an unavailable read up to the attempt limit, and never a settled one', () => {
    expect(READBACK_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    for (let a = 1; a < READBACK_MAX_ATTEMPTS; a++) expect(shouldRetryRead('unavailable', a)).toBe(true);
    expect(shouldRetryRead('unavailable', READBACK_MAX_ATTEMPTS)).toBe(false);
    for (const settled of ['confirmed', 'absent'] as ReadbackOutcome[]) {
      for (let a = 1; a <= READBACK_MAX_ATTEMPTS; a++) expect(shouldRetryRead(settled, a)).toBe(false);
    }
  });

  it('backs off between attempts and asks for nothing after the last one', () => {
    expect(readRetryDelayMs(1)).toBeGreaterThan(0);
    expect(readRetryDelayMs(2)).toBeGreaterThan(readRetryDelayMs(1));
    expect(readRetryDelayMs(READBACK_MAX_ATTEMPTS)).toBe(0);
  });

  it('the read timeout is explicit, named, and longer than the 20 s default it replaces', () => {
    // Secondary to the classification fix: healthy reads are 1–3 s, degraded ones 70 s+ or reset,
    // so this converts some unavailables into slow successes. It is NOT an explanation of the
    // 72–76 s behaviour observed on 2026-09-19 (see the Sippy incident item).
    expect(READBACK_TIMEOUT_MS).toBeGreaterThan(20_000);
    expect(READBACK_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
