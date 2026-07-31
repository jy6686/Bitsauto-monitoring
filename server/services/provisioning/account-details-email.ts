/**
 * account-details-email.ts — the account details handed to the customer after a
 * successful provision.
 *
 * Reproduces the format Ichibaan already sends by hand, field for field, so a customer
 * cannot tell an automated account from a manual one. Product prefixes are derived from
 * the company's account prefix plus the platform product digits — the same formula the
 * authentication rules use, so what the email says and what the switch enforces cannot
 * drift apart.
 *
 * Sent ONLY after a run reaches a terminal success. A customer receiving credentials for
 * an account that failed verification is worse than no email at all.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "../../db";
import { sendDirectEmail, sendDirectEmailWithAttachment } from "../../email";
import { PRODUCT_DIGITS } from "./account-prefix";

/** Content-ID for the inline logo. Referenced by the <img> in the header. */
export const LOGO_CID = "ichibaan-logo";

/** Read the logo once. Bundled builds run from dist/, so both roots are checked; a
 *  missing logo degrades to the text-only header rather than failing the send. */
let logoCache: Buffer | null | undefined;
function logoBuffer(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  for (const p of [
    resolve(process.cwd(), "server/assets/ichibaan-logo.png"),
    resolve(__dirname ?? ".", "../../assets/ichibaan-logo.png"),
  ]) {
    try {
      if (existsSync(p)) { logoCache = readFileSync(p); return logoCache; }
    } catch { /* try the next candidate */ }
  }
  logoCache = null;
  return null;
}

/** Product lines quoted in the email, in the order the manual template lists them. */
const EMAIL_PRODUCTS: Array<{ label: string; digit: string }> = [
  { label: "⭐ First Class / Premium",     digit: PRODUCT_DIGITS.FC },
  { label: "💼 Business Class / Standard", digit: PRODUCT_DIGITS.BC },
  { label: "🟣 Special Charlie",           digit: PRODUCT_DIGITS.SC },
];

export type AccountDetails = {
  companyName: string;
  contactName: string | null;
  accountName: string;
  accountPrefix: string;
  password: string | null;
  clientIps: string[];
  platformIp: string;
  codec: string;
  recipients: string[];
  /** Wording only — the details are identical either way. */
  accountType: 'test' | 'live';
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline styles throughout: every major email client strips <style> blocks, so a
// stylesheet would render this as unformatted text in exactly the inboxes that matter.
/** Corporate blue, taken from the brand mark. */
const BLUE = '#0B5FA5';

const S = {
  label: 'padding:10px 14px;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:13px;width:44%;',
  value: 'padding:10px 14px;border-bottom:1px solid #e8eaed;color:#202124;font-size:13px;font-weight:600;',
  // Section heading as a tinted bar rather than plain text: it separates the sections
  // visually in clients that collapse vertical margins, which most of them do.
  h2:    `margin:24px 0 0;padding:8px 14px;background:#eaf2fa;border-left:3px solid ${BLUE};color:${BLUE};font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;`,
  table: 'width:100%;border-collapse:collapse;border:1px solid #e8eaed;',
  mono:  'font-family:Consolas,Menlo,monospace;letter-spacing:.02em;',
  th:    'padding:8px 14px;background:#f6f8fa;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;',
};

function table(rows: Array<[string, string, boolean?]>, head?: [string, string]): string {
  const header = head
    ? `<tr><th align="left" style="${S.th}">${esc(head[0])}</th><th align="left" style="${S.th}">${esc(head[1])}</th></tr>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="${S.table}">${header}${
    rows.map(([k, v, mono]) =>
      `<tr><td style="${S.label}">${esc(k)}</td><td style="${S.value}${mono ? S.mono : ''}">${esc(v)}</td></tr>`
    ).join("")
  }</table>`;
}

/** Industry notation: G729 → G.729. The company row stores whatever an operator typed or
 *  a profile seeded ('auto', 'G711u', 'G729,G723'); the customer should always see the
 *  standard form regardless of which. */
export function formatCodecs(raw: string | null | undefined): string {
  if (!raw || raw.trim().toLowerCase() === 'auto') return 'G.729, G.723';
  return raw
    .split(/[,/|]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^G\.?(\d{3})([a-z]*)$/i, (_m, num, suffix) => `G.${num}${suffix.toLowerCase()}`))
    .join(', ');
}

export function subjectFor(d: Pick<AccountDetails, 'accountType'>): string {
  return d.accountType === 'live'
    ? 'Ichibaan Logic – Account Details'
    : 'Ichibaan Logic – Test Account Details';
}

/**
 * Customer-facing HTML. Deliberately contains no platform name, no run reference and no
 * "provisioned successfully" language — the customer is being given credentials, not a
 * report on our automation. Internal traceability lives in the audit log, where it
 * belongs, not in the customer's inbox.
 */
