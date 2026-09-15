/**
 * rate-notification-email.ts — per-product rate notification in industry-standard format.
 *
 * Sends four separate emails after a provisioning run completes, one for each commercial
 * product (FC, BC, SB, SC). Each email matches the reference format Ichibaan already
 * sends manually:
 *   Subject: RATE NOTIFICATION (FULL) | {COMPANY} | {PRODUCT} | {Date}
 *   Body:    professional intro, rate table, FULL/CHANGES explanation footer
 *   Attachment: {COMPANY}-{PRODUCT}-{YYYYMMDDHHMM}-FULL.xlsx (customer-facing sheet)
 *
 * The Excel is the customer-facing rate sheet in the industry layout (header block,
 * status legend, Country/Destination/Prefix/Rate/Status/Increment/Effective table,
 * terms) — NOT the Sippy upload format. It is built by rate-sheet-workbook.ts from a
 * RateSheetModel assembled here; the model builder is pure and tested on its own.
 * The Sippy tariff is a single combined upload (handled by rates.step); these emails
 * are the commercial handover, not the switch instruction.
 *
 * Rows are resolved exactly the way rates.step resolves them for the switch: each
 * price is expanded through the Destination Catalogue (one row per prefix of the
 * priced destination, named by the catalogue) and anything the catalogue refuses is
 * reported in `details` rather than sent. Before 2026-09-14 the names were joined on
 * `product_rates.prefix`, which catalogue-keyed prices leave empty, and a customer
 * received rows reading `null` / `+null`.
 *
 * Recipients: commercial contacts from company_contacts only.
 * Finance, billing and invoicing contacts are excluded (same rule as the account details
 * email). The rate sheet is a commercial document, not a system credential, so it goes to
 * a slightly wider set — "commercial" and "rates" contacts in addition to "technical".
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { sendDirectEmailWithAttachment } from "../../email";
import { expandRates, activeCatalogueVersionId, type Expansion } from "../rates/rate-prefix-expansion";
import { lookupCatalogueIncrements } from "../rates/catalogue-increments";
import { parseBillingIncrement, formatBillingIncrement } from "../rates/billing-increment";
import {
  buildRateSheetRows, changeEffectiveDates, formatSheetDate, formatSheetTime, technicalPrefix,
  RATE_SHEET_TERMS, type PricedRate, type RateSheetModel, type RateSheetRow,
} from "./rate-sheet-model";
import { buildRateSheetWorkbook } from "./rate-sheet-workbook";

/** Product display name as it appears in the subject and body. */
const PRODUCT_LABELS: Record<string, string> = {
  FC: "FIRST CLASS",
  BC: "BUSINESS CLASS",
  SB: "SPECIAL BRAVO",
  SC: "SPECIAL CHARLIE",
};

/** Rate row as it appears in the email body's table: one line per prefix. */
export type NotificationRate = {
  productCode:  string;
  productLabel: string;
  productDigit: string;   // trunk_prefix: FC=1, BC=2, SB=6, SC=7
  prefix:       string;   // bare destination prefix, e.g. "9230"
  destination:  string;   // catalogue name, e.g. "PAKISTAN - MOBILE MOBILINK"
  rate:         string;   // numeric string, e.g. "0.040000"
  currency:     string;
};


// ── Email HTML body ────────────────────────────────────────────────────────────
// Matches the reference EML format: plain paragraphs, a simple rate table, footer notice.
/**
 * FULL and CHANGES are not two spellings of one thing — the footer below gives them opposite
 * legal meanings. Under FULL, a destination absent from the sheet is DELETED. Under CHANGES, an
 * absent destination keeps its previous rate. Sending a partial push labelled FULL therefore
 * tells a customer that every destination it does not mention has been withdrawn.
 */
export type RateNotificationType = 'FULL' | 'CHANGES';

/**
 * ONLY THE CLAUSE THAT APPLIES IS SHOWN, and that is a correctness requirement rather than
 * tidiness.
 *
 * These two paragraphs say OPPOSITE things about a destination the sheet does not mention:
 * under FULL it is DELETED, under CHANGES it keeps its previous rate. Printing both on a partial
 * sheet leaves the customer to work out which governs, and the expensive misreading is available
 * — a partial sheet listing four destinations, read under the FULL clause, withdraws every other
 * destination the customer buys.
 *
 * So the notification states the one rule that governs it. The `Notification Type` line above
 * names which, and the footer explains only that.
 */
