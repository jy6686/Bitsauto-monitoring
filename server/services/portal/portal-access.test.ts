/**
 * Leaving a portal the user may not enter — and, more importantly, NOT leaving one before we
 * know who the user is.
 *
 * A hard load of /commercial lands on / roughly three times in four. A client-side navigation
 * never does. The guard in portal-context.tsx reads:
 *
 *     if (activePortal && definitions.length > 0 && !!role) { ...redirect if not allowed }
 *
 * and its comment says the `!!role` term is there to stop definitions arriving before auth
 * from redirecting every cold deep link. It cannot do that, because useAuth reads
 * `const role: Role = user?.role ?? 'viewer'` — a TRUTHY default. So `!!role` is satisfied
 * before authentication resolves, `allowedPortals` is computed as if the visitor were a
 * viewer, `commercial` requires admin/super_admin/management, and the guard navigates away.
 *
 * Measured on a redirecting load in production: portal definitions finished at 2062 ms and
 * the auth request at 2136 ms. Definitions won by 74 ms. Both started within 14 ms of each
 * other, which is why it flips run to run.
 *
 * The decision is extracted here so it can be tested for real. There is no jsdom or
 * testing-library in this repo, so a rendered component cannot be asserted; a pure decision
 * can be, and this is the whole of the decision.
 *
 * The fix is NOT "find a truthier role". It is to ask whether authentication has RESOLVED,
 * which is a different question from what the role currently says — see
 * [[commercial-workspace-unreachable]] for why a 'viewer' default makes "unauthenticated"
 * and "authenticated as a viewer" indistinguishable everywhere useAuth is used.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldLeavePortal } from '@/lib/portal-access';

const base = {
  activePortal: 'commercial',
  authResolved: true,
  definitionsLoaded: true,
  allowedSlugs: ['noc', 'finance'] as readonly string[],
};

describe('the redirect waits for authentication, whatever the role currently says', () => {
  /**
   * THE REGRESSION. Everything is in place to redirect — a portal in the URL, definitions
   * loaded, the slug absent from the allowed list — except that we do not yet know who the
   * user is. The allowed list is empty or wrong precisely BECAUSE auth has not resolved, so
   * acting on it is acting on a value that is about to change.
   */
  it('does NOT redirect while authentication is unresolved, even with definitions loaded', () => {
    expect(shouldLeavePortal({ ...base, authResolved: false })).toBe(false);
  });

  it('does NOT redirect while auth is unresolved even when the allowed list is empty', () => {
    expect(shouldLeavePortal({ ...base, authResolved: false, allowedSlugs: [] })).toBe(false);
  });

  it('redirects once auth HAS resolved and the portal is still not allowed', () => {
    expect(shouldLeavePortal(base)).toBe(true);
  });
});

describe('the other two conditions still hold', () => {
  it('never redirects when the URL names no portal', () => {
    expect(shouldLeavePortal({ ...base, activePortal: null })).toBe(false);
  });

  it('never redirects before the definitions are known', () => {
    expect(shouldLeavePortal({ ...base, definitionsLoaded: false })).toBe(false);
  });

  it('stays put when the portal IS allowed', () => {
    expect(shouldLeavePortal({ ...base, allowedSlugs: ['commercial', 'noc'] })).toBe(false);
  });

  it('an empty allowed list with auth resolved is a real refusal, not a race', () => {
    expect(shouldLeavePortal({ ...base, allowedSlugs: [] })).toBe(true);
  });
});

describe('matching is exact — a portal slug is an identity, not a prefix', () => {
  it('does not treat a longer slug as a match', () => {
    expect(shouldLeavePortal({ ...base, allowedSlugs: ['commercial-extra'] })).toBe(true);
  });

  it('does not treat a prefix as a match', () => {
    expect(shouldLeavePortal({ ...base, activePortal: 'commercial-extra', allowedSlugs: ['commercial'] })).toBe(true);
  });
});

describe('the provider asks the resolved question, not the role question', () => {
  const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const CTX = strip(readFileSync(
    join(__dirname, '..', '..', '..', 'client', 'src', 'context', 'portal-context.tsx'), 'utf8'));

  /**
   * Scoped to the redirect effect. A file-wide search is not enough here: `navigate("/")`
   * also appears in `setPortal` and `exitPortalMode`, so a whole-file assertion stayed green
   * when the redirect itself was deleted. Three mutations survived that way before this slice
   * existed.
   */
  const EFFECT = (() => {
    const a = CTX.indexOf('useEffect(() => {', CTX.indexOf('shouldLeavePortal({') - 400);
    expect(a, 'the redirect effect must exist').toBeGreaterThan(-1);
    const b = CTX.indexOf('}, [', a);
    expect(b).toBeGreaterThan(a);
    return CTX.slice(a, b);
  })();

  it('takes isLoading from useAuth', () => {
    expect(CTX).toMatch(/const\s*\{[^}]*isLoading[^}]*\}\s*=\s*useAuth\(\)/);
  });

  /** The decision must be fed the RESOLVED question, not a constant and not the role. */
  it('passes !isLoading as authResolved', () => {
    expect(EFFECT).toMatch(/authResolved:\s*!isLoading\b/);
  });

  it('no longer consults the role when deciding to redirect', () => {
    expect(EFFECT).not.toMatch(/\brole\b/);
  });

  it('decides through the shared helper rather than inline', () => {
    expect(EFFECT).toContain('shouldLeavePortal({');
  });

  /**
   * The redirect itself must survive. A "fix" that simply deletes the navigate would leave a
   * user sitting inside a portal they may not access, which is worse than the bounce.
   */
  it('still redirects to the main platform when it decides to', () => {
    expect(EFFECT).toMatch(/navigate\("\/"\)/);
  });
});
