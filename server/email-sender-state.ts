/**
 * email-sender-state.ts — what state the shared Gmail sender is in.
 *
 * Pure, so it can be tested and so every message about the sender — the
 * Alerts test button, provisioning readiness, the direct senders — says the
 * same thing from the same facts.
 *
 * WHY THIS EXISTS. Until 2026-09-14 the transport itself was gated on the
 * "Enable Email Alerts" toggle: getTransporter() returned nothing whenever
 * alerts were off, so the Alerts test, provisioning readiness, the account
 * details email, incident mail and the Email Centre all went dark together,
 * with one merged message — "Email alerts not enabled or credentials
 * missing" — that could not say which. Production on 2026-09-14 had the
 * credentials set and the toggle off; readiness warned, and the warning was
 * true: the account details email would have failed for the same reason.
 *
 * The toggle means "send automated alerts". Whether the mailbox is usable is
 * a different fact, and this module states it: configured = both credentials
 * present. Alert-only senders still consult `alertsEnabled` themselves.
 */

export type EmailSenderInput = {
  alertEnabled?: boolean | null;
  alertGmailUser?: string | null;
  alertGmailAppPass?: string | null;
};

export type MissingCredential = 'Gmail user' | 'Gmail app password';

export type EmailSenderState = {
  /** Both credentials present — the mailbox can be opened, whatever the alerts toggle says. */
  configured: boolean;
  /** Which credential(s) are empty, named as the Settings → Alerts form labels them. */
  missing: MissingCredential[];
  /** The "Enable Email Alerts" toggle. Gates automated alerts only. */
  alertsEnabled: boolean;
  /** The mailbox, when configured — what sent mail will come from. */
  from: string | null;
};

const present = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

export function describeEmailSender(s: EmailSenderInput): EmailSenderState {
  const missing: MissingCredential[] = [];
  if (!present(s.alertGmailUser))    missing.push('Gmail user');
  if (!present(s.alertGmailAppPass)) missing.push('Gmail app password');
  return {
    configured: missing.length === 0,
    missing,
    alertsEnabled: !!s.alertEnabled,
    from: missing.length === 0 ? s.alertGmailUser!.trim() : null,
  };
}

/**
 * The one sentence every caller shows when the sender is not configured.
 * Names the empty field(s) and where to fill them; never mentions the alerts
 * toggle, because the toggle is not the reason.
 */
export function senderNotConfiguredMessage(state: EmailSenderState): string {
  const list = state.missing.join(' and ');
  const one = state.missing.length === 1;
  return `Gmail sender not configured — ${list} ${one ? 'is' : 'are'} empty. Add ${one ? 'it' : 'them'} in Settings → Alerts and save.`;
}
