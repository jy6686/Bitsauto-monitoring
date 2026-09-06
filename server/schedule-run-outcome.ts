/**
 * schedule-run-outcome.ts — what a scheduled invoice run decided, why, and
 * whether it will come back.
 *
 * WHY THIS EXISTS. Both live schedules ran on 2026-08-31 and produced no
 * invoice. The billing chain refused them — correctly — and said so in one
 * console.warn line that nobody reads. invoice_schedules recorded only
 * last_run_at, so Finance saw "ran" beside no invoice and could not answer
 * "why not?" without asking Engineering.
 *
 * Worse than invisible: LOST. The runner advanced next_run_at by a full
 * cadence on a refusal, and asked the next run for the newest closed period
 * only. A week refused because 2026-09-05 had not finished collecting would
 * never be invoiced again — one transient overnight failure silently skipping
 * a week's revenue. The gates were right to refuse; the scheduler was wrong to
 * treat a refusal as a decision that the period was not billable.
 *
 * ── The two states a refusal can be in ─────────────────────────────────────
 *   RETRYABLE   the data may complete on its own — days still being collected,
 *               a shortfall against the switch, a period not yet rated. The
 *               period comes back, on a cadence, bounded.
 *   TERMINAL    retrying cannot change it — already invoiced, or the switch
 *               itself has no calls for the period. It stays visible and stops
 *               consuming fetches.
 *
 * Retry is BOUNDED (MAX_RETRY_ATTEMPTS) rather than indefinite, because each
 * attempt re-fetches the period from Sippy: the seed re-runs every slice, so a
 * six-day period for one account is ~288 XML-RPC windows. An unbounded retry
 * of a period that will never pass is a standing load on the switch. When the
 * attempts are spent the period does not vanish — it becomes `exhausted`,
 * which says a person has to act, on the row where they are already looking.
 *
 * Pure: no clock, no DB, no I/O. Callers pass `now`; this decides and words.
 */

export type RunTrigger = 'scheduler' | 'manual';

/** Where a period stopped: the chain's own stages, plus the runner's. */
export type PeriodStage =
  | 'duplicate' | 'seed' | 'freeze' | 'coverage' | 'reconcile' | 'certify' | 'generate'
  | 'no-tariff' | 'no-account' | 'no-period' | 'error';

/** The run as a whole, for filtering and future automation. */
export type RunStatus = 'generated' | 'partial' | 'refused' | 'stopped' | 'nothing';

const CHAIN_STAGES: ReadonlySet<string> =
  new Set(['duplicate', 'seed', 'freeze', 'coverage', 'reconcile', 'certify', 'generate']);

/**
 * How many times a retryable refusal is re-attempted before it needs a person.
 * Six at six hours apart is ~36 hours — long enough for the collector to clear
 * a multi-day backlog, short enough that a period which will never pass stops
 * re-fetching within two days.
 */
export const MAX_RETRY_ATTEMPTS = 6;

/** Hours between retries of a refused period. */
export const RETRY_INTERVAL_HOURS = 6;

/**
 * Most periods one run will attempt. Each costs a full seed — every slice of
 * the period re-fetched from Sippy — so a run that fanned out over a long
 * backlog would hold the switch for hours. The remainder is not lost: it is
 * attempted on the next run, oldest first.
 */
export const MAX_PERIODS_PER_RUN = 4;

/**
 * The nightly collection window, UTC. A retry inside it would send the invoice
 * chain's seed at the switch while the collector is already fetching from it —
 * the two would contend for the same XML-RPC endpoint during the only hours
 * the switch is quiet. Retries are pushed past the window's end.
 */
export const COLLECTION_WINDOW_UTC = { startHour: 2, endHour: 6 } as const;

