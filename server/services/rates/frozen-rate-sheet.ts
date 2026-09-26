/**
 * frozen-rate-sheet.ts — the rate sheet attached to an AUTOMATIC notification.
 *
 * Built from the obligation's frozen rows and from nothing else. The manual path assembles its
 * sheet from `product_rates` and the catalogue, which is right for a provisioning-time FULL
 * sheet and wrong here: after a push, `product_rates` can disagree with what actually landed,
 * and a sheet rebuilt from it would tell the customer about rates the switch does not hold. The
 * frozen rows ARE what landed. They were certified once; this prints them.
 *
 * TWO THINGS THIS SHEET MUST NOT SAY.
 *
 * 1. "FULL" — the manual sheet's terms declare that any destination not listed is DELETED.
 *    This notification is CHANGES: the covering email says so, and a test refuses the deletion
 *    clause in it. An attachment that contradicts its own email, on a legal paragraph, is worse
 *    than no attachment. The terms here carry the CHANGES sentence instead, and "DELETED" is
 *    asserted absent.
 * 2. A billing increment it cannot substantiate. The frozen row now carries the increment AS
 *    APPLIED — resolved server-side from the active commercial catalogue at push time, not
 *    caller-supplied — so a destination that had one is quoted honestly. A destination whose
 *    prefix was absent from the catalogue kept 1/1 on the legacy path with no commercial row to
 *    consult; that is a DEFAULT nobody committed to, so the cell stays blank rather than quoting
 *    it as a term. Blank means "not established"; it never means 1/1.
 *
 * Everything else — layout, styles, columns, the workbook itself — is the existing builder,
 * untouched. This module only decides what goes in it.
 */
import { buildRateSheetWorkbook } from '../provisioning/rate-sheet-workbook';
import {
  countryOf, formatSheetDate, formatSheetTime, technicalPrefix, changeEffectiveDates, RATE_SHEET_TERMS,
  type RateSheetModel, type RateSheetRow,
} from '../provisioning/rate-sheet-model';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The owner's wording, 2026-09-23. Verbatim; a test pins it. */
export const CHANGES_SCOPE_SENTENCE =
  'This sheet lists only the destinations whose rates changed; all other destinations and rates remain as previously notified.';

/**
 * The FULL terms with the deletion paragraph replaced. The other paragraphs (24-hour acceptance,
 * increment explanation, authorised pricing address) are commitments the CHANGES email also
 * makes, so they stay.
 */
export const RATE_SHEET_TERMS_CHANGES: string[] = RATE_SHEET_TERMS.map(p =>
  /FULL rate sheet/.test(p)
    ? `All amounts are in US$ per minute. ${CHANGES_SCOPE_SENTENCE}`
    : p,
);

/** A frozen row as `rows_json` holds it. Only the fields the sheet prints are read. */
export interface FrozenRow {
  prefix: string;
  destination?: string | null;
  rate: string | number;
  effectiveDate?: string | null;
  productDigit?: string | null;
  /** "60/1" as applied, or empty/absent when the push established no commercial term. */
  billingIncrement?: string | null;
}

export interface FrozenSheetInput {
  companyName: string;
  productLabel: string;
  accountPrefix?: string | null;
  kamName?: string | null;
  /** YYYY-MM-DD — the notice's issue date, used where a row carries no date of its own. */
  issueDate: string;
  rows: FrozenRow[];
  /** When the sheet is produced; injected so the header does not depend on the machine. */
  sentAt?: Date;
}

/** 'YYYY-MM-DD HH:MM' or 'YYYY-MM-DD' → the time part, or ''. */
function timeOf(s: string): string {
  const m = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/.exec(s);
  return m ? m[1] : '';
}

/** Filename in the manual path's convention, with CHANGES where it wrote FULL. */
export function frozenSheetFilename(companyName: string, productLabel: string, sentAt: Date): string {
  const safeCompany = companyName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${sentAt.getUTCFullYear()}${p(sentAt.getUTCMonth() + 1)}${p(sentAt.getUTCDate())}-${p(sentAt.getUTCHours())}${p(sentAt.getUTCMinutes())}`;
  return `${safeCompany}-${productLabel.replace(/\s+/g, '_')}-${stamp}-CHANGES.xlsx`;
}

/** The sheet's model — pure, so a test can assert every cell without opening a workbook. */
export function buildFrozenRateSheetModel(input: FrozenSheetInput): RateSheetModel {
  const sentAt = input.sentAt ?? new Date();
  const productDigit = String(input.rows[0]?.productDigit ?? '').trim();

  const rows: RateSheetRow[] = input.rows.map(r => {
    const destination = String(r.destination ?? r.prefix);
    const eff = String(r.effectiveDate ?? '').trim() || input.issueDate;
    return {
      country: countryOf(destination),
      destination,
      prefix: String(r.prefix),
      rate: Number(r.rate),
      // Every row of a CHANGES notice is a rate the customer did not have before at this value.
      // No prior rate is frozen, so I/D cannot be decided honestly; N is what the manual sheet
      // prints for the same reason.
      status: 'N',
      // The increment AS APPLIED, frozen with the row. Blank when the push established no
      // commercial term for that destination — see the file comment. A blank cell says "not
      // established"; printing a default would quote a commitment nobody made.
      billingIncrement: String(r.billingIncrement ?? '').trim(),
      effectiveDate: formatSheetDate(eff),
      effectiveTime: timeOf(eff),
    };
  });

  const change = changeEffectiveDates(rows);
  return {
    header: {
      companyName: input.companyName,
      productLabel: input.productLabel,
      sendDate: formatSheetDate(sentAt),
      sendTime: formatSheetTime(sentAt),
      increaseEffectiveDate: change.increase,
      decreaseEffectiveDate: change.decrease,
      technicalPrefix: technicalPrefix(input.accountPrefix, productDigit),
      kamName: String(input.kamName ?? '').trim(),
      kamEmail: '',
    },
    rows,
    terms: RATE_SHEET_TERMS_CHANGES,
  };
}

/** The attachment itself: the model, rendered by the existing builder. */
export async function buildFrozenRateSheetAttachment(input: FrozenSheetInput): Promise<{
  filename: string; content: Buffer; contentType: string;
}> {
  const sentAt = input.sentAt ?? new Date();
  const content = await buildRateSheetWorkbook(buildFrozenRateSheetModel({ ...input, sentAt }));
  return {
    filename: frozenSheetFilename(input.companyName, input.productLabel, sentAt),
    content,
    contentType: XLSX_CONTENT_TYPE,
  };
}
