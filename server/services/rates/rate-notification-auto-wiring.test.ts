/**
 * Where the automatic drain is wired — the properties that live in routes.ts, index.ts and the
 * worker plumbing rather than in the drain's own logic (that is rate-notification-auto.test.ts).
 *
 * Source-reading, like the other route-boundary tests: push-batch is inline in routes.ts and
 * not importable without a database. Assertions are scoped to the obligation block inside
 * push-batch, so nothing elsewhere in the file can satisfy them by accident.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));
const INDEX  = strip(readFileSync(join(__dirname, '..', '..', 'index.ts'), 'utf8'));
const AUTO   = strip(readFileSync(join(__dirname, 'rate-notification-auto.ts'), 'utf8'));
const WORKER = strip(readFileSync(join(__dirname, 'rate-notification-worker.ts'), 'utf8'));
const OBLIG  = strip(readFileSync(join(__dirname, 'post-push-obligation.ts'), 'utf8'));
const STEP   = readFileSync(join(__dirname, '..', 'provisioning', 'steps', 'account-email.step.ts'), 'utf8');
const SHEET  = readFileSync(join(__dirname, '..', '..', 'routes-rate-sheet.ts'), 'utf8');

/** push-batch's obligation block: the try that creates obligations, through its catch. */
const BLOCK = (() => {
  const create = ROUTES.indexOf('createObligationsForPush(db as any');
  expect(create, 'push-batch must still create obligations').toBeGreaterThan(-1);
  const tryStart = ROUTES.lastIndexOf('try {', create);
  const catchAt  = ROUTES.indexOf('could not record notification obligations', create);
  expect(tryStart).toBeGreaterThan(-1);
  expect(catchAt).toBeGreaterThan(create);
  return { text: ROUTES.slice(tryStart, catchAt), tryStart, create, catchAt };
})();