export interface PeriodOutcome {
  /** Inclusive, YYYY-MM-DD — what the invoice would print. */
  start: string;
  end: string;
  accountingMonth?: string;
  partial?: boolean;
  ok: boolean;
  invoiceNumber?: string;
  lineCount?: number;
  /** Where it stopped, when not ok. */
  stage?: PeriodStage;
  /** The chain's own wording, verbatim — never paraphrased here. */
  reason?: string;
  /** Will the scheduler bring this period back by itself? */
  retryable?: boolean;
  /** How many times this period has now been attempted. 1 on the first. */
  attempt?: number;
  /** True when the attempts are spent: still visible, no longer automatic. */
  exhausted?: boolean;
  /** What a reader must do — or what the scheduler will do for them. */
  next?: string;
}

export type AccountSource = 'schedule' | 'company' | 'none';

export interface ResolvedAccount {
  iAccount: number | null;
  source: AccountSource;
  /** Where it came from, or why there is none. */
  detail: string;
}

export interface RunStop {
  stage: 'no-tariff' | 'no-account' | 'no-period' | 'error';
  reason: string;
  retryable: boolean;
  next: string;
}

export interface ScheduleRunOutcome {
  /** ISO instant of the run. */
  at: string;
  trigger: RunTrigger;
  status: RunStatus;
  account: ResolvedAccount;
  periods: PeriodOutcome[];
  generated: number;
  refused: number;
  /** Refused periods the scheduler will bring back by itself. */
  retryable: number;
  /** Refused periods whose automatic attempts are spent. */
  exhausted: number;
  /**
   * When the scheduler will next re-attempt the retryable periods, ISO.
   * Null when nothing is waiting on a retry — the ordinary cadence applies.
   */
  retryAt: string | null;
  /** Present when the run stopped before any period was attempted. */
  stopped?: RunStop;
  /** One line for the schedules page. Full wording stays in `periods`. */
  headline: string;
}

/** The shape the billing chain returns; only the fields read here. */
export interface ChainResultLike {
  ok: boolean;
  stage?: string;
  error?: string;
  seed?: { fetched: number; created: number; skipped: number; message?: string };
  invoice?: { id: number; invoiceNumber: string; lineCount: number };
}

const UNRESOLVED: ResolvedAccount = {
  iAccount: null, source: 'none', detail: 'Not resolved — the run stopped first.',
};

/** A Sippy account id is a positive integer; anything else is "none". */
function toAccountId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The account the chain's data gates will be scoped to. The schedule's own
 * value wins; the company record is the fallback — that is where the
 * commercial identity lives, beside the billing cycle the runner already
 * reads from it. When neither has one, `detail` says which link is broken,
 * because "no account" has three different fixes.
 */
export function resolveScheduleAccount(
  schedule: { iAccount?: number | null; companyId?: number | null },
  company: { sippyIAccount?: number | null } | null | undefined,
): ResolvedAccount {
  const own = toAccountId(schedule.iAccount);
  if (own !== null) {
    return { iAccount: own, source: 'schedule', detail: `Account ${own}, set on the schedule.` };
  }
  const fromCompany = toAccountId(company?.sippyIAccount);
  if (fromCompany !== null) {
    return { iAccount: fromCompany, source: 'company', detail: `Account ${fromCompany}, from the company record.` };
  }
  const why = schedule.companyId == null
    ? 'The schedule names no company.'
    : company == null
      ? `Company #${schedule.companyId} was not found.`
      : `Company #${schedule.companyId} has no Sippy account on record.`;
  return {
    iAccount: null, source: 'none',
    detail: `${why} Coverage and reconciliation cannot be checked without an account.`,
  };
}

/**
 * Can waiting change this verdict?
 *
 * Retryable, because the underlying data completes on its own or by ordinary
 * operations: `seed` (the switch was unreachable), `coverage` (days still
 * being collected), `reconcile` (a shortfall being worked), `certify` and
 * `generate` (the period has calls but is not yet rated).
 *
 * Terminal: `duplicate` — the period IS invoiced, which is the success case
 * wearing a refusal's clothes. And `certify` when the seed fetched nothing on
 * a period whose coverage already passed: the days were collected and the
 * switch has no calls, so there is nothing to bill and no amount of waiting
 * produces some. `freeze` is neither — the period simply has not ended, and
 * the ordinary cadence reaches it without a retry slot.
 */
