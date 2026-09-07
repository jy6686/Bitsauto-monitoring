import { describe, it, expect } from 'vitest';
import { repositoryRowToVerification, mapRepositoryRows, type RepositoryCdrRow } from './repository-rating';

const row = (over: Partial<RepositoryCdrRow> = {}): RepositoryCdrRow => ({
  i_cdr: '9001', cdr_call_id: 'abc-123@switch', callee: '923001234567',
  started_at: new Date('2026-09-02T00:05:04.000Z'), billed_secs: '61', cost: 0.0203, payload: null,
  ...over,
});

describe('the mapping is the fetch path’s mapping', () => {
  it('produces the exact shape verifyBatch consumes', () => {
    const m = repositoryRowToVerification(row(), '32');
    expect(m.input).toEqual({
      callId: 'abc-123@switch', startTime: '2026-09-02T00:05:04.000Z', callee: '923001234567',
      durationSecs: 61, sippyActualCost: 0.0203, iTariff: '32',
    });
    expect(m.reason).toBeNull();
    expect(m.costMissing).toBe(false);
  });

  it('prefers the switch call id, then i_cdr — same precedence as ingestion, so dedup agrees', () => {
    expect(repositoryRowToVerification(row({ cdr_call_id: null }), '32').input!.callId).toBe('9001');
    expect(repositoryRowToVerification(row({ cdr_call_id: ' ' }), '32').input!.callId).toBe('9001');
  });

  it('reads billed_secs as a number whether numeric arrives as string or number', () => {
    // billed_secs is NUMERIC in Postgres and comes back as a string.
    expect(repositoryRowToVerification(row({ billed_secs: '87.22' }), '32').input!.durationSecs).toBeCloseTo(87.22);
    expect(repositoryRowToVerification(row({ billed_secs: 30 }), '32').input!.durationSecs).toBe(30);
  });

  it('emits the certification’s date key from started_at', () => {
    // _certificationFor selects on left(cdr_start_time, 10); an ISO instant
    // satisfies that exactly as the fetch path's string does.
    const m = repositoryRowToVerification(row({ started_at: '2026-09-02 23:59:55+00' }), '32');
    expect(m.input!.startTime!.slice(0, 10)).toBe('2026-09-02');
  });
});

describe('what the row cannot supply is reported, never defaulted', () => {
  it('refuses a row with no identity', () => {
    const m = repositoryRowToVerification(row({ i_cdr: null, cdr_call_id: null }), '32');
    expect(m).toMatchObject({ input: null, reason: 'no-identity' });
  });

  it('refuses a row with no dialled number rather than pricing an empty prefix', () => {
    const m = repositoryRowToVerification(row({ callee: null }), '32');
    expect(m).toMatchObject({ input: null, reason: 'no-callee' });
  });

  it('refuses a row with no start time', () => {
    const m = repositoryRowToVerification(row({ started_at: null }), '32');
    expect(m).toMatchObject({ input: null, reason: 'no-start' });
  });

  it('counts a missing cost instead of silently pricing the call as free', () => {
    // Number(undefined) || 0 is how silent zeros are born. The fetch path does
    // exactly that; here the same value is produced but the fact is COUNTED.
    const m = repositoryRowToVerification(row({ cost: null }), '32');
    expect(m.input!.sippyActualCost).toBe(0);
    expect(m.costMissing).toBe(true);
  });

  it('does not count a genuine zero cost as missing', () => {
    expect(repositoryRowToVerification(row({ cost: 0 }), '32').costMissing).toBe(false);
  });
});

describe('the payload is the fallback, never the first choice', () => {
  it('recovers callee from the switch’s own record when the column is empty', () => {
    const m = repositoryRowToVerification(row({ callee: null, payload: { cld: '441234567' } }), '32');
    expect(m.input!.callee).toBe('441234567');
  });

  it('recovers identity and start from the payload', () => {
    const m = repositoryRowToVerification(
      row({ i_cdr: null, cdr_call_id: null, started_at: null,
            payload: { i_cdr: '77', connect_time: '2026-09-02T10:00:00Z' } }), '32');
    expect(m.input).toMatchObject({ callId: '77' });
    expect(m.input!.startTime!.slice(0, 10)).toBe('2026-09-02');
  });

  it('column beats payload when both are present', () => {
    const m = repositoryRowToVerification(row({ payload: { cld: 'WRONG' } }), '32');
    expect(m.input!.callee).toBe('923001234567');
  });
});

describe('mapRepositoryRows accounts for every row', () => {
  it('usable + unusable = rows, and nothing vanishes', () => {
    const rows = [
      row(), row({ callee: null }), row({ i_cdr: null, cdr_call_id: null }),
      row({ started_at: null }), row({ cost: null }),
    ];
    const s = mapRepositoryRows(rows, '32');
    expect(s.rows).toBe(5);
    expect(s.usable).toBe(2);
    expect(s.unusable).toEqual({ 'no-identity': 1, 'no-callee': 1, 'no-start': 1 });
    expect(s.usable + Object.values(s.unusable).reduce((a, b) => a + b, 0)).toBe(s.rows);
    expect(s.costMissing).toBe(1);
    expect(s.inputs).toHaveLength(2);
  });

  it('is empty, not absent, for a period with nothing collected', () => {
    const s = mapRepositoryRows([], '32');
    expect(s).toMatchObject({ rows: 0, usable: 0, inputs: [] });
  });
});
