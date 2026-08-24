/**
 * Tariff resolution by effective date.
 *
 * The rule this pins was a live defect: resolution keyed off when a version was
 * RECORDED, so a rate added after a call could never price that call, and an
 * unrated call could never be fixed by supplying the missing rate. The two
 * cases that matter most are at the bottom — a backdated correction must reach
 * the call, and an already-rated call must resolve exactly as it did before.
 */

import { describe, it, expect } from 'vitest';
import { selectTariffVersion } from './tariff-effective-dating';

const v = (o: { id: string; from?: string | null; to?: string | null; created: string }) => ({
  id: o.id,
  effectiveFrom: o.from === undefined ? null : o.from,
  effectiveTo:   o.to ?? null,
  createdAt:     o.created,
});
const at = (iso: string) => new Date(iso);

describe('selectTariffVersion', () => {
  it('picks the version in force at the call time', () => {
    const versions = [
      v({ id: 'july',   from: '2026-07-01', created: '2026-07-01' }),
      v({ id: 'august', from: '2026-08-01', created: '2026-08-01' }),
    ];
    expect(selectTariffVersion(versions, at('2026-08-15T10:00:00Z'))?.id).toBe('august');
    expect(selectTariffVersion(versions, at('2026-07-15T10:00:00Z'))?.id).toBe('july');
  });

  it('ignores a version that takes effect after the call', () => {
    const versions = [v({ id: 'september', from: '2026-09-01', created: '2026-09-01' })];
    expect(selectTariffVersion(versions, at('2026-08-15T10:00:00Z'))).toBeNull();
  });

  it('honours an end date — a retired version does not price later calls', () => {
    const versions = [
      v({ id: 'old', from: '2026-01-01', to: '2026-06-30', created: '2026-01-01' }),
    ];
    expect(selectTariffVersion(versions, at('2026-03-01T00:00:00Z'))?.id).toBe('old');
    expect(selectTariffVersion(versions, at('2026-08-01T00:00:00Z'))).toBeNull();
  });

  it('prefers the newest RECORD when two versions share an effective date', () => {
    // A correction to an already-backdated period supersedes the original.
    const versions = [
      v({ id: 'first',      from: '2026-08-01', created: '2026-08-02' }),
      v({ id: 'correction', from: '2026-08-01', created: '2026-08-20' }),
    ];
    expect(selectTariffVersion(versions, at('2026-08-15T00:00:00Z'))?.id).toBe('correction');
  });

  it('falls back to the record date when no effective date is set', () => {
    // Pre-migration rows: behaviour identical to the old created_at rule.
    const versions = [
      v({ id: 'july',   from: null, created: '2026-07-01' }),
      v({ id: 'august', from: null, created: '2026-08-01' }),
    ];
    expect(selectTariffVersion(versions, at('2026-08-15T00:00:00Z'))?.id).toBe('august');
    expect(selectTariffVersion(versions, at('2026-07-15T00:00:00Z'))?.id).toBe('july');
  });

  it('empty and malformed inputs resolve to nothing rather than throwing', () => {
    expect(selectTariffVersion([], at('2026-08-15T00:00:00Z'))).toBeNull();
    expect(selectTariffVersion([v({ id: 'bad', from: 'not-a-date', created: 'also-bad' })],
      at('2026-08-15T00:00:00Z'))).toBeNull();
  });

  it('THE FIX: a rate backdated over the call now prices it', () => {
    // The call happened on 15 Aug. Nothing covered it, so it was unrated. On
    // 25 Aug someone adds the missing rate, effective from 1 Aug. Under the old
    // created_at rule this version was dated after the call and ignored
    // forever, leaving the call permanently unbillable.
    const call = at('2026-08-15T10:00:00Z');
    const beforeFix = [v({ id: 'late-entry', from: '2026-08-01', created: '2026-08-25' })];
    expect(selectTariffVersion(beforeFix, call)?.id).toBe('late-entry');
  });

  it('a version recorded late but NOT backdated still does not reach the call', () => {
    // Effective dating is not a licence to rate calls with rates that did not
    // apply to them. Recorded 25 Aug, effective 25 Aug, call on the 15th.
    const versions = [v({ id: 'not-backdated', from: '2026-08-25', created: '2026-08-25' })];
    expect(selectTariffVersion(versions, at('2026-08-15T10:00:00Z'))).toBeNull();
  });
});
