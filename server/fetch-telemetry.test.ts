import { describe, it, expect } from 'vitest';
import { summariseDisposition, suspiciousSlices, summariseFetch, type SliceTelemetry } from './fetch-telemetry';

const PAGE = 1000;

const slice = (over: Partial<SliceTelemetry> = {}): SliceTelemetry => ({
  label: '00:00–00:30Z', pages: [{ offset: 0, rows: 10, ok: true }], end: 'end_of_data',
  received: 10, kept: 10, inserted: 10, duplicate: 0, invalid: 0, ...over,
});

describe('the accounting identity — every row lands in exactly one bucket', () => {
  it('balances a clean slice', () => {
    const d = summariseDisposition([slice()]);
    expect(d.balances).toBe(true);
    expect(d.unaccounted).toBe(0);
  });

  it('balances the mixed case', () => {
    const d = summariseDisposition([slice({
      received: 1000, kept: 900, inserted: 500, duplicate: 380, invalid: 20,
    })]);
    // 100 filtered + 500 + 380 + 20 = 1000
    expect(d.filtered).toBe(100);
    expect(d.unaccounted).toBe(0);
    expect(d.balances).toBe(true);
  });

  /**
   * The point of an exhaustive split is that a residual is impossible. If one
   * appears, a row went somewhere no counter knows about — and every figure
   * beside it becomes a story rather than evidence.
   */
  it('REFUSES to balance when rows vanish between counters', () => {
    const d = summariseDisposition([slice({
      received: 1000, kept: 1000, inserted: 500, duplicate: 0, invalid: 0,
    })]);
    expect(d.unaccounted).toBe(500);
    expect(d.balances).toBe(false);
  });

  it('says so loudly in the verdict, before anything else', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [slice({
      received: 1000, kept: 1000, inserted: 500, duplicate: 0, invalid: 0,
    })] });
    // First, not merely present: if the counters are wrong, every other
    // sentence in the verdict is unreliable and must not be read first.
    expect(s.verdict.startsWith('COUNTERS DO NOT BALANCE')).toBe(true);
  });

  it('sums across many slices', () => {
    const d = summariseDisposition([
      slice({ received: 100, kept: 100, inserted: 100 }),
      slice({ received: 50,  kept: 50,  inserted: 20, duplicate: 30 }),
    ]);
    expect(d.received).toBe(150);
    expect(d.inserted).toBe(120);
    expect(d.duplicate).toBe(30);
    expect(d.balances).toBe(true);
  });
});

describe('the two dispositions that look identical in a total', () => {
  /**
   * The user's case, and the reason inserted/duplicate/invalid are separate
   * columns: both of these store 500 rows out of 1000. One is healthy, one is
   * losing half the data, and the repository count cannot tell them apart.
   */
  const mostlyDuplicate = slice({ received: 1000, kept: 1000, inserted: 500, duplicate: 480, invalid: 20 });
  const mostlyInvalid   = slice({ received: 1000, kept: 1000, inserted: 500, duplicate: 0,   invalid: 500 });

  it('agree on what was stored', () => {
    expect(summariseDisposition([mostlyDuplicate]).inserted)
      .toBe(summariseDisposition([mostlyInvalid]).inserted);
  });

  it('but report losses differing by 25×, which is the whole point', () => {
    // Both carry SOME real loss — 20 rows and 500 rows — so the distinction is
    // never "one is clean". It is that an identical repository count conceals
    // a 25-fold difference in what actually went missing, and only the split
    // surfaces it. (My first version of this test asserted the duplicate-heavy
    // case reported no loss at all; it has invalid:20, so the module was
    // right and the assertion was wrong.)
    const dup = summariseFetch({ pageSize: PAGE, slices: [mostlyDuplicate] });
    const inv = summariseFetch({ pageSize: PAGE, slices: [mostlyInvalid] });
    expect(dup.verdict).toContain('20 row(s) were received and never stored');
    expect(inv.verdict).toContain('500 row(s) were received and never stored');
    expect(inv.disposition.invalid / dup.disposition.invalid).toBe(25);
    expect(inv.disposition.duplicate).toBe(0);
    expect(dup.disposition.duplicate).toBe(480);
  });
});