export function isRetryable(stage: PeriodStage, seed?: { fetched: number } | null): boolean {
  if (stage === 'certify' && seed && seed.fetched === 0) return false;
  switch (stage) {
    case 'seed': case 'coverage': case 'reconcile': case 'certify': case 'generate':
      return true;
    case 'error':
      return true;   // the runner itself failed; the clock does not advance
    // Configuration faults. Not retryable, because waiting changes nothing —
    // but they do NOT advance the clock either, so they are re-checked on
    // every tick and clear themselves the moment the record is fixed.
    case 'duplicate': case 'freeze': case 'no-tariff': case 'no-account': case 'no-period':
      return false;
  }
}

const PIPELINE = 'Billing Certification → Pipeline run';

/** What happens next — by the scheduler, or by a person. */
export function nextStepFor(
  stage: PeriodStage,
  opts?: { retryable?: boolean; exhausted?: boolean; attempt?: number; seed?: { fetched: number } | null },
): string {
  const seed = opts?.seed ?? null;
  const attempt = opts?.attempt ?? 1;
  const exhausted = opts?.exhausted === true;
  const retryable = opts?.retryable ?? isRetryable(stage, seed);

  const byHand = `Run now on this schedule for the latest period, or ${PIPELINE} with the dates for an older one.`;

  if (exhausted) {
    return `Re-attempted ${attempt} time(s) without passing; the scheduler has stopped retrying it. ` +
           `Resolve the cause, then ${byHand}`;
  }
  if (retryable) {
    const left = Math.max(0, MAX_RETRY_ATTEMPTS - attempt);
    const cause =
      stage === 'coverage'  ? 'The scheduler re-attempts it once the missing days are collected'
      : stage === 'reconcile' ? 'The scheduler re-attempts it once the platform agrees with the switch'
      : stage === 'seed'      ? 'The scheduler re-attempts it once the switch answers'
      : stage === 'error'     ? 'The runner retries within 30 minutes'
      : 'The scheduler re-attempts it once the period is rated';
    return `${cause} — attempt ${attempt}, ${left} automatic attempt(s) left. No invoice is sent meanwhile.`;
  }
  switch (stage) {
    case 'duplicate': return 'Already invoiced — nothing to do.';
    case 'freeze':    return 'Attempted again on the next run, once the period has closed.';
    case 'certify':
      return seed && seed.fetched === 0
        ? 'The switch returned no calls for this account in the period, and its days were collected — ' +
          'there is nothing to invoice. Not retried.'
        : byHand;
    case 'no-tariff': return 'Set a tariff on the schedule; it is re-checked every 30 minutes.';
    case 'no-account':
      return 'Set the Sippy account on the company record, or on the schedule. Coverage and ' +
             'reconciliation cannot be checked without it, so no invoice can be generated. ' +
             'Re-checked every 30 minutes — the billing period is not lost.';
    case 'no-period': return 'Nothing to do until the next billing period closes.';
    default:          return byHand;
  }
}

/** Identity of a period within a schedule, for matching across runs. */
export const periodKey = (p: { start: string; end: string }) => `${p.start}..${p.end}`;

/**
 * One period's verdict, from the chain's result.
 *
 * `previous` is the same period's outcome on the last run, when there was one:
 * it carries the attempt count, which is what makes retry bounded rather than
 * perpetual. Wording of the failure itself is always the chain's.
 */
