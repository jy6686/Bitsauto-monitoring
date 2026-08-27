/**
 * xmlrpc-credentials.ts — which credentials may speak XML-RPC to the switch.
 *
 * Owner rule (2026-08-27): the Admin API credential is the single authoritative
 * identity for every XML-RPC CDR operation. The reseller/portal credential
 * (RTST1) is a PORTAL login — it scrapes reports and rate pages legitimately,
 * but it does not participate in billing ingestion unless a fallback is
 * explicitly enabled.
 *
 * Why this exists as a filter rather than a rewrite of the pair builder: the
 * builder's admin-username candidates include several password variants
 * (configured API password, the web password that many switches reuse for
 * XML-RPC, and a platform-default recovery pair). Production authenticated
 * with ONE of those on 2026-08-26 and the logs do not say which — so the safe
 * change narrows by USERNAME, dropping every reseller-identity pair while
 * keeping every admin-identity candidate. Nothing that could have been the
 * working pair is removed.
 *
 * The skip report carries usernames only. Passwords never leave this module.
 */

export interface CredentialPair {
  username: string;
  password: string;
}

export interface CredentialSelection {
  pairs: CredentialPair[];
  /** Usernames of pairs excluded by the admin-only rule. NEVER passwords. */
  skippedUsernames: string[];
  adminOnly: boolean;
}

/**
 * Keep only pairs whose username is an ADMIN identity.
 *
 * `adminUsernames` are the identities allowed to bill: the configured Admin API
 * username plus the platform default. `allowFallback` restores the old
 * try-everything behaviour and exists so an operator can switch it on
 * deliberately — never so the code can drift back silently.
 */
export function selectXmlRpcCredentials(
  pairs: CredentialPair[],
  adminUsernames: Array<string | null | undefined>,
  allowFallback: boolean,
): CredentialSelection {
  if (allowFallback) {
    return { pairs, skippedUsernames: [], adminOnly: false };
  }

  const admins = new Set(
    adminUsernames.filter((u): u is string => !!u && u.trim() !== ''),
  );

  const kept: CredentialPair[] = [];
  const skipped = new Set<string>();
  for (const p of pairs) {
    if (admins.has(p.username)) kept.push(p);
    else skipped.add(p.username);
  }

  // An empty admin selection must stay empty rather than quietly readmitting
  // the reseller pairs: the strict fetch model reports "no credentials" as a
  // loud, named failure, which is the honest outcome when the Admin API is
  // unconfigured. Billing does not fall back to a portal identity by accident.
  return { pairs: kept, skippedUsernames: [...skipped], adminOnly: true };
}
