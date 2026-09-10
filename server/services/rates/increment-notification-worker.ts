/**
 * increment-notification-worker.ts — discharging the obligation to tell clients.
 *
 * The outbox already holds what is owed: one committed row per recipient per change, written in
 * the same transaction as the change itself. This worker does one thing — deliver those rows
 * through the platform's existing email path and record what happened.
 *
 * WHAT IT MAY NOT DO, AND WHY EACH MATTERS.
 *
 *   - **Open its own transport.** Delivery goes through the injected sender, which production
 *     binds to `sendDirectEmail`. A worker with its own SMTP client would bypass every setting
 *     the platform has about who may be emailed and from where — including test mode.
 *   - **Create an obligation.** It reads rows; it never inserts one. What is owed was decided at
 *     commit time, and a worker inventing recipients would email people nobody agreed to email.
 *   - **Touch the commercial change** beyond marking it notified once every recipient is done.
 *     A delivery failure must not alter, retire, or reschedule a commitment.
 *   - **Touch Sippy.** Telling a customer about a change and making that change are separate
 *     acts on separate dates. Nothing here reaches a switch.
 *
 * A send that FAILS leaves the row owed and retryable with its reason recorded. A send whose
 * outcome is unknown is treated as failed — which is safe HERE, unlike a rate write, because the
 * cost of a duplicate email is an annoyed customer rather than a mispriced tariff. That asymmetry
 * is deliberate and is the one place in this codebase where retrying an unknown is correct.
 */
import {
  pendingNotifications, recordDelivery, markNotifiedWhenComplete, type ChangeStoreDb,
} from './increment-change-store';

export interface SendResult { ok: boolean; error?: string }

export interface WorkerDeps {
  db: ChangeStoreDb;
  /**
   * The platform's existing email path. Production binds this to `sendDirectEmail`; tests bind a
   * recorder. There is deliberately no default — a worker that emails real customers must be
   * given its transport explicitly rather than acquiring one by importing it.
   */
  send(msg: { to: string; subject: string; html: string }): Promise<SendResult>;
  /** Subject line builder, so wording lives with the caller rather than buried here. */
  subjectFor?(clientName: string): string;
}

export interface WorkerOptions {
  /** How many rows to attempt in one pass. */
  limit?: number;
  /**
   * Stop retrying a row after this many attempts.
   *
   * An address that has failed repeatedly is a configuration problem, not a transient one, and
   * retrying it forever buries every other pending row behind it. The row stays `failed` with its
   * reason, so the obligation remains visible instead of being silently abandoned.
   */
  maxAttempts?: number;
  /**
   * Delivery is OFF unless the caller says otherwise.
   *
   * A worker that emails real customers the moment it is imported is a hazard. Nothing is sent
   * unless this is explicitly true, and when it is false the rows are left exactly as they were —
   * not marked sent, not marked failed, because neither happened.
   */
  enabled?: boolean;
}

export interface WorkerReport {
  attempted: number;
  sent: number;
  failed: number;
  skippedExhausted: number;
  changesNotified: number[];
  /** True when the pass ran with delivery disabled and therefore sent nothing. */
  disabled: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export async function deliverPendingNotifications(
  deps: WorkerDeps,
  opts: WorkerOptions = {},
): Promise<WorkerReport> {
  const report: WorkerReport = {
    attempted: 0, sent: 0, failed: 0, skippedExhausted: 0, changesNotified: [], disabled: false,
  };

  if (opts.enabled !== true) {
    // Explicitly not an error and explicitly not a no-op that pretends to have worked: the rows
    // stay owed, untouched, and the report says why nothing moved.
    report.disabled = true;
    return report;
  }

  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const owed = await pendingNotifications(deps.db, opts.limit ?? 200);
  const touchedChanges = new Set<number>();

  for (const row of owed) {
    if (row.attempts >= maxAttempts) {
      // Left failed, with its reason, so the obligation stays visible.
      report.skippedExhausted++;
      continue;
    }
    report.attempted++;

    let result: SendResult;
    try {
      result = await deps.send({
        to: row.email,
        subject: deps.subjectFor?.(row.clientName) ?? 'Billing increment change',
        html: `<p>${escapeHtml(row.message)}</p>`,
      });
    } catch (e: any) {
      result = { ok: false, error: String(e?.message ?? e) };
    }

    if (result.ok) {
      await recordDelivery(deps.db, row.id, { sent: true });
      report.sent++;
    } else {
      await recordDelivery(deps.db, row.id, { sent: false, error: result.error ?? 'send failed' });
      report.failed++;
    }
    touchedChanges.add(row.changeId);
  }

  // A change is notified only when every recipient it owes has been told. Checked once per
  // change rather than per delivery, so a partially delivered change is never reported as
  // announced.
  for (const changeId of touchedChanges) {
    if (await markNotifiedWhenComplete(deps.db, changeId)) report.changesNotified.push(changeId);
  }

  return report;
}

/** The message is operator-authored text about a customer's prices; it is not markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
