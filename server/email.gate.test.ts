/**
 * The contract the 2026-09-14 change must keep:
 *   - automated ALERTS honour "Enable Email Alerts" exactly as before;
 *   - the MAILBOX (test connection, direct/transactional mail) does not.
 * Mailer and storage are mocked so no network or database is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verify = vi.fn(async () => true);
const sendMail = vi.fn(async () => ({}));
const createTransport = vi.fn(() => ({ verify, sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const settings: Record<string, any> = {};
vi.mock('./storage', () => ({
  storage: {
    getSettings: vi.fn(async () => settings),
    getWatcherRecipients: vi.fn(async () => []),
  },
}));
vi.mock('./db', () => ({ db: {} }));
vi.mock('../shared/schema', () => ({ userRoles: {}, userConfig: {} }));
vi.mock('../shared/models/auth', () => ({ users: {} }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), inArray: () => ({}) }));

const email = await import('./email');

function configure(over: Record<string, any>) {
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, {
    alertEnabled: true, alertAdminEmail: 'admin@example.com',
    alertGmailUser: 'alerts@example.com', alertGmailAppPass: 'abcd efgh ijkl mnop',
  }, over);
}

beforeEach(() => { verify.mockClear(); sendMail.mockClear(); createTransport.mockClear(); });

describe('alerts toggle OFF, credentials present (production on 2026-09-14)', () => {
  beforeEach(() => configure({ alertEnabled: false }));

  it('the mailbox verifies — the Alerts test and readiness both read this', async () => {
    const r = await email.testEmailConfig();
    expect(r).toEqual({ ok: true, from: 'alerts@example.com', alertsEnabled: false });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('an automated alert is NOT sent', async () => {
    const sent = await email.sendAlertEmail({ subject: 'Balance low', bodyHtml: '<p>x</p>' } as any);
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    expect(await email.alertEmailConfigured()).toBe(false);
  });

  it('a direct (transactional) email IS sent — account details are not an alert', async () => {
    const r = await email.sendDirectEmail({ to: 'customer@example.com', subject: 'Account Details', html: '<p>x</p>' } as any);
    expect(r.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('alerts toggle ON, credentials present', () => {
  beforeEach(() => configure({ alertEnabled: true }));

  it('alerts go out and the alert-configured check says so', async () => {
    expect(await email.alertEmailConfigured()).toBe(true);
    const sent = await email.sendAlertEmail({ subject: 'Balance low', bodyHtml: '<p>x</p>' } as any);
    expect(sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('a credential is empty', () => {
  beforeEach(() => configure({ alertEnabled: true, alertGmailAppPass: '' }));

  it('every path names the empty field instead of blaming the toggle', async () => {
    const t = await email.testEmailConfig();
    expect(t.ok).toBe(false);
    expect(t.error).toContain('Gmail app password');
    expect(t.error).not.toMatch(/alerts? (not )?enabled/i);
    const d = await email.sendDirectEmail({ to: 'c@example.com', subject: 's', html: 'h' } as any);
    expect(d.ok).toBe(false);
    expect(d.error).toContain('Gmail app password');
    expect(await email.alertEmailConfigured()).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
