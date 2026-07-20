/**
 * portal-constants.ts — Single source of truth for portal keys and access scopes.
 *
 * RULE: Adding a portal in the future = change VALID_PORTAL_KEYS here ONLY.
 *       No other file should hardcode portal slug lists.
 *
 * Importable by both server (server/lib/…) and client (client/src/…) via
 * the @shared/ path alias.
 */

/**
 * All portal slugs the platform recognizes. These are the only values
 * that are valid for `assignedPortals[]` and `defaultPortal`.
 */
export const VALID_PORTAL_KEYS = [
  "noc",
  "finance",
  "commercial",
  "product",
  "admin",
] as const;

export type PortalKey = (typeof VALID_PORTAL_KEYS)[number];

/**
 * Canonical access scope values stored in `platform_access_type` (DB) /
 * `platformAccessType` (Drizzle). The CHECK constraint enforces these.
 */
export const ACCESS_SCOPE_VALUES = [
  "full_platform",
  "portal_only",
  "hybrid",
] as const;

export type AccessScopeValue = (typeof ACCESS_SCOPE_VALUES)[number];

/** True if the given string is a known portal slug. */
export function isValidPortalKey(slug: string): slug is PortalKey {
  return (VALID_PORTAL_KEYS as readonly string[]).includes(slug);
}

/** True if the given string is a known access scope value. */
export function isValidAccessScope(scope: string): scope is AccessScopeValue {
  return (ACCESS_SCOPE_VALUES as readonly string[]).includes(scope);
}
