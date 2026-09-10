/**
 * rate-notification-worker.ts - turning an owed obligation into a ready-to-send message.
 *
 * The join between three things that were deliberately built apart: the durable obligation (what
 * a certified push owes), the canonical recipient resolver (commercial and rates contacts, never
 * technical or NOC), and the branded renderer.
 *
 * IT PREPARES; IT DOES NOT SEND.
 *
 * `prepareRateNotifications` returns messages and touches nothing. `deliverRateNotifications` is
 * the only function that can send, and it refuses unless delivery is explicitly enabled AND a
 * sender was injected. There is no default transport and no import of the platform sender: a
 * worker that emails real customers the moment something calls it is a hazard, and the way to
 * prevent that is to make sending impossible without two deliberate acts rather than one.
 *
 * WHAT IT MAY NOT DO.
 *   - Create an obligation. What is owed was decided when the push certified.
 *   - Alter the obligation's frozen rows. They are what the customer is told, fixed at
 *     certification precisely so a later query cannot change the story.
 *   - Touch a switch, or the commercial change records.
 */
import {
  pendingRateNotifications, type ObligationDb,
} from './post-push-obligation';
import {
  resolveRateRecipientsByName, type RecipientQueryable,
} from './rate-notification-recipients';
import {
  renderRateNotification, subjectForRateNotification, rateNotificationLogoAttachment,
  type RateChangeRow, type NotificationKind,
} from './rate-notification-render';
import { sql } from 'drizzle-orm';

export interface PreparedMessage {
  obligationId: number;
  jobId: string;
  clientName: string;
  productLabel: string;
  kind: NotificationKind;
  to: string[];
  subject: string;
  html: string;
  attachment: { filename: string; content: Buffer; contentType: string; cid: string } | null;
  rowCount: number;
}

export interface PreparationReport {
  prepared: PreparedMessage[];
  /** Obligations that could not be prepared, each with why. Never silently dropped. */
  blocked: Array<{ obligationId: number; clientName: string; reason: string }>;
}

export interface SendResult { ok: boolean; error?: string }

export interface RateWorkerDeps {
  db: ObligationDb & RecipientQueryable;
  /**
   * The platform's existing email path. No default, deliberately: the worker must be GIVEN a
   * transport rather than acquiring one by importing it, so nothing can send by accident.
   */
  send?: (msg: { to: string; subject: string; html: string; attachment?: any }) => Promise<SendResult>;
  /** Injected so the notice's issue date does not depend on the machine that ran the worker. */
  today?: () => string;
}

const isoDay = () => new Date().toISOString().slice(0, 10);

/**
 * Build the messages the outbox currently owes. Sends nothing, writes nothing.
 *
 * Separated from delivery so the output can be inspected — and tested — without a transport
 * existing anywhere in the call graph.
 */
