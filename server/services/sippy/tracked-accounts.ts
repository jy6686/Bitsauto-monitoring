/**
 * Which Sippy accounts the platform KNOWS — and therefore must never offer to delete.
 *
 * THE DEFECT THIS EXISTS TO END. `/api/sippy/sync/preview` classified an account as
 * "untracked" unless some company was BOTH `provisioning_status = 'provisioned'` AND carried a
 * `sippy_i_account`. Those are different facts. A company linked to a live Sippy account whose
 * workflow status is `draft`, `pending_provision`, `imported` or anything else was excluded from
 * the tracked set, and its account was rendered under "Untracked Sippy Accounts — select to
 * delete from Sippy". On 2026-09-25 that list named `aura` (1067) and `1gloabl` (1069): the two
 * accounts rates had been pushed to that same day, one of which had received a certified rate
 * notification. Only 9 of 30 linked companies carry a stored tariff, so non-'provisioned'
 * statuses are the norm rather than the exception.
 *
 * THE TEST IS `sippyIAccount IS NOT NULL`. If any company records an account id, the platform
 * knows that account; how far along its provisioning workflow sits says nothing about whether
 * deleting it would destroy a live customer. `provisioning_status` is workflow state and is
 * deliberately not consulted here.
 *
 * Pure and I/O-free so the classification can be exercised directly, and so the destructive
 * endpoint can re-derive it server-side instead of trusting ids a browser submitted.
 */

/** The only fields identity classification may read. Deliberately narrow. */
export type CompanyIdentity = {
  id?: number | null;
  name?: string | null;
  sippyIAccount?: number | string | null;
  /** Present so callers can pass whole company rows; NEVER read by this module. */
  provisioningStatus?: string | null;
};

/** A Sippy account id, or null when the value is absent or not a usable id. */
export function toAccountId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Every Sippy account the platform records, regardless of provisioning workflow state.
 * A company with no account id contributes nothing; it cannot claim an account it has never had.
 */
export function linkedAccountIds(companies: readonly CompanyIdentity[]): Set<number> {
  const out = new Set<number>();
  for (const c of companies ?? []) {
    const id = toAccountId(c?.sippyIAccount);
    if (id !== null) out.add(id);
  }
  return out;
}

/** An account is untracked only when NO company records it. */
export function isUntracked(iAccount: unknown, linked: ReadonlySet<number>): boolean {
  const id = toAccountId(iAccount);
  if (id === null) return false; // unreadable id: never classify as safe to delete
  return !linked.has(id);
}

export type DeletionRefusal = { iAccount: unknown; reason: string };

/**
 * Split requested deletions into those the SERVER itself classifies as untracked, and refusals.
 *
 * FAILS CLOSED BY CONSTRUCTION: an id reaches `deletable` only by being a usable account id that
 * no company records. Anything unreadable, or claimed by a company, is refused and named. The
 * caller reports refusals rather than silently dropping them — a deletion that does not happen
 * must be visible, or the operator will believe the cleanup completed.
 *
 * This is the second of the two protections: `preview` classifying correctly is not enough,
 * because the ids arriving at `execute` were chosen by a browser that may have rendered a stale
 * preview, or may have sent something the preview never offered at all.
 */
export function partitionDeletions(
  requested: readonly unknown[] | null | undefined,
  linked: ReadonlySet<number>,
): { deletable: number[]; refused: DeletionRefusal[] } {
  const deletable: number[] = [];
  const refused: DeletionRefusal[] = [];
  const seen = new Set<number>();

  for (const raw of requested ?? []) {
    const id = toAccountId(raw);
    if (id === null) {
      refused.push({ iAccount: raw, reason: 'Not a usable Sippy account id.' });
      continue;
    }
    if (linked.has(id)) {
      refused.push({
        iAccount: id,
        reason: 'Account is linked to a platform company and is not untracked. Refusing to delete it.',
      });
      continue;
    }
    if (seen.has(id)) continue; // a repeat is not a second deletion
    seen.add(id);
    deletable.push(id);
  }

  return { deletable, refused };
}
