/**
 * Credential projection at the HTTP response boundary.
 *
 * Two endpoints serve a `users` row to the browser, and both of them serve `password_hash`
 * with it. Confirmed live in production 2026-09-20:
 *
 *   GET /api/auth/user  builds a correct, documented projection and then appends `...user`
 *                       as the final property, re-adding every column. Self-exposure.
 *   GET /api/team       passes the rows from getAllUsersWithRoles() straight to res.json().
 *                       Every user's hash, to any admin. This is the severe one.
 *
 * The fix belongs at those two boundaries, not in the database layer: getAllUsersWithRoles()
 * has three other callers that already project explicit fields or consume the rows internally
 * and never serialize them, so narrowing the helper would change more than it protects.
 *
 * NO TEST HERE HANDLES A CREDENTIAL VALUE. A hash is proven absent by the absence of its KEY;
 * asserting anything about the value would mean putting one in a fixture, and a fixture is a
 * place a real hash eventually gets pasted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_TEAM_FIELDS, toTeamMember, type TeamMemberRow } from './public-user';

/** A row shaped like `users` + the helper's two additions. The hash is a placeholder marker. */
const row = (over: Partial<TeamMemberRow> = {}): TeamMemberRow => ({
  id: 'u-1',
  email: 'someone@example.com',
  username: 'someone',
  firstName: 'Some',
  lastName: 'One',
  profileImageUrl: 'https://example.com/a.png',
  jobTitle: null,
  platformAccessType: 'full_platform',
  defaultPortal: null,
  passwordHash: 'NOT-A-REAL-HASH',
  createdAt: '2026-04-06T07:50:29.980Z',
  updatedAt: '2026-09-19T07:16:49.817Z',
  role: 'admin',
  teamId: null,
  ...over,
}) as TeamMemberRow;

describe('toTeamMember — the projection that /api/team serialises', () => {
  it('does not carry the credential key at all', () => {
    const out = toTeamMember(row()) as Record<string, unknown>;
    expect(Object.keys(out)).not.toContain('passwordHash');
    expect('passwordHash' in out).toBe(false);
  });

  /**
   * An allowlist, not a denylist. A denylist that deletes `passwordHash` would leak the next
   * credential column someone adds to the table; this projection only ever emits what it names.
   */
  it('emits ONLY named fields, so a new column is excluded by default', () => {
    const out = toTeamMember(row({ mfaSecret: 'NOT-A-REAL-SECRET' } as Partial<TeamMemberRow>));
    for (const k of Object.keys(out)) expect(PUBLIC_TEAM_FIELDS).toContain(k);
    expect(Object.keys(out)).not.toContain('mfaSecret');
  });

  /**
   * Derived from the consumers, not guessed. client/src/pages/team.tsx is the only reader of
   * /api/team, and these are the fields it reads off a member. The `u.jobTitle` /
   * `u.assignedPortals` reads in that same file belong to a DIFFERENT query (/api/users) and
   * so place no requirement here.
   */
  it('keeps every field the team page actually reads', () => {
    const out = toTeamMember(row()) as Record<string, unknown>;
    for (const k of ['id', 'email', 'firstName', 'lastName', 'profileImageUrl', 'role', 'createdAt']) {
      expect(Object.keys(out), k).toContain(k);
    }
  });

  it('passes those values through unchanged', () => {
    const out = toTeamMember(row({ id: 'u-9', email: 'kam@example.com', role: 'management' }));
    expect(out.id).toBe('u-9');
    expect(out.email).toBe('kam@example.com');
    expect(out.role).toBe('management');
  });

  it('never invents a value for a field the row leaves null', () => {
    const out = toTeamMember(row({ firstName: null, lastName: null, profileImageUrl: null }));
    expect(out.firstName).toBeNull();
    expect(out.lastName).toBeNull();
    expect(out.profileImageUrl).toBeNull();
  });

  it('the allowlist itself names no credential field', () => {
    for (const forbidden of ['passwordHash', 'password', 'mfaSecret', 'resetToken']) {
      expect(PUBLIC_TEAM_FIELDS, forbidden).not.toContain(forbidden);
    }
  });
});
