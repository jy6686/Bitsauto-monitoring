/**
 * rate-notification-auto.ts — the caller the notification worker never had.
 *
 * Every certified push records what it owes the customer in `rate_push_notifications`
 * (post-push-obligation.ts). The worker (rate-notification-worker.ts) can turn an obligation into
 * an email to the company's commercial and rates contacts — the addresses captured at account
 * creation, never technical or NOC — but it refuses to send unless it is explicitly enabled AND
 * handed a transport, and nothing in production ever did either. Obligations were recorded and
 * never delivered.
 *
 * This module is the two deliberate acts. It decides WHEN the worker runs and WITH WHAT, and it
 * adds nothing to what is sent: the frozen rows, the recipient rule and the rendering are all the
 * worker's, untouched.
 *
 * SHIPS OFF. `platform_feature_flags.rate_notifications_auto` absent or false means the worker is
 * told `enabled: false` and sends nothing — the same discipline as `rate_policy_enforcement`. An
 * admin turns it on in production, and the next real push is the certification. Nothing here
 * writes the flag.
 *
 * NO TIMERS. Long timers do not survive this platform's restarts, and the obligations are already
 * durable, so the drain is driven by events: once after each push (inside push-batch's existing
 * failure-isolation boundary — a send failure can no more fail a push than a bookkeeping failure
 * can), and once on boot, for whatever a restart left pending or failed.
 *
 * ATTEMPTS ARE CAPPED. `pendingRateNotifications` selects pending AND failed rows oldest-first, so
 * without a cap one permanently failing obligation would sit at the front and starve everything
 * behind it, forever. The drain passes MAX_DELIVERY_ATTEMPTS; an exhausted obligation stays
 * `failed` with its `last_error`, visible rather than retried into the void.
 *
 * NEVER THROWS. Whatever goes wrong — flag unreadable, transport down — is logged and reported;
 * the caller's control flow is not the notification's to interrupt.
 *
 * NOT THIS MODULE'S BUSINESS: the provisioning-time notification (account-email.step.ts →
 * sendRateNotificationEmails, driven by product_rates) and the manual admin resend. Those are
 * separate paths for separate moments. This one is "the rates changed after provisioning".
 *
 * Known limitation, recorded and not fixed here: the worker resolves recipients by company NAME.
 * Two companies claim account 76 in production, so a rename or a shared name could misroute. That
 * is the resolver's design question, not a delivery one.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { platformFeatureFlags } from '../../../shared/schema';
import { sendDirectEmail, sendDirectEmailWithAttachment } from '../../email';
import {
  deliverRateNotifications,
  type RateWorkerDeps, type DeliveryReport, type SendResult,
} from './rate-notification-worker';

export const RATE_NOTIFICATIONS_AUTO_FLAG = 'rate_notifications_auto';
/** Beyond this many failed attempts an obligation is left `failed` and no longer retried. */
export const MAX_DELIVERY_ATTEMPTS = 5;
/** Obligations processed per drain. Oldest first; the next event drains the rest. */
export const DRAIN_LIMIT = 50;
/** The identity the manual rate-sheet path already sends as. Customer-facing; not the platform. */
export const RATE_NOTIFICATION_FROM = {
  fromName:    'Ichibaan Rates',
  fromAddress: 'pricing@ichibaanlogic.com',
} as const;

export type DrainReason = 'push' | 'boot';

/**
 * WHAT A DRAIN IS ALLOWED TO SEE.
 *
 * A push drains ITS OWN obligations and nothing else. On 2026-09-22 a First Class push for one
 * account ran the drain, the drain took the oldest pending row in the system, and a different
 * account received a four-day-old Business Class notice — from a push that had nothing to do
 * with it. The push knew its job id the whole time; the drain was never told.
 *
 * So a push-triggered drain REQUIRES the job id and delivers only that job's rows; a push that
 * arrives without one is refused, not widened. The boot drain is the one place the backlog is
 * legitimately delivered — a restart is exactly the moment older obligations are found — and
 * every row it sends is logged with the obligation's own job and creation time, so a backlog
 * send is visible as a backlog send.
 */
export interface DrainOptions {
  jobId?: string;
}

/**
 * The flag decides. Only a literal `true` enables — not a missing row, not a string, not 1 —
 * because "we could not read the flag" must never read as "on".
 */
export function shouldAutoDeliver(flag: { enabled?: unknown } | null | undefined): boolean {
  return !!flag && flag.enabled === true;
}

type WorkerSend = NonNullable<RateWorkerDeps['send']>;

export interface Transports {
  withAttachment: (opts: {
    to: string; subject: string; html: string; fromName?: string; fromAddress?: string; attachment: any;
  }) => Promise<SendResult>;
  plain: (opts: {
    to: string; subject: string; html: string; fromName?: string; fromAddress?: string;
  }) => Promise<SendResult>;
}

