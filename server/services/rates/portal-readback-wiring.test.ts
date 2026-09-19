/**
 * The portal-edit path's contract with the read-back model — the tri-state, its propagation, and
 * the SA gate — asserted against source, with the existing classifier behaviour regression-tested.
 *
 * The decision table is exercised by calling it in portal-edit-verdict.test.ts. What can only be
 * checked here: that the portal read-back reports WHY it failed rather than collapsing into
 * `confirmed:false`, that the signal survives out of pushRateViaPortalUpload, that the SA path
 * consults the table instead of treating every failure as a reason to try the next write method,
 * and that no mutating call sits in that branch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPortalWrite, type PortalReadBack } from './portal-write-outcome';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SIPPY = strip(readFileSync(join(__dirname, '..', '..', 'sippy.ts'), 'utf8'));
const slice = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `anchor not found: ${from}`).toBeGreaterThan(-1);
  const b = src.indexOf(to, a);
  expect(b, `end anchor not found: ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
};

const READBACK = () => slice(SIPPY, 'async function readBackRateWithIntervals(', 'export function rateUploadAction(');
const PORTAL   = () => slice(SIPPY, 'async function pushRateViaPortalUpload(', 'export async function probePortalRatesPage(');
/** The SA block of setSippyRateEntryInner — scoped to that function first. */
const SA = () => {
  const inner = slice(SIPPY, 'async function setSippyRateEntryInner(', 'export function reportCellText(');
  return slice(inner, "if (adminCreds && requestedAction === 'SA')", 'const processOn = sippyUploadTimestamp');
};

/** Anything that can change Sippy state by a route OTHER than the portal edit itself. */
const FALLBACK_MUTATORS = ['uploadBinaryFile(', 'buildGetUploadTokenXml(', 'getUploadToken', 'buildRateXlsx(', 'addRateDirectToTariff('];

const CTX = { operation: 'edit' as const, tariffId: 64, prefix: '19230', rate: 0.04, iRate: 9218 };
const CLEAN_PAGE = { isLoginPage: false, hasError: false, errorText: null, lockBanner: null, statusCode: 200, bodyLength: 18204 };

