/**
 * business-day-status.ts — has yesterday's finance actually completed?
 *
 * WHY THIS REPLACES A PERCENTAGE. The Finance Health page led with "Data
 * Freshness 55%". Three days of work went into finding out what that number
 * meant, and the answer was that it did not mean anything: two of its three
 * inputs were daily artefacts being measured in elapsed minutes, so the score
 * moved with the clock rather than with the platform. Even after that was
 * fixed, a percentage is the wrong shape of answer. The first question anyone
 * asks a 55% is "what is missing", and a percentage cannot say.
 *
 * The distinction that makes this tractable is between two KINDS of thing:
 *
 *   Continuous services   API, scheduler, workers, database, queue
 *                         → "how long since the last heartbeat?"
 *   Daily artefacts       CDR import, DMR, snapshot, margin, reconciliation
 *                         → "has the business day been completed?"
 *
 * Only the first class has a meaningful age. The second has a COVERAGE
 * question, and this module answers it as a chain, because that is how the
 * nightly pipeline actually runs: each stage consumes what the one before it
 * produced.
 *
 * ── The state vocabulary is the whole point ────────────────────────────────
 * `waiting`, `blocked`, `failed` and `not_due` are four different facts and
 * collapsing them is how a dashboard stops being read:
 *
 *   not_due   the scheduled hour has not arrived. Nothing is wrong.
 *   waiting   has not run yet — either its own turn has not come, or the
 *             chain above it simply has not reached here.
 *   running   in progress right now.
 *   blocked   an upstream stage FAILED, so this one never got its chance. It
 *             has not failed itself — it was never asked.
 *   failed    it ran, against met prerequisites, and did not succeed.
 *   complete  it covers the target business day.
 *
 * Only a genuine upstream FAILURE turns a downstream stage red. An upstream
 * stage that has merely not run yet leaves everything below it grey, because
 * a board that goes red at 00:40 for work scheduled at 02:00 is a board that
 * stops being read. `blockedBy` is still set in both cases, so the reason is
 * always available without the colour claiming more than the evidence does.
 *
 * The blocked/failed line is the one that matters operationally. Reporting a
 * stage as failed when its input never arrived sends someone to debug the
 * wrong component — the same class of mistake as an unreadable flag reporting
 * "off", which cost a night's collection on 2026-09-03.
 *
 * `awaiting_approval` is deliberately its own state rather than a kind of
 * waiting. Customer dispatch is gated on a person by design; showing it as an
 * incomplete automated step would make a working control look like a defect,
 * and would eventually get "fixed".
 *
 * Pure: no DB, no clock, no environment. The caller gathers the evidence.
 */

import { dailyFreshness, dayKeyUtc, DEFAULT_GRACE_HOURS } from './freshness';

export type StageState =
  | 'complete' | 'running' | 'failed' | 'blocked'
  | 'waiting' | 'not_due' | 'awaiting_approval' | 'unavailable';

/** Green / amber / red / grey, for a caller that renders rather than reasons. */
export type StageTone = 'good' | 'active' | 'bad' | 'idle';

export const STATE_TONE: Record<StageState, StageTone> = {
  complete: 'good',
  running: 'active',
  failed: 'bad',
  blocked: 'bad',
  waiting: 'idle',
  not_due: 'idle',
  awaiting_approval: 'active',
  // Grey, never red. "We cannot report on this" is not "this failed", and
  // colouring it red would send someone to fix a stage that may be fine.
  unavailable: 'idle',
};

/**
 * Who has to act. Three, not two.
 *
 * The first version folded approval into `business`, which was wrong: waiting
 * for reference data and waiting for a named person to press approve are
 * different situations with different owners and different remedies. An
 * engineer reading a merged list cannot tell whether to investigate
 * infrastructure, chase data, or simply wait.
 *
 *   technical  an engineer investigates — a run broke, a service is down
 *   business   data or upstream state is missing — finance or ops chases it
 *   human      the platform is finished and a person must act. Nothing is
 *              wrong; this is the approval gate working as designed.
 */
