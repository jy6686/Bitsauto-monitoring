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
