/**
 * The branded rate notification.
 *
 * Two kinds of assertion here. The visual ones check it really is the house template rather than
 * a lookalike. The legal ones check the thing that can cost money: a CHANGES notice must never
 * carry FULL's deletion clause, because under FULL every destination the sheet omits is withdrawn.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderRateNotification, subjectForRateNotification, rateNotificationLogoAttachment,
  type RateNotificationView,
} from "./rate-notification-render";
import { LOGO_CID } from "../provisioning/account-details-email";

const view = (o: Partial<RateNotificationView> = {}): RateNotificationView => ({
  clientName: 'Shareef Telecom',
  productLabel: 'Voice A-Z',
  issueDate: '18 Aug 2026',
  effectiveDate: '20 Aug 2026',
  dialFormat: '19230[Country Code][Number]',
  kind: 'CHANGES',
  rows: [
    { destination: 'Afghanistan Mobile', prefix: '9230', previousRate: '0.0500', newRate: '0.0450', billingIncrement: '60/1', effectiveDate: '20 Aug 2026' },
    { destination: 'Afghanistan Mobile', prefix: '9231', previousRate: '0.0500', newRate: '0.0450', billingIncrement: '60/1', effectiveDate: '20 Aug 2026' },
  ],
  ...o,
});

describe("it is the house template, not a lookalike", () => {
  const html = renderRateNotification(view());

  it("uses the SAME logo, embedded as cid rather than a hosted URL", () => {
    // Gmail and Outlook block remote images by default; a hosted logo is a broken box on first
    // open, which is the worst possible moment.
    expect(html).toContain(`cid:${LOGO_CID}`);
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it("ships the attachment the cid: reference needs, from the same module as the markup", () => {
    // Nothing in the HTML can enforce that a sender attaches the logo. Exporting the spec beside
    // the markup makes the two hard to separate: a sender takes it from here, or the header shows
    // a broken image box in every inbox while the send reports success.
    const a = rateNotificationLogoAttachment();
    expect(a).not.toBeNull();
    expect(a!.cid).toBe(LOGO_CID);
    expect(a!.contentType).toBe('image/png');
    expect(a!.content.length).toBeGreaterThan(1000);
    // The cid the HTML asks for and the cid the attachment carries must be the same string.
    expect(html).toContain(`cid:${a!.cid}`);
  });

  it("keeps the wordmark as TEXT, so a client that strips images still reads correctly", () => {
    expect(html).toContain('>Ichibaan Logic<');
    expect(html).toContain('International Voice Business');
  });

  it("uses the corporate blue and the tinted section bars", () => {
    expect(html).toContain('#0B5FA5');
    expect(html).toContain('background:#eaf2fa');
  });

  it("styles are INLINE, since every major client strips style blocks", () => {
    expect(html).not.toContain('<style');
    expect(html).toContain('style="');
  });

  it("carries the commercial footer, not the credentials one", () => {
    expect(html).toContain('sales@ichibaanlogic.com');
    expect(html).toContain('formerly Bhaoo Private Limited');
    // The account-details email's audience and confidentiality treatment are not this document's.
    expect(html).not.toContain('noc1@ichibaanlogic.com');
    expect(html).not.toContain('Confidentiality Notice');
  });
});

describe("the content is commercial", () => {
  const html = renderRateNotification(view());

  it("addresses the client and states the summary", () => {
    expect(html).toContain('Dear Shareef Telecom,');
    expect(html).toContain('Voice A-Z');
    expect(html).toContain('18 Aug 2026');
    expect(html).toContain('19230[Country Code][Number]');
  });

  it("shows all six rate columns", () => {
    for (const h of ['Destination', 'Prefix', 'Previous Rate', 'New Rate', 'Billing Increment', 'Effective Date']) {
      expect(html, h).toContain(h);
    }
  });

  it("shows previous and new rate side by side, per destination", () => {
    expect(html).toContain('0.0500');
    expect(html).toContain('0.0450');
    expect(html).toContain('Afghanistan Mobile');
    expect(html).toContain('60/1');
  });

  it("quotes the BARE prefix, never a trunk-composed one", () => {
    // 19230 is trunk 1 + dial 9230 and belongs only in the dial-format line.
    expect(html).toMatch(/>9230</);
    expect(html).toContain('19230[Country Code][Number]');
  });

  it("shows a dash where there is no previous rate, rather than inventing one", () => {
    const html2 = renderRateNotification(view({
      rows: [{ destination: 'New Dest', prefix: '880', previousRate: null, newRate: '0.0300', billingIncrement: null, effectiveDate: '20 Aug 2026' }],
    }));
    expect(html2).toContain('&mdash;');
    expect(html2).not.toContain('0.0000');
  });

  it("shows a dash for an unknown increment rather than defaulting to 1/1", () => {
    // Defaulting would state a billing term nobody agreed.
    const html2 = renderRateNotification(view({
      rows: [{ destination: 'X', prefix: '880', previousRate: '0.05', newRate: '0.04', billingIncrement: null, effectiveDate: '20 Aug 2026' }],
    }));
    expect(html2).not.toContain('1/1');
  });

  it("escapes client-supplied text", () => {
    const html2 = renderRateNotification(view({ clientName: 'A & B <script>' }));
    expect(html2).toContain('A &amp; B &lt;script&gt;');
    expect(html2).not.toContain('<script>');
  });
});

describe("THE LEGAL CLAUSE: only the one that governs appears", () => {
  it("a CHANGES notice says unlisted destinations are unaffected", () => {
    const html = renderRateNotification(view({ kind: 'CHANGES' }));
    expect(html).toContain('CHANGES (PARTIAL) NOTIFICATION');
    expect(html).toMatch(/remain valid and unaffected/);
  });

  it("a CHANGES notice NEVER carries the deletion clause", () => {
    // The expensive misreading: a partial sheet read under FULL withdraws every destination it
    // does not list.
    const html = renderRateNotification(view({ kind: 'CHANGES' }));
    expect(html).not.toMatch(/considered DELETED/i);
    expect(html).not.toContain('FULL / A2Z NOTIFICATION');
  });

  it("a FULL notice carries the deletion clause, and only that", () => {
    const html = renderRateNotification(view({ kind: 'FULL' }));
    expect(html).toContain('FULL / A2Z NOTIFICATION');
    expect(html).toMatch(/considered DELETED/);
    expect(html).not.toContain('CHANGES (PARTIAL) NOTIFICATION');
  });

  it("the Notification Type row agrees with the clause shown", () => {
    expect(renderRateNotification(view({ kind: 'CHANGES' }))).toContain('CHANGES (PARTIAL)');
    expect(renderRateNotification(view({ kind: 'FULL' }))).toContain('FULL / A2Z');
  });

  it("the subject states the kind, so triage happens before opening", () => {
    expect(subjectForRateNotification(view({ kind: 'CHANGES' })))
      .toBe('Rate Notification (CHANGES) - Shareef Telecom - Voice A-Z - Effective 20 Aug 2026');
    expect(subjectForRateNotification(view({ kind: 'FULL' }))).toContain('(FULL)');
  });
});

describe("Account Details is untouched", () => {
  it("its module is not modified by this one", () => {
    const acct = readFileSync(join(__dirname, '..', 'provisioning', 'account-details-email.ts'), 'utf8');
    // Still the credentials document, with its own audience and confidentiality treatment.
    expect(acct).toContain('Confidentiality Notice');
    expect(acct).toContain('noc1@ichibaanlogic.com');
    expect(acct).not.toContain('renderRateNotification');
  });

  it("this module borrows only the logo constant", () => {
    const CODE = readFileSync(join(__dirname, 'rate-notification-render.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(CODE).toContain("import { LOGO_CID } from '../provisioning/account-details-email'");
    expect(CODE).not.toContain('renderAccountDetails');
    // And it sends nothing.
    for (const t of ['sendmail', 'sendemail', 'nodemailer', 'fetch(']) {
      expect(CODE.toLowerCase(), t).not.toContain(t);
    }
  });
});
