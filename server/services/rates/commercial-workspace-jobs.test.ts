/**
 * The Commercial Workspace push-jobs panel, against the API that actually exists.
 *
 * The panel was written for a response nobody serves: it typed the query as `{ jobs: [...] }`
 * while `/api/rate-manager/jobs` returns a BARE ARRAY, so `jobsQ.data?.jobs ?? []` was always
 * empty and the table has always read "No push jobs found."
 *
 * Unwrapping alone would not have fixed it. The panel also reads four field names the row does
 * not carry — `clientName` (the row has `clientNames`), `iAccount` (not on the row at all), and
 * `totalRates`/`pushedRates`/`failedRates` (the row has `totalClients`/`pushedClients`/
 * `failedClients`) — and branches on a `running` status that only operations ever have; a job is
 * `pending`, `processing`, `completed`, `partial`, `failed` or `needs_review`. So three of six
 * columns would have rendered placeholders and the Pending tile would have missed every job in
 * flight.
 *
 * `partial` and `needs_review` are deliberately counted in NONE of the three tiles: this change
 * corrects a contract, it does not redefine the dashboard's status taxonomy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asJobList, jobCounts, filterJobs, jobClientLabel, jobProgress, type RatePushJobRow } from '@/lib/rate-push-jobs';

const row = (over: Partial<RatePushJobRow> = {}): RatePushJobRow =>
  ({ id: 1, jobId: 'job-1', status: 'completed', clientNames: 'aura', totalClients: 5, pushedClients: 5, failedClients: 0, ...over });

describe('asJobList — the response is a bare array, and nothing else is treated as one', () => {
  it('passes a bare array through', () => {
    const rows = [row(), row({ id: 2 })];
    expect(asJobList(rows)).toEqual(rows);
  });

  it('the wrapper the panel used to expect yields nothing — it was never the contract', () => {
    expect(asJobList({ jobs: [row()] })).toEqual([]);
  });

  it('undefined, null and an error body are empty, never a crash', () => {
    for (const v of [undefined, null, { error: 'Forbidden — insufficient permissions' }, 'nope', 42]) {
      expect(asJobList(v)).toEqual([]);
    }
  });
});

describe('jobCounts — pending means in flight, and only the three named states are counted', () => {
  const mixed = [
    row({ id: 1, status: 'completed' }), row({ id: 2, status: 'completed' }),
    row({ id: 3, status: 'failed' }),
    row({ id: 4, status: 'pending' }), row({ id: 5, status: 'processing' }),
    row({ id: 6, status: 'partial' }), row({ id: 7, status: 'needs_review' }),
  ];

  it('counts completed, failed, and pending+processing as Pending', () => {
    expect(jobCounts(mixed)).toEqual({ completed: 2, failed: 1, pending: 2 });
  });

  it('a job in flight is Pending — `processing`, not the operation-only `running`', () => {
    expect(jobCounts([row({ status: 'processing' })])).toEqual({ completed: 0, failed: 0, pending: 1 });
    // `running` is an operation status; no job ever has it, so it counts as nothing.
    expect(jobCounts([row({ status: 'running' })])).toEqual({ completed: 0, failed: 0, pending: 0 });
  });

  it('partial and needs_review are counted in NONE of the three — taxonomy unchanged', () => {
    const counts = jobCounts([row({ status: 'partial' }), row({ status: 'needs_review' })]);
    expect(counts).toEqual({ completed: 0, failed: 0, pending: 0 });
  });

  it('an empty list is three zeroes', () => {
    expect(jobCounts([])).toEqual({ completed: 0, failed: 0, pending: 0 });
  });
});

describe('filterJobs — searches the fields the row actually has', () => {
  const rows = [
    row({ id: 1, clientNames: 'aura', status: 'completed', destinationName: 'PAKISTAN - MOBILE ZONG', dialPrefix: '9231' }),
    row({ id: 2, clientNames: '1global, Test-31', status: 'failed', destinationName: 'AFGHANISTAN - MOBILE MTN', dialPrefix: '9376' }),
  ];

  it('an empty or blank query returns everything', () => {
    expect(filterJobs(rows, '')).toEqual(rows);
    expect(filterJobs(rows, '   ')).toEqual(rows);
  });

  it('matches a client name case-insensitively, including one of several', () => {
    expect(filterJobs(rows, 'AURA').map(r => r.id)).toEqual([1]);
    expect(filterJobs(rows, 'test-31').map(r => r.id)).toEqual([2]);
  });

  it('matches status, destination and dial prefix', () => {
    expect(filterJobs(rows, 'failed').map(r => r.id)).toEqual([2]);
    expect(filterJobs(rows, 'zong').map(r => r.id)).toEqual([1]);
    expect(filterJobs(rows, '9376').map(r => r.id)).toEqual([2]);
  });

  it('a row missing every optional field never throws and simply does not match', () => {
    const bare = [{ id: 9, status: 'pending' } as RatePushJobRow];
    expect(filterJobs(bare, 'aura')).toEqual([]);
    expect(filterJobs(bare, 'pending').map(r => r.id)).toEqual([9]);
  });
});

describe('jobClientLabel — the row carries clientNames, and there is no iAccount to fall back to', () => {
  it('shows the client names as stored', () => {
    expect(jobClientLabel(row({ clientNames: 'aura' }))).toBe('aura');
    expect(jobClientLabel(row({ clientNames: '1global, Test-31' }))).toBe('1global, Test-31');
  });

  it('falls back to a dash when the row names nobody', () => {
    expect(jobClientLabel(row({ clientNames: undefined }))).toBe('—');
    expect(jobClientLabel(row({ clientNames: '' }))).toBe('—');
  });

  /**
   * The old panel rendered `clientName || iAccount`. The row carries neither, but a future reader
   * may well re-add an account fallback from some other source; the dash must win anyway, because
   * an account number in the Client column is not the client and reads as one.
   */
  it('never falls back to an account number, even when the row is carrying one', () => {
    const withAccount = { ...row({ clientNames: '' }), iAccount: 77_014 } as RatePushJobRow;
    expect(jobClientLabel(withAccount)).toBe('—');
  });
});