export type IssueClass = 'business' | 'technical' | 'human';

/** Who owns each class, named so the board does not need a legend. */
export const ISSUE_OWNER: Record<IssueClass, string> = {
  technical: 'Engineering',
  business:  'Finance operations',
  human:     'Finance',
};

/** Where a stage's detail lives, for the board to double as navigation. */
export const STAGE_HREF: Record<StageKey, string> = {
  collect:       '/finance/health',
  verify:        '/cdr-reconciliation',
  dmr:           '/finance/pipeline-trace',
  snapshot:      '/finance-cockpit',
  margin:        '/margin-intelligence',
  reconcile:     '/finance/reconciliation',
  invoice_draft: '/invoices',
  invoice_send:  '/invoice-jobs',
};

export interface StageProgress {
  done: number;
  total: number;
  /** What is being counted — "accounts", "customers". Never assumed. */
  unit: string;
}

export interface StageStatus {
  key:   StageKey;
  label: string;
  state: StageState;
  tone:  StageTone;
  /** One line an operator can act on. Names days and counts, never a score. */
  detail: string;
  /** The business day this stage was judged against. */
  targetDay: string;
  /** Which upstream stage this one is behind — set whenever there IS one,
   *  whether that stage failed (red here) or simply has not run (grey here). */
  blockedBy?: StageKey;
  /** Real counts only. Omitted when the caller could not measure them —
   *  a fabricated denominator is worse than no progress bar. */
  progress?: StageProgress;
  /** When this stage last RAN, successfully or not, and how long it took. */
  lastRunAt?: string | null;
  durationMs?: number | null;
  /**
   * When this stage last COMPLETED SUCCESSFULLY. Distinct from lastRunAt on
   * purpose: a failed stage has a recent run and an older success, and showing
   * the run time under a red mark implies the stage did something it did not.
   * A green mark with a real completion timestamp is the difference between
   * "the check passed" and "the check ran".
   */
  lastSuccessAt?: string | null;
  /** Set only when this stage is not complete. */
  issueClass?: IssueClass;
  /** Who owns the next action. Derived from issueClass, carried for the UI. */
  owner?: string;
  /** Short phrase for the blocker callout — the WHY, without the stage name. */
  reason?: string;
  /** Detail page for this stage. */
  href: string;
}

export type StageKey =
  | 'collect' | 'verify' | 'dmr' | 'snapshot'
  | 'margin' | 'reconcile' | 'invoice_draft' | 'invoice_send';

/** The chain, in the order the night actually runs it. */
export const STAGE_ORDER: StageKey[] = [
  'collect', 'verify', 'dmr', 'snapshot', 'margin', 'reconcile',
  'invoice_draft', 'invoice_send',
];

export const STAGE_LABEL: Record<StageKey, string> = {
  collect:       'CDR Import',
  verify:        'Verification',
  dmr:           'Daily Minutes Report',
  snapshot:      'Financial Snapshot',
  margin:        'Margin Analysis',
  reconcile:     'Reconciliation',
  invoice_draft: 'Invoice Drafts',
  invoice_send:  'Customer Emails',
};

/**
 * What the caller observed for one stage. Every field is optional on purpose:
 * a caller that cannot determine something must be able to say so, and a
 * missing observation resolves to `waiting`/`not_due` rather than to a verdict
 * the evidence does not support.
 */
export interface StageEvidence {
  /** The newest business day this artefact covers, if any. */
  coveredDay?: string | null;
  /** A run is in flight right now. */
  running?: boolean;
  /** The last run for the target day ended in failure. */
  failed?: boolean;
  /** Verbatim error or note from the run, if there was one. */
  note?: string | null;
  /** Overrides the derived detail line when the caller knows better. */
  detail?: string;
  /** Real counts. Omit rather than invent a denominator. */
  progress?: StageProgress;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  durationMs?: number | null;
  /** The caller could not determine this stage's status at all. Distinct from
   *  failure: it means no integration or no answer, not a bad answer. */
  unavailable?: boolean;
  /** Short WHY for the callout, e.g. "reference data unavailable". */
  reason?: string;
  /** Overrides the derived business/technical classification. */
  issueClass?: IssueClass;
}

