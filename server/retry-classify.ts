/**
 * retry-classify.ts — which subsystem is making a collection retry?
 *
 * WHY. Retry accounting told us the 2026-09-03 job spent about fifty of its
 * ninety minutes asleep. It did not say what it was sleeping BECAUSE of, and
 * that is the question that decides who fixes it: a switch that times out, a
 * switch that returns 500, a rate limiter, an expired credential and a
 * database fault all produce the same "66 retries, 50m backoff" line and need
 * five different people.
 *
 * The classification is deliberately coarse and deliberately honest. Six
 * causes plus `unknown`, and `unknown` keeps a sample of the message rather
 * than being folded into a neighbour — a bucket that quietly absorbs whatever
 * does not match is how a distribution stops describing reality. If `unknown`
 * dominates, that is a finding about this module, and it should be visible as
 * one instead of showing up as a plausible `timeout` count.
 *
 * ORDER MATTERS and the order is not the obvious one. An HTTP 401 is both an
 * auth failure and a 4xx; a 429 is both a rate limit and a 4xx. The specific
 * reading is always the useful one, so the narrow patterns are tested first
 * and the generic status families last. Getting this backwards would file
 * every credential problem under "client error", which is true and useless.
 *
 * Pure: no clock, no DB, no network. One string in, one label out.
 */

export type RetryCause =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'server_error'
  | 'switch_fault'
  | 'database'
  | 'circuit_open'
  | 'unknown';

/** Operator-facing names. The board should not need the source to read it. */
export const CAUSE_LABEL: Record<RetryCause, string> = {
  timeout:      'Timeout',
  network:      'Network',
  auth:         'Authentication',
  rate_limit:   'Rate limit',
  server_error: 'Switch 5xx',
  switch_fault: 'Switch fault',
  database:     'Database',
  circuit_open: 'Circuit open',
  unknown:      'Unknown',
};

/** Who investigates each cause first. */
export const CAUSE_OWNER: Record<RetryCause, string> = {
  timeout:      'Switch / network',
  network:      'Network',
  auth:         'Credentials',
  rate_limit:   'Switch capacity',
  server_error: 'Switch',
  switch_fault: 'Switch',
  database:     'Platform',
  circuit_open: 'Platform',
  unknown:      'Needs triage',
};

/**
 * Patterns, most specific first. Each entry is [cause, test].
 *
 * Written against the strings this platform actually produces: node's socket
 * error codes, the XML-RPC layer's fault text, pg's connection errors and the
 * fetch layer's own messages. A pattern list assembled from what an API
 * *might* return would classify nothing.
 */
const RULES: Array<[RetryCause, RegExp]> = [
  // The platform's own refusal, which is not a switch problem at all.
  // NOT the bare "CDR fetch DID NOT RUN" prefix: that also opens the
  // no-credentials message, which is a configuration fault and must file
  // under auth, not here.
  ['circuit_open',  /circuit breaker is open|circuit_open/i],

  // Credentials before any generic status family: a 401 filed as "client
  // error" is true and useless.
  // `\bauth\b` catches an XML-RPC faultString of just "Auth", which is a real
  // credential signal. The word boundary keeps it narrow: it does not match
  // "authorization", "authorised" or "author".
  ['auth',          /\b401\b|\b403\b|\bauth\b|unauthor|forbidden|authentication|invalid credential|bad credential|login fail|access denied|no xml-?rpc credentials/i],

  ['rate_limit',    /\b429\b|rate ?limit|too many requests|throttl|slow down/i],

  // A CONNECTION-POOL timeout before the generic timeout rule. Production's
  // real strings are pg's own pool messages, and the generic /timeout/ below
  // would file them under "Switch / network", sending someone to the switch
  // when the pool is the thing that is exhausted.
  //
  //   "timeout exceeded when trying to connect"   forward-capture flag read,
  //                                               2026-09-04, with 17 retries
  //   "Connection terminated due to connection timeout"
  //                                               repository WRITE, 2026-09-05,
  //                                               job recon-2026-09-03-1
  //
  // The second one is why `connection terminated` appears here as well as in
  // the database rule further down: that rule was written for it, but the
  // production string also contains the word "timeout", so the generic rule
  // claimed it first. A message naming BOTH is still the pool.
  ['database',      /timeout exceeded when trying to connect|connection terminated|connection pool|pool (?:is )?(?:exhaust|full)|remaining connection slots/i],

  // Timeouts before network: ETIMEDOUT is a socket code but the actionable
  // reading is "it did not answer in time".
  ['timeout',       /timeout|timed ?out|ETIMEDOUT|ESOCKETTIMEDOUT|AbortError|aborted|deadline exceeded/i],

  // Database before network: pg's "Connection terminated" looks like a socket
  // fault but points at the pool, and the pool is ours.
  ['database',      /\bpg\b|postgres|relation .* does not exist|connection terminated|too many clients|deadlock|pool|column .* does not exist|duplicate key/i],

  ['network',       /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang ?up|dns|getaddrinfo|network|TLS|certificate/i],

  // A bare 50x needs HTTP context. This platform's own fetch messages embed
  // pagination offsets — "offset=500" — and a naked \b500\b would file every
  // one of those under a switch fault.
  ['server_error',  /\b(?:http|status(?: code)?|code|error)\s*[:=]?\s*50[0234]\b|\b50[0234]\s+(?:internal|bad gateway|service unavail|gateway)|internal server error|bad gateway|service unavailable|gateway time/i],

  // The switch answering in-band with a fault is a distinct fact from an HTTP
  // failure: the call arrived and was rejected.
  ['switch_fault',  /faultCode|faultString|xml-?rpc (fault|error)|<fault>/i],
];