const FULL_FOOTER = `<p><strong>FULL/A2Z:&nbsp;</strong>FULL rate sheet contains all the codes and destinations
for all countries offered. Rates against codes/destinations should always be replaced by the
new FULL rate sheet. In case any code/destination is not offered in the new FULL rate sheet,
the missing codes/destinations are considered to be DELETED.</p>`;

const CHANGES_FOOTER = `<p><strong>CHANGES/PARTIAL:&nbsp;</strong>This is a partial rate sheet and includes only the
destinations whose rates have changed. All rates given against codes in this partial rate sheet
replace the previous rates for those codes. Rates for codes/destinations NOT listed here are
unaffected and remain valid as given in the previous rate sheet.</p>`;

export function renderRateNotificationHtml(opts: {
  companyName:  string;
  productLabel: string;
  dialFormat:   string;  // e.g. "30711XXXXXXXXXX" (accountPrefix + productDigit + dest)
  issueDate:    string;  // e.g. "July 31, 2026"
  rows:         NotificationRate[];
  /** Defaults to FULL so every existing caller keeps the behaviour it had. */
  notificationType?: RateNotificationType;
}): string {
  const { companyName, productLabel, dialFormat, issueDate, rows } = opts;
  const notificationType = opts.notificationType ?? 'FULL';

  const rateTableRows = rows
    .map(r =>
      `<tr>
         <td style="padding:6px 10px;border:1px solid #ccc;">${r.destination || r.prefix}</td>
         <td style="padding:6px 10px;border:1px solid #ccc;font-family:monospace;">+${r.prefix}</td>
         <td style="padding:6px 10px;border:1px solid #ccc;text-align:right;">${Number(r.rate).toFixed(4)}</td>
       </tr>`,
    )
    .join("");

  return `<p>Dear ${companyName},&nbsp;<br /><br />
Please find attached ${notificationType === 'CHANGES' ? 'a partial rate sheet containing only the destinations whose rates have changed' : 'updated rate sheet'} from <strong>Ichibaan Logic Private Limited</strong>
<em>(formerly&nbsp;Bhaoo Private Limited)</em>. Changes are indicated in the attached rate
sheet and are effective as specified.</p>

<p>We request you to acknowledge the rate sheet and look forward to your continuous support
in our endeavour to give you the best quality at the best possible price. Please note that
the notification will be considered&nbsp;as received automatically, even if you fail to
confirm.</p>

<p><strong>Issue Date :</strong>&nbsp;${issueDate}</p>

<p><strong>Product:</strong>&nbsp;${productLabel}</p>

<p><strong>Traffic to send in a format:</strong>&nbsp;${dialFormat}</p>

<p><strong>Notification Type:</strong>&nbsp;<strong>${notificationType === 'CHANGES' ? 'CHANGES/PARTIAL' : 'FULL'}</strong></p>

<p>We would like to inform you that notwithstanding anything contained in the rate sheet,
the following rates will be charged for traffic:</p>

<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  <thead>
    <tr style="background:#f4f5f7;">
      <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;">Destination</td>
      <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;">Prefix</td>
      <td style="padding:6px 10px;border:1px solid #ccc;font-weight:bold;">Rate USD/Min</td>
    </tr>
  </thead>
  <tbody>${rateTableRows}</tbody>
</table>

<p>In case of any further clarification, please do not hesitate to contact your Key Account
Manager.</p>

<p>Thank you very much for your support.<br />&nbsp;</p>

<p><strong>Best Regards,</strong></p>
<p><strong>Ichibaan Logic Private Limited</strong></p>
<p><em>(formerly Bhaoo Private Limited)</em></p>

${notificationType === 'CHANGES' ? CHANGES_FOOTER : FULL_FOOTER}`;
}

// ── Date helpers ───────────────────────────────────────────────────────────────
function friendlyDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function compactDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

// ── KAM ────────────────────────────────────────────────────────────────────────
/**
 * The sheet header names the Key Account Manager. Assignments live in kam_accounts,
 * keyed by the Sippy account id; a company without an assignment falls back to the
 * free-text `companies.kam` name (matched to a KAM record for the email when it can be).
 * Never fails the send: a sheet with a blank KAM line is still a correct rate sheet.
 */