/**
 * The question an executive asks in the first three seconds.
 *
 * Deliberately THREE values, not two. "Yes" and "No" are the answers worth
 * having, but a stage the platform cannot see supports neither: saying yes
 * would overclaim and saying no would assert a failure that did not happen.
 * Reconciliation is in exactly that position today, so the third value is not
 * hypothetical.
 *
 * The human approval gate does NOT make the answer no. Automation finishing
 * its part and handing over is the system working; readiness describes whether
 * finance CAN operate, not whether every box is ticked.
 */
export type ReadyAnswer = 'yes' | 'no' | 'unconfirmed';

export interface Readiness {
  ready: ReadyAnswer;
  /** One sentence. Names the cause when the answer is not yes. */
  reason: string;
}

export interface BusinessDayInput {
  nowMs: number;
  /** Business coverage — customers with a completed collection for this day. */
  coverage?: { done: number; total: number; unit: string };
  scheduledHourUtc: number;
  graceHours?: number;
  /** Force the day under judgement. Normally derived from the clock. */
  targetDayOverride?: string;
  evidence: Partial<Record<StageKey, StageEvidence>>;
}

export type Verdict =
  | 'complete'       // every automated stage covers the target day
  | 'in_progress'    // something is running, nothing has failed
  | 'blocked'        // a stage failed, and downstream work cannot proceed
  | 'unconfirmed'    // nothing failed, but a stage cannot be reported on
  | 'not_due'        // the window has not opened yet
  | 'awaiting_approval'; // automation finished; a person must release invoices

export interface BusinessDayStatus {
  targetDay: string;
  verdict: Verdict;
  /** One sentence for the top of the page. States the day, never a score. */
  headline: string;
  /** The first stage that is not complete — the actionable one. */
  firstBlocker: StageStatus | null;
  stages: StageStatus[];
  /** Split by who has to act. An engineer and a finance controller should not
   *  have to read each other's list to find their own item. */
  businessIssues:  StageStatus[];
  technicalIssues: StageStatus[];
  /** Nothing is wrong here — a person simply has to act. */
  humanIssues:     StageStatus[];
  /**
   * BUSINESS coverage, alongside the runtime progress on each stage. These
   * answer different questions and both get asked: "how is tonight's run
   * going" is 33/48 jobs attempted, while "how much of the business is ready
   * to bill" is 45/49 customers with a completed collection. Choosing one
   * leaves the other question unanswered.
   */
  coverage: { done: number; total: number; unit: string } | null;
  /** The one line an executive reads first. */
  readiness: Readiness;
  /** Automated stages complete / automated stages total. Not a percentage. */
  completed: number;
  automatedTotal: number;
}

/**
 * The business day the platform owes right now.
 *
 * Shares its grace logic with dailyFreshness rather than reimplementing it:
 * before the pipeline's hour plus grace, yesterday is not yet owed, and two
 * modules disagreeing about that would put a red stage next to a green
 * artefact describing the same day.
 */
export function targetBusinessDay(
  nowMs: number, scheduledHourUtc: number, graceHours = DEFAULT_GRACE_HOURS,
): string {
  return dailyFreshness({
    latestDate: null, nowMs, scheduledHourUtc, graceHours,
  }).expectedDay!;
}

