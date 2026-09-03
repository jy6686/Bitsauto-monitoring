/**
 * collection-lifecycle.ts — which customers does tonight's collection cover?
 *
 * THE OWNER'S RULE, verbatim in effect:
 *
 *   Active     collect nightly · DMR · snapshot · invoice
 *   Inactive   collect an OUTSTANDING day · DMR · snapshot · invoice HELD
 *   Dormant    no new collection · historical reports only · no new invoices
 *
 *   "If an account becomes Inactive after generating traffic, finish
 *    collecting and billing the outstanding business day before excluding it
 *    from future collection."
 *
 * ── Why this module exists at all ──────────────────────────────────────────
 * Today `_accountsForCollection()` selects EVERY company with a Sippy account
 * id and consults status nowhere. That is accidentally safe: a customer
 * blocked mid-day for exhausted credit is still collected, because nothing
 * asks whether they are blocked. Sippy keeps the CDRs for calls that already
 * completed; blocking stops new calls, not history.
 *
 * So the danger is not the current behaviour — it is the obvious "fix".
 * Adding `WHERE status = 'active'` would CREATE the data loss this policy is
 * meant to prevent: a customer who burns $2,000 at 11:00 and is switched to
 * Inactive at 11:06 would drop out of the schedule that same night, and the
 * $2,000 of billable traffic already sitting on the switch would never be
 * collected. The invoice would be for zero.
 *
 * That is why the outstanding-day exception is not a nicety bolted on
 * afterwards. It is the reason the filter can be introduced at all.
 *
 * ── Why a change DATE is required ──────────────────────────────────────────
 * Without one, "outstanding" means "every day never collected", so a Dormant
 * customer would be queued every single night forever — the opposite of
 * excluding them, and the reason migration 506 exists. With it the rule is
 * exact and it terminates: a non-Active account is collected only for unsealed
 * days on or before the day its lifecycle changed.
 *
 * ── Unclassified is not Inactive ───────────────────────────────────────────
 * A null or empty status reads as ACTIVE, matching the rule the Rate Manager's
 * own client list already follows. Only Active can afford to be the bucket
 * that holds things nobody has classified yet; treating unclassified as
 * inactive would silently stop collecting for every customer predating the
 * lifecycle feature.
 *
 * Pure: no DB, no clock, no environment. The caller supplies the evidence.
 */

export type Lifecycle = 'active' | 'inactive' | 'dormant';

/** What the nightly scheduler should do with one account. */
export type CollectAction =
  /** Normal nightly collection — the account is operational. */
  | 'collect'
  /** Collect only because a day it already owes is unsealed. */
  | 'collect_outstanding'
  /** Nothing to do tonight. */
  | 'skip';

/** What may happen to an invoice for this account. */
export type InvoicePolicy =
  /** Draft and allow the normal review-and-send flow. */
  | 'allow'
  /** Draft, but hold for a person — never queue it for dispatch. */
  | 'hold'
  /** Do not raise a new invoice at all. */
  | 'none';

export interface AccountLifecycleInput {
  /** companies.status verbatim. The Rate Manager owns this word. */
  status?: string | null;
  /** companies.lifecycle_changed_at, ISO. Null when never changed. */
  lifecycleChangedAtIso?: string | null;
  /** The business day the scheduler is about to collect, YYYY-MM-DD. */
  targetDay: string;
  /**
   * Has this account already got a completed collection for targetDay? The
   * caller looks this up; the policy never guesses, because guessing "already
   * collected" is how a billable day gets skipped.
   */
  daySealed?: boolean;
}

export interface AccountLifecycleDecision {
  lifecycle: Lifecycle;
  /** True when the status field was absent and defaulted to active. */
  unclassified: boolean;
  action: CollectAction;
  collect: boolean;
  invoice: InvoicePolicy;
  /** One line naming the rule that produced this, for the log and the panel. */
  reason: string;
}

export function normaliseLifecycle(status?: string | null): { lifecycle: Lifecycle; unclassified: boolean } {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'inactive') return { lifecycle: 'inactive', unclassified: false };
  if (s === 'dormant')  return { lifecycle: 'dormant',  unclassified: false };
  if (s === 'active')   return { lifecycle: 'active',   unclassified: false };
  // Anything else — null, empty, or a word this platform does not use — is
  // UNCLASSIFIED and treated as active. See the header: only active can hold
  // what nobody has classified yet.
  return { lifecycle: 'active', unclassified: true };
}

