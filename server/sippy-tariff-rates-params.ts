/**
 * sippy-tariff-rates-params.ts — the parameter struct for Sippy's
 * getTariffRatesList, built from what a caller passed.
 *
 * Pure, so it is testable, and so the XML-RPC call can never carry a value
 * Sippy rejects. On 2026-09-14 the company card's tariff panel returned 500
 * for every company: its caller wrote `getTariffRatesListFull(u, p, id, {},
 * portalUrl)` against a signature of `(u, p, id, offset?, limit?, iCustomer?,
 * portalUrl?)`, so an empty object went out as `offset` and Sippy answered
 * "offset: Input should be a valid integer". A second caller passed
 * `undefined, 0, 1000` and so asked for one rate of customer 1000.
 *
 * Rule: a paging or customer value is sent only when it is a finite integer;
 * anything else — an object, a string, NaN, undefined — is simply not sent,
 * which is what "no offset" means to Sippy. `limit` keeps its historical
 * clamp to 1..1000.
 */

export type TariffRatesArgs = {
  iTariff: number;
  offset?: unknown;
  limit?: unknown;
  iCustomer?: unknown;
};

/** Keys are only ever i_tariff, offset, limit, i_customer — and only present when set. */
export type TariffRatesParams = Record<string, number>;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function tariffRatesParams(a: TariffRatesArgs): TariffRatesParams {
  const p: TariffRatesParams = { i_tariff: a.iTariff };
  if (isInt(a.offset) && a.offset >= 0) p.offset = a.offset;
  if (isInt(a.limit))                   p.limit  = Math.min(Math.max(1, a.limit), 1000);
  if (isInt(a.iCustomer))               p.i_customer = a.iCustomer;
  return p;
}
