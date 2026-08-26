import { describe, it, expect } from 'vitest';
import {
  assessCompleteness,
  DEFAULT_TOLERANCE_PCT,
  DIMENSIONS,
  STAGE_ORDER,
  type StageCount,
} from './cdr-completeness';

const stage = (
  s: StageCount['stage'],
  calls: number | null,
  billedMinutes: number | null,
  cost: number | null = null,
): StageCount => ({ stage: s, calls, billedMinutes, cost });

/**
 * The real 16–22 Aug figures for `asterisk`, from Sippy's Customer Summary and
 * the certification record. Kept as the anchor case: if this ever reports
 * anything but a loss at the reference boundary, the classifier is wrong.
 */
const SIPPY_MINUTES = 17_080.33; // 17080:20 billed
const SIPPY_CALLS   = 1_712_336; // attempts, both prefixes
const SIPPY_COST    = 576.3327;
const OURS_MINUTES  = 179.12;    // 145.37 Pakistan + 33.75 Bangladesh
const OURS_COST     = 5.42;

describe('assessCompleteness — the August population gap', () => {
  it('names the reference boundary as the first lossy transition', () => {
    const v = assessCompleteness([
      stage('sippy_reference', SIPPY_CALLS, SIPPY_MINUTES, SIPPY_COST),
      stage('repository',      4_000,       OURS_MINUTES,  OURS_COST),
      stage('verified',        4_000,       OURS_MINUTES,  OURS_COST),
      stage('snapshotted',     4_000,       OURS_MINUTES,  OURS_COST),
    ]);

    expect(v.status).toBe('incomplete');
    expect(v.lossStage?.from).toBe('sippy_reference');
    expect(v.lossStage?.to).toBe('repository');
    // ~1% retained — the figure that started the investigation.
    expect(v.lossStage!.retained.minutes).toBeLessThan(1.1);
    expect(v.lossStage!.retained.minutes).toBeGreaterThan(1.0);
    // Money went with it, in proportion — the signature of a population loss.
    expect(v.lossStage!.lossyDimensions).toContain('minutes');
    expect(v.lossStage!.lossyDimensions).toContain('cost');
  });

  it('does not compare calls across the reference boundary', () => {
    const v = assessCompleteness([
      stage('sippy_reference', SIPPY_CALLS, SIPPY_MINUTES, SIPPY_COST),
      stage('repository',      4_000,       OURS_MINUTES,  OURS_COST),
    ]);
    expect(v.transitions[0].retained.calls).toBeNull();
    expect(v.transitions[0].lost.calls).toBeNull();
    expect(v.transitions[0].lossyDimensions).not.toContain('calls');
  });

  /**
   * Sippy counts attempts. Bangladesh: 59,104 calls, 51,242 billed seconds —
   * fewer billed seconds than calls, which is only possible if unbilled
   * attempts are counted. A complete import must NOT be reported incomplete
   * merely because it holds fewer rows than Sippy counted attempts.
   */
  it('reports a complete import as complete despite far fewer calls than attempts', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 59_104, 854.03, 8.4122),
      stage('repository',      12_000, 854.03, 8.4122),
      stage('verified',        12_000, 854.03, 8.4122),
      stage('snapshotted',     12_000, 854.03, 8.4122),
    ]);
    expect(v.status).toBe('complete');
    expect(v.lossStage).toBeNull();
  });
});

describe('assessCompleteness — telling the three failures apart', () => {
  it('calls a proportional shortfall a population loss', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080, 576.33),
      stage('repository',       20_000,  1_708,  57.63),
    ]);
    expect(v.lossStage!.lossyDimensions).toEqual(
      expect.arrayContaining(['minutes', 'cost']),
    );
    expect(v.notes.join(' ')).toMatch(/rows did not survive this stage/);
  });

  it('calls intact minutes with short money a rating or mapping problem', () => {
    const v = assessCompleteness([
      stage('repository', 165_000, 17_080, 576.33),
      stage('verified',   165_000, 17_080, 300.00), // priced short, nothing lost
    ]);
    expect(v.lossStage!.lossyDimensions).toEqual(['cost']);
    expect(v.lossStage!.lossyDimensions).not.toContain('minutes');
    expect(v.notes.join(' ')).toMatch(/not a population problem/);
  });

  it('reports money loss even when calls and minutes are perfect', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 100, 1_000, 100),
      stage('repository',      100, 1_000,  50),
    ]);
    expect(v.status).toBe('incomplete');
    expect(v.lossStage!.retained.minutes).toBe(100);
    expect(v.lossStage!.retained.cost).toBe(50);
  });
});

describe('assessCompleteness — attributing the loss', () => {
  it('attributes a dedup-stage loss to repository → verified', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080, 576),
      stage('repository',      165_000, 17_080, 576),
      stage('verified',          2_100,    210,   7),
      stage('snapshotted',       2_100,    210,   7),
    ]);
    expect(v.lossStage?.from).toBe('repository');
    expect(v.lossStage?.to).toBe('verified');
  });

  it('attributes a rating-exclusion loss to verified → snapshotted', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080, 576),
      stage('repository',      165_000, 17_080, 576),
      stage('verified',        165_000, 17_080, 576),
      stage('snapshotted',      90_000,  9_000, 300),
    ]);
    expect(v.lossStage?.from).toBe('verified');
    expect(v.lossStage?.to).toBe('snapshotted');
  });

  it('returns the FIRST lossy transition, not the largest', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 10_000, 500),
      stage('repository',      165_000,  9_000, 450), // −10%
      stage('verified',          1_000,    100,   5), // −99%, but inherited
      stage('snapshotted',       1_000,    100,   5),
    ]);
    expect(v.lossStage?.from).toBe('sippy_reference');
    expect(v.transitions.filter(t => t.lossy)).toHaveLength(2);
  });
});

