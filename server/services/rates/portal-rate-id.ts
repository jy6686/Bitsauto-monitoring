/**
 * portal-rate-id.ts
 *
 * Decides which Sippy `i_rate` a portal "add a new prefix" operation may use.
 *
 * WHY THIS EXISTS. On 2026-09-09 a push of a NEW prefix (9370 -> 19370) to Test-31's tariff 64
 * overwrote the tariff's existing rate instead of creating one. The add path scraped an
 * `i_rate` out of Sippy's page with three fallbacks, the second being `/[?&]i_rate=(\d+)/i` —
 * which matches ANY edit link on the page. Tariff 64 had exactly one, `i_rate=9115` (prefix
 * `191`), so that id went into `action=change` and Sippy rewrote the row: prefix `191` -> the
 * new `19370`, price 0.02 -> 0.133, same iRate, same activation date. `191 @ 0.02` was lost.
 *
 * The same request against PUSHTOTALK's shared tariff 2 the day before would have done the same
 * to a live customer's rate. It did not only because that tariff happened to be locked.
 *
 * So: a candidate id is accepted ONLY from a real form field, and ONLY if it is not already in
 * use by a rate in this tariff. A guess is refused, because on this path a wrong id is not a
 * failed add — it is a silent edit of somebody else's price.
 */

export type RateIdDecision =
  | { ok: true;  iRate: number }
  | { ok: false; reason: 'no_form_field' | 'collides_with_existing'; message: string; candidate?: number };

/**
 * Sippy's add form carries the reserved id as a real input. Only this shape is trusted —
 * a bare `i_rate=N` anywhere in the page is an EXISTING rate's link, not a new id.
 */
// The name must END at i_rate. An optional closing quote also matched `i_rate_old`, which is
// a different field entirely — caught by its own test before this shipped.
const NAME_IS_I_RATE = `\\bname=(?:"i_rate"|'i_rate'|i_rate(?=[\\s>]))`;
const FORM_FIELD     = new RegExp(`<input[^>]*${NAME_IS_I_RATE}[^>]*\\bvalue=["'](\\d+)["']`, 'i');
/** Same field with the attribute order reversed, which Sippy also emits. */
const FORM_FIELD_ALT = new RegExp(`<input[^>]*\\bvalue=["'](\\d+)["'][^>]*${NAME_IS_I_RATE}`, 'i');

/**
 * @param formHtml      the add-form page returned by Sippy
 * @param existingIRates every i_rate already present in this tariff — the collision set
 */
export function resolveNewRateId(
  formHtml: string,
  existingIRates: ReadonlyArray<number>,
): RateIdDecision {
  const m = FORM_FIELD.exec(formHtml ?? '') ?? FORM_FIELD_ALT.exec(formHtml ?? '');
  if (!m) {
    return {
      ok: false, reason: 'no_form_field',
      message: 'Sippy\'s add form did not return an i_rate field. Refusing to guess one: on this path a wrong id silently edits an existing rate instead of failing.',
    };
  }

  const candidate = parseInt(m[1], 10);
  if (!Number.isInteger(candidate) || candidate <= 0) {
    return { ok: false, reason: 'no_form_field', message: `Sippy's add form returned an unusable i_rate ("${m[1]}").` };
  }

  if (existingIRates.some(id => Number(id) === candidate)) {
    return {
      ok: false, reason: 'collides_with_existing', candidate,
      message: `Refusing to add: the id Sippy's form offered (i_rate=${candidate}) is already used by an existing rate in this tariff. Submitting it would overwrite that rate rather than create a new one — the defect that destroyed 191 @ 0.02 on tariff 64.`,
    };
  }

  return { ok: true, iRate: candidate };
}