describe('jobProgress — operation counts, under the column the panel calls Rates', () => {
  it('reads pushed/total/failed from the *Clients fields the row actually has', () => {
    expect(jobProgress(row({ totalClients: 5, pushedClients: 4, failedClients: 1 })))
      .toEqual({ pushed: 4, total: 5, failed: 1, pct: 80 });
  });

  it('a job with no total has no percentage and no bar', () => {
    expect(jobProgress(row({ totalClients: undefined, pushedClients: undefined, failedClients: undefined })))
      .toEqual({ pushed: 0, total: null, failed: 0, pct: null });
  });

  it('never divides by zero', () => {
    expect(jobProgress(row({ totalClients: 0, pushedClients: 0 })).pct).toBeNull();
  });
});

describe('the page is wired to the helpers, and the phantom fields are gone', () => {
  const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const PAGE   = strip(readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'commercial-workspace.tsx'), 'utf8'));
  const ROUTES = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));

  it('imports the helpers and stops unwrapping a .jobs property', () => {
    expect(PAGE).toMatch(/from ["']@\/lib\/rate-push-jobs["']/);
    expect(PAGE).not.toMatch(/jobsQ\.data\?\.jobs/);
    expect(PAGE).not.toMatch(/useQuery<\{\s*jobs:/);
  });

  /**
   * Scoped to the push-jobs panel. `clientName` and `iAccount` are real fields on OTHER panels of
   * this page (the client roster has its own type), so a page-wide search would fail on code that
   * is perfectly correct.
   */
  const JOBS_PANEL = (() => {
    const a = PAGE.indexOf('const jobsQ');
    expect(a, 'the jobs query must exist').toBeGreaterThan(-1);
    const b = PAGE.indexOf("tab === 'send'", a);
    expect(b).toBeGreaterThan(a);
    return PAGE.slice(a, b);
  })();

  it('no longer reads any field the row does not carry', () => {
    // `clientName\b` does not match `clientNames` — the trailing `s` is a word character.
    expect(JOBS_PANEL).not.toMatch(/\bclientName\b/);
    expect(JOBS_PANEL).not.toMatch(/\biAccount\b/);
    for (const phantom of ['totalRates', 'pushedRates', 'failedRates']) {
      expect(JOBS_PANEL, phantom).not.toContain(phantom);
    }
  });

  it('branches on `processing`, never on the operation-only `running`', () => {
    expect(JOBS_PANEL).not.toMatch(/'running'/);
    expect(JOBS_PANEL).toMatch(/j\.status === 'processing'/);
  });

  it('derives the panel through the helpers rather than inline', () => {
    for (const fn of ['asJobList(', 'filterJobs(', 'jobCounts(', 'jobClientLabel(', 'jobProgress(']) {
      expect(JOBS_PANEL, fn).toContain(fn);
    }
  });

  it('THE OTHER END OF THE CONTRACT: the route still returns a bare array', () => {
    const at = ROUTES.indexOf("app.get('/api/rate-manager/jobs'");
    expect(at).toBeGreaterThan(-1);
    const handler = ROUTES.slice(at, at + 1600);
    expect(handler).toContain('res.json(enriched)');
    expect(handler).not.toMatch(/res\.json\(\{\s*jobs/);
  });
});
