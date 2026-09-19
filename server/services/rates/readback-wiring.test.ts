/**
 * The single-prefix push path's contract with the read-back model — asserted against source,
 * plus behavioural regressions on the paths this change must NOT touch.
 *
 * The decisions live in readback-outcome.ts and are tested there. What can only be checked here:
 * that sippy.ts actually consults them, that the retry wraps a READ and nothing else, and that
 * the fall-through to further write methods is gated on the verdict's permission rather than on
 * "not confirmed" — which is how an unreadable tariff could start a second mutation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verdictFromPush } from './verdict';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SIPPY = strip(readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8'));
const slice = (from: string, to: string) => {
  const a = SIPPY.indexOf(from);
  expect(a, `anchor not found: ${from}`).toBeGreaterThan(-1);
  const b = SIPPY.indexOf(to, a);
  expect(b, `end anchor not found: ${to}`).toBeGreaterThan(a);
  return SIPPY.slice(a, b);
};

const VERIFY   = () => slice('async function verifySippyRate(', 'async function readBackRateWithIntervals(');
const RATELIST = () => slice('export async function getSippyRateList(', 'export function selectVerificationRow');

/**
 * The upload-status branches of setSippyRateEntryInner — scoped to that function first.
 * `if (finalStatus === 'FAIL'` also appears in pushRatesBulkXlsx thousands of lines earlier, and
 * a file-wide search silently sliced from there instead.
 */
const BRANCHES = () => {
  const inner = slice('async function setSippyRateEntryInner(', 'export function reportCellText(');
  const a = inner.indexOf("if (finalStatus === 'FAIL'");
  expect(a, 'the status branches must be inside setSippyRateEntryInner').toBeGreaterThan(-1);
  const b = inner.indexOf('lastErrors.push(`upload_token: status=', a);
  expect(b).toBeGreaterThan(a);
  return inner.slice(a, b);
};

/** Anything that can change Sippy state. None of these may appear inside the verification read. */
const MUTATORS = [
  'uploadBinaryFile(', 'getUploadToken', 'buildGetUploadTokenXml(', 'pushRateViaPortalUpload(',
  'addRateDirectToTariff(', 'setSippyRateEntry(', 'buildRateXlsx(', 'buildGroupRateXlsx(',
];

