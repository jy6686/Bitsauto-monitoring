/**
 * rate-notification-render.ts - the rate notification, in the house visual style.
 *
 * The Account Details email is the VISUAL reference: same logo, header, tinted section bars,
 * table treatment and footer. Its content is not: that email hands over credentials to a
 * technical audience, this one states prices to a commercial one. Nothing in
 * `account-details-email.ts` is modified.
 *
 * WHY THE STYLE IS COPIED RATHER THAN IMPORTED. These are inline styles because every major
 * email client strips `<style>` blocks, and the two documents are free to diverge - a pricing
 * notice may need a column an account handover never will. Sharing a module would couple two
 * customer-facing documents that answer to different audiences and different legal wording.
 * The tokens are small and are commented where they matter.
 *
 * THE LOGO IS A `cid:` REFERENCE, NOT A URL. Gmail and Outlook block remote images by default, so
 * a hosted logo renders as a broken box on first open. The sender attaches the same bundled asset
 * the account email uses; the wordmark stays TEXT so the header still reads in clients that strip
 * images entirely.
 *
 * FULL AND CHANGES ARE NOT TWO SPELLINGS OF ONE THING. Under FULL a destination absent from the
 * sheet is DELETED; under CHANGES it keeps its previous rate. Only the clause that governs the
 * notice appears on it - printing both leaves the customer to guess, and the expensive guess is
 * available.
 */
import { LOGO_CID } from '../provisioning/account-details-email';

export type NotificationKind = 'FULL' | 'CHANGES';

/** One priced destination, as the customer sees it. */
export interface RateChangeRow {
  destination: string;
  /** The customer's BARE dial prefix. Never the trunk-composed prefix written to the switch. */
  prefix: string;
  /** Absent when there was no prior rate - a destination priced for the first time. */
  previousRate?: string | null;
  newRate: string;
  /** "60/1". Absent when unknown, which is shown as such rather than defaulted to 1/1. */
  billingIncrement?: string | null;
  effectiveDate: string;
}

