/**
 * increment-change.ts — changing a destination's billing increment on a promised date.
 *
 * A billing increment is a commercial term, not a switch detail. Changing 60/1 to 30/6 changes
 * what every call on that destination costs, so it is announced to customers with a date and it
 * takes effect on that date — not when someone edits a form.
 *
 * THREE RULES THIS MODULE KEEPS.
 *
 * 1. **The date clients are told is the date the switch changes.** One `effective_date` drives
 *    both the notification and the mutation. There is no second date anywhere.
 *
 * 2. **Before that date, nothing changes.** `resolveEffectiveIncrement` returns the PREVIOUS
 *    increment right up to the day before, so a scheduled change cannot leak into today's push.
 *
 * 3. **Commercial truth and switch state are answered separately.** The resolver says what
 *    SHOULD be in force. Whether Sippy actually holds it is `applied_at`, and the gap between
 *    them is a real operational fact rather than something to smooth over.
 */
import { parseBillingIncrement, formatBillingIncrement, type BillingIncrement } from './billing-increment';

export type IncrementChangeStatus = 'accepted' | 'notified' | 'applied' | 'cancelled' | 'failed';

export interface IncrementChange {
  id?: number;
  productId: number;
  destinationId: number;
  catalogueVersionId: number;
  previousIncrement: string | null;
  newIncrement: string;
  /** YYYY-MM-DD. The commercial contract date. */
  effectiveDate: string;
  status: IncrementChangeStatus;
  appliedAt?: string | null;
  notifiedAt?: string | null;
}

export type ValidationOutcome =
  | { ok: true; normalised: string; parsed: BillingIncrement }
  | { ok: false; code: ValidationCode; message: string };

export type ValidationCode =
  | 'unreadable'
  | 'no_change'
  | 'effective_date_missing'
  | 'effective_date_malformed'
  | 'effective_date_in_past';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a proposed change BEFORE it is accepted, notified or scheduled.
 *
 * Every refusal here happens before any record exists, so nothing is emailed and nothing is
 * scheduled. That ordering is the point: a change that cannot be delivered must never become a
 * promise to a customer.
 */
export function validateIncrementChange(input: {
  currentIncrement: string | null | undefined;
  newIncrement: string | null | undefined;
  effectiveDate: string | null | undefined;
  /** YYYY-MM-DD. Injected so the rule does not depend on the clock of the machine running it. */
  today: string;
}): ValidationOutcome {
  const parsed = parseBillingIncrement(input.newIncrement);
  if (!parsed) {
    return {
      ok: false, code: 'unreadable',
      message: `"${input.newIncrement ?? ''}" is not a usable billing increment. `
             + `Use seconds as N/M — first interval over subsequent interval, e.g. 60/1 or 30/6. `
             + `Both must be between 1 and 3600.`,
    };
  }
  const normalised = formatBillingIncrement(parsed);

  // Compare on the PARSED value, so "60 / 1" and "60/1" are recognised as the same term and do
  // not generate a notification about a change in spacing.
  const current = parseBillingIncrement(input.currentIncrement);
  if (current && formatBillingIncrement(current) === normalised) {
    return {
      ok: false, code: 'no_change',
      message: `The billing increment is already ${normalised}. Nothing would change, and `
             + `clients would be notified about a change that is not one.`,
    };
  }

  if (!input.effectiveDate) {
    return {
      ok: false, code: 'effective_date_missing',
      message: 'A billing increment change needs an effective date: it is the date clients are '
             + 'told, and the date the switch is changed. There is no "immediately" here.',
    };
  }
  if (!DATE_PATTERN.test(input.effectiveDate)) {
    return { ok: false, code: 'effective_date_malformed', message: `Effective date must be YYYY-MM-DD, got "${input.effectiveDate}".` };
  }
  if (input.effectiveDate < input.today) {
    // A past date cannot be honoured: the notification would announce a change that already
    // should have happened, and the switch would be changed late by definition.
    return {
      ok: false, code: 'effective_date_in_past',
      message: `Effective date ${input.effectiveDate} is in the past (today is ${input.today}). `
             + `A change cannot take effect before it is announced.`,
    };
  }

  return { ok: true, normalised, parsed };
}

export interface ResolvedIncrement {
  /** What is in force on `asOf`. Null when nothing readable applies. */
  increment: BillingIncrement | null;
  /** Where it came from — the catalogue, or an accepted change that has reached its date. */
  source: 'catalogue' | 'change' | 'none';
  /** The change that supplied it, when one did. */
  changeId?: number;
  /**
   * True when a change has reached its effective date but the switch has NOT been updated.
   * The commercial position and the switch disagree, and an operator needs to know.
   */
  awaitingApplication?: boolean;
  /** The next change that has NOT yet taken effect, if any — what is coming, and when. */
  scheduled?: { changeId?: number; increment: string; effectiveDate: string };
}

/**
 * Which billing increment is in force for a product/destination on a given date.
 *
 * The catalogue value is the base. Accepted changes override it once their effective date has
 * arrived; the latest such change wins. Cancelled changes are ignored entirely, and a change
 * whose date has not arrived is reported as `scheduled` rather than applied — that separation is
 * rule 2, and it is what stops tomorrow's promise from being pushed today.
 */
export function resolveEffectiveIncrement(
  catalogueIncrement: string | null | undefined,
  changes: IncrementChange[],
  asOf: string,
): ResolvedIncrement {
  const live = changes.filter(c => c.status !== 'cancelled' && c.status !== 'failed');

  const inForce = live
    .filter(c => c.effectiveDate <= asOf)
    .sort((a, b) => a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : (a.id ?? 0) - (b.id ?? 0));

  const upcoming = live
    .filter(c => c.effectiveDate > asOf)
    .sort((a, b) => a.effectiveDate < b.effectiveDate ? -1 : 1)[0];

  const scheduled = upcoming
    ? { changeId: upcoming.id, increment: upcoming.newIncrement, effectiveDate: upcoming.effectiveDate }
    : undefined;

  const winner = inForce[inForce.length - 1];
  if (winner) {
    const parsed = parseBillingIncrement(winner.newIncrement);
    return {
      increment: parsed,
      source: 'change',
      changeId: winner.id,
      // Its date has arrived. If the switch has not been told, say so rather than implying the
      // two agree.
      awaitingApplication: winner.status !== 'applied',
      scheduled,
    };
  }

  const base = parseBillingIncrement(catalogueIncrement);
  return { increment: base, source: base ? 'catalogue' : 'none', scheduled };
}

/** Changes whose effective date has arrived and which the switch has not yet been given. */
export function changesDueForApplication(changes: IncrementChange[], asOf: string): IncrementChange[] {
  return changes
    .filter(c => (c.status === 'accepted' || c.status === 'notified') && c.effectiveDate <= asOf)
    .sort((a, b) => a.effectiveDate < b.effectiveDate ? -1 : 1);
}

/**
 * The sentence clients are told. Built here rather than in a template so the date and the
 * increment in the email are the same values the switch mutation will use — a notification
 * composed from different variables is how the two drift apart.
 */
export function describeChangeForNotification(c: {
  destinationName: string; previousIncrement: string | null; newIncrement: string; effectiveDate: string;
}): string {
  const from = c.previousIncrement ? ` from ${c.previousIncrement}` : '';
  return `The billing increment for ${c.destinationName} changes${from} to ${c.newIncrement}, `
       + `effective ${c.effectiveDate}. Calls on this destination are charged on the new increment `
       + `from that date.`;
}
