/**
 * billing-fallback.ts — where an invoice goes when the customer has no
 * billing email, and how that send is kept distinguishable from a real one.
 *
 * OWNER RULE (2026-09-07): a missing billing email must not block invoicing.
 * Send the invoice to a fallback recipient instead — but as a REVIEW COPY that
 * Finance can tell apart from a customer delivery, so that when the customer's
 * address is added later the invoice is sent to them properly. Sixteen of
 * twenty-five billed clients had no billing email on the day the rule was set.
 *
 * Three properties, each of which the tests pin:
 *   1. The fallback is read from the environment (BILLING_FALLBACK_RECIPIENT),
 *      never from source. It is a person's address.
 *   2. A customer WITH recipients is never touched — the fallback only fills
 *      an empty list, and only when one is configured.
 *   3. A review copy is marked in the subject, in the body, and in the
 *      delivery row's intended-recipients field. The caller must also refuse
 *      to move the invoice to `sent`: a copy to Finance is not delivery.
 *
 * Pure: no I/O. The email service and the two send paths call it.
 */

export const FALLBACK_ENV = 'BILLING_FALLBACK_RECIPIENT';
export const REVIEW_COPY_PREFIX = '[REVIEW COPY]';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The configured fallback, or null when unset, blank or not an address. */
export function fallbackRecipient(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env[FALLBACK_ENV] ?? '').trim();
  return EMAIL.test(v) ? v : null;
}

export interface ReviewCopy {
  /** Why this went to the fallback. Written into the delivery row. */
  reason: string;
  fallbackTo: string;
}

export interface DeliveryPlan {
  recipients: string[];
  /** Null for an ordinary send to the customer's own addresses. */
  reviewCopy: ReviewCopy | null;
}

/**
 * Decide who receives the invoice. `source` is the client-master lookup's own
 * description of where it looked (it is recorded verbatim in the reason).
 */
export function planDelivery(opts: {
  recipients: readonly string[]; source: string; fallback: string | null;
}): DeliveryPlan {
  const own = opts.recipients.map(r => r.trim()).filter(Boolean);
  if (own.length > 0) return { recipients: own, reviewCopy: null };
  if (!opts.fallback) return { recipients: [], reviewCopy: null };
  return {
    recipients: [opts.fallback],
    reviewCopy: {
      fallbackTo: opts.fallback,
      reason: `Customer billing email not configured (${opts.source}). Review copy sent to the finance ` +
              `fallback ${opts.fallback} — NOT delivered to the customer. Add the customer's billing email, ` +
              'then send again.',
    },
  };
}

/**
 * Mark subject and body. Idempotent: a subject already prefixed is left alone,
 * so a retry cannot stack "[REVIEW COPY] [REVIEW COPY]".
 */
export function markReviewCopy(subject: string, body: string, rc: ReviewCopy): { subject: string; body: string } {
  const s = subject.startsWith(REVIEW_COPY_PREFIX) ? subject : `${REVIEW_COPY_PREFIX} ${subject}`;
  const banner = `*** REVIEW COPY — ${rc.reason} ***`;
  const b = body.startsWith('*** REVIEW COPY') ? body : `${banner}\n\n${body}`;
  return { subject: s, body: b };
}