async function resolveKam(
  sippyIAccount: number | null,
  kamText: string | null,
): Promise<{ name: string; email: string; note?: string }> {
  try {
    if (sippyIAccount !== null && sippyIAccount !== undefined) {
      const { rows } = await pool.query<any>(
        `SELECT k.name, k.email FROM kam_accounts ka JOIN kams k ON k.id = ka.kam_id
          WHERE ka.account_id = $1 ORDER BY ka.id LIMIT 1`,
        [String(sippyIAccount)],
      );
      if (rows[0]) return { name: rows[0].name ?? "", email: rows[0].email ?? "" };
    }
    const name = (kamText ?? "").trim();
    if (name) {
      const { rows } = await pool.query<any>(
        `SELECT name, email FROM kams WHERE LOWER(name) = LOWER($1) ORDER BY id LIMIT 1`, [name],
      );
      return rows[0] ? { name: rows[0].name, email: rows[0].email ?? "" } : { name, email: "" };
    }
    return { name: "", email: "", note: "No KAM assigned to this account — KAM lines on the sheet are blank." };
  } catch (e: any) {
    return { name: "", email: "", note: `KAM lookup failed (${e?.message ?? e}) — KAM lines on the sheet are blank.` };
  }
}

/** Legacy (prefix-keyed) prices keep the name resolution they always had. */
async function legacyNamesFor(prefixes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!prefixes.length) return out;
  const { rows } = await pool.query<any>(
    `SELECT p.prefix, COALESCE(d.name, gd.name) AS name
       FROM unnest($1::text[]) AS p(prefix)
       LEFT JOIN LATERAL (
              SELECT name FROM destinations
               WHERE dial_prefix = p.prefix
               ORDER BY level DESC, id LIMIT 1
       ) d ON true
       LEFT JOIN LATERAL (
              SELECT name FROM global_destinations
               WHERE dial_prefix = p.prefix AND commercial_status = 'approved'
               ORDER BY id LIMIT 1
       ) gd ON true`,
    [prefixes],
  );
  for (const r of rows) if (r.name) out.set(String(r.prefix), String(r.name));
  return out;
}

// ── Assembly ───────────────────────────────────────────────────────────────────
/** The four commercial products a sheet can be produced for. */
export const RATE_SHEET_PRODUCT_CODES: readonly string[] = Object.keys(PRODUCT_LABELS);

/** One product's notification, fully rendered and ready to send or download. */
export type PreparedRateSheet = {
  productCode:  string;
  productLabel: string;
  productDigit: string;
  currency:     string;
  subject:      string;
  filename:     string;
  html:         string;
  xlsx:         Buffer;
  rows:         RateSheetRow[];
  /** Prices that were effective but could not be carried on this sheet, and why. */
  excluded:     string[];
};

export type RateSheetAssembly = {
  /** Null when the company does not exist. */
  company: { id: number; name: string; accountPrefix: string; recipients: string[] } | null;
  /** Products with at least one row — these are what a customer would receive. */
  products: PreparedRateSheet[];
  /** Products with effective prices but no row the sheet could carry. Never sent. */
  unsendable: Array<{ productCode: string; productLabel: string; reasons: string[] }>;
  /** Everything worth telling the operator (KAM fallback, excluded prices …). */
  details: string[];
};

/**
 * Everything the notification needs, computed but not delivered.
 *
 * Reads only. It is the single place the customer sheet is derived, so the
 * download used for acceptance and the email a customer receives are the
 * same bytes from the same rows. `productCode` narrows the assembly to one
 * product (the download); the sender assembles all four.
 */