/** UTC day key of an ISO timestamp, or null when unparseable. */
function dayOf(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

export function decideAccountCollection(input: AccountLifecycleInput): AccountLifecycleDecision {
  const { lifecycle, unclassified } = normaliseLifecycle(input.status);
  const changedDay = dayOf(input.lifecycleChangedAtIso);
  const sealed = input.daySealed === true;

  const invoice: InvoicePolicy =
    lifecycle === 'active'   ? 'allow'
    : lifecycle === 'inactive' ? 'hold'
    : 'none';

  // ── Active (and unclassified) — the normal path ─────────────────────────
  if (lifecycle === 'active') {
    if (sealed) {
      return { lifecycle, unclassified, action: 'skip', collect: false, invoice,
               reason: `${input.targetDay} already collected` };
    }
    return { lifecycle, unclassified, action: 'collect', collect: true, invoice,
             reason: unclassified
               ? 'Unclassified customer — collected as active until the Rate Manager classifies it'
               : 'Active customer — normal nightly collection' };
  }

  // ── Inactive / Dormant — outstanding days only ──────────────────────────
  if (sealed) {
    return { lifecycle, unclassified, action: 'skip', collect: false, invoice,
             reason: `${lifecycle} and ${input.targetDay} already collected` };
  }

  // No change date recorded. This is the case that must fail SAFE: the
  // account predates migration 506, or was set without a stamp, and we cannot
  // tell whether the target day falls before or after its retirement. Refusing
  // to collect would risk dropping billable traffic, which is the failure this
  // whole policy exists to prevent — so an unsealed day is collected and the
  // reason says why the decision was made on incomplete evidence.
  if (!changedDay) {
    return { lifecycle, unclassified, action: 'collect_outstanding', collect: true, invoice,
             reason: `${lifecycle} with no recorded change date — collecting unsealed ` +
                     `${input.targetDay} rather than risk dropping billable traffic` };
  }

  // The rule, exactly: days ON OR BEFORE the change are still owed; days after
  // it are not, because the customer was already retired by then.
  if (input.targetDay <= changedDay) {
    return { lifecycle, unclassified, action: 'collect_outstanding', collect: true, invoice,
             reason: `${lifecycle} since ${changedDay} — ${input.targetDay} is an outstanding ` +
                     'day from while it was still trading' };
  }

  return { lifecycle, unclassified, action: 'skip', collect: false, invoice,
           reason: `${lifecycle} since ${changedDay} — ${input.targetDay} is after retirement, ` +
                   'no traffic expected' };
}

// ── Roll-up for the scheduler and the panel ────────────────────────────────

export interface LifecyclePlanAccount<T> {
  account: T;
  decision: AccountLifecycleDecision;
}

export interface LifecyclePlan<T> {
  /** Accounts to collect tonight, in the caller's original order. */
  collect: Array<LifecyclePlanAccount<T>>;
  /** Accounts deliberately not collected, with the reason each. */
  skipped: Array<LifecyclePlanAccount<T>>;
  counts: {
    active: number; inactive: number; dormant: number; unclassified: number;
    /** Collected ONLY because they still owe a day. The number worth watching:
     *  it should trend to zero, and a persistent non-zero means retirements
     *  are happening mid-day and the exception is doing real work. */
    outstanding: number;
  };
  /** One line for the nightly log. */
  summary: string;
}

export function planByLifecycle<T>(
  accounts: T[],
  read: (a: T) => AccountLifecycleInput,
): LifecyclePlan<T> {
  const collect: Array<LifecyclePlanAccount<T>> = [];
  const skipped: Array<LifecyclePlanAccount<T>> = [];
  const counts = { active: 0, inactive: 0, dormant: 0, unclassified: 0, outstanding: 0 };

  for (const account of accounts) {
    const decision = decideAccountCollection(read(account));
    counts[decision.lifecycle]++;
    if (decision.unclassified) counts.unclassified++;
    if (decision.action === 'collect_outstanding') counts.outstanding++;
    (decision.collect ? collect : skipped).push({ account, decision });
  }

  const parts = [
    `${collect.length} to collect`,
    counts.outstanding > 0 ? `${counts.outstanding} outstanding-day` : null,
    `${skipped.length} skipped`,
    `(${counts.active} active, ${counts.inactive} inactive, ${counts.dormant} dormant`,
  ].filter(Boolean);
  const summary = `${parts.join(' · ')}` +
    (counts.unclassified > 0 ? `, ${counts.unclassified} unclassified→active)` : ')');

  return { collect, skipped, counts, summary };
}
