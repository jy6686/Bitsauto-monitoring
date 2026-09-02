/**
 * collection-progress.ts — how far through the day is the collector?
 *
 * The panel showed the CURRENT account and nothing else, so an operator could
 * see that asterisk was running without being able to tell whether that was
 * account 7 of 25 or account 24 of 25. Owner request 2026-09-02: lead with the
 * day, then the account.
 *
 * THE ETA IS THE HARD PART, and this panel has already lied about it twice.
 * Account durations differ by a factor of TWENTY — an empty account takes
 * ~60s, one with real traffic 16-24 minutes — and the busy ones are a handful
 * scattered through the list. So "elapsed ÷ completed × remaining" is not
 * merely imprecise, it is wrong in a specific and misleading direction:
 * measured across the 21 empty accounts that usually run first, it predicts
 * the whole day finishing in minutes, right up until it hits asterisk.
 *
 * Measured 2026-09-02: the slice-level ETA announced "≈ 14 min left" on an
 * account that finished 58 seconds later, and the operator reasonably read the
 * panel as stuck.
 *
 * So this separates the two populations it can actually distinguish — accounts
 * that have returned CDRs before, and accounts that have not — and estimates
 * each from its OWN observed durations. When it cannot do that honestly it
 * returns null rather than a number, because a confident wrong ETA is worse
 * than no ETA: it is the reason someone stops trusting the panel.
 *
 * Dependency-free so the arithmetic is pinned by tests.
 */

export interface AccountRun {
  iAccount: number;
  status:   'running' | 'done' | 'error' | string;
  /** Rows the switch returned. >0 marks this as a "busy" account for timing. */
  fetched:  number;
  /** Rows actually written. fetched − stored is dedup, not loss — see
   *  fetch-telemetry.ts for why those must stay distinguishable. */
  stored:   number;
  startedAt:  string;
  finishedAt: string | null;
}

export interface CollectionProgress {
  /** Accounts the collector intends to walk for this day. */
  total:     number;
  completed: number;
  running:   number;
  pending:   number;
  failed:    number;
  /** 0-100, of accounts — NOT of time. Stated because they differ wildly. */
  pct:       number;
  cdrs: { fetched: number; stored: number; duplicates: number };
  elapsedMs: number;
  /** null when no honest estimate exists. Never a guess dressed as a number. */
  etaMs:     number | null;
  /** Why the ETA is null, or how it was derived. Always populated. */
  etaBasis:  string;
  complete:  boolean;
}

const ms = (a: string, b: string | null, now: number) => {
  const s = Date.parse(a);
  const e = b ? Date.parse(b) : now;
  return Number.isFinite(s) && Number.isFinite(e) ? Math.max(0, e - s) : 0;
};

export function summariseCollection(opts: {
  runs:        AccountRun[];
  /** How many accounts the collector will visit. From the same selection the
   *  collector uses, never a count of rows already created. */
  totalAccounts: number;
  startedAtIso:  string;
  nowIso:        string;
}): CollectionProgress {
  const now = Date.parse(opts.nowIso);
  const runs = opts.runs;

  const done    = runs.filter(r => r.status === 'done');
  const running = runs.filter(r => r.status === 'running');
  const failed  = runs.filter(r => r.status === 'error');
  const total   = Math.max(opts.totalAccounts, done.length + running.length + failed.length);
  const seen    = done.length + running.length + failed.length;

  const fetched = runs.reduce((s, r) => s + (r.fetched || 0), 0);
  const stored  = runs.reduce((s, r) => s + (r.stored  || 0), 0);

  // Two populations, timed separately. Mixing them is what makes a naive
  // average predict minutes for a day that takes hours.
  const busyDone  = done.filter(r => r.fetched > 0);
  const emptyDone = done.filter(r => r.fetched === 0);
  const meanOf = (rs: AccountRun[]) =>
    rs.length ? rs.reduce((s, r) => s + ms(r.startedAt, r.finishedAt, now), 0) / rs.length : null;
  const meanBusy  = meanOf(busyDone);
  const meanEmpty = meanOf(emptyDone);

  const pending = Math.max(0, total - seen);

  let etaMs: number | null = null;
  let etaBasis: string;
  if (pending === 0 && running.length === 0) {
    etaMs = 0;
    etaBasis = 'complete';
  } else if (meanEmpty == null) {
    // Nothing finished yet. Any number here would be invented.
    etaBasis = 'no account has finished yet — no basis for an estimate';
  } else if (meanBusy == null) {
    // Only empty accounts so far. The busy ones are the entire cost of the
    // day and none has been observed, so an estimate from empties alone would
    // understate by an order of magnitude. Say that instead of predicting it.
    etaBasis = `${emptyDone.length} empty account(s) averaged ` +
               `${Math.round(meanEmpty / 1000)}s, but no account with traffic has finished yet — ` +
               'those take 15-25× longer and dominate the total, so no estimate is offered';
  } else {
    // Both observed. Assume pending accounts split in the same proportion as
    // the ones already done — the only evidence available, and stated as such.
    const busyShare = busyDone.length / Math.max(1, done.length);
    const pendingBusy  = pending * busyShare;
    const pendingEmpty = pending - pendingBusy;
    const runningLeft  = running.reduce((s, r) => {
      const spent = ms(r.startedAt, null, now);
      const expect = r.fetched > 0 ? meanBusy : meanEmpty;
      return s + Math.max(0, expect - spent);
    }, 0);
    etaMs = Math.round(pendingBusy * meanBusy + pendingEmpty * meanEmpty + runningLeft);
    etaBasis = `from ${busyDone.length} account(s) with traffic (avg ` +
               `${Math.round(meanBusy / 60000)}m) and ${emptyDone.length} without (avg ` +
               `${Math.round(meanEmpty / 1000)}s); pending assumed to split the same way`;
  }

  return {
    total, completed: done.length, running: running.length, pending, failed: failed.length,
    // Of ACCOUNTS. Time is not proportional to account count and the label
    // must not imply it is.
    pct: total > 0 ? Math.round((done.length / total) * 100) : 0,
    // duplicates is fetched − stored, which on a re-run is the DOMINANT number
    // and is not a loss. Labelled here so the panel never implies it is.
    cdrs: { fetched, stored, duplicates: Math.max(0, fetched - stored) },
    elapsedMs: ms(opts.startedAtIso, null, now),
    etaMs, etaBasis,
    complete: pending === 0 && running.length === 0 && total > 0,
  };
}
