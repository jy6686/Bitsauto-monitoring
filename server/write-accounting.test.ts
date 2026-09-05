import { describe, it, expect } from 'vitest';
import { summariseWrite, isRetryableWrite, type BatchOutcome } from './write-accounting';

const ok = (index: number, rows: number, rowCount: number | null = rows,
            attempts = 1): BatchOutcome => ({ index, rows, rowCount, attempts });
const bad = (index: number, rows: number, error: string, attempts = 1): BatchOutcome =>
  ({ index, rows, rowCount: null, error, attempts });

const TIMEOUT = 'Connection terminated due to connection timeout';

describe('the defect: committed work discarded on a later failure', () => {
  it('keeps what committed when a later batch fails', () => {
    // storeSlice returned 0 here, throwing away 1000 confirmed rows.
    const r = summariseWrite([ok(0, 500), ok(1, 500), bad(2, 500, TIMEOUT), ok(3, 447)]);
    expect(r.confirmed).toBe(1447);
    expect(r.failed).toBe(500);
    expect(r.batchesOk).toBe(3);
    expect(r.batchesFailed).toBe(1);
  });

  it('reports zero confirmed only when nothing committed', () => {
    const r = summariseWrite([bad(0, 500, TIMEOUT), bad(1, 500, TIMEOUT)]);
    expect(r.confirmed).toBe(0);
    expect(r.failed).toBe(1000);
    expect(r.lastSuccessfulBatch).toBe(-1);
  });

  it('separates rows never written from rows written but uncounted', () => {
    // The distinction the 1947/1241 reading could not make. One is a real gap
    // that re-collection recovers; the other is an accounting artefact.
    const r = summariseWrite([ok(0, 500), ok(1, 500, null), bad(2, 400, TIMEOUT)]);
    expect(r.confirmed).toBe(500);   // driver said so
    expect(r.unknown).toBe(500);     // committed, no rowCount reported
    expect(r.failed).toBe(400);      // genuinely absent
    expect(r.confirmed + r.unknown + r.failed).toBe(1400);
  });

  it('never folds unknown into confirmed', () => {
    // `rowCount ?? chunk.length` asserted a success the driver never claimed.
    const r = summariseWrite([ok(0, 500, null)]);
    expect(r.confirmed).toBe(0);
    expect(r.unknown).toBe(500);
    expect(r.detail).toContain('without a reported row count');
  });
});

describe('batch-level telemetry — where the failure happened', () => {
  it('names the last good batch and the first bad one', () => {
    const r = summariseWrite([ok(0, 500), ok(1, 500), bad(2, 500, TIMEOUT), bad(3, 200, TIMEOUT)]);
    expect(r.lastSuccessfulBatch).toBe(1);
    expect(r.lastSuccessfulRows).toBe(1000);
    expect(r.failedBatch).toBe(2);        // the FIRST failure, not the last
    expect(r.failedBatchSize).toBe(500);
  });

  it('says so in one line an operator can act on', () => {
    const r = summariseWrite([ok(0, 500), ok(1, 500), bad(2, 447, TIMEOUT)]);
    expect(r.detail).toContain('2 of 3 batch(es) written before batch 2 failed');
    expect(r.detail).toContain('1000 row(s) confirmed');
    expect(r.detail).toContain('447 row(s) not written and recoverable by re-collection');
  });

  it('reports a clean write plainly', () => {
    const r = summariseWrite([ok(0, 500), ok(1, 300)]);
    expect(r.batchesFailed).toBe(0);
    expect(r.failedBatch).toBeNull();
    expect(r.detail).toBe('All 2 batch(es) written — 800 confirmed.');
  });

  it('counts retries across batches', () => {
    const r = summariseWrite([ok(0, 500, 500, 3), ok(1, 500, 500, 1), bad(2, 100, TIMEOUT, 3)]);
    expect(r.retriesTotal).toBe(4);       // (3-1) + (1-1) + (3-1)
  });

  it('classifies what the failures blamed', () => {
    const r = summariseWrite([bad(0, 10, TIMEOUT), bad(1, 10, 'duplicate key value violates unique constraint')]);
    expect(r.causes).toHaveLength(2);
    expect(r.causes[0]).toBe('database');
  });

  it('handles an empty slice without inventing anything', () => {
    const r = summariseWrite([]);
    expect(r).toMatchObject({ confirmed: 0, unknown: 0, failed: 0, batchesTotal: 0,
                              lastSuccessfulBatch: -1, failedBatch: null });
  });
});

describe('isRetryableWrite — only what a second attempt can clear', () => {
  it('retries transient connection and timeout faults', () => {
    // The exact production message, and its neighbours.
    expect(isRetryableWrite(TIMEOUT)).toBe(true);
    expect(isRetryableWrite('timeout exceeded when trying to connect')).toBe(true);
    expect(isRetryableWrite('remaining connection slots are reserved')).toBe(true);
    expect(isRetryableWrite('ETIMEDOUT')).toBe(true);
    expect(isRetryableWrite('ECONNRESET')).toBe(true);
  });

  it('does NOT retry a fault a second attempt would reproduce exactly', () => {
    // A constraint violation or a bad value fails identically every time.
    // Retrying it spends the collection window to reach the same answer.
    expect(isRetryableWrite('null value in column "i_account" violates not-null constraint')).toBe(false);
    expect(isRetryableWrite('invalid input syntax for type integer')).toBe(false);
    expect(isRetryableWrite('permission denied for table raw_sippy_cdrs')).toBe(false);
  });

  it('treats an unreadable message as not retryable', () => {
    // Retrying on an unclassifiable error is guessing with the window's time.
    expect(isRetryableWrite(null)).toBe(false);
    expect(isRetryableWrite('')).toBe(false);
  });

  it('is safe to retry because the insert is idempotent', () => {
    // Stated as a test so the reason survives: onConflictDoNothing against the
    // repository's unique index makes a repeat a no-op, which is what makes
    // retrying free of side effects. If that ever changes, this comment is
    // where someone should look before keeping the retry.
    expect(isRetryableWrite(TIMEOUT)).toBe(true);
  });
});
