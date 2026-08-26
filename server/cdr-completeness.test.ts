import { describe, it, expect } from 'vitest';
import {
  assessCompleteness,
  DEFAULT_TOLERANCE_PCT,
  STAGE_ORDER,
  type StageCount,
} from './cdr-completeness';

const stage = (
  s: StageCount['stage'],
  calls: number | null,
  billedMinutes: number | null,
): StageCount => ({ stage: s, calls, billedMinutes });

/**
 * The real 16–22 Aug figures for `asterisk`, from Sippy's Customer Summary and
 * the certification record. Kept as the anchor case: if this ever reports
 * anything but a loss at the reference boundary, the classifier is wrong.
 */
const SIPPY_MINUTES  = 17_080.33; // 17080:20 billed
const SIPPY_CALLS    = 1_712_336; // attempts, both prefixes
const BITSAUTO_MINS  = 179.12;    // 145.37 Pakistan + 33.75 Bangladesh

describe('assessCompleteness — the August population gap', () => {
  it('names the reference boundary as the first lossy transition', () => {
    const v = assessCompleteness([
      stage('sippy_reference', SIPPY_CALLS, SIPPY_MINUTES),
      stage('repository',      4_000,       BITSAUTO_MINS),
      stage('verified',        4_000,       BITSAUTO_MINS),
      stage('snapshotted',     4_000,       BITSAUTO_MINS),
    ]);

    expect(v.status).toBe('incomplete');
    expect(v.lossStage?.from).toBe('sippy_reference');
    expect(v.lossStage?.to).toBe('repository');
    // ~1% retained — the figure that started the investigation.
    expect(v.lossStage!.minutesRetainedPct).toBeLessThan(1.1);
    expect(v.lossStage!.minutesRetainedPct).toBeGreaterThan(1.0);
  });

  it('does not compare calls across the reference boundary', () => {
    const v = assessCompleteness([
      stage('sippy_reference', SIPPY_CALLS, SIPPY_MINUTES),
      stage('repository',      4_000,       BITSAUTO_MINS),
    ]);
    expect(v.transitions[0].callsRetainedPct).toBeNull();
    expect(v.transitions[0].callsLost).toBeNull();
  });

  /**
   * Sippy counts attempts. Bangladesh: 59,104 calls, 51,242 billed seconds —
   * fewer billed seconds than calls, which is only possible if unbilled
   * attempts are counted. A complete import must NOT be reported incomplete
   * merely because it holds fewer rows than Sippy counted attempts.
   */
  it('reports a complete import as complete despite far fewer calls than attempts', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 59_104, 854.03),
      stage('repository',      12_000, 854.03),
      stage('verified',        12_000, 854.03),
      stage('snapshotted',     12_000, 854.03),
    ]);
    expect(v.status).toBe('complete');
    expect(v.lossStage).toBeNull();
  });
});

describe('assessCompleteness — attributing the loss', () => {
  it('attributes a dedup-stage loss to repository → verified', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080),
      stage('repository',      165_000, 17_080),
      stage('verified',          2_100,    210),
      stage('snapshotted',       2_100,    210),
    ]);
    expect(v.lossStage?.from).toBe('repository');
    expect(v.lossStage?.to).toBe('verified');
  });

  it('attributes a rating-exclusion loss to verified → snapshotted', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080),
      stage('repository',      165_000, 17_080),
      stage('verified',        165_000, 17_080),
      stage('snapshotted',      90_000,  9_000),
    ]);
    expect(v.lossStage?.from).toBe('verified');
    expect(v.lossStage?.to).toBe('snapshotted');
  });

  it('returns the FIRST lossy transition, not the largest', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 10_000),
      stage('repository',      165_000,  9_000), // −10%
      stage('verified',          1_000,    100), // −99%, but inherited
      stage('snapshotted',       1_000,    100),
    ]);
    expect(v.lossStage?.from).toBe('sippy_reference');
    expect(v.transitions.filter(t => t.lossy)).toHaveLength(2);
  });
});