export interface RateNotificationView {
  clientName: string;
  productLabel: string;
  issueDate: string;
  /** The date the notice as a whole takes effect; rows may carry their own. */
  effectiveDate: string;
  /** e.g. "19230[Country Code][Number]" */
  dialFormat: string;
  kind: NotificationKind;
  rows: RateChangeRow[];
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BLUE = '#0B5FA5';

const S = {
  label: 'padding:10px 14px;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:13px;width:38%;',
  value: 'padding:10px 14px;border-bottom:1px solid #e8eaed;color:#202124;font-size:13px;font-weight:600;',
  h2:    `margin:24px 0 0;padding:8px 14px;background:#eaf2fa;border-left:3px solid ${BLUE};color:${BLUE};font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;`,
  table: 'width:100%;border-collapse:collapse;border:1px solid #e8eaed;',
  mono:  'font-family:Consolas,Menlo,monospace;letter-spacing:.02em;',
  th:    'padding:8px 10px;background:#f6f8fa;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;',
  td:    'padding:9px 10px;border-bottom:1px solid #e8eaed;color:#202124;font-size:13px;',
};

export function subjectForRateNotification(v: Pick<RateNotificationView, 'clientName' | 'productLabel' | 'kind' | 'effectiveDate'>): string {
  // The KIND is in the subject because it changes what the notice means, and a reader triaging an
  // inbox decides whether to act on it before opening anything.
  const kind = v.kind === 'CHANGES' ? 'CHANGES' : 'FULL';
  return `Rate Notification (${kind}) - ${v.clientName} - ${v.productLabel} - Effective ${v.effectiveDate}`;
}

/**
 * The legal clause, and ONLY the one that governs this notice.
 *
 * Rendered as a tinted callout rather than footer small print: it is the sentence that decides
 * what happens to every destination the sheet does not mention, which is the part a customer is
 * most likely to need and least likely to read.
 */
function noticeBlock(kind: NotificationKind): string {
  if (kind === 'CHANGES') {
    return `
      <div style="margin:10px 0 0;padding:14px 16px;background:#f1f8f2;border-left:4px solid #2e7d32;">
        <div style="font-size:13px;font-weight:700;color:#1b5e20;margin-bottom:4px;">CHANGES (PARTIAL) NOTIFICATION</div>
        <div style="font-size:13px;color:#3c4043;line-height:1.6;">Only the destinations listed above have changed.
        All other destinations and rates remain valid and unaffected.</div>
      </div>`;
  }
  return `
      <div style="margin:10px 0 0;padding:14px 16px;background:#fff8e1;border-left:4px solid #b26a00;">
        <div style="font-size:13px;font-weight:700;color:#8a4b00;margin-bottom:4px;">FULL / A2Z NOTIFICATION</div>
        <div style="font-size:13px;color:#3c4043;line-height:1.6;">This is a complete rate sheet. Rates against
        codes and destinations should be replaced in full. Any code or destination NOT offered in this sheet is
        considered DELETED.</div>
      </div>`;
}

export function renderRateNotification(v: RateNotificationView): string {
  const summary: Array<[string, string, boolean?]> = [
    ['Issue Date',                    v.issueDate],
    ['Product',                       v.productLabel],
    ['Notification Type',             v.kind === 'CHANGES' ? 'CHANGES (PARTIAL)' : 'FULL / A2Z'],
    ['Effective Date',                v.effectiveDate],
    ['Traffic to be sent in a format', v.dialFormat, true],
  ];

  const summaryTable = `<table role="presentation" cellpadding="0" cellspacing="0" style="${S.table}">${
    summary.map(([k, val, mono]) =>
      `<tr><td style="${S.label}">${esc(k)}</td><td style="${S.value}${mono ? S.mono : ''}">${esc(val)}</td></tr>`,
    ).join('')
  }</table>`;

  const rateRows = v.rows.map(r => `
      <tr>
        <td style="${S.td}">${esc(r.destination)}</td>
        <td style="${S.td}${S.mono}">${esc(r.prefix)}</td>
        <td style="${S.td}${S.mono}text-align:right;color:#5f6368;">${r.previousRate ? esc(r.previousRate) : '&mdash;'}</td>
        <td style="${S.td}${S.mono}text-align:right;font-weight:700;">${esc(r.newRate)}</td>
        <td style="${S.td}${S.mono}text-align:center;">${r.billingIncrement ? esc(r.billingIncrement) : '&mdash;'}</td>
        <td style="${S.td}">${esc(r.effectiveDate)}</td>
      </tr>`).join('');

  return `
<div style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e8eaed;border-radius:10px;overflow:hidden;">

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:26px 26px 22px;background:${BLUE};">
          <img src="cid:${LOGO_CID}" alt="" width="52" height="52"
               style="display:block;border:0;outline:none;width:52px;height:52px;margin:0 auto 10px;">
          <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.02em;">Ichibaan Logic</div>
          <div style="font-size:12px;color:#cfe0f0;margin-top:3px;letter-spacing:.04em;">International Voice Business</div>
        </td>
      </tr>
    </table>

    <div style="padding:24px 26px;">
      <p style="margin:0 0 12px;font-size:14px;color:#202124;">Dear ${esc(v.clientName)},</p>
      <p style="margin:0 0 8px;font-size:14px;color:#3c4043;line-height:1.6;">We are pleased to inform you of the
      following rate changes applicable to your account.</p>
      <p style="margin:0 0 4px;font-size:14px;color:#3c4043;line-height:1.6;">These rates will be effective from the
      date specified below and will be applicable to traffic routed through the relevant product.</p>

      <div style="${S.h2}">Notification Summary</div>
      ${summaryTable}

      <div style="${S.h2}">Rate Changes</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="${S.table}">
        <tr>
          <th align="left"   style="${S.th}">Destination</th>
          <th align="left"   style="${S.th}">Prefix</th>
          <th align="right"  style="${S.th}">Previous Rate<br>USD/min</th>
          <th align="right"  style="${S.th}">New Rate<br>USD/min</th>
          <th align="center" style="${S.th}">Billing Increment<br>(sec/sec)</th>
          <th align="left"   style="${S.th}">Effective Date</th>
        </tr>
        ${rateRows}
      </table>

      <div style="${S.h2}">Important Notice</div>
      ${noticeBlock(v.kind)}

      <p style="margin:20px 0 0;font-size:14px;color:#3c4043;line-height:1.6;">Should you have any questions, please
      contact your Key Account Manager or our commercial team.</p>

      <p style="margin:18px 0 0;font-size:14px;color:#3c4043;">Best regards,<br>
      <strong style="color:#202124;">Ichibaan Logic Private Limited</strong>
      <em style="color:#5f6368;">(formerly Bhaoo Private Limited)</em></p>
    </div>

    <div style="padding:18px 26px;background:#f6f8fa;border-top:1px solid #e8eaed;font-size:12px;color:#3c4043;line-height:1.7;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td valign="top" style="font-size:12px;color:#3c4043;">
            <strong style="color:#202124;">Ichibaan Logic Private Limited</strong><br>
            <em style="color:#5f6368;">(formerly Bhaoo Private Limited)</em><br>
            International Voice Business
          </td>
          <td valign="top" align="right" style="font-size:12px;color:#3c4043;">
            For commercial enquiries, please contact your<br>Key Account Manager.<br>
            <a href="mailto:sales@ichibaanlogic.com" style="color:${BLUE};text-decoration:none;">sales@ichibaanlogic.com</a>
          </td>
        </tr>
      </table>
    </div>

  </div>
</div>`.trim();
}
