/**
 * rate-sheet-model.ts — the rows and header of a customer rate sheet, as data.
 *
 * Pure: no database, no workbook library. It turns effective prices plus their
 * catalogue expansions into exactly the rows a customer may see, and refuses
 * — by name — anything it cannot name.
 *
 * WHY THIS EXISTS. The sheet 1global received on 2026-09-14 carried two rows
 * reading `null` / `+null`. The old builder resolved destination names by
 * joining legacy prefix tables on `product_rates.prefix`, which catalogue-
 * keyed prices leave empty, so a price with no legacy prefix became a row with
 * no name and no prefix. Here a catalogue-keyed price contributes one row per
 * prefix of its destination, named from the catalogue, and any expansion the
 * catalogue refuses (stale version, not eligible, unknown destination) is
 * reported in `excluded` instead of reaching the customer.
 */
import type { Expansion, ExpandableRate } from '../rates/rate-prefix-expansion';
import { REFUSED_VERDICTS } from '../rates/rate-prefix-expansion';

export type PricedRate = ExpandableRate & {
  productCode: string;
  productDigit: string;
  rate: string | number;
  currency: string | null;
  /** YYYY-MM-DD */
  effectiveFrom: string;
};

/** One line of the customer sheet. Every field is display-ready text except `rate`. */
export type RateSheetRow = {
  country: string;
  destination: string;
  prefix: string;
  rate: number;
  /** Reference legend: N new · NC no change · I increase · D decrease · PI/PD pending · B block · R removed · DC destination change. */
  status: 'N' | 'NC' | 'I' | 'D' | 'PI' | 'PD' | 'B' | 'R' | 'DC';
  billingIncrement: string;
  /** DD-Mon-YYYY, as the reference prints it. */
  effectiveDate: string;
  effectiveTime: string;
};

export type RateSheetHeader = {
  companyName: string;
  productLabel: string;
  sendDate: string;
  sendTime: string;
  increaseEffectiveDate: string;
  decreaseEffectiveDate: string;
  technicalPrefix: string;
  kamName: string;
  kamEmail: string;
};

export type RateSheetModel = {
  header: RateSheetHeader;
  rows: RateSheetRow[];
  /** Sheet footer paragraphs, printed under "TERMS AND CONDITIONS". */
  terms: string[];
};

/**
 * Printed under TERMS AND CONDITIONS at the foot of the sheet. Same commitments the
 * covering email already makes (FULL semantics, the authorised pricing address), so the
 * attachment cannot say something the email does not.
 */
