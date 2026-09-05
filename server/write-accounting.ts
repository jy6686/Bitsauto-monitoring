/**
 * write-accounting.ts — what a partially-failed repository write actually did.
 *
 * WHY THIS EXISTS. `storeSlice` inserts a slice in 500-row batches, each
 * committing independently, with one try/catch around the whole loop. When a
 * batch failed it returned 0 — discarding the count of every batch that had
 * ALREADY COMMITTED. So `stored_total` under-reported, and the difference
 * between fetched and stored conflated two different things:
 *
 *     rows never written        a real gap, re-collection recovers it
 *     rows written, not counted an accounting artefact, nothing is missing
 *
 * On 2026-09-05 a job reported `fetched 1947 · stored 1241 · done` with a
 * connection timeout in last_error, and that 706 was read — by me — as 706
 * lost records. It cannot be read that way: the true gap is somewhere between
 * 0 and 706 and the instrumentation could not say which. A number that looks
 * like a measurement and is not one is the defect this codebase keeps finding,
 * and this module exists so the write path stops producing one.
 *
 * ── Three counts, not one ──────────────────────────────────────────────────
 *   confirmed  the driver reported a rowCount. Rows are in the table.
 *   unknown    the batch resolved but reported no rowCount. Probably stored,
 *              NOT counted as stored — the same rule as the money.
 *   failed     the batch threw. Those rows are not in the table.
 *
 * ── Why retrying is safe ───────────────────────────────────────────────────
 * The insert is `onConflictDoNothing()` against the repository's unique index,
 * so re-running a batch is a no-op for rows already present. A transient pool
 * timeout therefore costs nothing to retry, and the fetch path already retries
 * three times — the asymmetry was an oversight, not a decision.
 *
 * Pure: no DB, no clock, no I/O. The caller performs the writes.
 */

import { classifyRetry, type RetryCause } from './retry-classify';

/** What one batch attempt did. */
export interface BatchOutcome {
  /** 0-based batch index within the slice. */
  index: number;
  rows: number;
  /** Rows the driver confirmed. null when it reported none. */
  rowCount: number | null;
  /** The exception message, when the batch threw. */
  error?: string | null;
  /** Attempts made, including the first. */
  attempts: number;
}

export interface WriteResult {
  /** Rows the driver confirmed inserted. The only number safe to bill on. */
  confirmed: number;
  /**
   * Rows in batches that committed without a reported rowCount. Reported
   * separately rather than added to `confirmed` — `rowCount ?? chunk.length`
   * asserted success the driver never claimed.
   */
  unknown: number;
  /** Rows in batches that threw. These are genuinely absent. */
  failed: number;
  batchesTotal: number;
  batchesOk: number;
  batchesFailed: number;
  /** Highest batch index that committed. -1 when none did. */
  lastSuccessfulBatch: number;
  /** Rows committed up to and including that batch. */
  lastSuccessfulRows: number;
  /** First batch index that threw. null when none did. */
  failedBatch: number | null;
  failedBatchSize: number | null;
  retriesTotal: number;
  /** Which subsystem the failures blamed, classified once. */
  causes: RetryCause[];
  /** One line naming what committed and what did not. */
  detail: string;
}

/**
 * Transient enough to be worth another attempt?
 *
 * Only the failure kinds a second attempt can plausibly clear. A constraint
 * violation or a malformed row will fail identically every time, and retrying
 * it burns the collection window to reach the same answer.
 */
export function isRetryableWrite(message: string | null | undefined): boolean {
  const cause = classifyRetry(message);
  return cause === 'database' || cause === 'timeout' || cause === 'network';
}

export function summariseWrite(outcomes: readonly BatchOutcome[]): WriteResult {
  let confirmed = 0, unknown = 0, failed = 0;
  let batchesOk = 0, batchesFailed = 0, retriesTotal = 0;
  let lastSuccessfulBatch = -1, lastSuccessfulRows = 0;
  let failedBatch: number | null = null, failedBatchSize: number | null = null;
  const causes: RetryCause[] = [];

  for (const o of outcomes) {
    retriesTotal += Math.max(0, (o.attempts ?? 1) - 1);
    if (o.error) {
      batchesFailed++;
      failed += o.rows;
      causes.push(classifyRetry(o.error));
      if (failedBatch === null) { failedBatch = o.index; failedBatchSize = o.rows; }
      continue;
    }
    batchesOk++;
    if (o.rowCount == null) unknown += o.rows;
    else confirmed += o.rowCount;
    // "Up to and including" — the rows an operator can be sure are in the
    // table when the failure happened, which is the number they need first.
    if (o.index > lastSuccessfulBatch) {
      lastSuccessfulBatch = o.index;
      lastSuccessfulRows = confirmed + unknown;
    }
  }

  const detail = batchesFailed === 0
    ? `All ${outcomes.length} batch(es) written — ${confirmed} confirmed` +
      (unknown ? `, ${unknown} committed without a reported row count` : '') + '.'
    : `${batchesOk} of ${outcomes.length} batch(es) written before batch ` +
      `${failedBatch} failed (${failedBatchSize} row(s)). ${confirmed} row(s) confirmed in the ` +
      `repository` + (unknown ? `, ${unknown} committed without a reported count` : '') +
      `; ${failed} row(s) not written and recoverable by re-collection.`;

  return {
    confirmed, unknown, failed,
    batchesTotal: outcomes.length, batchesOk, batchesFailed,
    lastSuccessfulBatch, lastSuccessfulRows,
    failedBatch, failedBatchSize,
    retriesTotal, causes, detail,
  };
}