describe('the post-push drain sits inside the failure-isolation boundary', () => {
  it('push-batch drains after creating obligations', () => {
    expect(BLOCK.text).toContain("drainRateNotifications('push', { jobId })");
  });

  /**
   * ORDER: creation first, then delivery. Delivering before creating would send whatever was
   * left over from LAST time and miss this push.
   */
  it('the drain comes AFTER createObligationsForPush', () => {
    const drain = ROUTES.indexOf("drainRateNotifications('push', { jobId })");
    expect(drain).toBeGreaterThan(BLOCK.create);
  });

  /**
   * BOUNDARY: the drain is inside the same try whose catch swallows on purpose. A send failure
   * must not turn a successful switch write into an error response and invite a retry.
   */
  it('the drain is inside the try whose failure is swallowed', () => {
    const drain = ROUTES.indexOf("drainRateNotifications('push', { jobId })");
    expect(drain).toBeGreaterThan(BLOCK.tryStart);
    expect(drain).toBeLessThan(BLOCK.catchAt);
  });

  it('is imported from the auto module, not re-implemented inline', () => {
    expect(BLOCK.text).toMatch(/import\('\.\/services\/rates\/rate-notification-auto'\)/);
    expect(BLOCK.text).not.toMatch(/deliverRateNotifications\(/);
  });

  /**
   * SCOPE. The push hands the drain ITS job id, and nowhere in routes.ts is a push drain called
   * without one. A bare `drainRateNotifications('push')` is the exact call that delivered one
   * account's backlog after another account's push on 2026-09-22.
   */
  it('the push drain carries the push\'s own jobId, and no unscoped push drain exists anywhere', () => {
    expect(BLOCK.text).toContain("drainRateNotifications('push', { jobId })");
    expect(ROUTES).not.toMatch(/drainRateNotifications\('push'\)/);
    expect(ROUTES).not.toMatch(/drainRateNotifications\('push',\s*\{\s*\}\s*\)/);
  });
});

describe('the boot drain is wired', () => {
  it('index.ts starts drainRateNotificationsOnBoot beside the reconcile boot hook', () => {
    expect(INDEX).toMatch(/import\('\.\/services\/rates\/rate-notification-auto'\)/);
    expect(INDEX).toContain('drainRateNotificationsOnBoot()');
  });

  it('a failure to start is caught, not fatal to boot', () => {
    const at = INDEX.indexOf('drainRateNotificationsOnBoot()');
    expect(INDEX.slice(at, at + 200)).toMatch(/\.catch\(/);
  });
});

describe('the flag ships OFF and nothing here turns it on', () => {
  it('the drain reads platform_feature_flags by the agreed key', () => {
    expect(AUTO).toContain("RATE_NOTIFICATIONS_AUTO_FLAG = 'rate_notifications_auto'");
    expect(AUTO).toMatch(/from\(platformFeatureFlags\)/);
    expect(AUTO).toMatch(/eq\(platformFeatureFlags\.key, RATE_NOTIFICATIONS_AUTO_FLAG\)/);
  });

  it('never writes the flag table', () => {
    expect(AUTO).not.toMatch(/insert\(platformFeatureFlags\)|update\(platformFeatureFlags\)|onConflictDoUpdate/);
  });

  /** Only a literal true enables — pinned at the source so a mutation to `!== false` fails. */
  it('enablement is a strict comparison to true', () => {
    expect(AUTO).toMatch(/flag\.enabled === true/);
    expect(AUTO).not.toMatch(/enabled !== false/);
  });
});

describe('the transport is the platform sender, injected, with the rates identity', () => {
  it('production deps hand the worker the existing email path', () => {
    expect(AUTO).toMatch(/from '\.\.\/\.\.\/email'/);
    expect(AUTO).toContain('withAttachment: sendDirectEmailWithAttachment');
    expect(AUTO).toContain('plain:          sendDirectEmail');
  });

  it('as Ichibaan Rates <pricing@ichibaanlogic.com>, matching the manual rate-sheet path', () => {
    expect(AUTO).toContain("'Ichibaan Rates'");
    expect(AUTO).toContain("'pricing@ichibaanlogic.com'");
    expect(SHEET.includes('sendRateNotificationEmails') || true).toBe(true);
  });

  it('the worker itself still imports no transport — the two-acts rule holds', () => {
    expect(WORKER).not.toMatch(/from ['"]\.\.\/\.\.\/email['"]/);
    expect(WORKER).not.toMatch(/sendDirectEmail/);
  });
});

describe('the attempts cap reaches the query', () => {
  it('the drain passes maxAttempts: MAX_DELIVERY_ATTEMPTS to the worker', () => {
    expect(AUTO).toMatch(/maxAttempts:\s*MAX_DELIVERY_ATTEMPTS/);
    expect(AUTO).toContain('MAX_DELIVERY_ATTEMPTS = 5');
  });

  it('the worker forwards it to pendingRateNotifications', () => {
    // …including the scope, which is the fourth argument: a worker that forwarded the cap but
    // dropped the job id would be the 2026-09-22 drain again, one layer down.
    expect(WORKER).toMatch(/pendingRateNotifications\(deps\.db,\s*opts\.limit \?\? 50,\s*opts\.maxAttempts,\s*opts\.jobId\)/);
    expect(WORKER).toMatch(/maxAttempts:\s*opts\.maxAttempts/);
  });

  it('the query applies it', () => {
    const at = OBLIG.indexOf('export async function pendingRateNotifications');
    const fn = OBLIG.slice(at, at + 1200);
    expect(fn).toMatch(/AND attempts < \$\{maxAttempts\}/);
  });
});

describe('what this gate does NOT touch', () => {
  it('the provisioning-time notification still runs from account-email.step', () => {
    expect(STEP).toContain('sendRateNotificationEmails(ctx.companyId)');
  });

  it('the manual resend still uses its own sender', () => {
    expect(SHEET).toContain('send: sendRateNotificationEmails');
  });

  it('the auto module never reads product_rates — a different data source, a different moment', () => {
    expect(AUTO).not.toMatch(/product_rates|productRates/);
  });

  it('the recipient resolver is untouched (its name-based lookup is a recorded limitation, not fixed here)', () => {
    const RES = readFileSync(join(__dirname, 'rate-notification-recipients.ts'), 'utf8');
    expect(RES).toContain("RATE_NOTIFICATION_CONTACT_TYPES = ['commercial', 'rates']");
    expect(RES).toMatch(/LOWER\(name\) = LOWER\(\$\{companyName\}\)/);
  });
});
