import { describe, it, expect } from 'vitest';
import { summariseSliceTiming, meanPageMs, type SliceSample } from './slice-timing';

const s = (label: string, totalMs: number, fetchMs: number, storeMs: number,
           pages = 1, rows = 40): SliceSample =>
  ({ label, totalMs, fetchMs, storeMs, pages, rows });

describe('the three-way split answers what one number cannot', () => {
  it('names the switch when the fetch dominates', () => {
    // The hypothesis under test: waiting on an XML-RPC call that returns
    // nothing. If true, this is the shape it produces.
    const r = summariseSliceTiming([
      s('01:00–01:30Z', 3_480_000, 3_479_000, 300, 1, 0),
      s('01:30–02:00Z', 3_500_000, 3_499_100, 300, 1, 0),
    ]);
    expect(r.dominant).toBe('fetch');
    expect(r.share!.fetch).toBeGreaterThan(0.99);
    expect(r.rows).toBe(0);
    expect(r.detail).toContain('fetching');
  });

  it('names our database when the write dominates', () => {
    const r = summariseSliceTiming([s('00:00–00:30Z', 60_000, 2_000, 57_000)]);
    expect(r.dominant).toBe('store');
    expect(r.share!.store).toBeGreaterThan(0.9);
  });

  it('names our own code when neither does', () => {
    // Dedup, filtering, the byICdr map — all land here.
    const r = summariseSliceTiming([s('00:00–00:30Z', 60_000, 2_000, 1_000)]);
    expect(r.dominant).toBe('other');
    expect(r.otherMs).toBe(57_000);
  });

  it('makes `other` a remainder so no phase can escape measurement', () => {
    // If a future phase is added and never timed, its cost appears here
    // rather than vanishing. That is why it is subtracted, not measured.
    const r = summariseSliceTiming([s('x', 10_000, 1_000, 1_000)]);
    expect(r.fetchMs + r.storeMs + r.otherMs).toBe(r.totalMs);
  });
});

describe('the ordinary case, from production', () => {
  it('reads a healthy account as unremarkable', () => {
    // PUSHTOTALK: 48 slices in 57m59s — about 72s a slice.
    const samples = Array.from({ length: 48 }, (_, i) =>
      s(`slice ${i}`, 72_000, 68_000, 2_500, 2, 41));
    const r = summariseSliceTiming(samples);
    expect(r.slices).toBe(48);
    expect(r.meanMs).toBe(72_000);
    expect(r.dominant).toBe('fetch');
    expect(r.rows).toBe(48 * 41);
  });

  it('reports partial progress, which is the point', () => {
    // A job that dies at slice 3 of 48 previously recorded nothing at all,
    // because the summary only ran after all 48 completed.
    const r = summariseSliceTiming([s('00:00–00:30Z', 900, 700, 120),
                                    s('00:30–01:00Z', 1_100, 900, 130)]);
    expect(r.slices).toBe(2);
    expect(r.meanMs).toBe(1_000);
    expect(r.detail).toContain('2 slice(s)');
  });
});

describe('the slowest slice is the one worth looking at', () => {
  it('keeps the worst, not the last', () => {
    const r = summariseSliceTiming([
      s('a', 1_000, 900, 50), s('b', 90_000, 89_000, 200), s('c', 1_200, 1_000, 60),
    ]);
    expect(r.slowest!.label).toBe('b');
    expect(r.slowest!.totalMs).toBe(90_000);
    expect(r.detail).toContain('Slowest b');
  });

  it('carries the slow slice\'s own split, so it can be read directly', () => {
    const r = summariseSliceTiming([s('a', 1_000, 900, 50), s('b', 90_000, 200, 89_000)]);
    expect(r.slowest).toMatchObject({ label: 'b', fetchMs: 200, storeMs: 89_000 });
  });
});