export async function prepareRateNotifications(
  deps: RateWorkerDeps,
  opts: { limit?: number } = {},
): Promise<PreparationReport> {
  const prepared: PreparedMessage[] = [];
  const blocked: PreparationReport['blocked'] = [];
  const issueDate = (deps.today ?? isoDay)();

  for (const owed of await pendingRateNotifications(deps.db, opts.limit ?? 50)) {
    const recipients = await resolveRateRecipientsByName(deps.db, owed.clientName);
    if ('error' in recipients) {
      blocked.push({ obligationId: owed.id, clientName: owed.clientName, reason: recipients.error });
      continue;
    }
    if (recipients.emails.length === 0) {
      // A configuration gap, reported rather than treated as "nobody to tell".
      blocked.push({
        obligationId: owed.id, clientName: owed.clientName,
        reason: recipients.reason ?? 'No commercial or rates contact with an email address.',
      });
      continue;
    }

    // The FROZEN rows, exactly as certified. Not re-read, not recomputed.
    const rows: RateChangeRow[] = (owed.rows ?? []).map((r: any) => ({
      destination: String(r.destination ?? r.prefix),
      prefix: String(r.prefix),
      previousRate: r.previousRate ?? null,
      newRate: String(r.rate ?? r.newRate),
      billingIncrement: r.billingIncrement ?? null,
      effectiveDate: String(r.effectiveDate ?? issueDate),
    }));
    if (rows.length === 0) {
      blocked.push({ obligationId: owed.id, clientName: owed.clientName, reason: 'The obligation carries no rows.' });
      continue;
    }

    const kind: NotificationKind = owed.notificationType === 'FULL' ? 'FULL' : 'CHANGES';
    // The product digit is recovered from the frozen rows, so the dial format is composed from
    // the same certified facts as the table and cannot be handed a switch-side prefix.
    const productDigit = String((owed.rows?.[0] as any)?.productDigit ?? '');

    const view = {
      clientName: recipients.companyName,
      productLabel: owed.productLabel,
      issueDate,
      effectiveDate: rows[0].effectiveDate,
      accountPrefix: recipients.accountPrefix,
      productDigit,
      kind,
      rows,
    };

    let html: string;
    try {
      // Throws if the internal execution prefix would appear anywhere. Blocking here is correct:
      // an unsendable message is better than one that publishes switch-side routing.
      html = renderRateNotification(view);
    } catch (e: any) {
      blocked.push({ obligationId: owed.id, clientName: owed.clientName, reason: String(e?.message ?? e) });
      continue;
    }

    prepared.push({
      obligationId: owed.id,
      jobId: owed.jobId,
      clientName: recipients.companyName,
      productLabel: owed.productLabel,
      kind,
      to: recipients.emails,
      subject: subjectForRateNotification(view),
      html,
      // Shipped with the message, because the header's cid: resolves only if it is attached.
      attachment: rateNotificationLogoAttachment(),
      rowCount: rows.length,
    });
  }

  return { prepared, blocked };
}

export interface DeliveryReport {
  attempted: number;
  sent: number;
  failed: number;
  blocked: PreparationReport['blocked'];
  /** True when the pass ran with delivery disabled and therefore sent nothing. */
  disabled: boolean;
}

/**
 * Deliver what is owed.
 *
 * TWO deliberate acts are required before anything leaves: `enabled: true`, and a `send`
 * dependency. Either missing means nothing is attempted and every row is left exactly as it was -
 * not sent, not failed, because neither happened. A worker that could send on one condition would
 * eventually send on an accident.
 */
export async function deliverRateNotifications(
  deps: RateWorkerDeps,
  opts: { enabled?: boolean; limit?: number } = {},
): Promise<DeliveryReport> {
  const report: DeliveryReport = { attempted: 0, sent: 0, failed: 0, blocked: [], disabled: false };

  if (opts.enabled !== true || !deps.send) {
    report.disabled = true;
    return report;
  }

  const { prepared, blocked } = await prepareRateNotifications(deps, { limit: opts.limit });
  report.blocked = blocked;

  for (const msg of prepared) {
    report.attempted++;
    let result: SendResult;
    try {
      result = await deps.send({
        to: msg.to.join(', '), subject: msg.subject, html: msg.html, attachment: msg.attachment,
      });
    } catch (e: any) {
      result = { ok: false, error: String(e?.message ?? e) };
    }

    if (result.ok) {
      await deps.db.execute(sql`
        UPDATE rate_push_notifications
           SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW(),
               attempts = attempts + 1, last_error = NULL, recipients = ${msg.to.join(', ')}
         WHERE id = ${msg.obligationId}`);
      report.sent++;
    } else {
      // Stays owed. A failed delivery is durable and retryable, never a lost obligation.
      await deps.db.execute(sql`
        UPDATE rate_push_notifications
           SET status = 'failed', last_attempt_at = NOW(),
               attempts = attempts + 1, last_error = ${result.error ?? 'send failed'}
         WHERE id = ${msg.obligationId}`);
      report.failed++;
    }
  }

  return report;
}
