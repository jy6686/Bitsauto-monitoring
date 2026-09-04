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
 * WHERE THIS REACHES MONEY — measured 2026-09-04, after getting it wrong twice.
 *
 * There are TWO invoice documents and I conflated them.
 *
 *   invoices.html_content        frozen at generation. THIS is what the email
 *                                attached and what a customer would read.
 *   GET /api/invoices/:id/html   a LIVE re-render from invoice_cdr_snapshots,
 *                                produced on request, today.
 *
 * I first repeated the platform's own audit — "the stored html_content bills
 * the reproduction, up to 60x wrong". Then I rendered the LIVE endpoint, saw
 * 362 rows of 0.00, and "corrected" myself to say the document bills nothing.
 * That correction was wrong: I had tested the wrong document.
 *
 * The stored html_content of C-2608-0007, read verbatim:
 *
 *     Country summary   Unknown        9.70 min        $16.52
 *     1880                             2.55 min   @ $0.59100/min    $1.51
 *     192                              7.15 min   @ $2.10000/min   $15.01
 *     Total                            9.70 min        $16.52
 *
 * The tariff-32 rates for those prefixes are $0.00985 and $0.035 per minute.
 * 0.00985 x 60 = 0.591. 0.035 x 60 = 2.10. The printed RATE COLUMN is exactly
 * 60x the tariff, so the defect is in per-line pricing and the total merely
 * inherits it. Sippy's actual_cost for the same period is $0.275368.
 *
 * So the original claim stands and my correction did not:
 *   stored document   $16.52   (60x)
 *   Sippy actual      $0.2754
 *   live re-render    $0.00    <- a SEPARATE defect, in the re-render path
 *
 * Still true, and the reason none of this reached a customer: the delivery
 * record shows testMode true, recipients [junaid@ichibaanlogic.com], subject
 * prefixed [TEST]. invoiceEmailTestMode is still true.
 *
 * Two further things the stored document shows on its face:
 *   - Its footer reads "DRAFT — NOT APPROVED FOR PAYMENT" while the invoice
 *     row status is 'sent'. The HTML is frozen at generation and never
 *     regenerated on approval, so the document that was emailed contradicts
 *     the record that says it was sent.
 *   - It prints "Due Date: 06-Sep-2026" while the row's due_date is NULL and
 *     its terms read "Not configured" — the document computing its own due
 *     date, which the platform's audit reports as a divergence and which is
 *     confirmed here.
 *
 * For the rating fix: correcting the engine DOES fix the stored document,
 * because that document reads the reproduction. It does not fix the live
 * re-render, which is empty for its own unrelated reason.
 */