export const RATE_SHEET_TERMS: string[] = [
  'These rates are effective on the dates shown against each destination. Any inquiries regarding this ' +
  'price offer must be received by Ichibaan Logic Private Limited within 24 hours of receipt, otherwise ' +
  'the rates shown are deemed to be accepted by both parties.',
  'Billing increments are stated per destination in the Billing Increment column as initial seconds / ' +
  'subsequent seconds (for example 60/1 bills a 60-second minimum, then per second).',
  'All amounts are in US$ per minute. This is a FULL rate sheet: it contains all the codes and destinations ' +
  'offered for this product, and rates against codes/destinations should always be replaced by this sheet. ' +
  'Any code/destination not offered in this sheet is considered to be DELETED.',
  "Please be advised that pricing-related information from Ichibaan Logic Private Limited is only effective " +
  "if it comes from Ichibaan's authorised pricing email address (pricing@ichibaanlogic.com). All other " +
  'pricing-related correspondence is deemed a quotation for discussion and/or budgetary purposes only, and ' +
  'is not valid until specifically confirmed by an Ichibaan Account Manager.',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-14' → '14-Sep-2026'. Anything unparseable is returned as given. */
export function formatSheetDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const s = iso instanceof Date ? iso.toISOString().slice(0, 10) : String(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return String(iso);
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

export function formatSheetTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * The reference names its first column after the part of the destination
 * before " - ": "PAKISTAN - MOBILE MOBILINK" → "PAKISTAN". The catalogue stores
 * no separate country on purpose (it never infers commercial structure from a
 * name); this is a display label derived the same way the reference does it.
 */
export function countryOf(destination: string): string {
  const i = destination.indexOf(' - ');
  return (i > 0 ? destination.slice(0, i) : destination).trim();
}

/**
 * Technical prefix = account prefix + product digit — the same composition the
 * authentication rules use, and what the reference prints ("59471" = 5947 + 1).
 */
export function technicalPrefix(accountPrefix: string | null | undefined, productDigit: string): string {
  return `${(accountPrefix ?? '').trim()}${productDigit.trim()}`;
}

export type BuildRowsInput = {
  expansions: Array<Expansion<PricedRate>>;
  /** prefix → billing increment as it should be printed ('60/1'); missing = ''. */
  increments: Map<string, string | null | undefined>;
  /** prefix → legacy destination name, for prefix-keyed (pre-catalogue) prices only. */
  legacyNames: Map<string, string>;
  /** prefix → why it must not appear (e.g. the switch holds no rate for it). Reported, never printed. */
  excludedPrefixes?: Map<string, string>;
};

export type BuildRowsResult = {
  rows: RateSheetRow[];
  /** One line per price the sheet could not carry, and why. Never empty rows. */
  excluded: string[];
};

/**
 * No notification history is kept yet, so nothing can be compared with a
 * previous send: every row is N (new code). When sent rate sets are stored,
 * this is where NC / I / D are decided.
 */
const FIRST_SHEET_STATUS: RateSheetRow['status'] = 'N';

export function buildRateSheetRows(input: BuildRowsInput): BuildRowsResult {
  const rows: RateSheetRow[] = [];
  const excluded: string[] = [];
  const seen = new Set<string>();

  for (const e of input.expansions) {
    const r = e.row;
    const rate = Number(r.rate);
    if (!Number.isFinite(rate)) { excluded.push(`${r.productCode} destination ${r.destinationId ?? r.prefix ?? '?'}: rate "${r.rate}" is not a number`); continue; }

    if (REFUSED_VERDICTS.includes(e.verdict)) {
      excluded.push(`${r.productCode} destination ${r.destinationId ?? r.prefix ?? '?'}: ${e.verdict}${e.reason ? ` — ${e.reason}` : ''}`);
      continue;
    }

    let name: string;
    let prefixes: string[];
    if (e.verdict === 'catalogue') {
      name = (e.destinationName ?? '').trim();
      prefixes = e.prefixes.map(p => String(p).trim()).filter(Boolean);
      if (!name) { excluded.push(`${r.productCode} destination ${r.destinationId}: catalogue returned no name`); continue; }
      if (!prefixes.length) { excluded.push(`${r.productCode} ${name}: catalogue returned no prefixes`); continue; }
    } else {
      // legacy_prefix: the price itself names the prefix; the name comes from the legacy table or is the prefix.
      const p = String(r.prefix ?? '').trim();
      if (!p) { excluded.push(`${r.productCode}: prefix-keyed price with no prefix`); continue; }
      prefixes = [p];
      name = (input.legacyNames.get(p) ?? '').trim() || p;
    }

    for (const prefix of prefixes) {
      const veto = input.excludedPrefixes?.get(prefix);
      if (veto) { excluded.push(`${r.productCode} ${name} ${prefix}: ${veto}`); continue; }
      const key = `${r.productCode}|${prefix}`;
      if (seen.has(key)) { excluded.push(`${r.productCode} ${name} ${prefix}: duplicate prefix, second price ignored`); continue; }
      seen.add(key);
      rows.push({
        country: countryOf(name),
        destination: name,
        prefix,
        rate,
        status: FIRST_SHEET_STATUS,
        billingIncrement: (input.increments.get(prefix) ?? '') || '',
        effectiveDate: formatSheetDate(r.effectiveFrom),
        effectiveTime: '00:00:00',
      });
    }
  }

  rows.sort((a, b) => a.country.localeCompare(b.country) || a.destination.localeCompare(b.destination) || a.prefix.localeCompare(b.prefix, undefined, { numeric: true }));
  return { rows, excluded };
}

/** The increase/decrease effective dates the header prints: earliest date among I/D rows, else blank. */
export function changeEffectiveDates(rows: RateSheetRow[]): { increase: string; decrease: string } {
  const earliest = (status: RateSheetRow['status']) => {
    const dates = rows.filter(r => r.status === status).map(r => r.effectiveDate).filter(Boolean);
    return dates.length ? dates.sort()[0] : '';
  };
  return { increase: earliest('I'), decrease: earliest('D') };
}