describe('assessCompleteness — no reference is not a pass', () => {
  it('returns no_reference when the Sippy summary is absent', () => {
    const v = assessCompleteness([
      stage('repository',  165_000, 17_080),
      stage('verified',    165_000, 17_080),
      stage('snapshotted', 165_000, 17_080),
    ]);
    // Self-consistent, and it proves nothing about completeness.
    expect(v.status).toBe('no_reference');
    expect(v.status).not.toBe('complete');
    expect(v.notes.join(' ')).toMatch(/cannot detect calls the platform never imported/);
  });

  it('still attributes internal loss without a reference', () => {
    const v = assessCompleteness([
      stage('repository',  165_000, 17_080),
      stage('verified',      2_100,    210),
    ]);
    expect(v.status).toBe('no_reference');
    expect(v.lossStage?.from).toBe('repository');
  });
});

describe('assessCompleteness — tolerance', () => {
  it('treats a sub-tolerance difference as rounding', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 1_000, 1_000),
      stage('repository',      1_000,   999.9), // 0.01%
    ]);
    expect(v.status).toBe('complete');
  });

  it('honours an explicit tolerance', () => {
    const stages = [
      stage('sippy_reference', 1_000, 1_000),
      stage('repository',      1_000,   990), // 1% short
    ];
    expect(assessCompleteness(stages).status).toBe('incomplete');
    expect(assessCompleteness(stages, { tolerancePct: 2 }).status).toBe('complete');
  });

  it('defaults to half a percent', () => {
    expect(DEFAULT_TOLERANCE_PCT).toBe(0.5);
  });
});

describe('assessCompleteness — identity collisions', () => {
  it('flags repeated call ids as a predictor of the dedup skip', () => {
    const v = assessCompleteness(
      [stage('repository', 165_000, 17_080), stage('verified', 2_100, 210)],
      {
        identity: {
          rows: 165_000,
          distinctCallIds: 3_000,
          duplicateCallIds: 162_000,
          duplicatePct: 98.18,
        },
      },
    );
    expect(v.notes.join(' ')).toMatch(/repeated call id/);
    expect(v.notes.join(' ')).toMatch(/no period bound/);
  });

  it('says nothing when call ids are unique', () => {
    const v = assessCompleteness(
      [stage('repository', 165_000, 17_080), stage('verified', 165_000, 17_080)],
      {
        identity: {
          rows: 165_000, distinctCallIds: 165_000,
          duplicateCallIds: 0, duplicatePct: 0,
        },
      },
    );
    expect(v.notes.join(' ')).not.toMatch(/repeated call id/);
  });
});

describe('assessCompleteness — partial measurement', () => {
  it('compares only adjacent measured stages', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080),
      stage('snapshotted',       2_100,    210),
    ]);
    expect(v.transitions).toHaveLength(1);
    expect(v.transitions[0].from).toBe('sippy_reference');
    expect(v.transitions[0].to).toBe('snapshotted');
  });

  it('falls back to calls when a stage reports no minutes', () => {
    const v = assessCompleteness([
      stage('repository', 165_000, null),
      stage('verified',     2_100, null),
    ]);
    expect(v.transitions[0].minutesRetainedPct).toBeNull();
    expect(v.transitions[0].callsRetainedPct).toBeLessThan(2);
    expect(v.lossStage).not.toBeNull();
    expect(v.notes.join(' ')).toMatch(/no billed minutes/);
  });

  it('accepts stages in any order', () => {
    const v = assessCompleteness([
      stage('snapshotted',     2_100,    210),
      stage('sippy_reference', 200_000, 17_080),
      stage('repository',      165_000, 17_080),
    ]);
    expect(v.transitions.map(t => t.from)).toEqual(['sippy_reference', 'repository']);
  });

  it('reports nothing to compare from a single stage', () => {
    const v = assessCompleteness([stage('repository', 165_000, 17_080)]);
    expect(v.transitions).toHaveLength(0);
    expect(v.lossStage).toBeNull();
  });

  it('keeps STAGE_ORDER as the pipeline order', () => {
    expect(STAGE_ORDER).toEqual([
      'sippy_reference', 'repository', 'verified', 'snapshotted',
    ]);
  });
});

describe('assessCompleteness — a gain is not a loss', () => {
  it('does not classify a stage that grew as lossy', () => {
    const v = assessCompleteness([
      stage('repository',  100, 100),
      stage('verified',    120, 120),
    ]);
    expect(v.transitions[0].lossy).toBe(false);
    expect(v.transitions[0].minutesLost).toBe(-20);
  });
});