export function periodOutcomeFromChain(
  period: { start: string; end: string; accountingMonth?: string; partial?: boolean },
  chain: ChainResultLike,
  previous?: PeriodOutcome | null,
): PeriodOutcome {
  const base = {
    start: period.start, end: period.end,
    accountingMonth: period.accountingMonth, partial: period.partial,
  };
  if (chain.ok && chain.invoice) {
    return { ...base, ok: true, invoiceNumber: chain.invoice.invoiceNumber, lineCount: chain.invoice.lineCount };
  }
  // A success without an invoice is not a success. Name it rather than
  // count it as generated.
  const stage: PeriodStage = chain.ok
    ? 'generate'
    : (chain.stage && CHAIN_STAGES.has(chain.stage) ? (chain.stage as PeriodStage) : 'error');
  const reason = chain.ok
    ? 'The billing chain reported success but produced no invoice.'
    : (chain.error?.trim() || 'The billing chain refused without giving a reason.');

  const attempt = (previous && !previous.ok ? (previous.attempt ?? 1) : 0) + 1;
  const couldRetry = isRetryable(stage, chain.seed);
  const exhausted  = couldRetry && attempt >= MAX_RETRY_ATTEMPTS;
  const retryable  = couldRetry && !exhausted;

  return {
    ...base, ok: false, stage, reason, retryable, attempt,
    ...(exhausted ? { exhausted: true } : {}),
    next: nextStepFor(stage, { retryable, exhausted, attempt, seed: chain.seed }),
  };
}

/**
 * When to re-attempt, given the moment a run finished.
 *
 * Two rules: at least RETRY_INTERVAL_HOURS away, and never inside the nightly
 * collection window — a retry there would put the invoice chain's seed on the
 * same switch the collector is fetching from, during the only quiet hours it
 * gets. A candidate landing in the window is pushed to its end.
 */
export function nextRetryAt(now: Date, hours: number = RETRY_INTERVAL_HOURS): Date {
  const at = new Date(now.getTime() + hours * 3_600_000);
  const { startHour, endHour } = COLLECTION_WINDOW_UTC;
  if (at.getUTCHours() >= startHour && at.getUTCHours() < endHour) {
    at.setUTCHours(endHour, 0, 0, 0);
  }
  return at;
}

/**
 * The earliest period the next run must ask for again, as YYYY-MM-DD — the
 * oldest refused period that is still retryable. Undefined when nothing is
 * waiting, and the ordinary "latest closed period" applies.
 *
 * This is the half of the fix that scheduling alone cannot do: an earlier
 * next_run_at is useless if the run then asks only for the newest closed
 * period. `closedPeriods(term, asOf, since)` returns them all, and the chain's
 * duplicate guard — which runs BEFORE the seed — skips the ones already
 * invoiced at the cost of one query.
 */
export function retrySince(previous: ScheduleRunOutcome | null | undefined): string | undefined {
  const waiting = (previous?.periods ?? []).filter(p => !p.ok && p.retryable === true);
  if (waiting.length === 0) return undefined;
  return waiting.reduce((min, p) => (p.start < min ? p.start : min), waiting[0].start);
}

/** The same period on the previous run, for the attempt count. */
export function previousPeriod(
  previous: ScheduleRunOutcome | null | undefined,
  period: { start: string; end: string },
): PeriodOutcome | null {
  const k = periodKey(period);
  return (previous?.periods ?? []).find(p => periodKey(p) === k) ?? null;
}

/**
 * Which of the closed periods this run will actually attempt.
 *
 * `closedPeriods(term, asOf, since)` filters by DATE ONLY — it returns every
 * closed period in the range, including ones already invoiced and ones whose
 * retries are spent. Two things go wrong if a run simply takes the oldest N:
 *
 *   1. A period we deliberately STOPPED retrying is re-seeded anyway, which
 *      is the standing switch load the attempt limit exists to end.
 *   2. Current billing starves behind a backlog. With four slots and five
 *      open periods, the newest — the week the customer is actually waiting
 *      on — is never reached while the older four keep failing.
 *
 * So: drop what must not be re-attempted, then ALWAYS keep the newest period
 * and fill the remaining slots oldest-first. A backlog still drains in the
 * order the revenue was earned, but it can never hold this week's invoice
 * hostage. With a single slot, the newest wins.
 */
