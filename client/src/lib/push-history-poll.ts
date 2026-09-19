/**
 * How often the Push History tab should refetch — pure, so it is provable without React.
 *
 * Poll only while a job is BOTH `processing` AND young. The status alone is not enough: a few
 * legacy rows (e.g. job-1788118802847, from 2026-08-30) sit at `processing` permanently with no
 * recorded intent, and keying on status alone would make the tab hammer the server every three
 * seconds for as long as it is open.
 *
 * UI POLLING HEURISTIC ONLY. This window is a display convenience for refreshing a list. It is
 * NOT the server's authoritative stale / in-flight rule — that lives in reconcile-core's
 * RATE_JOB_STALE_MS and is shared by the boot sweep and the submit guards, which the browser does
 * not (and must not) reimplement. A job older than this window is simply not refreshed
 * automatically; nothing about its state is decided here.
 */

export const PUSH_HISTORY_POLL_MS = 3000;
export const PUSH_HISTORY_LIVE_WINDOW_MS = 30 * 60_000;

export interface PushHistoryRow { status?: string | null; createdAt?: string | Date | null }

/** `PUSH_HISTORY_POLL_MS` while a young processing job exists; otherwise `false` (no polling). */
export function pushHistoryPollInterval(rows: ReadonlyArray<PushHistoryRow> | undefined | null, now: number = Date.now()): number | false {
  if (!Array.isArray(rows)) return false;
  const live = rows.some(j => {
    if (j?.status !== 'processing') return false;
    const t = j.createdAt instanceof Date ? j.createdAt.getTime() : Date.parse(String(j.createdAt ?? ''));
    // Unknown age is not "young": a row that cannot say when it started does not drive a loop.
    return Number.isFinite(t) && now - t < PUSH_HISTORY_LIVE_WINDOW_MS;
  });
  return live ? PUSH_HISTORY_POLL_MS : false;
}