export function renderAccountDetails(d: AccountDetails): string {
  const greeting = d.contactName ? `Dear ${esc(d.contactName)},` : 'Dear Customer,';
  const intro = d.accountType === 'live'
    ? 'Your account has been prepared and is ready for use. Please find your account details below.'
    : 'Your test account has been prepared for connectivity and traffic testing. Please find your account details below.';

  return `
<div style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e8eaed;border-radius:10px;overflow:hidden;">

    <!-- Centred, single-column header: renders identically in Outlook's Word engine, Gmail
         and mobile, where a two-column logo/text layout collapses unpredictably.
         cid: rather than a hosted URL because Gmail and Outlook block remote images by
         default — a linked logo shows as a broken box on first open, the worst possible
         moment on a first-contact email. The wordmark is TEXT, so the header still reads
         correctly in clients that strip images entirely. -->
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
      <p style="margin:0 0 12px;font-size:14px;color:#202124;">${greeting}</p>
      <p style="margin:0 0 10px;font-size:14px;color:#3c4043;line-height:1.6;">Thank you for choosing Ichibaan Logic.</p>
      <p style="margin:0 0 4px;font-size:14px;color:#3c4043;line-height:1.6;">${intro}</p>

      <div style="${S.h2}">Customer Information</div>
      ${table([
        ['Client Name',  d.companyName],
        ['Account Name', d.accountName, true],
        ['Client IP(s)', d.clientIps.join(', ') || 'To be confirmed', true],
      ], ['Item', 'Details'])}

      <div style="${S.h2}">Technical Information</div>
      ${table([
        ['SIP Server (IP)', d.platformIp, true],
        ['Protocol',        'SIP'],
        ['Transport',       'UDP / TCP'],
        ['Codec',           d.codec],
        ['Dial Plan',       'Prefix + Country Code + Destination Number'],
      ], ['Item', 'Details'])}

      <div style="${S.h2}">Routing Prefixes</div>
      ${table(
        EMAIL_PRODUCTS.map(p => [p.label, `${d.accountPrefix}${p.digit}`, true] as [string, string, boolean]),
        ['Service', 'Prefix'],
      )}

      <div style="${S.h2}">Account Credentials</div>
      ${table([
        ['Username', d.accountName, true],
        ['Password', d.password ?? 'Provided separately by our NOC team', true],
      ], ['Item', 'Details'])}

      <div style="${S.h2}">Next Steps</div>
      <p style="margin:0;font-size:13px;color:#3c4043;line-height:1.65;">
        Please configure your SIP trunk using the information above and perform your
        connectivity tests. If you require any assistance during configuration or testing,
        please contact our Network Operations team.
      </p>

      <div style="${S.h2}">Support</div>
      <p style="margin:12px 0 0;font-size:13px;color:#3c4043;line-height:1.65;">
        For any assistance, our Network Operations Center is available at
        <a href="mailto:noc1@ichibaanlogic.com" style="color:${BLUE};text-decoration:none;font-weight:600;">noc1@ichibaanlogic.com</a>.
      </p>
    </div>

    <div style="padding:20px 26px;background:#f6f8fa;border-top:1px solid #e8eaed;font-size:13px;color:#3c4043;line-height:1.7;">
      <div style="color:#202124;font-weight:600;margin-bottom:6px;">Best Regards,</div>
      Network Operations Center (NOC)<br>
      Ichibaan Logic Private Limited<br>
      International Voice Business<br><br>
      <a href="mailto:noc1@ichibaanlogic.com" style="color:${BLUE};text-decoration:none;">noc1@ichibaanlogic.com</a>
      &nbsp;·&nbsp;
      <a href="https://www.ichibaanlogic.com" style="color:${BLUE};text-decoration:none;">www.ichibaanlogic.com</a>
    </div>

    <div style="padding:14px 26px;background:#eef1f4;border-top:1px solid #e0e4e8;font-size:11px;color:#5f6368;line-height:1.6;">
      <strong style="color:#3c4043;">Confidentiality Notice:</strong> This email contains account
      credentials intended solely for the designated recipient. Please keep this information secure
      and do not share it with unauthorized parties.
    </div>

  </div>
</div>`.trim();
}

