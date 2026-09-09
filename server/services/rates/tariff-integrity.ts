/**
 * tariff-integrity.ts
 *
 * Refuses a rate push when the tariff Sippy would actually write to is not the tariff this
 * platform provisioned for that customer.
 *
 * WHY THIS EXISTS. On 2026-09-08 an authorised test push aimed at tariff 61 (a test company's
 * provisioned tariff) was sent to **tariff 2 — a live customer's tariff shared by fifteen
 * accounts**. Nothing was written, but only because tariff 2 happened to be locked at that
 * moment. Rate Manager resolves the destination from the Sippy account's live billing plan;
 * nothing checked that the result was the customer's own tariff.
 *
 * It is not the resolver that is wrong. On this Sippy build the service-plan step cannot run
 * (no `createServicePlan()`, portal INSERT denied), so accounts are created without their
 * provisioned plan and Sippy assigns a shared default. 22 of 26 companies are in that state.
 * Until that operational dependency clears, "the account's live tariff" and "the customer's
 * tariff" are different things, and a push that trusts the first can move billing for every
 * other account sharing it.
 *
 * So this compares them and refuses on any doubt. A NULL stored tariff refuses too: absent an
 * intended value there is nothing to verify against, and "we could not check" must not read as
 * "safe" — that conflation is the whole failure mode.
 */

export type TariffIntegrityVerdict =
  | { safe: true;  storedITariff: number; resolvedITariff: number }
  | { safe: false; reason: 'no_stored_tariff' | 'mismatch' | 'unresolved'; message: string;
      storedITariff: number | null; resolvedITariff: number | null };

export interface TariffIntegrityInput {
  accountName: string;
  /** `company.sippyITariff` — what provisioning built for this customer. */
  storedITariff: number | null | undefined;
  /** What push-batch resolved from Sippy (account -> billing plan -> tariff). */
  resolvedITariff: number | string | null | undefined;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Allows a push ONLY when both tariffs are known and identical.
 *
 * Deliberately strict in all three failure directions, because each one is a way a rate can
 * land on a tariff the customer does not bill on — or worse, one that other customers do.
 */
export function checkTariffIntegrity(input: TariffIntegrityInput): TariffIntegrityVerdict {
  const stored   = toNum(input.storedITariff);
  const resolved = toNum(input.resolvedITariff);

  if (resolved === null) {
    return {
      safe: false, reason: 'unresolved', storedITariff: stored, resolvedITariff: null,
      message: `${input.accountName}: could not resolve which Sippy tariff this account bills on — refusing to push, because the destination of the write is unknown`,
    };
  }

  if (stored === null) {
    return {
      safe: false, reason: 'no_stored_tariff', storedITariff: null, resolvedITariff: resolved,
      message: `${input.accountName}: no provisioned tariff is recorded for this customer, so the tariff Sippy resolved (${resolved}) cannot be confirmed as theirs — refusing to push. A shared default tariff would carry this rate to every other account on it.`,
    };
  }

  if (stored !== resolved) {
    return {
      safe: false, reason: 'mismatch', storedITariff: stored, resolvedITariff: resolved,
      message: `${input.accountName}: provisioned tariff is ${stored} but Sippy bills this account on ${resolved} — refusing to push. Writing to ${resolved} would price a tariff this customer does not own; writing to ${stored} would price a tariff they do not use.`,
    };
  }

  return { safe: true, storedITariff: stored, resolvedITariff: resolved };
}
