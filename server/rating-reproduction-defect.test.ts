import { describe, it, expect } from 'vitest';
import { reproduceCost } from './services/sippy/sippy-rating-verification.service';

/**
 * CHARACTERISATION TEST — this pins a DEFECT, not a requirement.
 *
 * Every assertion below describes behaviour that is WRONG. They exist so the
 * defect cannot be argued about, cannot regress further, and cannot be fixed
 * silently: the day someone corrects the engine, this file fails loudly and
 * should be rewritten into the correct expectations, which are already written
 * out beside each wrong one.
 *
 * ── What is wrong ──────────────────────────────────────────────────────────
 * reproduceCost charges the per-MINUTE price once per BILLING INTERVAL. When
 * the tariff's intervals are 60/60 an interval IS a minute, so the arithmetic
 * happens to come out right — which is why this survived. On any tariff with
 * finer intervals it multiplies by 60/interval.
 *
 * Reproduced 2026-09-04 by calling the real engine:
 *
 *     intervals   10s        30s        60s        90s
 *     1/1         $0.350000  $1.050000  $2.100000  $3.150000     (60x)
 *     tariff says $0.005833  $0.017500  $0.035000  $0.052500
 *
 * The deployed platform reports this itself, as a MEASURED policy divergence
 * at /api/finance/cdr-repository/completeness. This test is the independent
 * confirmation of that report.
 *
 * ── Why this is not being fixed here ───────────────────────────────────────
 * Rating logic is off-limits without an explicit decision from the owner, and
 * correctly so: changing how calls are priced is a commercial act, not a
 * refactor. The blast radius also needs deciding first — see the invoice note
 * at the end of this file.
 */
describe('DEFECT: reproduceCost charges per interval, not per minute', () => {
  const rate = (interval1: number, intervalN: number): any =>
    ({ prefix: '192', price1: 0.035, priceN: 0.035, interval1, intervalN });

  const tariffSays = (secs: number) => 0.035 * (secs / 60);

  it('is exactly 60x over on 1-second intervals, at every duration', () => {
    for (const secs of [10, 30, 60, 90]) {
      const actual = Number(reproduceCost(secs, rate(1, 1)).reproducedCost);
      const correct = tariffSays(secs);
      // WRONG — the correct assertion is toBeCloseTo(correct, 6).
      expect(actual / correct).toBeCloseTo(60, 5);
    }
  });

  it('names the money on the case the policy check reports', () => {
    // A 10-second call at 3.5c/min should cost just over half a cent.
    const actual = Number(reproduceCost(10, rate(1, 1)).reproducedCost);
    expect(tariffSays(10)).toBeCloseTo(0.005833, 6);
    expect(actual).toBeCloseTo(0.35, 6);        // WRONG: should be 0.005833
  });

  it('comes out right on 60/60 intervals, which is why it was never noticed', () => {
    // One interval == one minute, so "price per interval" and "price per
    // minute" coincide. Every tariff on 60/60 reproduces correctly.
    expect(Number(reproduceCost(10, rate(60, 60)).reproducedCost)).toBeCloseTo(0.035, 6);
    expect(Number(reproduceCost(90, rate(60, 60)).reproducedCost)).toBeCloseTo(0.070, 6);
  });

  it('scales with the interval, confirming the mechanism', () => {
    // The multiplier is 60/interval, not a fixed 60 — this is what identifies
    // the bug as "per interval" rather than "times sixty".
    const secs = 60;
    for (const [interval, expectedRatio] of [[1, 60], [6, 10], [30, 2], [60, 1]] as const) {
      const actual = Number(reproduceCost(secs, rate(interval, interval)).reproducedCost);
      expect(actual / tariffSays(secs)).toBeCloseTo(expectedRatio, 5);
    }
  });
});

/**
 * WHERE THIS REACHES MONEY — measured 2026-09-04, and NOT where I first said.
 *
 * The platform's own policy audit reports, as MEASURED:
 *
 *   "The stored html_content bills the rating engine's reproduction —
 *    currently up to 60x wrong — while the canonical PDF sums actual_cost."
 *
 * I repeated that as "an invoice's stored HTML can carry the 60x figure" and
 * called it the finding with a customer at the end of it. Then I rendered a
 * real one. Invoice C-2608-0007 (asterisk, tariff 32 — the only invoice ever
 * marked sent that carries a divergence):
 *
 *     Sippy actual_cost       $0.275368
 *     reproduction engine    $16.522050   (60x — the defect above)
 *     rendered HTML document  $0.000000   <- all 362 lines
 *
 * The document does not over-bill by 60x. It bills NOTHING: 362 rows of
 * 0.00 minutes, 0.00000 rate/min, 0.00 amount, country "Unknown", under a
 * total of 0.00. In the direction this platform actually cares about that is
 * worse, because under-billing is the failure it exists to prevent.
 *
 * The renderer reads s.durationSecs and s.reproducedCost, and both columns
 * exist on invoice_cdr_snapshots (reproduced_cost is NOT NULL) — so the stored
 * rows carry zeros, while the invoice HEADER carries totalReproduced $16.52
 * over lineCount 362. Header and lines disagree about the same invoice. That
 * is a separate defect from this one and is not yet traced to its cause.
 *
 * Two things follow for the rating fix:
 *   - It is not the customer-facing emergency I implied. Nobody has been
 *     over-billed: invoice email was in test mode and went to the operator,
 *     and invoiceEmailTestMode is still true.
 *   - Correcting the engine ALONE will not make the document right, because
 *     the document is not currently reading a non-zero cost from anywhere.
 */
