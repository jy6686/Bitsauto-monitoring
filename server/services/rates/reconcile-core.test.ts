/**
 * Boot-time reconciliation core — the safety decisions, pinned.
 *
 * Every test here is written to FAIL if the specific guard it names is removed, not merely to
 * pass once the code is right. The core exists to hold three invariants (verify-never-retry,
 * read-back-authoritative, unavailable≠indeterminate); a test that could pass without them is
 * not protecting them.
 */
import { describe, it, expect } from 'vitest';
import {
  isOrphanEligible,
  effectiveStaleClock,
  classifyReadback,
  parseUnavailableCount,
  advanceUnavailable,
  hasVerifiableIntent,
  RECONCILE_STATE,
  type OrphanCandidate,
  type RateIntent,
  type Readback,
} from './reconcile-core';

const now = new Date('2026-09-18T18:00:00Z');
const STALE = 30 * 60_000; // 2× the 15-min upload window
const ago = (ms: number) => new Date(now.getTime() - ms);

// ── 1. Orphan eligibility ────────────────────────────────────────────────────────────────────

describe('orphan eligibility — both non-terminal statuses, and only when stale', () => {
  const stale: Pick<OrphanCandidate, 'lastStepAt' | 'createdAt'> =
    { lastStepAt: ago(STALE + 60_000), createdAt: ago(STALE + 120_000) };

  it('sweeps a stale PROCESSING job (the production change-client-rates / push-batch path)', () => {
    expect(isOrphanEligible({ status: 'processing', ...stale }, now, STALE)).toBe(true);
  });

  it('sweeps a stale PENDING job (the older insert path) — not only processing', () => {
    expect(isOrphanEligible({ status: 'pending', ...stale }, now, STALE)).toBe(true);
  });

  it('never sweeps a terminal job, however old', () => {
    for (const status of ['completed', 'failed', 'partial', 'indeterminate', 'needs_review']) {
      expect(isOrphanEligible({ status, ...stale }, now, STALE)).toBe(false);
    }
  });

  it('does NOT sweep a fresh job a sibling instance is still running', () => {
    // lastStepAt refreshed 10s ago — a live push, not an orphan.
    const fresh = { status: 'processing', lastStepAt: ago(10_000), createdAt: ago(20_000) };
    expect(isOrphanEligible(fresh, now, STALE)).toBe(false);
  });

  it('a job exactly at the threshold is eligible; one just under is not', () => {
    const at   = { status: 'processing', lastStepAt: ago(STALE),          createdAt: ago(STALE) };
    const under= { status: 'processing', lastStepAt: ago(STALE - 1_000),  createdAt: ago(STALE) };
    expect(isOrphanEligible(at, now, STALE)).toBe(true);
    expect(isOrphanEligible(under, now, STALE)).toBe(false);
  });
});

describe('legacy rows: NULL lastStepAt falls back to createdAt, never reads as fresh', () => {
  it('a legacy row with NULL lastStepAt and an old createdAt IS swept', () => {
    const legacy = { status: 'processing', lastStepAt: null, createdAt: ago(STALE + 60_000) };
    expect(effectiveStaleClock(legacy)).toEqual(legacy.createdAt);
    expect(isOrphanEligible(legacy, now, STALE)).toBe(true);
  });

  it('a legacy row with NULL lastStepAt but a RECENT createdAt is not swept', () => {
    const legacy = { status: 'pending', lastStepAt: null, createdAt: ago(5_000) };
    expect(isOrphanEligible(legacy, now, STALE)).toBe(false);
  });

  it('the fallback is createdAt specifically — NOT a treat-null-as-epoch or treat-null-as-now shortcut', () => {
    // treat-as-now would make it never stale (bug); treat-as-epoch would make it always stale (bug).
    const recent = { status: 'processing', lastStepAt: null, createdAt: ago(1_000) };
    const oldOne = { status: 'processing', lastStepAt: null, createdAt: ago(STALE * 10) };
    expect(isOrphanEligible(recent, now, STALE)).toBe(false); // not "always stale"
    expect(isOrphanEligible(oldOne, now, STALE)).toBe(true);  // not "never stale"
  });
});

// ── 1b. Verifiable intent ──────────────────────────────────────────────────────────────────────

describe('hasVerifiableIntent — reconciliation only acts on a recorded mutation intent', () => {
  const intent: RateIntent[] = [{ prefix: '1990', newRate: 0.0199, oldRate: null }];

  it('true when a target tariff AND at least one parsed intent are present', () => {
    expect(hasVerifiableIntent(68, intent)).toBe(true);
  });

  it('false when the tariff is missing — a read-back has no target to check against', () => {
    expect(hasVerifiableIntent(null, intent)).toBe(false);
  });

  it('false when no intent parsed (no prefix / unparseable rate)', () => {
    expect(hasVerifiableIntent(68, [])).toBe(false);
  });

  it('false when BOTH are absent — the pre-instrumentation job-* orphan shape', () => {
    // These are the production legacy rows: i_tariff NULL, no rate. The sweep must not fabricate
    // a verdict for them, and must not overwrite a mismatch/skip diagnostic they already carry.
    expect(hasVerifiableIntent(null, [])).toBe(false);
  });
});

// ── 2. Classification ────────────────────────────────────────────────────────────────────────

const rb = (rows: { prefix: string; price1: number }[], over: Partial<Readback> = {}): Readback =>
  ({ ok: true, complete: true, rows, ...over });

