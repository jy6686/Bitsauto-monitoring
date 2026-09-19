/**
 * Push History refresh cadence — the regression that review item 10 found before it shipped.
 *
 * A legacy row parked at `processing` since 2026-08-30 must NOT keep the tab polling every three
 * seconds; only a processing job started within the last thirty minutes may. The window is a UI
 * heuristic and is asserted as such: it must not be presented as, or wired to, the server's rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pushHistoryPollInterval, PUSH_HISTORY_POLL_MS, PUSH_HISTORY_LIVE_WINDOW_MS } from '@/lib/push-history-poll';

const NOW = Date.parse('2026-09-19T14:30:00Z');
const at = (iso: string, status = 'processing') => ({ status, createdAt: iso });

describe('pushHistoryPollInterval', () => {
  it('the legacy stale processing row (job-1788118802847 shape, 2026-08-30) does NOT activate polling', () => {
    expect(pushHistoryPollInterval([at('2026-08-30T19:40:02.880Z')], NOW)).toBe(false);
  });

  it('a processing job started within the window polls at 3 s', () => {
    expect(pushHistoryPollInterval([at('2026-09-19T14:26:16.951Z')], NOW)).toBe(PUSH_HISTORY_POLL_MS);
    expect(PUSH_HISTORY_POLL_MS).toBe(3000);
  });

  it('the boundary is the window: 29 min polls, 30 min does not', () => {
    expect(pushHistoryPollInterval([{ status: 'processing', createdAt: new Date(NOW - 29 * 60_000) }], NOW)).toBe(3000);
    expect(pushHistoryPollInterval([{ status: 'processing', createdAt: new Date(NOW - 30 * 60_000) }], NOW)).toBe(false);
    expect(PUSH_HISTORY_LIVE_WINDOW_MS).toBe(30 * 60_000);
  });

  it('terminal or pending rows never poll, however young', () => {
    for (const s of ['completed', 'partial', 'failed', 'needs_review', 'pending']) {
      expect(pushHistoryPollInterval([at('2026-09-19T14:29:00Z', s)], NOW)).toBe(false);
    }
  });

  it('a mixed list polls only because of the young processing row', () => {
    const rows = [at('2026-08-30T19:40:02.880Z'), at('2026-09-19T14:00:39.720Z', 'completed'), at('2026-09-19T14:28:00Z')];
    expect(pushHistoryPollInterval(rows, NOW)).toBe(3000);
    expect(pushHistoryPollInterval(rows.slice(0, 2), NOW)).toBe(false);
  });

  it('unknown age is not young: a processing row with no parseable createdAt does not poll', () => {
    expect(pushHistoryPollInterval([{ status: 'processing', createdAt: null }], NOW)).toBe(false);
    expect(pushHistoryPollInterval([{ status: 'processing', createdAt: 'not a date' }], NOW)).toBe(false);
  });

  it('no rows, or not an array, means no polling', () => {
    expect(pushHistoryPollInterval([], NOW)).toBe(false);
    expect(pushHistoryPollInterval(undefined, NOW)).toBe(false);
    expect(pushHistoryPollInterval(null, NOW)).toBe(false);
  });
});

describe('it is a UI heuristic, wired where the list is, and not the server rule', () => {
  const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const PAGE = strip(readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'pages', 'rate-manager.tsx'), 'utf8'));
  const HELPER = readFileSync(join(__dirname, '..', '..', '..', 'client', 'src', 'lib', 'push-history-poll.ts'), 'utf8');

  it('JobsTab derives its refetchInterval from pushHistoryPollInterval and from nothing else', () => {
    const tab = PAGE.slice(PAGE.indexOf('function JobsTab()'), PAGE.indexOf('function JobsTab()') + 700);
    expect(tab).toMatch(/refetchInterval:\s*\(query: any\)\s*=>\s*pushHistoryPollInterval\(/);
    expect(tab).not.toMatch(/status === 'processing'\s*\)\s*\?\s*\d+/);
  });

  it('the helper says so in its own words and imports nothing from the server', () => {
    expect(HELPER).toMatch(/UI POLLING HEURISTIC/);
    expect(HELPER).toMatch(/NOT the server's authoritative/);
    // Import STATEMENTS only — the comment may (and does) name the server rule to disclaim it.
    expect(HELPER).not.toMatch(/^\s*import\b/m);
  });
});
