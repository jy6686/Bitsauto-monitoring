// Pakistan is the office this defect was found in, and the one whose times appear in the
// evidence. Set BEFORE importing anything that touches Date, so the local-time semantics under
// test are the ones an operator there actually gets.
process.env.TZ = 'Asia/Karachi';

import { describe, it, expect } from 'vitest';
import { toLocalInputValue, localInputToUtcPayload, localInputUtcHint } from '@shared/datetime-local';

describe('localInputToUtcPayload — the five-hour defect', () => {
  it('converts the two selections from the live incident', () => {
    // 1global: operator asked for 09:30 and the rate went live at 14:30 their time.
    expect(localInputToUtcPayload('2026-09-17T09:30')).toBe('2026-09-17 04:30');
    // shareef-tel: 19:10 would have activated at 00:10 the next morning.
    expect(localInputToUtcPayload('2026-09-17T19:10')).toBe('2026-09-17 14:10');
  });

  it('rolls the DATE back when the local time is before the offset', () => {
    // 02:00 in Karachi is 21:00 the PREVIOUS day in UTC. A conversion that moved only the
    // clock and not the date would schedule this a full day late.
    expect(localInputToUtcPayload('2026-09-18T02:00')).toBe('2026-09-17 21:00');
    expect(localInputToUtcPayload('2026-01-01T03:15')).toBe('2025-12-31 22:15');
  });

  it('rolls the date FORWARD across midnight the other way', () => {
    // 23:30 local is already the next day in UTC only where the offset is negative; in Karachi
    // it stays the same day. Pinned so a change of office does not silently change meaning.
    expect(localInputToUtcPayload('2026-09-17T23:30')).toBe('2026-09-17 18:30');
  });

  it('returns undefined rather than guessing, which keeps the change immediate', () => {
    for (const bad of ['', undefined, null, 'not a date', '2026-13-45T99:99']) {
      expect(localInputToUtcPayload(bad as any)).toBeUndefined();
    }
  });

  it('never emits a T separator — the server normalises a space-separated string', () => {
    expect(localInputToUtcPayload('2026-09-17T09:30')).not.toMatch(/T/);
    expect(localInputToUtcPayload('2026-09-17T09:30')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('is NOT a fixed five-hour subtraction — it goes through the platform offset', () => {
    // The delta must equal the environment's own offset, whatever that is. If someone
    // reintroduces a hard-coded -5, this fails everywhere except Karachi.
    const local = new Date('2026-06-15T12:00');           // mid-year, so a DST zone would differ
    const utc = localInputToUtcPayload('2026-06-15T12:00')!;
    const parsed = Date.parse(utc.replace(' ', 'T') + 'Z');
    expect(parsed - local.getTime()).toBe(0);
  });
});

describe('toLocalInputValue — the seeded default', () => {
  it('renders LOCAL wall clock, not the UTC slice the dialog used to seed', () => {
    const instant = new Date(Date.UTC(2026, 8, 17, 4, 30));  // 04:30 UTC = 09:30 in Karachi
    expect(toLocalInputValue(instant)).toBe('2026-09-17T09:30');
    // The old behaviour, kept here as the thing being fixed rather than described in prose.
    expect(instant.toISOString().slice(0, 16)).toBe('2026-09-17T04:30');
  });

  it('round-trips: a seeded default converts back to the instant it came from', () => {
    const instant = new Date(Date.UTC(2026, 11, 31, 20, 45));
    const seeded = toLocalInputValue(instant);
    expect(localInputToUtcPayload(seeded)).toBe('2026-12-31 20:45');
  });

  it('pads every field to two digits', () => {
    expect(toLocalInputValue(new Date(Date.UTC(2026, 0, 2, 0, 4)))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('localInputUtcHint — what the operator is shown', () => {
  it('states the UTC instant that will actually be sent', () => {
    expect(localInputUtcHint('2026-09-17T09:30')).toBe('2026-09-17 04:30 UTC');
  });
  it('shows nothing when there is nothing to state', () => {
    expect(localInputUtcHint('')).toBeNull();
    expect(localInputUtcHint('rubbish')).toBeNull();
  });
});