export function assessBusinessDay(input: BusinessDayInput): BusinessDayStatus {
  const graceHours = input.graceHours ?? DEFAULT_GRACE_HOURS;
  const targetDay = input.targetDayOverride
    ?? targetBusinessDay(input.nowMs, input.scheduledHourUtc, graceHours);

  // Has the window even opened? Before it does, nothing is late and every
  // stage reads not_due — an amber dashboard at 00:30 for work scheduled at
  // 02:00 trains people to ignore the dashboard.
  const todayStart = Date.parse(`${dayKeyUtc(input.nowMs)}T00:00:00Z`);
  const windowOpens = todayStart + input.scheduledHourUtc * 3_600_000;
  const beforeWindow = input.nowMs < windowOpens;

  const stages: StageStatus[] = [];
  // Two facts about the chain above this stage, not one. Whether it is broken
  // decides that this stage cannot proceed; whether it FAILED decides whether
  // that is a red condition or an ordinary not-there-yet.
  let upstreamBroken: StageKey | null = null;
  let upstreamFailed = false;
  let upstreamClass: IssueClass | null = null;
  let anyRunning = false;
  let anyFailed  = false;
  let anyUnavailable = false;

  for (const key of STAGE_ORDER) {
    const ev = input.evidence[key] ?? {};
    const covers = ev.coveredDay ?? null;
    const isComplete = covers != null && covers >= targetDay;

    let state: StageState;
    if (isComplete) {
      state = 'complete';
    } else if (ev.running) {
      state = 'running'; anyRunning = true;
    } else if (ev.unavailable && !upstreamBroken) {
      // No integration, or no answer. Reporting this as a failure would send
      // someone to fix a stage that may be working perfectly well.
      state = 'unavailable'; anyUnavailable = true;
    } else if (upstreamBroken) {
      // Never asked. Reporting this as a failure sends someone to debug a
      // component that was never given its input — but only an upstream
      // FAILURE makes this red. If the chain above simply has not reached
      // here yet, this stage is waiting like any other, because a board that
      // turns red at 00:40 for work scheduled at 02:00 stops being read.
      state = upstreamFailed ? 'blocked' : (beforeWindow ? 'not_due' : 'waiting');
    } else if (ev.failed) {
      state = 'failed'; anyFailed = true;
    } else if (key === 'invoice_send') {
      // Dispatch is human by design, not an unfinished automated step.
      state = 'awaiting_approval';
    } else if (beforeWindow) {
      state = 'not_due';
    } else {
      state = 'waiting';
    }

    // Classification. A stage that RAN and broke is technical; one waiting on
    // a person or on business data is not. Anything downstream inherits the
    // class of whatever is actually holding it up, so the callout points at
    // the same team the root cause does.
    const issueClass: IssueClass | undefined =
      state === 'complete' ? undefined
      : ev.issueClass ? ev.issueClass
      : state === 'awaiting_approval' ? 'human'
      : state === 'failed' ? 'technical'
      : state === 'unavailable' ? 'technical'
      : upstreamClass ?? 'business';

    stages.push({
      key, label: STAGE_LABEL[key], state, tone: STATE_TONE[state],
      targetDay, href: STAGE_HREF[key],
      detail: ev.detail ?? describe(key, state, covers, targetDay, ev.note ?? null, upstreamBroken),
      ...(ev.progress   ? { progress: ev.progress }     : {}),
      ...(ev.lastRunAt     !== undefined ? { lastRunAt: ev.lastRunAt }         : {}),
      ...(ev.lastSuccessAt !== undefined ? { lastSuccessAt: ev.lastSuccessAt } : {}),
      ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
      ...(issueClass ? { issueClass, owner: ISSUE_OWNER[issueClass] } : {}),
      ...(ev.reason ? { reason: ev.reason }
         : state === 'blocked' && upstreamBroken
           ? { reason: `${STAGE_LABEL[upstreamBroken]} did not complete` } : {}),
      ...(upstreamBroken && state !== 'complete' && state !== 'awaiting_approval'
          ? { blockedBy: upstreamBroken } : {}),
    });

    // Everything after a stage that did not complete is downstream of a gap.
    // `awaiting_approval` does not break the chain — it IS the end of it.
    if (!isComplete && state !== 'awaiting_approval' && !upstreamBroken) {
      upstreamBroken = key;
      upstreamFailed = state === 'failed';
      upstreamClass  = issueClass ?? null;
    }
  }

  const automated = stages.filter(s => s.key !== 'invoice_send');
  const completed = automated.filter(s => s.state === 'complete').length;
  const firstBlocker = stages.find(s => s.state !== 'complete' && s.state !== 'awaiting_approval') ?? null;

  const allAutomatedDone = completed === automated.length;
  const verdict: Verdict =
    allAutomatedDone
      ? (stages[stages.length - 1].state === 'complete' ? 'complete' : 'awaiting_approval')
      : anyFailed       ? 'blocked'
      : anyRunning      ? 'in_progress'
      : beforeWindow    ? 'not_due'
      // Nothing failed — we simply cannot see one of the stages. Saying
      // "incomplete" would assert something the evidence does not support.
      : anyUnavailable  ? 'unconfirmed'
      : 'blocked';

  const issues = stages.filter(s => s.issueClass && s.state !== 'complete');
  return {
    targetDay, verdict, firstBlocker, stages,
    businessIssues:  issues.filter(s => s.issueClass === 'business'),
    technicalIssues: issues.filter(s => s.issueClass === 'technical'),
    humanIssues:     issues.filter(s => s.issueClass === 'human'),
    coverage: input.coverage ?? null,
    readiness: readinessFor(verdict, targetDay, firstBlocker, completed, automated.length,
                            input.coverage ?? null),
    completed, automatedTotal: automated.length,
    headline: headlineFor(verdict, targetDay, firstBlocker, completed, automated.length),
  };
}

