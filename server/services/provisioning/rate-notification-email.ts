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
 * The Excel is a clean 3-column customer sheet — NOT the Sippy upload format.
 * The Sippy tariff is a single combined upload (handled by rates.step); these emails
 * are the commercial handover, not the switch instruction.
 *
 * Recipients: commercial contacts from company_contacts only.
 * Finance, billing and invoicing contacts are excluded (same rule as the account details
 * email). The rate sheet is a commercial document, not a system credential, so it goes to
 * a slightly wider set — "commercial" and "rates" contacts in addition to "technical".
 */
import * as XLSX from "xlsx";
import { pool } from "../../db";
import { sendDirectEmailWithAttachment } from "../../email";

/** Product display name as it appears in the subject and body. */
const PRODUCT_LABELS: Record<string, string> = {
  FC: "FIRST CLASS",
  BC: "BUSINESS CLASS",
  SB: "SPECIAL BRAVO",
  SC: "SPECIAL CHARLIE",
};

/** Rate row as resolved from product_rates + global_destinations. */
export type NotificationRate = {
  productCode:  string;
  productLabel: string;
  productDigit: string;   // trunk_prefix: FC=1, BC=2, SB=6, SC=7
  prefix:       string;   // bare destination prefix, e.g. "92"
  destination:  string;   // human name, e.g. "Pakistan"
  rate:         string;   // numeric string, e.g. "0.040000"
  currency:     string;
};