export function classifyRetry(message: string | null | undefined): RetryCause {
  const m = String(message ?? '').trim();
  if (!m) return 'unknown';
  for (const [cause, re] of RULES) if (re.test(m)) return cause;
  return 'unknown';
}

export interface CauseCount {
  cause: RetryCause;
  label: string;
  owner: string;
  count: number;
  /** A representative message. Kept for `unknown` above all, so a bucket that
   *  is not understood can be understood without opening the logs. */
  sample?: string;
}

export interface RetryDistribution {
  total: number;
  /** Descending by count. Causes with zero occurrences are omitted, not shown
   *  as zeros — a list of zeros reads as a checklist that was verified. */
  causes: CauseCount[];
  /** The cause responsible for most retries, or null when there are none. */
  dominant: CauseCount | null;
  /** True when `unknown` is the largest bucket — a finding about THIS module
   *  rather than about the switch, and it must not read as one about the
   *  switch. */
  mostlyUnclassified: boolean;
}

/**
 * Roll a list of retry messages into a distribution.
 *
 * Takes the raw messages rather than pre-counted causes so the classification
 * lives in exactly one place; a caller that counted its own buckets would
 * drift from this one the first time a rule changed.
 */
export function summariseRetries(messages: Array<string | null | undefined>): RetryDistribution {
  const buckets = new Map<RetryCause, { count: number; sample?: string }>();
  for (const msg of messages) {
    const cause = classifyRetry(msg);
    const b = buckets.get(cause) ?? { count: 0 };
    b.count++;
    if (!b.sample && msg) b.sample = String(msg).slice(0, 160);
    buckets.set(cause, b);
  }

  const causes: CauseCount[] = [...buckets.entries()]
    .map(([cause, b]) => ({
      cause, label: CAUSE_LABEL[cause], owner: CAUSE_OWNER[cause],
      count: b.count, ...(b.sample ? { sample: b.sample } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const total = messages.length;
  const dominant = causes[0] ?? null;
  return {
    total, causes, dominant,
    mostlyUnclassified: dominant?.cause === 'unknown' && total > 0,
  };
}

// ── Efficiency ─────────────────────────────────────────────────────────────

export interface Efficiency {
  elapsedMs: number;
  /** Elapsed minus backoff. Time the job was actually doing something. */
  workingMs: number;
  waitingMs: number;
  /** workingMs / elapsedMs, 0–1. null when no time has passed. */
  ratio: number | null;
  /** Rounded percentage for display. null when no time has passed. */
  percent: number | null;
  /** One line: the three numbers and the verdict. */
  summary: string;
}

/**
 * How much of a job's wall clock was productive.
 *
 * "1h30m" is not a diagnosis. "39m working, 51m waiting, 43% productive" is —
 * it says the job was mostly not working, which points at the switch rather
 * than at the size of the account.
 */
export function computeEfficiency(elapsedMs: number, backoffMs: number): Efficiency {
  const elapsed = Math.max(0, elapsedMs);
  // Clamped: a backoff total larger than elapsed means the accounting is
  // wrong, and a negative "working" figure would be a worse lie than a zero.
  const waiting = Math.min(Math.max(0, backoffMs), elapsed);
  const working = elapsed - waiting;
  const ratio   = elapsed > 0 ? working / elapsed : null;
  const percent = ratio == null ? null : Math.round(ratio * 100);
  return {
    elapsedMs: elapsed, workingMs: working, waitingMs: waiting, ratio, percent,
    summary: percent == null
      ? 'No time elapsed.'
      : `${fmtMs(working)} working, ${fmtMs(waiting)} waiting — ${percent}% productive.`,
  };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