function describe(
  key: StageKey, state: StageState, covers: string | null, targetDay: string,
  note: string | null, upstream: StageKey | null,
): string {
  switch (state) {
    case 'complete':
      return covers === targetDay ? `Covers ${covers}` : `Covers ${covers} (ahead of ${targetDay})`;
    case 'running':
      return `Running now for ${targetDay}`;
    case 'failed':
      return note ? `Failed for ${targetDay} — ${note}` : `Failed for ${targetDay}`;
    case 'blocked':
      return `Waiting on ${STAGE_LABEL[upstream!]} — ${targetDay} never reached this stage`;
    case 'not_due':
      return upstream && upstream !== key
        ? `Not due yet — runs after ${STAGE_LABEL[upstream]} tonight`
        : `Not due yet — scheduled tonight for ${targetDay}`;
    case 'awaiting_approval':
      return 'Requires a person — the platform never sends an invoice by itself';
    case 'unavailable':
      // Wording matters: this is read by executives, not by the team that
      // wrote it. "Not yet wired to this view" is a development note.
      return 'Status unavailable — planned integration';
    default:
      if (upstream && upstream !== key) {
        return `Waiting on ${STAGE_LABEL[upstream]} — ${targetDay} has not reached this stage`;
      }
      return covers
        ? `Covers ${covers}; ${targetDay} not yet processed`
        : `${targetDay} not yet processed`;
  }
}

/**
 * "Finance Ready Today" — the top line.
 *
 * Ready means the automated pipeline has done its part for the business day,
 * so finance can operate. Invoices sitting in approval is NOT a no: the gate
 * is the system working as designed, and reporting it as unready would train
 * people to ignore the top line on every normal day.
 */
function readinessFor(
  verdict: Verdict, day: string, blocker: StageStatus | null,
  done: number, total: number,
  coverage: { done: number; total: number; unit: string } | null,
): Readiness {
  const cov = coverage && coverage.total > 0
    ? ` Coverage ${coverage.done}/${coverage.total} ${coverage.unit}.` : '';

  switch (verdict) {
    case 'complete':
      return { ready: 'yes',
               reason: `All required stages completed for business day ${day}.${cov}` };
    case 'awaiting_approval':
      // Automation finished. A person has to release the invoices, which is
      // the control working, not a fault.
      return { ready: 'yes',
               reason: `All required stages completed for business day ${day}. ` +
                       `Invoices are drafted and waiting for approval.${cov}` };
    case 'unconfirmed':
      return { ready: 'unconfirmed',
               reason: blocker
                 ? `${blocker.label} cannot be confirmed, so readiness for ${day} is unknown. ` +
                   `${done} of ${total} stages completed.${cov}`
                 : `Readiness for ${day} cannot be confirmed.${cov}` };
    case 'not_due':
      return { ready: 'unconfirmed',
               reason: `Business day ${day} is not due yet — collection starts tonight.` };
    case 'in_progress':
      return { ready: 'no',
               reason: `Business day ${day} is still processing — ${done} of ${total} ` +
                       `stages completed.${cov}` };
    case 'blocked':
      return { ready: 'no',
               reason: blocker
                 ? `${blocker.label} incomplete${blocker.reason ? ` — ${blocker.reason}` : ''}. ` +
                   `${done} of ${total} stages completed for ${day}.${cov}`
                 : `Business day ${day} is incomplete.${cov}` };
  }
}

