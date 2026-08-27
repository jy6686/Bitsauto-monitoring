import { describe, it, expect } from 'vitest';
import { selectXmlRpcCredentials, type CredentialPair } from './xmlrpc-credentials';

const ADMIN   = 'ssp-root';
const DEFAULT = 'ssp-root'; // platform default shares the admin identity
const PORTAL  = 'RTST1';

/** The shape the routes.ts ladder actually produces. */
const LADDER: CredentialPair[] = [
  { username: ADMIN,  password: 'api-pass' },      // configured admin pair
  { username: PORTAL, password: 'portal-pass' },   // portal pair
  { username: ADMIN,  password: 'web-pass' },      // admin + adminWebPassword
  { username: PORTAL, password: 'web-pass' },      // portal + adminWebPassword
  { username: PORTAL, password: 'api-pass' },      // swapped-field cross-combo
  { username: ADMIN,  password: 'portal-pass' },   // reverse cross-combo
  { username: ADMIN,  password: 'default-pass' },  // hardcoded recovery pair
];

describe('selectXmlRpcCredentials — the Admin API is the only billing identity', () => {
  it('drops every reseller/portal pair by default', () => {
    const sel = selectXmlRpcCredentials(LADDER, [ADMIN, DEFAULT], false);
    expect(sel.adminOnly).toBe(true);
    expect(sel.pairs.every(p => p.username === ADMIN)).toBe(true);
    expect(sel.skippedUsernames).toEqual([PORTAL]);
  });

  /**
   * Production authenticated with ONE of the admin password variants on
   * 2026-08-26 and the logs do not say which. Filtering by USERNAME must keep
   * every variant, or this change could remove the one pair that works.
   */
  it('keeps every admin password variant', () => {
    const sel = selectXmlRpcCredentials(LADDER, [ADMIN, DEFAULT], false);
    expect(sel.pairs.map(p => p.password)).toEqual([
      'api-pass', 'web-pass', 'portal-pass', 'default-pass',
    ]);
  });

  it('restores the full ladder only under the explicit fallback flag', () => {
    const sel = selectXmlRpcCredentials(LADDER, [ADMIN, DEFAULT], true);
    expect(sel.adminOnly).toBe(false);
    expect(sel.pairs).toEqual(LADDER);
    expect(sel.skippedUsernames).toEqual([]);
  });

  /**
   * No admin username configured must yield an EMPTY selection, not a silent
   * fallback to the reseller identity — the strict fetch model then reports
   * "no credentials" loudly, which is the honest outcome.
   */
  it('returns empty rather than readmitting portal pairs when no admin identity exists', () => {
    const sel = selectXmlRpcCredentials(
      [{ username: PORTAL, password: 'portal-pass' }],
      ['', null, undefined],
      false,
    );
    expect(sel.pairs).toEqual([]);
    expect(sel.skippedUsernames).toEqual([PORTAL]);
  });

  it('never places a password in the skip report', () => {
    const sel = selectXmlRpcCredentials(LADDER, [ADMIN], false);
    const report = JSON.stringify(sel.skippedUsernames);
    for (const p of LADDER) expect(report).not.toContain(p.password);
  });

  it('deduplicates skipped usernames', () => {
    const sel = selectXmlRpcCredentials(LADDER, [ADMIN], false);
    expect(sel.skippedUsernames.length).toBe(new Set(sel.skippedUsernames).size);
  });
});