describe('assessCompleteness — no reference is not a pass', () => {
  it('returns no_reference when the Sippy summary is absent', () => {
    const v = assessCompleteness([
      stage('repository',  165_000, 17_080, 576),
      stage('verified',    165_000, 17_080, 576),
      stage('snapshotted', 165_000, 17_080, 576),
    ]);
    // Self-consistent, and it proves nothing about completeness.
    expect(v.status).toBe('no_reference');
    expect(v.status).not.toBe('complete');
    expect(v.notes.join(' ')).toMatch(/cannot detect calls the platform never imported/);
  });

  it('still attributes internal loss without a reference', () => {
    const v = assessCompleteness([
      stage('repository',  165_000, 17_080, 576),
      stage('verified',      2_100,    210,   7),
    ]);
    expect(v.status).toBe('no_reference');
    expect(v.lossStage?.from).toBe('repository');
  });
});

describe('assessCompleteness — tolerance', () => {
  it('treats a sub-tolerance difference as rounding', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 1_000, 1_000, 100),
      stage('repository',      1_000,   999.9, 99.99), // 0.01%
    ]);
    expect(v.status).toBe('complete');
  });

  it('honours an explicit tolerance', () => {
    const stages = [
      stage('sippy_reference', 1_000, 1_000, 100),
      stage('repository',      1_000,   990,  99), // 1% short
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
      [stage('repository', 165_000, 17_080, 576), stage('verified', 2_100, 210, 7)],
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
      [stage('repository', 165_000, 17_080, 576), stage('verified', 165_000, 17_080, 576)],
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
  it('returns every measured stage in pipeline order, not only lossy ones', () => {
    const v = assessCompleteness([
      stage('snapshotted',     2_100,    210,   7),
      stage('sippy_reference', 200_000, 17_080, 576),
      stage('repository',      165_000, 17_080, 576),
    ]);
    expect(v.stages.map(s => s.stage)).toEqual([
      'sippy_reference', 'repository', 'snapshotted',
    ]);
    expect(v.stages[1].cost).toBe(576);
  });

  it('compares only adjacent measured stages', () => {
    const v = assessCompleteness([
      stage('sippy_reference', 200_000, 17_080, 576),
      stage('snapshotted',       2_100,    210,   7),
    ]);
    expect(v.transitions).toHaveLength(1);
    expect(v.transitions[0].from).toBe('sippy_reference');
    expect(v.transitions[0].to).toBe('snapshotted');
  });

  it('skips dimensions a stage did not report', () => {
    const v = assessCompleteness([
      stage('repository', 165_000, null, null),
      stage('verified',     2_100, null, null),
    ]);
    expect(v.transitions[0].retained.minutes).toBeNull();
    expect(v.transitions[0].retained.cost).toBeNull();
    expect(v.transitions[0].retained.calls).toBeLessThan(2);
    expect(v.lossStage).not.toBeNull();
    expect(v.notes.join(' ')).toMatch(/did not report minutes, cost/);
  });

  it('reports nothing to compare from a single stage', () => {
    const v = assessCompleteness([stage('repository', 165_000, 17_080, 576)]);
    expect(v.transitions).toHaveLength(0);
    expect(v.lossStage).toBeNull();
    expect(v.stages).toHaveLength(1);
  });

  it('keeps STAGE_ORDER as the pipeline order', () => {
    expect(STAGE_ORDER).toEqual([
      'sippy_reference', 'repository', 'verified', 'snapshotted',
    ]);
  });

  it('compares exactly three dimensions', () => {
    expect(DIMENSIONS).toEqual(['calls', 'minutes', 'cost']);
  });
});

describe('assessCompleteness — a gain is not a loss', () => {
  it('does not classify a stage that grew as lossy', () => {
    const v = assessCompleteness([
      stage('repository', 100, 100, 10),
      stage('verified',   120, 120, 12),
    ]);
    expect(v.transitions[0].lossy).toBe(false);
    expect(v.transitions[0].lost.minutes).toBe(-20);
    expect(v.transitions[0].lossyDimensions).toEqual([]);
  });

  /**
   * The reason StageCount.cost is documented as the switch's figure and never
   * the reproduced one: the rating engine currently over-reports by up to 60x
   * on tariffs whose intervals are not 60/60. Feed it reproduced cost and a
   * stage that lost 99% of its calls still shows a money GAIN, so nothing is
   * flagged. This test pins the failure mode the doc comment warns about.
   */
  it('would be fooled by reproduced cost — which is why it must not be used', () => {
    const v = assessCompleteness([
      stage('repository', 165_000, 17_080, 576.33),
      stage('verified',     2_100,    210, 12_800), // 210 min at the 60x error
    ]);
    expect(v.lossStage!.lossyDimensions).toContain('calls');
    expect(v.lossStage!.lossyDimensions).toContain('minutes');
    // Money looks like a gain, so cost alone would have reported no problem.
    expect(v.lossStage!.lossyDimensions).not.toContain('cost');
  });
});