function headlineFor(
  verdict: Verdict, day: string, blocker: StageStatus | null,
  done: number, total: number,
): string {
  switch (verdict) {
    case 'complete':
      return `${day} is complete — collected, reconciled, rated and invoiced.`;
    case 'awaiting_approval':
      return `${day} is processed and reconciled. Invoices are drafted and waiting for approval.`;
    case 'in_progress':
      return `${day} is being processed — ${done} of ${total} stages complete.`;
    case 'not_due':
      return `${day} is not due yet. Collection starts tonight.`;
    case 'unconfirmed':
      return blocker
        ? `${day} processed ${done} of ${total} stages. ${blocker.label} cannot be confirmed.`
        : `${day} cannot be fully confirmed.`;
    case 'blocked':
      return blocker
        ? `${day} is INCOMPLETE — stopped at ${blocker.label}. ${blocker.detail}`
        : `${day} is incomplete.`;
  }
}

// ── Continuous services ─────────────────────────────────────────────────────
// The other half of the split. These genuinely have an age, so they keep the
// heartbeat question — the point of this file is not that elapsed time is
// always wrong, it is that it is wrong for artefacts keyed by business day.

export interface HeartbeatInput {
  key: string;
  label: string;
  lastSeenIso?: string | null;
  /** Beyond this, the service is considered down. */
  toleranceSec: number;
  /** Set when the caller could not check at all — ignorance, not a verdict. */
  unknownReason?: string | null;
}

export interface HeartbeatStatus {
  key: string; label: string;
  state: 'up' | 'late' | 'down' | 'unknown';
  tone: StageTone;
  ageSec: number | null;
  detail: string;
}

export function assessHeartbeat(h: HeartbeatInput, nowMs: number): HeartbeatStatus {
  if (h.unknownReason) {
    return { key: h.key, label: h.label, state: 'unknown', tone: 'idle', ageSec: null,
             detail: `Could not check — ${h.unknownReason}` };
  }
  if (!h.lastSeenIso) {
    return { key: h.key, label: h.label, state: 'unknown', tone: 'idle', ageSec: null,
             detail: 'No heartbeat recorded' };
  }
  const ms = Date.parse(h.lastSeenIso);
  if (!Number.isFinite(ms)) {
    return { key: h.key, label: h.label, state: 'unknown', tone: 'idle', ageSec: null,
             detail: 'Heartbeat timestamp unreadable' };
  }
  const ageSec = Math.max(0, Math.round((nowMs - ms) / 1000));
  // Two bands, because "a beat late" and "gone" call for different reactions.
  const state = ageSec <= h.toleranceSec ? 'up'
              : ageSec <= h.toleranceSec * 3 ? 'late'
              : 'down';
  return {
    key: h.key, label: h.label, state,
    tone: state === 'up' ? 'good' : state === 'late' ? 'active' : 'bad',
    ageSec,
    detail: state === 'up' ? `Healthy — last seen ${fmtAge(ageSec)} ago`
          : state === 'late' ? `Late — last seen ${fmtAge(ageSec)} ago`
          : `No heartbeat for ${fmtAge(ageSec)}`,
  };
}

function fmtAge(sec: number): string {
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${Math.round(sec / 86400)}d`;
}
