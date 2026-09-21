/**
 * push-scope-guard.ts
 *
 * Whether this caller may push rates to THESE accounts — decided before a job row exists, so a
 * refusal is provably a non-event: nothing recorded, nothing sent to Sippy.
 *
 * `push-batch` accepts `accountNames` and an optional `accounts: [{username, iAccount}]` from
 * the REQUEST BODY, and resolves the target tariff from `acc.iAccount`. The caller therefore
 * names the thing the write lands on. For `admin` and `management` that is fine — they are
 * trusted with every account, and the route has always worked that way. For a `kam` it is the
 * entire attack surface.
 *
 * SO THIS AUTHORISES ON ACCOUNT IDS, NEVER ON NAMES, and never on the pairing between them:
 * the body controls both halves of that pairing, so a name proves nothing. A mislabelled but
 * in-scope id is allowed (the label is cosmetic); an in-scope NAME carrying an out-of-scope id
 * is refused (the id is what gets written).
 *
 * ALL-OR-NOTHING. One out-of-scope account refuses the whole batch. Dropping the offending
 * entries would push a subset while the operator believes the whole batch went — and a partial
 * push nobody notices is worse than a refusal everybody sees.
 *
 * Pure. The scope comes from resolveCommercialScope() (KAM resolved by `kams.user_id`, never
 * by email), and the route composes the two.
 */

/**
 * Roles whose pushes are confined to a resolved account scope. Everything else is unaffected
 * and keeps the behaviour it has always had. Adding a role here NARROWS it — do that
 * deliberately, never to make a test pass.
 */
export const SCOPE_LIMITED_ROLES = ['kam'] as const;

export interface PushScopeInput {
  /** The caller's platform role. */
  role: string;
  /** Account names from the request body — display labels, NOT authority. */
  accountNames: readonly string[];
  /** Account entries from the request body. `iAccount` is what the push actually targets. */
  accounts: ReadonlyArray<{ username?: string; iAccount?: number | string }> | undefined;
  /**
   * Account ids this caller may write to, from resolveCommercialScope().
   * `null` means the caller has no KAM record at all — distinct from having one with no
   * accounts, which is an empty array and refuses everything.
   */
  scopedAccountIds: readonly string[] | null;
}

export type PushScopeDecision =
  | { kind: 'proceed' }
  | { kind: 'no_kam_link' }
  | { kind: 'unidentified'; names: string[] }
  | { kind: 'out_of_scope'; accountIds: string[] };

const isScopeLimited = (role: string) => (SCOPE_LIMITED_ROLES as readonly string[]).includes(role);

export function pushScopeGuard(input: PushScopeInput): PushScopeDecision {
  const { role, accountNames, accounts, scopedAccountIds } = input;

  // Not a scope-limited role: unchanged behaviour, no new failure mode for existing callers.
  if (!isScopeLimited(role)) return { kind: 'proceed' };

  // A scope-limited caller with no KAM record cannot push anything. This is NOT the same as a
  // KAM whose portfolio is empty; that case falls through and refuses as out-of-scope, which
  // is the honest answer to "may I push to this account".
  if (scopedAccountIds === null) return { kind: 'no_kam_link' };

  const idByName = new Map<string, string>();
  for (const a of accounts ?? []) {
    if (a?.username == null || a.iAccount == null || a.iAccount === '') continue;
    idByName.set(String(a.username), String(a.iAccount));
  }

  // Every NAME must resolve to an id, or the push would reach an account this guard never saw.
  // Refuse rather than guess which account a bare name meant.
  const unidentified = accountNames.filter(n => !idByName.has(String(n)));
  if (unidentified.length > 0) return { kind: 'unidentified', names: unidentified };

  // Ids compared as strings: the body may send 1065 and the scope "1065".
  const allowed = new Set(scopedAccountIds.map(String));
  const offending = accountNames
    .map(n => idByName.get(String(n))!)
    .filter(id => !allowed.has(id));

  if (offending.length > 0) return { kind: 'out_of_scope', accountIds: [...new Set(offending)] };

  return { kind: 'proceed' };
}
