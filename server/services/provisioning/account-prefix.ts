/**
 * account-prefix.ts — allocation of the canonical 4-digit customer identifier.
 *
 * The prefix is the one value Sippy authentication, CLD translation, routing and product
 * selection can all key off. It is allocated by the platform, never typed by an operator,
 * and never changed once issued: it ends up inside Sippy auth rules and CLD rules, so
 * altering it orphans a live customer's routing.
 *
 * Allocation is a Postgres SEQUENCE (migration 049), not max(prefix)+1, for two reasons
 * that both matter in production:
 *
 *   • nextval() is atomic, so two companies created in the same instant cannot collide.
 *     A read-then-write allocator has a race that only shows up under load, which is
 *     exactly when a duplicate identifier is most expensive to unpick.
 *
 *   • A sequence never returns a value twice. Deleting a company must NOT free its prefix
 *     for reuse — a reissued prefix silently routes a new customer's traffic under a
 *     retired customer's identity. Reuse is the failure worth engineering against.
 *
 * The sequence is bounded 1001–9999 and does not cycle, so exhaustion raises rather than
 * wrapping. That is a real capacity decision (widen to five digits), not something to
 * resolve by handing out a used prefix.
 */
import { pool } from "../../db";

/** Thrown when the prefix space is exhausted — 8999 customers. Distinct from a
 *  transient database error so the caller can report it as the capacity limit it is. */
export class PrefixSpaceExhaustedError extends Error {
  constructor() {
    super('The 4-digit account prefix space (1001-9999) is exhausted. Widen the prefix format — do not reissue retired prefixes.');
    this.name = 'PrefixSpaceExhaustedError';
  }
}

/**
 * Take the next prefix. Each call consumes one value whether or not the caller goes on
 * to use it — gaps in the sequence are expected and harmless, reuse is not.
 *
 * SKIPS VALUES ALREADY HELD BY A COMPANY. Two things put taken numbers in the sequence's
 * path: 049 adopts legacy prefixes without consuming them from the sequence, and 051
 * rewinds the sequence to the lowest free value, after which it walks upward through a
 * range where some numbers are already in use. Without the skip, allocation returns a
 * duplicate and the caller hits the partial unique index with a raw constraint error.
 *
 * The skip does not weaken the never-reissue guarantee: a value that ever reached a
 * company is in `companies` and is exactly what this excludes.
 */
export async function allocateAccountPrefix(): Promise<string> {
  // Bounded rather than unbounded: on a nearly-full space this would otherwise walk
  // thousands of taken values one round trip at a time. Hitting the cap means the space
  // is dense enough to need widening, which is the same conversation as exhaustion.
  const MAX_ATTEMPTS = 100;
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { rows } = await pool.query<{ prefix: string; taken: boolean }>(
        `WITH candidate AS (SELECT lpad(nextval('account_prefix_seq')::TEXT, 4, '0') AS prefix)
         SELECT c.prefix,
                EXISTS (SELECT 1 FROM companies WHERE account_prefix = c.prefix) AS taken
           FROM candidate c`,
      );
      const prefix = rows[0]?.prefix;
      if (!prefix || !/^\d{4}$/.test(prefix)) {
        throw new Error(`account_prefix_seq produced an invalid value: ${String(prefix)}`);
      }
      if (!rows[0].taken) return prefix;
    }
    throw new Error(`${MAX_ATTEMPTS} consecutive sequence values were already allocated — the 4-digit prefix space is nearly full.`);
  } catch (err: any) {
    // Postgres raises 2200H (sequence_generator_limit_exceeded) at MAXVALUE with NO CYCLE.
    if (err?.code === '2200H' || /reached maximum value/i.test(err?.message ?? '')) {
      throw new PrefixSpaceExhaustedError();
    }
    throw err;
  }
}

/** Product digits, platform-wide — NOT per customer. Mirrors PRODUCT_CLASSES in
 *  client/src/pages/products.tsx and the product_prefixes seed (1=FC, 2=BC, 6=SB, 7=SC). */
export const PRODUCT_DIGITS = { FC: '1', BC: '2', SB: '6', SC: '7' } as const;
export type ProductDigit = (typeof PRODUCT_DIGITS)[keyof typeof PRODUCT_DIGITS];

export type AuthRuleFields = {
  /** Incoming CLD/DNIS wildcard the rule matches, e.g. "5135192*". */
  incomingCld: string;
  /** Translation applied on match, e.g. "s/^5135192/192/" — strips the customer prefix
   *  so the routing group sees {product}{cc}, which is what it routes on. */
  cldTranslationRule: string;
  /** Exact caller-prefix match, no wildcard. */
  incomingCli: string;
};

/**
 * Build one authentication rule's CLD fields from the triple the switch actually uses:
 *
 *     {account_prefix}{product_digit}{country_code}
 *
 * Verified against a live account: "flashbee" carries twelve rules, all derived from the
 * single prefix 5135 — 5135192* → s/^5135192/192/ (First Class, Pakistan), 5135880* →
 * Bangladesh, and so on. One rule per product x destination.
 *
 * This is the server-side counterpart of the builders in client/src/pages/auth-studio.tsx,
 * which have been used to push rules by hand. Deliberately identical output: the
 * provisioning engine must produce rules indistinguishable from the ones already in
 * production, not a second dialect of the same convention.
 *
 * NOT stored on the company. A CLD rule is a property of a rule, not of a customer — the
 * only per-customer part is the prefix.
 */
export function buildAuthRuleFields(
  accountPrefix: string,
  productDigit: string,
  countryCode: string,
): AuthRuleFields {
  if (!/^\d{4}$/.test(accountPrefix)) {
    throw new Error(`buildAuthRuleFields requires a 4-digit account prefix, got "${accountPrefix}"`);
  }
  if (!/^\d+$/.test(productDigit)) {
    throw new Error(`product digit must be numeric, got "${productDigit}"`);
  }
  if (!/^\d+$/.test(countryCode)) {
    throw new Error(`country code must be numeric, got "${countryCode}"`);
  }
  const combined = `${accountPrefix}${productDigit}${countryCode}`;
  const stripped = `${productDigit}${countryCode}`;
  return {
    incomingCld:        `${combined}*`,
    cldTranslationRule: `s/^${combined}/${stripped}/`,
    incomingCli:        combined,
  };
}