export function selectPeriodsToAttempt<T extends { start: string; end: string }>(
  all: readonly T[],
  previous: ScheduleRunOutcome | null | undefined,
  max: number = MAX_PERIODS_PER_RUN,
): T[] {
  const attemptable = all.filter(p => {
    const prev = previousPeriod(previous, p);
    if (!prev) return true;            // never attempted
    if (prev.ok) return false;         // already invoiced — the duplicate guard's job, not a slot
    return prev.retryable !== false;   // terminal or exhausted — do not re-seed
  });
  if (max <= 0) return [];
  if (attemptable.length <= max) return [...attemptable];
  // `all` arrives chronological (closedPeriods sorts), so the last is newest.
  const newest = attemptable[attemptable.length - 1];
  return [...attemptable.slice(0, max - 1), newest];
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const span = (p: PeriodOutcome) => (p.start === p.end ? p.start : `${p.start}→${p.end}`);

function headlineFor(periods: readonly PeriodOutcome[]): string {
  if (periods.length === 0) return 'No closed period to invoice.';
  const gen = periods.filter(p => p.ok);
  const ref = periods.filter(p => !p.ok);
  const genText = gen.map(p => `${p.invoiceNumber} (${p.lineCount ?? 0} line(s), ${span(p)})`).join(', ');
  const first = ref.find(p => p.exhausted) ?? ref[0];
  const tail  = first?.exhausted ? ' — needs attention, no automatic retry left'
              : first?.retryable ? ' — will be re-attempted' : '';
  const refText = first ? `${span(first)} at ${first.stage}: ${trim(first.reason ?? '', 130)}${tail}` : '';
  if (ref.length === 0) return `${gen.length} invoice(s) generated: ${genText}`;
  if (gen.length === 0) {
    return ref.length === 1 ? `Refused — ${refText}` : `Refused ${ref.length} period(s) — first: ${refText}`;
  }
  return `${gen.length} generated (${genText}); ${ref.length} refused — ${refText}`;
}

function statusFor(periods: readonly PeriodOutcome[]): RunStatus {
  if (periods.length === 0) return 'nothing';
  const gen = periods.filter(p => p.ok).length;
  if (gen === periods.length) return 'generated';
  return gen > 0 ? 'partial' : 'refused';
}

/** The record for a run that attempted its periods. */
export function buildRunOutcome(opts: {
  at: string; trigger: RunTrigger; account: ResolvedAccount;
  periods: readonly PeriodOutcome[];
  /** From nextRetryAt(), when any period is retryable. */
  retryAt?: Date | string | null;
}): ScheduleRunOutcome {
  const periods = [...opts.periods];
  const retryable = periods.filter(p => !p.ok && p.retryable === true).length;
  const retryAtIso = opts.retryAt == null
    ? null
    : (typeof opts.retryAt === 'string' ? opts.retryAt : opts.retryAt.toISOString());
  return {
    at: opts.at, trigger: opts.trigger, status: statusFor(periods),
    account: opts.account, periods,
    generated: periods.filter(p => p.ok).length,
    refused:   periods.filter(p => !p.ok).length,
    retryable,
    exhausted: periods.filter(p => p.exhausted === true).length,
    // A retry instant without a period waiting on it would misreport the
    // schedule as pending work it has none of.
    retryAt: retryable > 0 ? retryAtIso : null,
    headline: headlineFor(periods),
  };
}

/** The record for a run that stopped before any period was attempted. */
export function stoppedRun(opts: {
  at: string; trigger: RunTrigger; account?: ResolvedAccount;
  stage: RunStop['stage']; reason: string;
}): ScheduleRunOutcome {
  const reason = opts.reason.trim() || 'The run stopped without giving a reason.';
  const retryable = isRetryable(opts.stage);
  return {
    at: opts.at, trigger: opts.trigger, status: 'stopped',
    account: opts.account ?? UNRESOLVED,
    periods: [], generated: 0, refused: 0, retryable: 0, exhausted: 0, retryAt: null,
    stopped: { stage: opts.stage, reason, retryable, next: nextStepFor(opts.stage) },
    headline: reason,
  };
}