/**
 * Wrap the platform's existing email path into the shape the worker expects, stamping the
 * rates identity on every message. The worker owns the try/catch around the send; this only
 * chooses the transport (with or without the logo attachment) and forwards.
 */
export function buildRateNotificationSender(transports: Transports): WorkerSend {
  return async (msg) => {
    const base = { to: msg.to, subject: msg.subject, html: msg.html, ...RATE_NOTIFICATION_FROM };
    return msg.attachment
      ? transports.withAttachment({ ...base, attachment: msg.attachment })
      : transports.plain(base);
  };
}

export interface AutoDrainDeps {
  readFlag:   () => Promise<{ enabled?: unknown } | null | undefined>;
  deliver:    typeof deliverRateNotifications;
  workerDeps: RateWorkerDeps;
  log?:       (line: string) => void;
}

export interface AutoDrainOutcome {
  reason:  DrainReason;
  enabled: boolean;
  report:  DeliveryReport | null;
  /** Set when the drain itself failed before or during delivery. Never thrown. */
  error?:  string;
}

/** The drain, with every dependency injected so it can be proven without a database or SMTP. */
export async function runAutoDrain(
  deps: AutoDrainDeps, reason: DrainReason, opts: DrainOptions = {},
): Promise<AutoDrainOutcome> {
  const log = deps.log ?? ((l: string) => console.log(l));
  try {
    // Decided BEFORE the flag is read: a push with no job id is a wiring defect, and the safe
    // answer to a wiring defect is to send nothing — not to send everything.
    if (reason === 'push' && !opts.jobId) {
      const error = 'push-triggered drain called without a jobId; refusing to drain the backlog';
      log(`[rate-notify] push: ${error}`);
      return { reason, enabled: false, report: null, error };
    }
    const scope = reason === 'push' ? `push ${opts.jobId}` : 'boot (backlog)';

    const enabled = shouldAutoDeliver(await deps.readFlag());
    if (!enabled) {
      log(`[rate-notify] ${scope}: automatic delivery is OFF (${RATE_NOTIFICATIONS_AUTO_FLAG}); obligations recorded, nothing sent`);
      return { reason, enabled: false, report: null };
    }
    const report = await deps.deliver(deps.workerDeps, {
      enabled: true, limit: DRAIN_LIMIT, maxAttempts: MAX_DELIVERY_ATTEMPTS,
      ...(reason === 'push' ? { jobId: opts.jobId } : {}),
    });
    // One line per delivery, naming the obligation's OWN job and age. "sent 1" beside a push
    // is not evidence of anything; "sent obligation 3 of job-…881944, frozen 2026-09-19, to
    // aura" is.
    for (const d of report.deliveries ?? []) {
      const own = reason === 'push' && d.jobId === opts.jobId ? 'this push' : 'BACKLOG';
      log(`[rate-notify] ${scope}: ${d.ok ? 'sent' : 'FAILED'} obligation ${d.obligationId} ` +
          `(${own}: ${d.jobId}, frozen ${d.createdAt ?? 'unknown'}) → ${d.clientName} <${d.to.join(', ')}>` +
          `${d.ok ? '' : ` — ${d.error}`}`);
    }
    log(`[rate-notify] ${scope}: attempted ${report.attempted}, sent ${report.sent}, failed ${report.failed}, ` +
        `blocked ${report.blocked.length}${report.blocked.length ? ' — ' + report.blocked.map(b => `${b.clientName}: ${b.reason}`).join('; ') : ''}`);
    return { reason, enabled: true, report };
  } catch (e: any) {
    const error = String(e?.message ?? e);
    log(`[rate-notify] ${reason}: drain failed (non-fatal): ${error}`);
    return { reason, enabled: false, report: null, error };
  }
}

async function readAutoFlag() {
  const [row] = await db.select().from(platformFeatureFlags)
    .where(eq(platformFeatureFlags.key, RATE_NOTIFICATIONS_AUTO_FLAG)).limit(1);
  return row ?? null;
}

/** Production wiring: the real flag, the real worker, the real database, the platform sender. */
export function productionDrainDeps(): AutoDrainDeps {
  return {
    readFlag:   readAutoFlag,
    deliver:    deliverRateNotifications,
    workerDeps: {
      db:   db as any,
      send: buildRateNotificationSender({
        withAttachment: sendDirectEmailWithAttachment,
        plain:          sendDirectEmail,
      }),
    },
  };
}

/**
 * After a push (called inside push-batch's failure boundary, WITH that push's job id) or on
 * boot. Never throws.
 */
export function drainRateNotifications(reason: DrainReason, opts: DrainOptions = {}): Promise<AutoDrainOutcome> {
  return runAutoDrain(productionDrainDeps(), reason, opts);
}

/** Wired from server/index.ts beside reconcileOrphanedRatePushesOnBoot. */
export function drainRateNotificationsOnBoot(): Promise<AutoDrainOutcome> {
  return drainRateNotifications('boot');
}