describe('classifyReadback — success only from a positive read-back', () => {
  it('all intents present at their new rate → success', () => {
    const intents: RateIntent[] = [{ prefix: '1990', newRate: 0.0199, oldRate: null }];
    expect(classifyReadback(intents, rb([{ prefix: '1990', price1: 0.0199 }]))).toBe('success');
  });

  it('a multi-prefix job needs EVERY prefix present — one missing is not success', () => {
    const intents: RateIntent[] = [
      { prefix: '1990', newRate: 0.0199, oldRate: null },
      { prefix: '1997', newRate: 0.0197, oldRate: null },
    ];
    const partial = rb([{ prefix: '1990', price1: 0.0199 }]); // 1997 missing
    expect(classifyReadback(intents, partial)).not.toBe('success');
    expect(classifyReadback(intents, partial)).toBe('indeterminate');
  });

  it('present prefix but at the WRONG rate is not success — it is indeterminate, never a guess', () => {
    const intents: RateIntent[] = [{ prefix: '1990', newRate: 0.0199, oldRate: null }];
    expect(classifyReadback(intents, rb([{ prefix: '1990', price1: 0.5 }]))).toBe('indeterminate');
  });
});

describe('classifyReadback — failure only when absence is POSITIVELY established on a complete read', () => {
  it('new-prefix create, prefix absent from a complete read → failure', () => {
    const intents: RateIntent[] = [{ prefix: '1990', newRate: 0.0199, oldRate: null }];
    expect(classifyReadback(intents, rb([{ prefix: '999', price1: 0.05 }]))).toBe('failure');
  });

  it('edit, old rate still present and new rate absent → failure', () => {
    const intents: RateIntent[] = [{ prefix: '192', newRate: 0.05, oldRate: 0.04 }];
    expect(classifyReadback(intents, rb([{ prefix: '192', price1: 0.04 }]))).toBe('failure');
  });

  it('edit where the prefix VANISHED entirely is indeterminate, not failure — that is not the shape we expected', () => {
    const intents: RateIntent[] = [{ prefix: '192', newRate: 0.05, oldRate: 0.04 }];
    expect(classifyReadback(intents, rb([{ prefix: '999', price1: 0.05 }]))).toBe('indeterminate');
  });
});

describe('classifyReadback — a read we could not fully trust is always indeterminate', () => {
  const intents: RateIntent[] = [{ prefix: '1990', newRate: 0.0199, oldRate: null }];

  it('a failed read is indeterminate even if the rows would have said failure', () => {
    expect(classifyReadback(intents, rb([], { ok: false }))).toBe('indeterminate');
  });

  it('a TRUNCATED (partial) read is indeterminate even when the prefix is absent from the page', () => {
    // Absence in a partial read is not absence in the tariff — the missing rows could be off-page.
    expect(classifyReadback(intents, rb([{ prefix: '999', price1: 0.05 }], { complete: false }))).toBe('indeterminate');
  });

  it('a partial read that DOES show the new rate is still not success', () => {
    expect(classifyReadback(intents, rb([{ prefix: '1990', price1: 0.0199 }], { complete: false }))).toBe('indeterminate');
  });

  it('no intents recorded → indeterminate, never success', () => {
    expect(classifyReadback([], rb([{ prefix: '1990', price1: 0.0199 }]))).toBe('indeterminate');
  });
});

// ── 3. Unavailable counter and escalation ──────────────────────────────────────────────────────

describe('the unavailable-attempt counter (encoded in verification_result)', () => {
  it('reads a prior count, and treats a real verdict / absence as zero', () => {
    expect(parseUnavailableCount('unavailable:3')).toBe(3);
    expect(parseUnavailableCount(null)).toBe(0);
    expect(parseUnavailableCount('reconciled_indeterminate')).toBe(0);
    expect(parseUnavailableCount('confirmed')).toBe(0);
  });

  it('an outage below the ceiling leaves the job ELIGIBLE (status unchanged), counter incremented', () => {
    const out = advanceUnavailable('processing', 'unavailable:1', 3);
    expect(out.escalate).toBe(false);
    expect(out.status).toBe('processing');           // still non-terminal → swept again next boot
    expect(out.verificationResult).toBe('unavailable:2');
  });

  it('does NOT mark an outage as indeterminate — the mutation was never queried', () => {
    const out = advanceUnavailable('pending', null, 3);
    expect(out.status).not.toBe('indeterminate');
    expect(out.verificationResult).not.toBe(RECONCILE_STATE.indeterminate.verificationResult);
    expect(out.status).toBe('pending');
  });

  it('escalates to needs_review at the ceiling — a terminal state distinct from indeterminate', () => {
    const out = advanceUnavailable('processing', 'unavailable:2', 3);
    expect(out.escalate).toBe(true);
    expect(out.status).toBe('needs_review');
    expect(out.status).not.toBe('indeterminate');
    expect(out.verificationResult).toMatch(/^unavailable_escalated:3$/);
  });

  it('converges under a concurrent double-boot — two instances on the same prior value compute the same next', () => {
    const a = advanceUnavailable('processing', 'unavailable:1', 5);
    const b = advanceUnavailable('processing', 'unavailable:1', 5);
    expect(a.verificationResult).toBe(b.verificationResult); // 'unavailable:2', not :2 and :3
  });
});
