// server/approval-notifications.ts
// ── Out-of-band notifications for pending approval expiry ─────────────────────
//
// Called by expireStaleApprovals() after each action transitions to 'rejected'.
// Reads operator preferences from the settings table and dispatches:
//   1. Email alert  — resolves the requesting operator's email from watcher_recipients
//                     (via userId match); CC's the global alertAdminEmail if different.
//                     Gated by approvalExpiryEmailEnabled global flag AND the
//                     per-operator notifyApprovalExpiry flag on their watcher entry.
//   2. Slack webhook — when approvalExpirySlackWebhookUrl is set (global).

import { Pool } from 'pg';
import { storage } from './storage';
import { sendAlertEmail, buildApprovalExpiryAlertEmail } from './email';

export type ApprovalExpiryPayload = {
  actionId:        number;
  accountName:     string;
  actionType:      string;
  requestedBy:     string;   // user ID of the operator who submitted the action
  requestedByName: string;
  ttlMinutes:      number;
  expiredAt:       string;
};

function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

function buildApprovalPanelUrl(): string {
  const base =
    process.env.REPL_SLUG && process.env.REPL_OWNER
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : process.env.PUBLIC_URL ?? '';
  return `${base}/ai-copilot?tab=approvals`;
}

/**
 * Resolves the requesting operator's email and their personal opt-in flag.
 * Returns null if no watcher entry exists for that userId (or userId is empty).
 */
async function resolveRequesterWatcher(requestedBy: string): Promise<{
  email: string;
  notifyApprovalExpiry: boolean;
} | null> {
  if (!requestedBy) return null;
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT email, notify_approval_expiry FROM watcher_recipients
       WHERE user_id = $1 AND active = true
       LIMIT 1`,
      [requestedBy],
    );
    if (r.rows.length === 0) return null;
    return {
      email:                r.rows[0].email,
      notifyApprovalExpiry: r.rows[0].notify_approval_expiry ?? true,
    };
  } finally {
    await pool.end();
  }
}

async function sendSlackWebhook(webhookUrl: string, payload: ApprovalExpiryPayload): Promise<void> {
  const panelUrl = buildApprovalPanelUrl();
  const body = {
    text: `⏰ *Pending Approval Expired* — Action #${payload.actionId}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⏰ Pending Approval Expired', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Action ID*\n#${payload.actionId}` },
          { type: 'mrkdwn', text: `*Account*\n${payload.accountName}` },
          { type: 'mrkdwn', text: `*Action Type*\n${payload.actionType}` },
          { type: 'mrkdwn', text: `*Requested By*\n${payload.requestedByName}` },
          { type: 'mrkdwn', text: `*Expiry Window*\n${payload.ttlMinutes} minutes` },
          { type: 'mrkdwn', text: `*Expired At*\n${payload.expiredAt}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `No second operator acted within the ${payload.ttlMinutes}-minute window. The action has been automatically rejected.`,
        },
      },
      ...(panelUrl
        ? [{
            type: 'actions',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: 'Open Approval Panel', emoji: true },
              url: panelUrl,
              style: 'primary',
            }],
          }]
        : []),
    ],
  };

  const resp = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8_000),
  });

  if (!resp.ok) {
    throw new Error(`Slack webhook HTTP ${resp.status}`);
  }
}

/**
 * Dispatch email + Slack notifications for a single expired approval action.
 *
 * Email recipient resolution (in priority order):
 *   1. The requesting operator's email — looked up from watcher_recipients by userId.
 *      Only included when their per-operator notifyApprovalExpiry flag is true.
 *   2. The global alertAdminEmail — always included as a fallback recipient so that
 *      there is always at least one person informed of the expiry.
 *
 * All errors are caught and logged — never throws so the caller is not affected.
 */
export async function sendApprovalExpiryNotifications(payload: ApprovalExpiryPayload): Promise<void> {
  let settings: Awaited<ReturnType<typeof storage.getSettings>> | null = null;
  try {
    settings = await storage.getSettings();
  } catch (err: any) {
    console.warn('[approval-notify] Could not read settings — skipping notifications:', err.message);
    return;
  }

  const panelUrl = buildApprovalPanelUrl();

  // ── 1. Email ────────────────────────────────────────────────────────────────
  if (settings.approvalExpiryEmailEnabled !== false && settings.alertEnabled) {
    try {
      // Resolve the requesting operator's personal email + opt-in flag
      let requesterEmail: string | null = null;
      try {
        const watcher = await resolveRequesterWatcher(payload.requestedBy);
        if (watcher && watcher.notifyApprovalExpiry) {
          requesterEmail = watcher.email;
        } else if (watcher && !watcher.notifyApprovalExpiry) {
          console.log(`[approval-notify] Operator ${payload.requestedBy} has opted out of approval expiry emails`);
        }
      } catch (lookupErr: any) {
        console.warn('[approval-notify] Watcher lookup failed (non-fatal):', lookupErr.message);
      }

      const { subject, bodyHtml } = buildApprovalExpiryAlertEmail({ ...payload, approvalPanelUrl: panelUrl });

      // Build explicit recipient list:
      // - Requester's email (if resolved and opted-in)
      // - Global admin email (always, as fallback/CC)
      const recipientSet = new Set<string>();
      if (requesterEmail) recipientSet.add(requesterEmail);
      if (settings.alertAdminEmail) recipientSet.add(settings.alertAdminEmail);

      if (recipientSet.size === 0) {
        console.warn(`[approval-notify] No email recipients for action #${payload.actionId} — add admin email in Settings`);
      } else {
        const sent = await sendAlertEmail({
          subject,
          bodyHtml,
          // Pass requester's email as clientEmail so sendAlertEmail adds it to the set
          clientEmail: requesterEmail ?? null,
          includeWatcherRecipients: false,
        });
        if (sent) {
          console.log(`[approval-notify] Email sent for action #${payload.actionId} → ${Array.from(recipientSet).join(', ')}`);
        } else {
          console.warn(`[approval-notify] Email skipped for action #${payload.actionId} (delivery failed or not configured)`);
        }
      }
    } catch (err: any) {
      console.warn(`[approval-notify] Email failed for action #${payload.actionId}:`, err.message);
    }
  }

  // ── 2. Slack webhook ────────────────────────────────────────────────────────
  const slackUrl = settings.approvalExpirySlackWebhookUrl?.trim();
  if (slackUrl) {
    try {
      await sendSlackWebhook(slackUrl, payload);
      console.log(`[approval-notify] Slack webhook sent for action #${payload.actionId}`);
    } catch (err: any) {
      console.warn(`[approval-notify] Slack webhook failed for action #${payload.actionId}:`, err.message);
    }
  }
}