describe('verifySippyRate — a read that did not happen is not an answer about the tariff', () => {
  it('classifies through readback-outcome and reports the tri-state outcome', () => {
    expect(SIPPY).toMatch(/from ['"]\.\/services\/rates\/readback-outcome['"]/);
    const v = VERIFY();
    expect(v).toContain('classifyVerificationRead(');
    expect(v).toMatch(/outcome/);
  });

  it('retries only while the outcome is unavailable, with the shared backoff', () => {
    const v = VERIFY();
    expect(v).toContain('shouldRetryRead(');
    expect(v).toContain('readRetryDelayMs(');
    expect(v).toContain('READBACK_MAX_ATTEMPTS');
  });

  it('passes the explicit read-back timeout to the read', () => {
    expect(VERIFY()).toContain('READBACK_TIMEOUT_MS');
  });

  it('REGRESSION: the verification read — retries included — cannot reach any mutating call', () => {
    const v = VERIFY();
    for (const m of MUTATORS) expect(v, m).not.toContain(m);
  });
});

describe('the upload branches consult the verdict table instead of deciding inline', () => {
  it('DONE / FILE_UPLOADED / FAIL all reach uploadVerdict — one table, no per-status decision', () => {
    const b = BRANCHES();
    expect(b).toContain('uploadVerdict(');
    // All three statuses are handled by the same guarded region, so one cannot drift from another.
    expect(b).toMatch(/finalStatus === 'FAIL'[\s\S]{0,120}finalStatus === 'DONE'[\s\S]{0,120}finalStatus === 'FILE_UPLOADED'/);
  });

  it('no branch computes its own verdict — success and verificationResult come from the table', () => {
    const b = BRANCHES();
    expect(b).not.toMatch(/verificationResult:\s*'(mismatch|confirmed)'/);
    expect(b).not.toMatch(/success:\s*(true|false)\b/);
    expect(b).toContain('verificationResult: v.verificationResult');
  });

  it('the fall-through to the XML-RPC / portal methods is gated on fallbackAllowed', () => {
    const b = BRANCHES();
    expect(b).toContain('fallbackAllowed');
    // The old gate — "not confirmed, therefore try something else" — must be gone.
    expect(b).not.toMatch(/if \(verifyResult\.confirmed\) \{[\s\S]{0,400}\}\s*\}\s*$/);
  });

  it('no branch asserts the tariff is unchanged without a read that established it', () => {
    const b = BRANCHES();
    expect(b).not.toMatch(/the tariff is unchanged \(\$\{after\.message\}\)/);
    expect(b).not.toContain('Upload token DONE but rate unchanged');
  });
});

describe('getSippyRateList — why a read failed is preserved', () => {
  it('reports a typed failure rather than one generic string for every cause', () => {
    const r = RATELIST();
    expect(r).toMatch(/failure/);
    expect(r).toMatch(/transport|timeout|fault|unsupported/);
    // The old shape said only this, for a reset, a timeout and an unsupported method alike.
    expect(r).not.toContain("error: 'Could not fetch rates from this Sippy instance.'");
  });

  it('records a reason at EVERY exit — a non-200, a fault, and a throw', () => {
    const r = RATELIST();
    expect(r).not.toMatch(/\}\s*catch\s*\{\s*continue;\s*\}/);
    // Keeping the catch block but dropping the record is the same defect in a different shape,
    // so the count is asserted rather than the literal bare form.
    expect((r.match(/failures\.push\(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(r).toContain('rateListFailureKind(');
    expect(r).toContain('faultFailureKind(');
  });
});

describe('REGRESSION — the paths that already classify correctly are untouched', () => {
  it('uploadRateGroup still decides through groupVerdicts, including readback_unavailable', () => {
    const g = slice('export async function uploadRateGroup(', 'export type RatePushStep');
    expect(g).toContain('groupVerdicts(');
    expect(g).toContain("kind: 'readback_unavailable'");
  });

  it('reconcile-boot still defers when the tariff cannot be read', () => {
    const BOOT = strip(readFileSync(join(__dirname, 'reconcile-boot.ts'), 'utf8'));
    expect(BOOT).toMatch(/catch \{\s*return \{ reachable: false \};\s*\}/);
  });

  it('uploadRatesWorkbook still reports an unconfirmed sample as indeterminate, never failure', () => {
    const w = slice('export async function uploadRatesWorkbook(', 'export async function uploadRateGroup(');
    expect(w).toContain("verdict: 'indeterminate' as const");
    expect(w).toContain('must not be retried blindly');
  });

  it('verdictFromPush keeps its mapping exactly — behaviourally, not by source match', () => {
    expect(verdictFromPush({ success: true,  message: 'm', verificationResult: 'confirmed' }).verdict).toBe('success');
    expect(verdictFromPush({ success: false, message: 'm', verificationResult: 'mismatch'  }).verdict).toBe('failure');
    expect(verdictFromPush({ success: false, message: 'm', verificationResult: 'skip', refusedBeforeWrite: true  }).verdict).toBe('failure');
    expect(verdictFromPush({ success: false, message: 'm', verificationResult: 'skip', refusedBeforeWrite: false }).verdict).toBe('indeterminate');
    expect(verdictFromPush({ success: false, message: 'm', verificationResult: 'skip' }).verdict).toBe('indeterminate');
  });

  it('END TO END ON THE CONTRACT: unavailable → skip → indeterminate, never retried', () => {
    // verificationResultFor('unavailable') is 'skip'; the boundary is crossed after an upload, so
    // refusedBeforeWrite is false. This is the composition the defect broke.
    const v = verdictFromPush({ success: false, message: 'read ECONNRESET', verificationResult: 'skip', refusedBeforeWrite: false });
    expect(v.verdict).toBe('indeterminate');
    expect(v.message).toMatch(/read the tariff|must be read/i);
  });
});