describe('CONTRACT 1: the portal read-back is a tri-state', () => {
  it('reports the failure kind instead of collapsing a dead connection into confirmed:false', () => {
    const r = READBACK();
    expect(r).toContain('rateListFailureKind(');
    expect(r).toMatch(/outcome/);
    // The old shape said only this, for a reset and for a genuinely missing prefix alike.
    expect(r).not.toMatch(/return \{ confirmed: false, message: `read-back failed/);
  });

  it('THE LINE THAT MATTERS: a caught transport error is unavailable, never established absence', () => {
    const r = READBACK();
    const at = r.indexOf('} catch');
    expect(at, 'the read-back must still catch').toBeGreaterThan(-1);
    const caught = r.slice(at);
    expect(caught).toContain("outcome: 'unavailable'");
    expect(caught).not.toContain("outcome: 'absent'");
    expect(caught).not.toContain("outcome: 'confirmed'");
    expect(caught).toContain('rateListFailureKind(');
  });

  it('and a prefix the read genuinely did NOT find is established absence', () => {
    const r = READBACK();
    const notFound = r.slice(r.indexOf('if (!match)'), r.indexOf('} catch'));
    expect(notFound).toContain("outcome: 'absent'");
    expect(notFound).not.toContain("outcome: 'unavailable'");
  });

  it('still selects the row by prefix and reports the intervals it found', () => {
    const r = READBACK();
    expect(r).toContain('getTariffRatesListFull(');
    expect(r).toMatch(/foundInterval1/);
    expect(r).toMatch(/foundIntervalN/);
  });
});

describe('CONTRACT 2: classifyPortalWrite tells an unverified write from an absent rate', () => {
  const unavailable: PortalReadBack = { confirmed: false, outcome: 'unavailable', message: 'tariff 64 could not be read [transport]: read ECONNRESET' };

  it('an unverified read-back is reported as unverified, not as a tariff that lacks the rate', () => {
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, unavailable);
    expect(o.unverified).toBe(true);
    expect(o.success).toBe(false);
    expect(o.message).not.toMatch(/does not show|unchanged|nothing was applied/i);
    expect(o.message).toMatch(/UNVERIFIED|could not be read|not established/i);
    expect(o.message).toContain('read ECONNRESET');
  });

  it('a lock banner over an unverified read-back is still unverified — the banner is not the outcome', () => {
    const o = classifyPortalWrite(CTX, { ...CLEAN_PAGE, lockBanner: 'Tariff is locked' }, unavailable);
    expect(o.unverified).toBe(true);
    expect(o.message).not.toMatch(/does not show/i);
  });

  it('REGRESSION: a confirmed read-back is still a success, and not unverified', () => {
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, { confirmed: true, message: 'tariff=64 prefix=19230 rate=0.04', foundRate: 0.04 });
    expect(o.success).toBe(true);
    expect(o.unverified).toBe(false);
  });

  it('REGRESSION: an ESTABLISHED absence still fails, still says so, and is not unverified', () => {
    const absent: PortalReadBack = { confirmed: false, outcome: 'absent', message: 'prefix 19230 not found in tariff 64 (tariff holds 7 rate(s))' };
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, absent);
    expect(o.success).toBe(false);
    expect(o.unverified).toBe(false);
    expect(o.message).toMatch(/does not show/);
  });

  it('REGRESSION: a null read-back keeps its existing UNVERIFIED meaning', () => {
    const o = classifyPortalWrite(CTX, CLEAN_PAGE, null);
    expect(o.unverified).toBe(true);
    expect(o.message).toMatch(/UNVERIFIED/);
  });

  it('REGRESSION: a read-back with no outcome field is read as before — confirmed or absent', () => {
    expect(classifyPortalWrite(CTX, CLEAN_PAGE, { confirmed: true, message: 'ok' }).unverified).toBe(false);
    expect(classifyPortalWrite(CTX, CLEAN_PAGE, { confirmed: false, message: 'prefix not found' }).unverified).toBe(false);
  });
});

describe('CONTRACT 3: the signal survives out of pushRateViaPortalUpload', () => {
  it('returns unverified alongside success and message, on both the add and the edit path', () => {
    const p = PORTAL();
    expect((p.match(/unverified: verdict\.unverified/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('REGRESSION: both mutating GETs still cross the boundary before they are sent', () => {
    expect((PORTAL().match(/if \(boundary\) boundary\.crossed = true;/g) || []).length).toBe(2);
  });

  it('a throw before the request still reports the failure without claiming a read', () => {
    const p = PORTAL();
    expect(p).toMatch(/catch \(addErr: any\)/);
    expect(p).toMatch(/catch \(e: any\)/);
  });
});

describe('CONTRACT 4: the SA gate', () => {
  it('consults portalEditVerdict rather than deciding from success alone', () => {
    expect(SIPPY).toMatch(/portalEditVerdict/);
    expect(SA()).toContain('portalEditVerdict(');
  });

  it('passes the live boundary, so a write that never left is told from one that did', () => {
    expect(SA()).toMatch(/boundaryCrossed:\s*boundary\.crossed/);
  });

  it('returns when the verdict forbids a fallback, and only falls through when it allows one', () => {
    const sa = SA();
    // The gate itself, not merely a mention of the word: the early return is conditional on it.
    expect(sa).toMatch(/if \(!\w+\.fallbackAllowed\)\s*\{[\s\S]{0,200}return \{/);
    const gate = sa.indexOf('fallbackAllowed');
    const fallThrough = sa.indexOf('lastErrors.push(`portal_edit:');
    expect(fallThrough).toBeGreaterThan(gate);
  });

  it('THE REGRESSION: no other write method can be reached from inside the SA block', () => {
    const sa = SA();
    for (const m of FALLBACK_MUTATORS) expect(sa, m).not.toContain(m);
  });

  it('no longer decides the fall-through from the message text', () => {
    expect(SA()).not.toMatch(/\/locked\/i\.test\(directResult\.message\)/);
  });
});

describe('CONTRACT 5: a successful edit whose verification could not be performed', () => {
  it('routes the verification OUTCOME into the verdict, not just its boolean', () => {
    const sa = SA();
    // The tri-state is read from the verification and reaches the table (assigned first, since
    // it is only produced when the edit reported success) — and no branch hardcodes a verdict.
    expect(sa).toMatch(/=\s*verifyResult\.outcome/);
    expect(sa).toMatch(/portalEditVerdict\(\{[\s\S]{0,500}verifyOutcome/);
    expect(sa).not.toMatch(/verificationResult:\s*'(mismatch|confirmed)'/);
    expect(sa).not.toMatch(/verifyResult\.confirmed/);
  });
});
