/**
 * The regression these pin: credentials present + alerts toggle OFF must read
 * as a configured sender. That exact state stood in production on
 * 2026-09-14 and was reported as "credentials missing".
 */
import { describe, it, expect } from 'vitest';
import { describeEmailSender, senderNotConfiguredMessage } from './email-sender-state';

describe('describeEmailSender', () => {
  it('is configured when both credentials are present, even with alerts switched off', () => {
    const s = describeEmailSender({ alertEnabled: false, alertGmailUser: 'alerts@example.com', alertGmailAppPass: 'abcd efgh ijkl mnop' });
    expect(s.configured).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.alertsEnabled).toBe(false);
    expect(s.from).toBe('alerts@example.com');
  });

  it('reports the toggle separately from the credentials', () => {
    const on  = describeEmailSender({ alertEnabled: true,  alertGmailUser: 'a@b.c', alertGmailAppPass: 'x' });
    const off = describeEmailSender({ alertEnabled: false, alertGmailUser: 'a@b.c', alertGmailAppPass: 'x' });
    expect(on.configured).toBe(off.configured);
    expect(on.alertsEnabled).toBe(true);
    expect(off.alertsEnabled).toBe(false);
  });

  it('names the empty credential', () => {
    const s = describeEmailSender({ alertEnabled: true, alertGmailUser: 'a@b.c', alertGmailAppPass: '' });
    expect(s.configured).toBe(false);
    expect(s.missing).toEqual(['Gmail app password']);
    expect(senderNotConfiguredMessage(s)).toBe('Gmail sender not configured — Gmail app password is empty. Add it in Settings → Alerts and save.');
  });

  it('names both when both are empty, and treats whitespace as empty', () => {
    const s = describeEmailSender({ alertEnabled: true, alertGmailUser: '   ', alertGmailAppPass: null });
    expect(s.missing).toEqual(['Gmail user', 'Gmail app password']);
    expect(s.from).toBeNull();
    expect(senderNotConfiguredMessage(s)).toBe('Gmail sender not configured — Gmail user and Gmail app password are empty. Add them in Settings → Alerts and save.');
  });

  it('never blames the alerts toggle for a missing credential (it may name the Alerts page)', () => {
    const s = describeEmailSender({ alertEnabled: false, alertGmailUser: null, alertGmailAppPass: null });
    const msg = senderNotConfiguredMessage(s);
    expect(msg).not.toMatch(/not enabled|switched off|disabled|enable/i);
    expect(msg).toContain('Settings → Alerts');
  });
});