export async function assembleRateSheets(
  companyId: number,
  opts: { now?: Date; productCode?: string } = {},
): Promise<RateSheetAssembly> {
  const details: string[] = [];
  const now = opts.now ?? new Date();

  // 1. Company info + recipients
  // Commercial + rates contacts receive rate notifications.
  // Technical contacts are excluded — they handle credentials, not pricing.
  // Finance/billing/invoicing are excluded as always.
  const { rows: compRows } = await pool.query<any>(
    `SELECT c.id, c.name, c.account_prefix, c.kam, c.sippy_i_account,
            COALESCE(
              (SELECT array_agg(DISTINCT ct.email) FROM company_contacts ct
                WHERE ct.company_id = c.id
                  AND ct.email IS NOT NULL AND ct.email <> ''
                  AND LOWER(ct.contact_type) IN ('commercial', 'rates', 'technical', 'support', 'noc')
              ), '{}') AS contact_emails
       FROM companies c WHERE c.id = $1`,
    [companyId],
  );

  const comp = compRows[0];
  if (!comp) return { company: null, products: [], unsendable: [], details: [`Company ${companyId} not found.`] };

  const recipients: string[] = Array.from(new Set<string>(
    (comp.contact_emails ?? [])
      .filter((e: any) => typeof e === "string" && e.includes("@"))
      .map((e: string) => e.trim().toLowerCase()),
  ));
  const accountPrefix = comp.account_prefix ?? "";
  const company = { id: Number(comp.id), name: String(comp.name), accountPrefix, recipients };

  // 2. Effective rates today — the same filter rates.step and Rate Manager use, so the
  //    sheet a customer receives cannot disagree with what was uploaded to the switch.
  const today = now.toISOString().slice(0, 10);
  const { rows: allRateRows } = await pool.query<any>(
    `SELECT pr.id   AS product_id,
            pr.code AS product_code,
            pr.name AS product_name,
            pr.trunk_prefix AS product_digit,
            r.destination_id,
            r.catalogue_version_id,
            r.prefix,
            r.rate,
            r.currency,
            to_char(r.effective_from, 'YYYY-MM-DD') AS effective_from
       FROM product_rates r
       JOIN product_registry pr ON pr.id = r.product_id
      WHERE r.effective_from <= $1
        AND (r.effective_to IS NULL OR r.effective_to >= $1)
        AND pr.code IN ('FC', 'BC', 'SB', 'SC')
      ORDER BY pr.code, r.prefix`,
    [today],
  );
  const wanted = opts.productCode ? String(opts.productCode).toUpperCase() : null;
  const rateRows = wanted ? allRateRows.filter((r: any) => String(r.product_code) === wanted) : allRateRows;

  if (!rateRows.length) return { company, products: [], unsendable: [], details };

  // 3. Resolve every price the way the switch upload resolves it: through the
  //    Destination Catalogue, one row per prefix, named by the catalogue. Legacy
  //    prefix-keyed rows keep their old name lookup. Increments come from the
  //    active catalogue; a prefix it does not carry prints a blank increment.
  const priced: PricedRate[] = rateRows.map((r: any) => ({
    destinationId:      r.destination_id === null || r.destination_id === undefined ? null : Number(r.destination_id),
    prefix:             r.prefix === null || r.prefix === undefined ? null : String(r.prefix),
    catalogueVersionId: r.catalogue_version_id === null || r.catalogue_version_id === undefined ? null : Number(r.catalogue_version_id),
    productId:          Number(r.product_id),
    productCode:        String(r.product_code),
    productDigit:       String(r.product_digit ?? ""),
    rate:               r.rate,
    currency:           r.currency ?? "USD",
    effectiveFrom:      String(r.effective_from ?? ""),
  }));

  const activeVersionId = await activeCatalogueVersionId(db as any, sql as any);
  const expansions = await expandRates(db as any, priced, activeVersionId, sql as any);

  const allPrefixes = Array.from(new Set(expansions.flatMap(e => e.prefixes)));
  const rawIncrements = await lookupCatalogueIncrements(db as any, allPrefixes);
  const increments = new Map<string, string>();
  for (const [prefix, raw] of rawIncrements) {
    const parsed = parseBillingIncrement(raw);
    if (parsed) increments.set(prefix, formatBillingIncrement(parsed));
  }
  const legacyNames = await legacyNamesFor(
    expansions.filter(e => e.verdict === "legacy_prefix").flatMap(e => e.prefixes),
  );

  const kam = await resolveKam(
    comp.sippy_i_account === null || comp.sippy_i_account === undefined ? null : Number(comp.sippy_i_account),
    comp.kam ?? null,
  );
  if (kam.note) details.push(kam.note);

  // 4. Group by product code
  const byProduct = new Map<string, Array<Expansion<PricedRate>>>();
  for (const e of expansions) {
    const code = e.row.productCode;
    if (!byProduct.has(code)) byProduct.set(code, []);
    byProduct.get(code)!.push(e);
  }

  // 5. One sheet per product
  const issueDateStr  = friendlyDate(now);
  const compactDtStr  = compactDateTime(now);
  const safeCompany   = comp.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const products: PreparedRateSheet[] = [];
  const unsendable: RateSheetAssembly["unsendable"] = [];

  for (const [productCode, productExpansions] of byProduct) {
    const productLabel = PRODUCT_LABELS[productCode] ?? productCode;
    const productDigit = productExpansions[0].row.productDigit;
    const currency     = productExpansions[0].row.currency ?? "USD";

    const { rows: sheetRows, excluded } = buildRateSheetRows({ expansions: productExpansions, increments, legacyNames });
    for (const line of excluded) details.push(`${productLabel}: not on the sheet — ${line}`);
    if (!sheetRows.length) {
      unsendable.push({ productCode, productLabel, reasons: excluded.length ? excluded : ["no effective price reached a named destination"] });
      continue;
    }

    // Dial format: accountPrefix + productDigit + [Country Code] + [Number]
    const dialFormat = accountPrefix
      ? `${accountPrefix}${productDigit}[Country Code][Number]`
      : `${productDigit}[Country Code][Number]`;

    const subject  = `RATE NOTIFICATION (FULL) | ${comp.name.toUpperCase()} | ${productLabel} | ${issueDateStr}`;
    const filename = `${safeCompany}-${productLabel.replace(/\s+/g, "_")}-${compactDtStr}-FULL.xlsx`;

    // The body's table lists the same rows as the sheet, so the two cannot disagree.
    const rows: NotificationRate[] = sheetRows.map(r => ({
      productCode, productLabel, productDigit,
      prefix: r.prefix, destination: r.destination, rate: String(r.rate), currency,
    }));
    const html = renderRateNotificationHtml({ companyName: comp.name, productLabel, dialFormat, issueDate: issueDateStr, rows });

    const change = changeEffectiveDates(sheetRows);
    const model: RateSheetModel = {
      header: {
        companyName:           comp.name,
        productLabel,
        sendDate:              formatSheetDate(today),
        sendTime:              formatSheetTime(now),
        increaseEffectiveDate: change.increase,
        decreaseEffectiveDate: change.decrease,
        technicalPrefix:       technicalPrefix(accountPrefix, productDigit),
        kamName:               kam.name,
        kamEmail:              kam.email,
      },
      rows: sheetRows,
      terms: RATE_SHEET_TERMS,
    };
    const xlsx = await buildRateSheetWorkbook(model);

    products.push({ productCode, productLabel, productDigit, currency, subject, filename, html, xlsx, rows: sheetRows, excluded });
  }

  return { company, products, unsendable, details };
}

