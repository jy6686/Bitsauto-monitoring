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
  resolveRateRecipientsForObligation, type RecipientQueryable,
} from './rate-notification-recipients';
import {
  renderRateNotification, subjectForRateNotification, rateNotificationLogoAttachment,
  type RateChangeRow, type NotificationKind,
} from './rate-notification-render';
import { sql } from 'drizzle-orm';
// The sheet is built from the frozen rows and nothing else — see the module's own comment.
import { buildFrozenRateSheetAttachment } from './frozen-rate-sheet';

/** drizzle returns rows differently per driver; both shapes are read the same way here. */
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

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
  /**
   * Everything that travels with the message: the inline logo (when the file exists) and then
   * the rate sheet, built from the frozen rows. Sheet LAST, so a transport that can carry only
   * one file carries the sheet.
   */
  attachments: Array<{ filename: string; content: Buffer; contentType: string; cid?: string }>;
  rowCount: number;
  /** When the obligation was frozen. Carried so a delivery can be logged as current or backlog. */
  createdAt: string | null;
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
  send?: (msg: {
    to: string; subject: string; html: string;
    /** The inline logo, kept for the singular transport. */
    attachment?: any;
    /** Everything on the message, logo first, rate sheet last. */
    attachments?: any[];
  }) => Promise<SendResult>;
  /** Injected so the notice's issue date does not depend on the machine that ran the worker. */
  today?: () => string;
  /** Injected for the same reason: the sheet header's send time and the filename stamp. */
  now?: () => Date;
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
  /** `jobId` narrows the pass to one push's obligations; absent, the pass is the whole backlog. */
  opts: { limit?: number; maxAttempts?: number; jobId?: string } = {},
): Promise<PreparationReport> {
  const prepared: PreparedMessage[] = [];
  const blocked: PreparationReport['blocked'] = [];
  const issueDate = (deps.today ?? isoDay)();

  for (const owed of await pendingRateNotifications(deps.db, opts.limit ?? 50, opts.maxAttempts, opts.jobId)) {
    // By the Sippy account the push targeted, not by name — see the resolver's comment.
    const recipients = await resolveRateRecipientsForObligation(deps.db, { jobId: owed.jobId, clientName: owed.clientName });
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

    // THE SHEET, from the same frozen rows as the table above, so the two cannot disagree.
    // The KAM name is a header nicety read best-effort from the company record; its absence
    // must never block a notice, so the read is guarded and an unreadable name is blank.
    let kamName = '';
    try {
      const [c] = rowsOf(await deps.db.execute(sql`SELECT kam FROM companies WHERE id = ${recipients.companyId}`));
      kamName = String(c?.kam ?? '').trim();
    } catch { kamName = ''; }

    let sheet: { filename: string; content: Buffer; contentType: string };
    try {
      sheet = await buildFrozenRateSheetAttachment({
        companyName: recipients.companyName,
        productLabel: owed.productLabel,
        accountPrefix: recipients.accountPrefix,
        kamName,
        issueDate,
        rows: (owed.rows ?? []) as any[],
        sentAt: deps.now?.() ?? new Date(),
      });
    } catch (e: any) {
      // A notice without its sheet is an incomplete notice. Blocked, not sent bare: the
      // obligation stays owed and the next drain tries again.
      blocked.push({ obligationId: owed.id, clientName: owed.clientName, reason: `Rate sheet could not be built: ${String(e?.message ?? e)}` });
      continue;
    }

    // Shipped with the message, because the header's cid: resolves only if it is attached.
    const logo = rateNotificationLogoAttachment();

    prepared.push({
      obligationId: owed.id,
      jobId: owed.jobId,
      clientName: recipients.companyName,
      productLabel: owed.productLabel,
      kind,
      to: recipients.emails,
      subject: subjectForRateNotification(view),
      html,
      attachment: logo,
      // Logo first, sheet LAST — a single-file transport keeps the last one.
      attachments: [...(logo ? [logo] : []), sheet],
      rowCount: rows.length,
      createdAt: owed.createdAt,
    });
  }

  return { prepared, blocked };
}

/** One delivery attempt, as it happened — enough for a log line that names the obligation. */
export interface DeliveryRecord {
  obligationId: number;
  jobId: string;
  clientName: string;
  createdAt: string | null;
  to: string[];
  ok: boolean;
  error?: string;
}

export interface DeliveryReport {
  attempted: number;
  sent: number;
  failed: number;
  blocked: PreparationReport['blocked'];
  /**
   * Every attempt, in order. The counts above say how many; this says WHICH — so a drain that
   * sent a four-day-old obligation can be read as exactly that in the deployment log, rather
   * than as "sent 1" beside a push that had nothing to do with it.
   */
  deliveries: DeliveryRecord[];
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
  /** `jobId` scopes delivery to one push. A push-triggered caller must always pass it. */
  opts: { enabled?: boolean; limit?: number; maxAttempts?: number; jobId?: string } = {},
): Promise<DeliveryReport> {
  const report: DeliveryReport = { attempted: 0, sent: 0, failed: 0, blocked: [], deliveries: [], disabled: false };

  if (opts.enabled !== true || !deps.send) {
    report.disabled = true;
    return report;
  }

  const { prepared, blocked } = await prepareRateNotifications(deps, {
    limit: opts.limit, maxAttempts: opts.maxAttempts, jobId: opts.jobId,
  });
  report.blocked = blocked;

  for (const msg of prepared) {
    report.attempted++;
    let result: SendResult;
    try {
      result = await deps.send({
        to: msg.to.join(', '), subject: msg.subject, html: msg.html,
        attachment: msg.attachment, attachments: msg.attachments,
      });
    } catch (e: any) {
      result = { ok: false, error: String(e?.message ?? e) };
    }
    report.deliveries.push({
      obligationId: msg.obligationId, jobId: msg.jobId, clientName: msg.clientName,
      createdAt: msg.createdAt, to: msg.to, ok: result.ok === true,
      ...(result.ok ? {} : { error: result.error ?? 'send failed' }),
    });

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
