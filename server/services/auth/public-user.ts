/**
 * What a `users` row is allowed to become on its way to a browser.
 *
 * Two endpoints served `password_hash` to the client, both by handing a raw row to
 * `res.json`: `/api/auth/user` appended `...user` to an otherwise correct projection, and
 * `/api/team` serialised `getAllUsersWithRoles()` directly — every user's hash, to any admin.
 *
 * This module exists so the second one has something explicit to serialise through.
 *
 * IT IS AN ALLOWLIST, AND THAT IS THE WHOLE POINT. A denylist that deleted `passwordHash`
 * would protect exactly today's schema: add an MFA secret or a reset token to the `users`
 * table tomorrow and it becomes browser-visible the moment the column exists, silently and
 * everywhere at once. A projection that copies only what it names cannot do that — a new
 * column is invisible until somebody writes its name down here, on purpose.
 *
 * The database layer is deliberately NOT narrowed. `getAllUsersWithRoles()` keeps returning
 * full rows because one of its callers needs the whole row for an internal viewer check and
 * never serialises it. The leak is a serialisation bug, so the fix belongs where the
 * serialisation happens.
 */

/** A row as `getAllUsersWithRoles()` returns it: the `users` columns plus role and teamId. */
export interface TeamMemberRow {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role: string;
  createdAt?: string | Date | null;
  /** Everything else the row carries — including credentials. Named by nothing below. */
  [other: string]: unknown;
}

/**
 * The fields `/api/team` may emit, derived from its only consumer. `client/src/pages/team.tsx`
 * reads exactly these off a member. (The `jobTitle` / `assignedPortals` reads in that same file
 * belong to a different query, `/api/users`, so they place no requirement here.)
 */
export const PUBLIC_TEAM_FIELDS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'profileImageUrl',
  'role',
  'createdAt',
] as const;

export type PublicTeamMember = Pick<TeamMemberRow, typeof PUBLIC_TEAM_FIELDS[number]>;

/**
 * Copy the named fields and nothing else. Written as an explicit copy rather than a filtered
 * spread so that reading the function tells you precisely what reaches the browser.
 */
export function toTeamMember(row: TeamMemberRow): PublicTeamMember {
  return {
    id:              row.id,
    email:           row.email ?? null,
    firstName:       row.firstName ?? null,
    lastName:        row.lastName ?? null,
    profileImageUrl: row.profileImageUrl ?? null,
    role:            row.role,
    createdAt:       row.createdAt ?? null,
  };
}