/** Gather everything the email quotes from the company record and its approved IPs. */
export async function collectAccountDetails(
  companyId: number,
  opts: { accountName?: string; password?: string | null; accountType?: 'test' | 'live' } = {},
): Promise<AccountDetails | { error: string }> {
  const { rows } = await pool.query<any>(
    `SELECT c.name, c.account_prefix, c.codec, c.invoice_email,
            COALESCE(
              (SELECT array_agg(i.ip_address ORDER BY i.id)
                 FROM client_ip_requests i
                WHERE i.company_id = c.id AND i.status = 'approved'), '{}') AS ips,
            -- Recipients are restricted BY ROLE. This email carries SIP credentials, IPs
            -- and routing prefixes — a technical handover, not a finance document. Finance,
            -- billing, rates, invoicing and accounts contacts have no use for it and every
            -- extra copy of a live credential is an extra place it can leak.
            COALESCE(
              (SELECT array_agg(DISTINCT ct.email) FROM company_contacts ct
                WHERE ct.company_id = c.id
                  AND ct.email IS NOT NULL AND ct.email <> ''
                  AND LOWER(ct.contact_type) IN ('technical', 'support', 'noc', 'commercial')
              ), '{}') AS contact_emails,
            -- Technical contact preferred for the greeting: this email is a configuration
            -- handover, so it is addressed to whoever will act on it.
            (SELECT TRIM(CONCAT(ct.first_name, ' ', ct.last_name))
               FROM company_contacts ct
              WHERE ct.company_id = c.id AND COALESCE(ct.first_name, '') <> ''
              ORDER BY (ct.contact_type = 'technical') DESC, ct.id
              LIMIT 1) AS contact_name
       FROM companies c WHERE c.id = $1`, [companyId]);

  const c = rows[0];
  if (!c) return { error: `Company ${companyId} not found.` };
  if (!c.account_prefix) return { error: 'Company has no account prefix — the product prefixes in the email derive from it.' };

  // Deliberately NOT falling back to invoice_email: that is a finance address, and this
  // email carries credentials. No fallback to a platform inbox either — sending customer
  // credentials to the wrong place is worse than not sending at all.
  const recipients = Array.from(new Set<string>(
    (c.contact_emails ?? [])
      .filter((e: any) => typeof e === 'string' && e.includes('@'))
      .map((e: string) => e.trim().toLowerCase()),
  ));
  if (!recipients.length) {
    return { error: 'No support or commercial contact has an email address. Account details are not sent to finance, billing, rates or invoicing contacts, so there is no eligible recipient — add a technical or commercial contact and resend.' };
  }

  // ── The IP the customer points traffic at ──────────────────────────────────
  // SIPPY_SIP_IP first, because a deployment whose SIP edge differs from its XML-RPC
  // address needs to say so. When it is unset — which it is on this deployment — fall
  // back to the switch the platform is ALREADY configured against rather than to a
  // literal. The address exists once, in settings.portal_url, and every XML-RPC call
  // already uses it; a hardcoded copy here would be the fifth in this repository and the
  // first one to go stale would send customers to a switch that no longer answers.
  //
  // Still an error if neither is available: an email that omits the IP, or invents one,
  // is worse than an email that was not sent. The customer would point traffic nowhere
  // and open a ticket against us.
  let platformIp = process.env.SIPPY_SIP_IP?.trim() || '';
  let ipSource   = 'SIPPY_SIP_IP';
  if (!platformIp) {
    const { rows: sRows } = await pool.query<{ portal_url: string | null }>(
      `SELECT portal_url FROM settings LIMIT 1`);
    // "https://191.101.30.107:8443/" → "191.101.30.107". Host only: the customer points
    // SIP at the host, not at the management URL.
    const host = String(sRows[0]?.portal_url ?? '')
      .replace(/^[a-z]+:\/\//i, '').split('/')[0].split(':')[0].trim();
    if (host) { platformIp = host; ipSource = 'settings.portal_url'; }
  }
  if (!platformIp) {
    return { error: 'No platform SIP IP is configured — set SIPPY_SIP_IP, or the Sippy portal URL in Settings. The email quotes it as the address the customer sends traffic to, so it cannot be guessed.' };
  }
  console.log(`[account-details] platform SIP IP ${platformIp} (from ${ipSource})`);

  return {
    companyName:   c.name,
    contactName:   c.contact_name || null,
    accountName:   opts.accountName ?? c.name,
    accountPrefix: c.account_prefix,
    password:      opts.password ?? null,
    clientIps:     c.ips ?? [],
    platformIp,
    codec:         formatCodecs(c.codec),
    recipients,
    accountType:   opts.accountType ?? 'test',
  };
}

/**
 * Render and send. Returns a reason rather than throwing — a failed email must never
 * turn a successful provision into a failed one, but it must be recorded, not swallowed.
 */
export async function sendAccountDetailsEmail(
  companyId: number,
  opts: { accountName?: string; password?: string | null; accountType?: 'test' | 'live' } = {},
): Promise<{ ok: boolean; recipients?: string[]; error?: string }> {
  const details = await collectAccountDetails(companyId, opts);
  if ('error' in details) return { ok: false, error: details.error };

  const to      = details.recipients.join(', ');
  const subject = subjectFor(details);
  const html    = renderAccountDetails(details);
  // From name is the customer-facing department, never the platform. A customer receiving
  // "Bitsauto Monitoring" in their inbox learns an internal system name for no benefit.
  const fromName = 'Ichibaan Logic Support';

  const logo = logoBuffer();
  const res = logo
    ? await sendDirectEmailWithAttachment({
        to, subject, html, fromName,
        attachment: { filename: 'ichibaan-logo.png', content: logo, contentType: 'image/png', cid: LOGO_CID },
      })
    : await sendDirectEmail({ to, subject, html });

  return res.ok
    ? { ok: true, recipients: details.recipients }
    : { ok: false, recipients: details.recipients, error: res.error };
}
