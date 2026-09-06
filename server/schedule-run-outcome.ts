/**
 * schedule-run-outcome.ts — what a scheduled invoice run decided, and why.
 *
 * WHY THIS EXISTS. Both live schedules ran on 2026-08-31 and produced no
 * invoice. The billing chain refused them — correctly — and said so in one
 * console.warn line that nobody reads. invoice_schedules recorded only
 * last_run_at, so Finance saw "ran" beside no invoice and could not answer
 * "why not?" without asking Engineering. The same was due to happen at 06:00
 * UTC on 2026-09-07, a week in which the collector failed to seal four days.
 *
 * A refusal the chain has already worded belongs on the schedule row, in the
 * chain's own words, with what a person must do next — because the scheduler
 * does NOT retry a refused period: its clock advances once per run and the
 * next run asks only for the newest closed period. A refusal nobody sees is a
 * period nobody invoices.
 *
 * The second thing here is the resolver for the one input every data gate
 * in the chain is scoped to. Coverage and reconciliation ask "was THIS
 * account's period collected, and does it agree with the switch?" — and both
 * were written as `if (opts.iAccount) { … }`. Neither live schedule carries
 * an account; the company record does. So the gates were not failing, they
 * were being skipped, on exactly the path they were written for.
 *
 * Pure: no clock, no DB. The runner measures and persists; this decides and
 * words.
 */

export type RunTrigger = 'scheduler' | 'manual';

/** Where a period stopped: the chain's own stages, plus the runner's. */
export type PeriodStage =
  | 'duplicate' | 'seed' | 'freeze' | 'coverage' | 'reconcile' | 'certify' | 'generate'
  | 'no-tariff' | 'no-period' | 'error';

const CHAIN_STAGES: ReadonlySet<string> =
  new Set(['duplicate', 'seed', 'freeze', 'coverage', 'reconcile', 'certify', 'generate']);

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
  /** What a reader must do. The scheduler will not do it for them. */
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
  stage: 'no-tariff' | 'no-period' | 'error';
  reason: string;
  next: string;
}

export interface ScheduleRunOutcome {
  /** ISO instant of the run. */
  at: string;
  trigger: RunTrigger;
  account: ResolvedAccount;
  periods: PeriodOutcome[];
  generated: number;
  refused: number;
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

const PIPELINE = 'Billing Certification → Pipeline run';

/**
 * What a person does about a stop at this stage. "Not retried by the
 * scheduler" is a fact about the runner, not a policy chosen here: the next
 * run asks for the newest closed period only, so an older refused period
 * comes back only by hand.
 */
export function nextStepFor(stage: PeriodStage, seed?: { fetched: number } | null): string {
  const later = (when: string) =>
    `Not retried by the scheduler. ${when}, press Run now on this schedule for the latest period, ` +
    `or use ${PIPELINE} with the dates for an older one.`;
  switch (stage) {
    case 'duplicate': return 'Already invoiced — nothing to do.';
    case 'freeze':    return 'Attempted again on the next run, once the period has closed.';
    case 'seed':      return later('The CDR fetch from the switch failed. Once the switch is reachable');
    case 'coverage':  return later('Collect the missing days first (Finance → Health lists what is outstanding); then');
    case 'reconcile': return later('The platform and the switch disagree for this customer. Once the shortfall is resolved');
    case 'certify':
      return seed && seed.fetched === 0
        ? 'The switch returned no calls for this account in the period — there may be nothing to invoice.'
        : later('Run rating verification for this tariff and period; then');
    case 'generate':  return later('Once the period has rated snapshots');
    case 'no-tariff': return 'Set a tariff on the schedule; it is re-checked every 30 minutes.';
    case 'no-period': return 'Nothing to do until the next billing period closes.';
    case 'error':     return 'The run itself failed; it is retried automatically within 30 minutes.';
  }
}

/** One period's verdict, from the chain's result. Wording is the chain's. */
export function periodOutcomeFromChain(
  period: { start: string; end: string; accountingMonth?: string; partial?: boolean },
  chain: ChainResultLike,
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
  return { ...base, ok: false, stage, reason, next: nextStepFor(stage, chain.seed) };
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const span = (p: PeriodOutcome) => (p.start === p.end ? p.start : `${p.start}→${p.end}`);

function headlineFor(periods: readonly PeriodOutcome[]): string {
  if (periods.length === 0) return 'No closed period to invoice.';
  const gen = periods.filter(p => p.ok);
  const ref = periods.filter(p => !p.ok);
  const genText = gen.map(p => `${p.invoiceNumber} (${p.lineCount ?? 0} line(s), ${span(p)})`).join(', ');
  const first = ref[0];
  const refText = first ? `${span(first)} at ${first.stage}: ${trim(first.reason ?? '', 140)}` : '';
  if (ref.length === 0) return `${gen.length} invoice(s) generated: ${genText}`;
  if (gen.length === 0) {
    return ref.length === 1 ? `Refused — ${refText}` : `Refused ${ref.length} period(s) — first: ${refText}`;
  }
  return `${gen.length} generated (${genText}); ${ref.length} refused — ${refText}`;
}

/** The record for a run that attempted its periods. */
export function buildRunOutcome(opts: {
  at: string; trigger: RunTrigger; account: ResolvedAccount; periods: readonly PeriodOutcome[];
}): ScheduleRunOutcome {
  const periods = [...opts.periods];
  return {
    at: opts.at, trigger: opts.trigger, account: opts.account, periods,
    generated: periods.filter(p => p.ok).length,
    refused:   periods.filter(p => !p.ok).length,
    headline:  headlineFor(periods),
  };
}

/** The record for a run that stopped before any period was attempted. */
export function stoppedRun(opts: {
  at: string; trigger: RunTrigger; account?: ResolvedAccount;
  stage: RunStop['stage']; reason: string;
}): ScheduleRunOutcome {
  const reason = opts.reason.trim() || 'The run stopped without giving a reason.';
  return {
    at: opts.at, trigger: opts.trigger, account: opts.account ?? UNRESOLVED,
    periods: [], generated: 0, refused: 0,
    stopped: { stage: opts.stage, reason, next: nextStepFor(opts.stage) },
    headline: reason,
  };
}
