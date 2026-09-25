/**
 * Which Sippy authentication rules the cleanup tool may offer to delete — and the same
 * re-derivation guard the account path already has.
 *
 * WHY THIS EXISTS. `sync/execute` protected `deleteAccountIds` (see ./tracked-accounts.ts) but
 * passed `deleteAuthRuleIds` straight to `delSippyAuthRule`, trusting ids a browser submitted.
 * Correcting the account predicate in the same endpoint widened the auth-rule scan from
 * 'provisioned' companies to every LINKED company, and the orphaned-IP list went 3 → 9 on the
 * 2026-09-24 deploy. The reporting is right and the growth is the point — but it enlarged an
 * unguarded destructive list, so that path was briefly MORE exposed than before the fix.
 *
 * WHAT A DELETION COSTS. An auth rule is how a customer's traffic authenticates from an IP.
 * Deleting one stops that traffic. And the rules surfaced by the widening are the likeliest FALSE
 * POSITIVES: they belong to companies never fully provisioned through the platform, whose
 * approved-IP lists are correspondingly thin. A rule can look orphaned because our records are
 * incomplete, not because the rule is wrong.
 *
 * ONE DEFINITION, TWO CALLERS. Preview and execute both classify through `orphanedAuthRules()`.
 * If execute re-derived with even slightly different semantics — a trimmed comparison, a
 * different treatment of a rule with no IP — it would refuse rules preview had legitimately
 * offered, and the operator would see arbitrary failures. Sharing the function makes drift
 * impossible rather than unlikely.
 */

export type AuthRuleRef = {
  iAuthentication?: number | string | null;
  remoteIp?: string | null;
};

/** One company's rules, paired with the IPs the platform has approved for it. */
export type OrphanScanInput = {
  companyId?: number | null;
  companyName?: string | null;
  iAccount?: number | string | null;
  authRules: readonly AuthRuleRef[];
  /** Approved IPs for THIS company. An empty list means none are approved, not "unknown". */
  approvedIps: readonly string[];
};

export type OrphanRule = {
  iAccount: number | null;
  iAuthentication: number;
  remoteIp: string;
  companyName: string;
  companyId: number | null;
};

function toId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A rule is orphaned when it carries a remote IP the platform has not approved for that company.
 *
 * A rule with NO remote IP is NEVER orphaned. It is not an unapproved address; it is a rule this
 * comparison cannot speak about, and silence is not grounds for deletion. Same for a rule whose
 * id we cannot read: it can be reported, but it can never be deleted, because `deletable` is
 * keyed on an id we could parse.
 */
export function orphanedAuthRules(scans: readonly OrphanScanInput[]): OrphanRule[] {
  const out: OrphanRule[] = [];
  for (const scan of scans ?? []) {
    const approved = new Set((scan?.approvedIps ?? []).map(ip => String(ip ?? '')));
    for (const rule of scan?.authRules ?? []) {
      const ip = rule?.remoteIp;
      if (!ip) continue;                       // no IP: not an unapproved address
      if (approved.has(String(ip))) continue;  // approved: not orphaned
      const id = toId(rule?.iAuthentication);
      if (id === null) continue;               // unreadable id: never deletable
      out.push({
        iAccount:        toId(scan?.iAccount),
        iAuthentication: id,
        remoteIp:        String(ip),
        companyName:     String(scan?.companyName ?? ''),
        companyId:       scan?.companyId ?? null,
      });
    }
  }
  return out;
}

/** The ids of a set of orphan rules, for membership tests. */
export function orphanedRuleIdSet(rules: readonly OrphanRule[]): Set<number> {
  const out = new Set<number>();
  for (const r of rules ?? []) {
    const id = toId(r?.iAuthentication);
    if (id !== null) out.add(id);
  }
  return out;
}

export type RuleRefusal = { iAuthentication: unknown; reason: string };

/**
 * Split requested rule deletions into those the SERVER re-derived as orphaned, and refusals.
 *
 * FAILS CLOSED. A rule id reaches `deletable` only by appearing in an orphan set the server
 * computed during this request. Everything else is refused and named — including ids belonging to
 * a company whose rules could not be listed, because "we could not check" is not "safe to
 * delete". The caller reports refusals rather than dropping them: an operator not told a deletion
 * was refused will believe the cleanup completed.
 */
export function partitionRuleDeletions(
  requested: readonly unknown[] | null | undefined,
  orphaned: ReadonlySet<number>,
): { deletable: number[]; refused: RuleRefusal[] } {
  const deletable: number[] = [];
  const refused: RuleRefusal[] = [];
  const seen = new Set<number>();

  for (const raw of requested ?? []) {
    const id = toId(raw);
    if (id === null) {
      refused.push({ iAuthentication: raw, reason: 'Not a usable Sippy auth-rule id.' });
      continue;
    }
    if (!orphaned.has(id)) {
      refused.push({
        iAuthentication: id,
        reason: 'The server did not classify this rule as orphaned just now — it may be approved, '
              + 'or its company could not be read. Refusing to delete it.',
      });
      continue;
    }
    if (seen.has(id)) continue; // a repeat is not a second deletion
    seen.add(id);
    deletable.push(id);
  }

  return { deletable, refused };
}
