/**
 * auth-rule-vocab.ts — the two lookup tables both authentication planners share.
 *
 * Moved out of auth-rule-set.ts (frozen) on 2026-09-15 so the breakout planner can use the
 * same tables without importing the frozen module (which would make the two modules import
 * each other). Values unchanged.
 */

/** Product name → Sippy product digit. Platform-wide, mirrors PRODUCT_CLASSES in
 *  client/src/pages/products.tsx and the product_prefixes seed (1=FC 2=BC 6=SB 7=SC).
 *  Keyed on the names migration 038 seeds into routing_package_entries.product. */
export const PRODUCT_DIGIT_BY_NAME: Record<string, string> = {
  'first class':     '1',
  'business class':  '2',
  'special bravo':   '6',
  'special charlie': '7',
};

/** Country → E.164 country code. Mirrors DESTINATIONS in auth-studio.tsx. */
export const COUNTRY_CODE: Record<string, string> = {
  pakistan: '92', india: '91', bangladesh: '880', 'sri lanka': '94', nepal: '977',
  uae: '971', 'saudi arabia': '966', uk: '44', 'united kingdom': '44',
  usa: '1', 'usa / canada': '1', afghanistan: '93', kenya: '254', nigeria: '234',
};

/**
 * Display spellings for the two vocabularies, keyed the same way. A routing-package row
 * is written with these so the grid reads "Afghanistan / First Class", never
 * "afghanistan / first class"; both planners lowercase before looking up, so the spelling
 * is presentation only.
 */
export const COUNTRY_DISPLAY: Record<string, string> = {
  pakistan: 'Pakistan', india: 'India', bangladesh: 'Bangladesh', 'sri lanka': 'Sri Lanka', nepal: 'Nepal',
  uae: 'UAE', 'saudi arabia': 'Saudi Arabia', uk: 'UK', 'united kingdom': 'United Kingdom',
  usa: 'USA', 'usa / canada': 'USA / Canada', afghanistan: 'Afghanistan', kenya: 'Kenya', nigeria: 'Nigeria',
};
export const PRODUCT_DISPLAY: Record<string, string> = {
  'first class': 'First Class', 'business class': 'Business Class',
  'special bravo': 'Special Bravo', 'special charlie': 'Special Charlie',
};

/**
 * A routing-package cell an operator wants to add, checked against the vocabulary both
 * planners can resolve. A country the planners cannot turn into a dial code, or a product
 * with no digit, would be a cell that maps a routing group to nothing.
 */
export function canonicalCell(input: { country?: unknown; product?: unknown }):
  | { ok: true; country: string; product: string; countryCode: string; productDigit: string }
  | { ok: false; error: string } {
  const c = String(input.country ?? '').trim().toLowerCase();
  const p = String(input.product ?? '').trim().toLowerCase();
  if (!c) return { ok: false, error: 'country is required.' };
  if (!p) return { ok: false, error: 'product is required.' };
  const countryCode = COUNTRY_CODE[c];
  if (!countryCode) return { ok: false, error: `"${String(input.country).trim()}" is not a country the authentication planner can resolve. Known: ${Object.values(COUNTRY_DISPLAY).join(', ')}.` };
  const productDigit = PRODUCT_DIGIT_BY_NAME[p];
  if (!productDigit) return { ok: false, error: `"${String(input.product).trim()}" is not a product with a Sippy digit. Known: ${Object.values(PRODUCT_DISPLAY).join(', ')}.` };
  return { ok: true, country: COUNTRY_DISPLAY[c], product: PRODUCT_DISPLAY[p], countryCode, productDigit };
}