// ── Customer-facing Excel ──────────────────────────────────────────────────────
// Three columns only: Destination, Prefix, Rate (USD/Min).
// The Sippy upload format (Action/Id/Interval/…) is internal and would confuse a customer.
function buildRateNotificationXlsx(
  companyName: string,
  productLabel: string,
  rows: NotificationRate[],
): Buffer {
  const date = new Date().toISOString().slice(0, 10);
  const aoa: (string | number)[][] = [
    // Title row — matches the email subject so the sheet is self-describing when detached
    [`RATE NOTIFICATION (FULL) — ${companyName} — ${productLabel} — ${date}`],
    [],
    ["Destination", "Prefix", "Rate (USD/Min)"],
    ...rows.map(r => [
      r.destination || r.prefix,
      `+${r.prefix}`,
      Number(Number(r.rate).toFixed(6)),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths: Destination 28, Prefix 12, Rate 16
  ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 16 }];

  // Bold the title and header row
  const title = XLSX.utils.encode_cell({ r: 0, c: 0 });
  const hDest = XLSX.utils.encode_cell({ r: 2, c: 0 });
  const hPfx  = XLSX.utils.encode_cell({ r: 2, c: 1 });
  const hRate = XLSX.utils.encode_cell({ r: 2, c: 2 });
  for (const cell of [title, hDest, hPfx, hRate]) {
    if (ws[cell]) ws[cell].s = { font: { bold: true } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rate Sheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── Email HTML body ────────────────────────────────────────────────────────────
// Matches the reference EML format: plain paragraphs, a simple rate table, footer notice.
function renderRateNotificationHtml(opts: {
  companyName:  string;
  productLabel: string;
  dialFormat:   string;  // e.g. "30711XXXXXXXXXX" (accountPrefix + productDigit + dest)
  issueDate:    string;  // e.g. "July 31, 2026"
  rows:         NotificationRate[];
}): string {
  const { companyName, productLabel, dialFormat, issueDate, rows } = opts;

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
Please find attached updated rate sheet from <strong>Ichibaan Logic Private Limited</strong>
<em>(formerly&nbsp;Bhaoo Private Limited)</em>. Changes are indicated in the attached rate
sheet and are effective as specified.</p>

<p>We request you to acknowledge the rate sheet and look forward to your continuous support
in our endeavour to give you the best quality at the best possible price. Please note that
the notification will be considered&nbsp;as received automatically, even if you fail to
confirm.</p>

<p><strong>Issue Date :</strong>&nbsp;${issueDate}</p>

<p><strong>Product:</strong>&nbsp;${productLabel}</p>

<p><strong>Traffic to send in a format:</strong>&nbsp;${dialFormat}</p>

<p><strong>Notification Type:</strong>&nbsp;<strong>FULL</strong></p>

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

<p><strong>FULL/A2Z:&nbsp;</strong>FULL rate sheet contains all the codes and destinations
for all countries offered. Rates against codes/destinations should always be replaced by the
new FULL rate sheet. In case any code/destination is not offered in the new FULL rate sheet,
the missing codes/destinations are considered to be DELETED.</p>

<p><strong>CHANGES/PARTIAL:&nbsp;</strong>Partial rate sheet includes only changes from the
previous rate sheet. All rates given against codes in the partial rate sheet are replaced by
the new rate sheet. However, rates for the missing codes/destinations are still considered
valid as given in the previous rate sheet.</p>`;
}

// ── Date helpers ───────────────────────────────────────────────────────────────
function friendlyDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function compactDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function sendRateNotificationEmails(
  companyId: number,
): Promise<{ sent: number; failed: number; skipped: number; details: string[] }> {
  const details: string[] = [];
  let sent = 0, failed = 0, skipped = 0;

  // 1. Company info + recipients
  // Commercial + rates contacts receive rate notifications.
  // Technical contacts are excluded — they handle credentials, not pricing.
  // Finance/billing/invoicing are excluded as always.
  const { rows: compRows } = await pool.query<any>(
    `SELECT c.name, c.account_prefix,
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
  if (!comp) {
    return { sent: 0, failed: 0, skipped: 1, details: [`Company ${companyId} not found.`] };
  }

  const recipients: string[] = Array.from(new Set<string>(
    (comp.contact_emails ?? [])
      .filter((e: any) => typeof e === "string" && e.includes("@"))
      .map((e: string) => e.trim().toLowerCase()),
  ));

  if (!recipients.length) {
    return {
      sent: 0, failed: 0, skipped: 1,
      details: ["No commercial or technical contacts with email addresses — rate notifications not sent."],
    };
  }

  const to = recipients.join(", ");
  const accountPrefix = comp.account_prefix ?? "";

  // 2. Effective rates today
  const today = new Date().toISOString().slice(0, 10);
  const { rows: rateRows } = await pool.query<any>(
    `SELECT pr.code AS product_code,
            pr.name AS product_name,
            pr.trunk_prefix AS product_digit,
            r.prefix,
            r.rate,
            r.currency,
            COALESCE(gd.name, r.prefix) AS destination
       FROM product_rates r
       JOIN product_registry pr ON pr.id = r.product_id
       LEFT JOIN global_destinations gd
              ON gd.dial_prefix = r.prefix AND gd.commercial_status = 'approved'
      WHERE r.effective_from <= $1
        AND (r.effective_to IS NULL OR r.effective_to >= $1)
        AND pr.code IN ('FC', 'BC', 'SB', 'SC')
      ORDER BY pr.code, r.prefix`,
    [today],
  );

  if (!rateRows.length) {
    return {
      sent: 0, failed: 0, skipped: 1,
      details: ["No effective rates in product_rates — nothing to notify."],
    };
  }

  // 3. Group by product code
  const byProduct = new Map<string, NotificationRate[]>();
  for (const r of rateRows) {
    if (!byProduct.has(r.product_code)) byProduct.set(r.product_code, []);
    byProduct.get(r.product_code)!.push({
      productCode:  r.product_code,
      productLabel: PRODUCT_LABELS[r.product_code] ?? r.product_name.toUpperCase(),
      productDigit: String(r.product_digit ?? ""),
      prefix:       String(r.prefix),
      destination:  r.destination,
      rate:         r.rate,
      currency:     r.currency ?? "USD",
    });
  }

  // 4. One email per product
  const now = new Date();
  const issueDateStr  = friendlyDate(now);
  const compactDtStr  = compactDateTime(now);
  const safeCompany   = comp.name.toUpperCase().replace(/[^A-Z0-9]/g, "");

  for (const [productCode, rows] of byProduct) {
    const productLabel = PRODUCT_LABELS[productCode] ?? productCode;
    const productDigit = rows[0].productDigit;

    // Dial format: accountPrefix + productDigit + [Country Code] + [Number]
    const dialFormat = accountPrefix
      ? `${accountPrefix}${productDigit}[Country Code][Number]`
      : `${productDigit}[Country Code][Number]`;

    const subject  = `RATE NOTIFICATION (FULL) | ${comp.name.toUpperCase()} | ${productLabel} | ${issueDateStr}`;
    const filename = `${safeCompany}-${productLabel.replace(/\s+/g, "_")}-${compactDtStr}-FULL.xlsx`;

    const html  = renderRateNotificationHtml({ companyName: comp.name, productLabel, dialFormat, issueDate: issueDateStr, rows });
    const xlsx  = buildRateNotificationXlsx(comp.name, productLabel, rows);

    const res = await sendDirectEmailWithAttachment({
      to,
      subject,
      html,
      fromName:    "Ichibaan Rates",
      fromAddress: "pricing@ichibaanlogic.com",
      attachment: { filename, content: xlsx, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });

    if (res.ok) {
      sent++;
      details.push(`✓ ${productLabel} → ${to} (${filename})`);
    } else {
      failed++;
      details.push(`✗ ${productLabel} failed: ${res.error}`);
    }
  }

  return { sent, failed, skipped, details };
}