// ── Main export ────────────────────────────────────────────────────────────────
/**
 * Sends one notification per product to the company's commercial contacts.
 * The provisioning account-email step calls this after the account details go
 * out; the company card's "Resend rate notification" calls it on its own, with
 * no account details and no switch write.
 */
export async function sendRateNotificationEmails(
  companyId: number,
): Promise<{ sent: number; failed: number; skipped: number; details: string[] }> {
  const details: string[] = [];
  let sent = 0, failed = 0, skipped = 0;

  const assembly = await assembleRateSheets(companyId);
  if (!assembly.company) {
    return { sent: 0, failed: 0, skipped: 1, details: [`Company ${companyId} not found.`] };
  }
  if (!assembly.company.recipients.length) {
    return {
      sent: 0, failed: 0, skipped: 1,
      details: ["No commercial or technical contacts with email addresses — rate notifications not sent."],
    };
  }
  if (!assembly.products.length && !assembly.unsendable.length) {
    return {
      sent: 0, failed: 0, skipped: 1,
      details: ["No effective rates in product_rates — nothing to notify."],
    };
  }

  details.push(...assembly.details);
  for (const u of assembly.unsendable) {
    skipped++;
    details.push(`${u.productLabel}: no destination could be named for the sheet — notification not sent.`);
  }

  const to = assembly.company.recipients.join(", ");
  for (const p of assembly.products) {
    const res = await sendDirectEmailWithAttachment({
      to,
      subject:     p.subject,
      html:        p.html,
      fromName:    "Ichibaan Rates",
      fromAddress: "pricing@ichibaanlogic.com",
      attachment: { filename: p.filename, content: p.xlsx, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });

    if (res.ok) {
      sent++;
      details.push(`✓ ${p.productLabel} → ${to} (${p.filename}, ${p.rows.length} prefix row(s))`);
    } else {
      failed++;
      details.push(`✗ ${p.productLabel} failed: ${res.error}`);
    }
  }

  return { sent, failed, skipped, details };
}
