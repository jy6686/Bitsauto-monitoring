/**
 * Reading `/api/rate-manager/jobs` — the shape it actually serves.
 *
 * The Commercial Workspace panel was written against a response nobody serves: it typed the
 * query as `{ jobs: [...] }` while the route returns a BARE ARRAY, so its table read "No push
 * jobs found." from the day it shipped. Unwrapping alone would not have fixed it — the panel also
 * read `clientName` (the row has `clientNames`), `iAccount` (absent entirely) and
 * `totalRates`/`pushedRates`/`failedRates` (the row has `totalClients`/`pushedClients`/
 * `failedClients`), and branched on a `running` status that only OPERATIONS have.
 *
 * So the derivations live here, pure, where they can be proven against the real field names
 * rather than assumed from a type that was never true.
 *
 * A NOTE ON THE *Clients NAMES. `totalClients` and friends hold OPERATION counts — one per
 * destination per client — not client counts. The route's own comment records that the column
 * name became wrong when multi-destination pushes arrived and that the numbers are the half worth
 * being right about. The panel's "Rates" heading is closer to the truth than the field name, so
 * mapping them onto it is correct even though it reads oddly.
 */

export interface RatePushJobRow {
  id: number;
  status: string;
  jobId?: string;
  /** Comma-joined; a batch can name several clients. */
  clientNames?: string | null;
  /** Operation counts, despite the names. See above. */
  totalClients?: number | null;
  pushedClients?: number | null;
  failedClients?: number | null;
  destinationName?: string | null;
  dialPrefix?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
}

/**
 * The response, or nothing. Deliberately strict: only an array is a job list. A `{ jobs: [...] }`
 * body yields an empty list rather than being quietly accommodated, because accommodating it is
 * what let the mismatch survive unnoticed — and an error body ({ message: 'Forbidden' }, which is
 * what a role without access receives) must never be mistaken for data.
 */
export function asJobList(data: unknown): RatePushJobRow[] {
  return Array.isArray(data) ? (data as RatePushJobRow[]) : [];
}

export interface JobCounts { completed: number; failed: number; pending: number }

/**
 * The three tiles. `pending` means IN FLIGHT: a job is `pending` before it starts and
 * `processing` while it runs — `running` is an operation status no job ever carries.
 *
 * `partial` and `needs_review` are counted in NONE of the three, deliberately. They are neither
 * finished nor failed nor in flight, and deciding where they belong would be a change to the
 * dashboard's taxonomy rather than a correction of its contract.
 */
export function jobCounts(rows: ReadonlyArray<RatePushJobRow>): JobCounts {
  return {
    completed: rows.filter(j => j.status === 'completed').length,
    failed:    rows.filter(j => j.status === 'failed').length,
    pending:   rows.filter(j => j.status === 'pending' || j.status === 'processing').length,
  };
}

/** Case-insensitive search across the fields the row carries. A missing field simply never matches. */
export function filterJobs(rows: ReadonlyArray<RatePushJobRow>, query: string): RatePushJobRow[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return rows as RatePushJobRow[];
  return rows.filter(j =>
    (j.clientNames     ?? '').toLowerCase().includes(q) ||
    (j.status          ?? '').toLowerCase().includes(q) ||
    (j.destinationName ?? '').toLowerCase().includes(q) ||
    (j.dialPrefix      ?? '').toLowerCase().includes(q),
  );
}

/** Who the push was for. There is no account number on the row to fall back to. */
export function jobClientLabel(row: RatePushJobRow): string {
  const names = (row.clientNames ?? '').trim();
  return names || '—';
}

export interface JobProgress { pushed: number; total: number | null; failed: number; pct: number | null }

/** Progress under the panel's "Rates" column. `total: null` means there is no bar to draw. */
export function jobProgress(row: RatePushJobRow): JobProgress {
  const total  = row.totalClients  == null || row.totalClients <= 0 ? null : Number(row.totalClients);
  const pushed = Number(row.pushedClients ?? 0);
  const failed = Number(row.failedClients ?? 0);
  return { pushed, total, failed, pct: total ? Math.round((pushed / total) * 100) : null };
}