describe('suspiciousSlices — a full last page means the loop quit early', () => {
  /**
   * classifyCdrPage only exits on a short page, an error, or the ceiling. So a
   * FULL final page proves the exit was not end-of-data, whatever the slice
   * recorded — the single most diagnostic fact about a truncating fetch, and
   * one that is invisible in any total.
   */
  it('flags a slice whose last page was full', () => {
    const s = slice({
      label: '13:00–13:30Z',
      pages: [{ offset: 0, rows: PAGE, ok: true }, { offset: PAGE, rows: PAGE, ok: true }],
      end: 'end_of_data', received: 2000, kept: 2000, inserted: 2000,
    });
    expect(suspiciousSlices([s], PAGE)).toEqual(['13:00–13:30Z']);
  });

  it('does not flag a slice that ended short', () => {
    const s = slice({
      pages: [{ offset: 0, rows: PAGE, ok: true }, { offset: PAGE, rows: 12, ok: true }],
      received: PAGE + 12, kept: PAGE + 12, inserted: PAGE + 12,
    });
    expect(suspiciousSlices([s], PAGE)).toEqual([]);
  });

  it('does not double-report a slice that ended on an error', () => {
    // An error is already surfaced as an error; calling it "suspicious" too
    // would inflate the count that is supposed to mean something specific.
    const s = slice({
      pages: [{ offset: 0, rows: 0, ok: false }], end: 'error',
      received: 0, kept: 0, inserted: 0,
    });
    expect(suspiciousSlices([s], PAGE)).toEqual([]);
  });

  it('ignores a slice with no pages at all', () => {
    expect(suspiciousSlices([slice({ pages: [] })], PAGE)).toEqual([]);
  });

  it('names them in the verdict and blames pagination, not the store', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [slice({
      label: '13:00–13:30Z',
      pages: [{ offset: 0, rows: PAGE, ok: true }],
      received: PAGE, kept: PAGE, inserted: PAGE,
    })] });
    expect(s.verdict).toContain('13:00–13:30Z');
    expect(s.verdict).toContain('FULL page');
    expect(s.verdict).toContain('not the store');
  });
});

describe('end-state breakdown', () => {
  it('counts each terminating condition', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [
      slice({ end: 'end_of_data' }),
      slice({ end: 'error', pages: [{ offset: 0, rows: 0, ok: false }] }),
      slice({ end: 'page_limit' }),
      slice({ end: 'page_limit' }),
    ] });
    expect(s.endBreakdown.end_of_data).toBe(1);
    expect(s.endBreakdown.error).toBe(1);
    expect(s.endBreakdown.page_limit).toBe(2);
    expect(s.verdict).toContain('page ceiling');
    expect(s.verdict).toContain('FETCH ERROR');
  });

  it('counts pages across slices', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [
      slice({ pages: [{ offset: 0, rows: 5, ok: true }] }),
      slice({ pages: [{ offset: 0, rows: PAGE, ok: true }, { offset: PAGE, rows: 5, ok: true }] }),
    ] });
    expect(s.pages).toBe(3);
    expect(s.slices).toBe(2);
  });
});

describe('the clean verdict points OUTWARD, at the request', () => {
  /**
   * Production 2026-08-31: fetched === stored exactly, no errors, nothing
   * filtered — and still 11% of the reference. When the loop is provably
   * innocent the remaining suspect is what was ASKED, and the verdict has to
   * say that rather than declaring health.
   */
  it('does not claim everything is fine merely because nothing was lost', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [slice({
      received: 1127, kept: 1127, inserted: 1127,
      pages: [{ offset: 0, rows: 1127 - PAGE + PAGE, ok: true }, { offset: PAGE, rows: 127, ok: true }],
    })] });
    expect(s.verdict).toContain('the gap is in the REQUEST');
    expect(s.verdict).toContain('returned less than it billed');
  });

  it('reports the buckets in the clean case so the reader can check the claim', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [slice({
      received: 100, kept: 90, inserted: 60, duplicate: 30, invalid: 0,
      pages: [{ offset: 0, rows: 100, ok: true }],
    })] });
    expect(s.verdict).toContain('60 inserted');
    expect(s.verdict).toContain('30 already');
    expect(s.verdict).toContain('10 filtered');
  });
});

describe('empty input', () => {
  it('reports zeroes that balance rather than throwing', () => {
    const s = summariseFetch({ pageSize: PAGE, slices: [] });
    expect(s.slices).toBe(0);
    expect(s.disposition.balances).toBe(true);
    expect(s.disposition.received).toBe(0);
  });
});
