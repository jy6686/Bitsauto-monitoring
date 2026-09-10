/**
 * Post-push CHANGES notification: what a client is told after a rate push.
 *
 * The dangerous assertions come first. Announcing a rate that did not land, or labelling a
 * partial sheet FULL, both reach the customer as a false commercial statement - the second one
 * silently, because under FULL every destination the sheet omits is DELETED.
 *
 * Nothing here sends anything: this module derives rows and has no transport.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveNotificationsFromPush, pushJustifiesNotification, type AppliedOperation,
} from "./post-push-notification";
import { renderRateNotificationHtml } from "../provisioning/rate-notification-email";

const op = (o: Partial<AppliedOperation> = {}): AppliedOperation => ({
  accountName: 'ACME', productName: 'FC', trunkPrefix: '1',
  dialPrefix: '9230', fullPrefix: '19230', destinationName: 'PAKISTAN - MOBILE JAZZ',
  requestedRate: 0.045, status: 'succeeded', refusedBeforeWrite: false, ...o,
});

describe("ONLY PROVEN SUCCESS IS ANNOUNCED", () => {
  it("includes a succeeded operation", () => {
    const r = deriveNotificationsFromPush([op()]);
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].rows).toHaveLength(1);
  });

  it("EXCLUDES an indeterminate operation, and says why", () => {
    // Nobody established what the switch did. Telling a customer the rate is live would be a
    // claim the platform cannot support.
    const r = deriveNotificationsFromPush([op({ status: 'indeterminate' })]);
    expect(r.notifications).toHaveLength(0);
    expect(r.excluded[0].reason).toMatch(/not established/i);
  });

  it("excludes failed, not_attempted and pending operations", () => {
    for (const status of ['failed', 'not_attempted', 'pending', 'running']) {
      const r = deriveNotificationsFromPush([op({ status })]);
      expect(r.notifications, status).toHaveLength(0);
      expect(r.excluded, status).toHaveLength(1);
    }
  });

  it("excludes a contradictory record that claims success but sent nothing", () => {
    const r = deriveNotificationsFromPush([op({ refusedBeforeWrite: true })]);
    expect(r.notifications).toHaveLength(0);
    expect(r.excluded[0].reason).toMatch(/contradictory/i);
  });

  it("a push where nothing succeeded justifies no notification at all", () => {
    const ops = [op({ status: 'failed' }), op({ status: 'indeterminate' })];
    expect(pushJustifiesNotification(ops)).toBe(false);
    expect(deriveNotificationsFromPush(ops).notifications).toEqual([]);
  });

  it("a mixed push announces only the successful part", () => {
    const r = deriveNotificationsFromPush([
      op({ dialPrefix: '9230', fullPrefix: '19230', status: 'succeeded' }),
      op({ dialPrefix: '9231', fullPrefix: '19231', status: 'indeterminate' }),
      op({ dialPrefix: '9232', fullPrefix: '19232', status: 'failed' }),
    ]);
    expect(r.notifications[0].rows.map(x => x.prefix)).toEqual(['9230']);
    expect(r.excluded).toHaveLength(2);
  });

  it("every exclusion is reported, so an omission is never silent", () => {
    const r = deriveNotificationsFromPush([op({ status: 'indeterminate' }), op({ requestedRate: null })]);
    expect(r.excluded).toHaveLength(2);
    expect(r.excluded.every(e => e.reason.length > 0)).toBe(true);
  });
});

describe("THE CUSTOMER NEVER SEES OUR TRUNK", () => {
  it("quotes the bare dial prefix, not the trunk-composed one", () => {
    // fullPrefix is 19230: trunk 1 + dial 9230. Publishing it as the destination prefix would
    // expose our routing scheme as though it were a dialling code.
    const r = deriveNotificationsFromPush([op()]);
    expect(r.notifications[0].rows[0].prefix).toBe('9230');
    expect(r.notifications[0].rows[0].prefix).not.toBe('19230');
  });

  it("the trunk digit is carried separately, for the dial-format line", () => {
    expect(deriveNotificationsFromPush([op()]).notifications[0].rows[0].productDigit).toBe('1');
  });

  it("refuses to quote anything when no bare prefix was recorded", () => {
    const r = deriveNotificationsFromPush([op({ dialPrefix: null })]);
    expect(r.notifications).toHaveLength(0);
    expect(r.excluded[0].reason).toMatch(/must not be quoted/i);
  });
});

describe("grouping matches the existing per-product behaviour", () => {
  it("one notification per client per product", () => {
    const r = deriveNotificationsFromPush([
      op({ accountName: 'ACME', productName: 'FC', dialPrefix: '9230' }),
      op({ accountName: 'ACME', productName: 'BC', dialPrefix: '9230', trunkPrefix: '2' }),
      op({ accountName: 'BETA', productName: 'FC', dialPrefix: '9230' }),
    ]);
    expect(r.notifications).toHaveLength(3);
  });

  it("several destinations for one client and product share one sheet", () => {
    const r = deriveNotificationsFromPush([
      op({ dialPrefix: '9230' }), op({ dialPrefix: '9231' }), op({ dialPrefix: '9232' }),
    ]);
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].rows.map(x => x.prefix)).toEqual(['9230', '9231', '9232']);
  });

  it("uses the supplied product label", () => {
    const r = deriveNotificationsFromPush([op()], { productLabelFor: c => c === 'FC' ? 'FIRST CLASS' : c });
    expect(r.notifications[0].productLabel).toBe('FIRST CLASS');
  });
});

describe("THE LEGAL LABEL: CHANGES, not FULL", () => {
  const rows = deriveNotificationsFromPush([op()]).notifications[0].rows;
  const render = (t?: 'FULL' | 'CHANGES') => renderRateNotificationHtml({
    companyName: 'ACME', productLabel: 'FIRST CLASS', dialFormat: '1[Country Code][Number]',
    issueDate: '11 September 2026', rows, notificationType: t,
  });

  it("renders CHANGES/PARTIAL when asked", () => {
    expect(render('CHANGES')).toContain('CHANGES/PARTIAL');
    expect(render('CHANGES')).not.toMatch(/Notification Type:.*<strong>FULL<\/strong>/);
  });

  it("says the sheet contains only what changed", () => {
    expect(render('CHANGES')).toMatch(/only the destinations whose rates have changed/i);
  });

  it("DEFAULTS to FULL, so every existing caller is unchanged", () => {
    // Provisioning still sends a full sheet and must keep doing so.
    expect(render()).toContain('<strong>FULL</strong>');
  });

  it("keeps BOTH legal paragraphs in either mode - they define each other", () => {
    for (const t of ['FULL', 'CHANGES'] as const) {
      const html = render(t);
      expect(html, t).toMatch(/FULL\/A2Z/);
      expect(html, t).toMatch(/considered to be DELETED/);
      expect(html, t).toMatch(/CHANGES\/PARTIAL/);
      expect(html, t).toMatch(/still considered\s*\n?\s*valid/);
    }
  });

  it("the rate table shows the bare prefix with a plus, at the pushed rate", () => {
    const html = render('CHANGES');
    expect(html).toContain('+9230');
    expect(html).toContain('0.0450');
    expect(html).toContain('PAKISTAN - MOBILE JAZZ');
  });
});

describe("this module sends nothing and invents nothing", () => {
  const CODE = readFileSync(join(__dirname, 'post-push-notification.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it("reaches no transport", () => {
    for (const t of ['sendmail', 'sendemail', 'nodemailer', 'fetch(']) {
      expect(CODE.toLowerCase(), t).not.toContain(t);
    }
  });

  it("NEVER re-queries product_rates to reconstruct the sheet", () => {
    // The whole reason this module exists: the sheet must describe what landed, not the matrix.
    expect(CODE).not.toContain('product_rates');
    expect(CODE).not.toContain('productRates');
    expect(CODE.toLowerCase()).not.toContain('select ');
  });
});