describe('degenerate inputs', () => {
  it('reports nothing rather than inventing a mean', () => {
    const r = summariseSliceTiming([]);
    expect(r).toMatchObject({ slices: 0, totalMs: 0, meanMs: null,
                              slowest: null, share: null, dominant: null });
    expect(r.detail).toBe('No slice has completed yet.');
  });

  it('clamps a negative remainder rather than reporting returned time', () => {
    // A page timed across a slice boundary can exceed the slice's own clock.
    // A negative `other` would read as a phase that gave time back.
    const r = summariseSliceTiming([s('x', 1_000, 1_200, 50)]);
    expect(r.otherMs).toBe(0);
  });

  it('survives a zero-duration slice without dividing by it', () => {
    const r = summariseSliceTiming([s('x', 0, 0, 0, 0, 0)]);
    expect(r.share).toBeNull();
    expect(r.dominant).toBeNull();
    expect(r.meanMs).toBe(0);
  });

  it('is JSON-safe — it is persisted on the job row', () => {
    const r = summariseSliceTiming([s('a', 1_000, 900, 50)]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('byCredential — did credentials 2-4 ever add anything?', () => {
  const tally = (pages: number, rows: number, empty: number, failed = 0, ms = 0, maxMs = 0) =>
    ({ pages, rows, empty, failed, ms, maxMs });

  it('shows the 4x pattern on an empty account exactly', () => {
    // Account 76 tonight: 48 slices, 192 pages, 0 rows. Four credentials
    // each asked once per slice, each answering empty.
    const samples = Array.from({ length: 48 }, (_, i) =>
      ({ ...s(`slice ${i}`, 60_000, 51_000, 0, 4, 0),
         creds: { admin: tally(1, 0, 1), portal: tally(1, 0, 1),
                  admin2: tally(1, 0, 1), portal2: tally(1, 0, 1) } }));
    const r = summariseSliceTiming(samples);
    expect(r.pages).toBe(192);
    expect(Object.keys(r.byCredential)).toHaveLength(4);
    for (const c of Object.values(r.byCredential)) {
      expect(c).toMatchObject({ pages: 48, rows: 0, empty: 48, failed: 0 });
    }
  });

  it('shows one credential doing all the work on an account with traffic', () => {
    // PUSHTOTALK tonight: 51 pages across 48 slices. The first credential
    // returned rows and the loop exited; the others were never reached.
    const samples = Array.from({ length: 48 }, (_, i) =>
      ({ ...s(`slice ${i}`, 60_000, 27_000, 23_000, 1, 41),
         creds: { admin: tally(1, 41, 0) } }));
    const r = summariseSliceTiming(samples);
    expect(Object.keys(r.byCredential)).toEqual(['admin']);
    expect(r.byCredential.admin.rows).toBe(48 * 41);
    expect(r.byCredential.admin.empty).toBe(0);
  });

  it('is the measurement that decides the credential question', () => {
    // A credential with rows > 0 has proven itself. A credential with only
    // `empty` has only ever confirmed what another already said. That
    // distinction is what the tally exists to make visible.
    const r = summariseSliceTiming([
      { ...s('a', 1, 1, 0, 2, 5), creds: { admin: tally(1, 5, 0), portal: tally(1, 0, 1) } },
      { ...s('b', 1, 1, 0, 2, 0), creds: { admin: tally(1, 0, 1), portal: tally(1, 0, 1) } },
    ]);
    expect(r.byCredential.admin).toMatchObject({ pages: 2, rows: 5, empty: 1, failed: 0 });
    expect(r.byCredential.portal).toMatchObject({ pages: 2, rows: 0, empty: 2, failed: 0 });
  });

  it('counts a failed page separately from an empty one', () => {
    const r = summariseSliceTiming([
      { ...s('a', 1, 1, 0, 1, 0), creds: { admin: tally(1, 0, 0, 1) } },
    ]);
    expect(r.byCredential.admin.failed).toBe(1);
    expect(r.byCredential.admin.empty).toBe(0);
  });

  it('is empty, not absent, when no sample carried credentials', () => {
    const r = summariseSliceTiming([s('a', 1, 1, 0)]);
    expect(r.byCredential).toEqual({});
  });
});

describe('page duration by credential — fallback cost, or the switch itself?', () => {
  const tally = (pages: number, rows: number, empty: number, ms: number, maxMs: number) =>
    ({ pages, rows, empty, failed: 0, ms, maxMs });

  it('sums duration and keeps the single slowest page across slices', () => {
    const r = summariseSliceTiming([
      { ...s('a', 1, 1, 0, 2, 0), creds: { admin: tally(1, 0, 1, 400, 400), portal: tally(1, 0, 1, 237_598, 237_598) } },
      { ...s('b', 1, 1, 0, 2, 0), creds: { admin: tally(1, 0, 1, 360, 360), portal: tally(1, 0, 1, 4_100, 4_100) } },
    ]);
    expect(r.byCredential.admin).toMatchObject({ pages: 2, ms: 760, maxMs: 400 });
    expect(r.byCredential.portal).toMatchObject({ pages: 2, ms: 241_698, maxMs: 237_598 });
  });

  it('derives the mean at read time rather than storing it', () => {
    // A stored mean drifts from its counts; a derived one cannot.
    expect(meanPageMs(tally(2, 0, 2, 760, 400))).toBe(380);
    expect(meanPageMs(tally(0, 0, 0, 0, 0))).toBeNull();     // no pages, no mean
  });

  it('distinguishes the two readings the owner named', () => {
    // Reading 1: credentials 2-4 are slow because of fallback — credential 1
    // is fast and the rest are not. Reading 2: EVERY empty request is
    // expensive, so the 4x loop multiplies a cost the switch imposes anyway.
    const fallbackSlow = summariseSliceTiming([
      { ...s('a', 1, 1, 0, 4, 0), creds: {
          c1: tally(1, 0, 1, 380, 380), c2: tally(1, 0, 1, 4_100, 4_100),
          c3: tally(1, 0, 1, 3_900, 3_900), c4: tally(1, 0, 1, 4_000, 4_000) } },
    ]).byCredential;
    expect(meanPageMs(fallbackSlow.c1)).toBeLessThan(1_000);
    expect(meanPageMs(fallbackSlow.c2)).toBeGreaterThan(3_000);

    const switchSlow = summariseSliceTiming([
      { ...s('a', 1, 1, 0, 4, 0), creds: {
          c1: tally(1, 0, 1, 12_000, 12_000), c2: tally(1, 0, 1, 12_400, 12_400),
          c3: tally(1, 0, 1, 11_900, 11_900), c4: tally(1, 0, 1, 12_100, 12_100) } },
    ]).byCredential;
    for (const c of Object.values(switchSlow)) expect(meanPageMs(c)).toBeGreaterThan(10_000);
  });
});
