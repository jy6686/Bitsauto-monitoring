import { describe, it, expect } from 'vitest';
import { reproduceCost } from './services/sippy/sippy-rating-verification.service';
import { rateCall } from './rating-cost';
import { chargeFor } from './billing-increments';

/**
 * REGRESSION GUARD — this file used to pin a defect. The defect is fixed.
 *
 * ── What it was ────────────────────────────────────────────────────────────
 * reproduceCost charged the per-MINUTE price once per BILLING INTERVAL. On a
 * 60/60 tariff an interval IS a minute, so the arithmetic came out right —
 * which is why it survived. On anything finer it multiplied by 60/intervalN.
 *
 * Measured 2026-09-04 against the real engine, before the fix:
 *
 *     intervals   10s        30s        60s        90s
 *     1/1         $0.350000  $1.050000  $2.100000  $3.150000     (60x)
 *     tariff says $0.005833  $0.017500  $0.035000  $0.052500
 *
 * ── Why the file stays ─────────────────────────────────────────────────────
 * Every assertion has been inverted rather than deleted. A deleted test proves
 * nothing; an inverted one fails if the defect ever returns, and carries the
 * measured evidence of what it looked like. The specific numbers above are the
 * ones an engineer would search for if it did.
 *
 * The arithmetic now lives in ONE place — `billing-increments.chargeFor` —
 * reached through `rateCall`. The last two tests here assert that chain, since
 * a future edit that reintroduces local arithmetic in the engine is exactly how
 * this would come back.
 */
describe('FIXED: reproduceCost charges per minute, not per interval', () => {
  const rate = (interval1: number, intervalN: number): any =>
    ({ prefix: '192', price1: 0.035, priceN: 0.035, interval1, intervalN });

  const tariffSays = (secs: number) => 0.035 * (secs / 60);

  it('matches the tariff at every duration on 1-second intervals', () => {
    for (const secs of [10, 30, 60, 90]) {
      const actual = Number(reproduceCost(secs, rate(1, 1)).reproducedCost);
      expect(actual).toBeCloseTo(tariffSays(secs), 6);
      // It was exactly 60x here. Stated as a guard, not as arithmetic — at
      // 5dp, because the engine rounds money to the 8dp the record stores.
      expect(actual / tariffSays(secs)).toBeCloseTo(1, 5);
    }
  });

  it('bills the case the policy check reports at half a cent', () => {
    // A 10-second call at 3.5c/min costs just over half a cent. It used to
    // reproduce as $0.35 — the single number that named the whole defect.
    const actual = Number(reproduceCost(10, rate(1, 1)).reproducedCost);
    expect(tariffSays(10)).toBeCloseTo(0.005833, 6);
    expect(actual).toBeCloseTo(0.005833, 6);
    expect(actual).not.toBeCloseTo(0.35, 4);
  });

  it('still comes out right on 60/60, which is what masked the defect', () => {
    // Unchanged by the fix, and that is the point: the correction had to leave
    // every correct answer correct. One interval == one minute here.
    expect(Number(reproduceCost(10, rate(60, 60)).reproducedCost)).toBeCloseTo(0.035, 6);
    expect(Number(reproduceCost(90, rate(60, 60)).reproducedCost)).toBeCloseTo(0.070, 6);
  });

  it('no longer scales with the interval', () => {
    // The old multiplier was 60/interval — 60x on 1/1, 10x on 6/6, 2x on
    // 30/30, 1x on 60/60. A ratio that varies with intervalN is the signature
    // of the defect, so the assertion is that it is now flat at 1.
    const secs = 60;
    for (const interval of [1, 6, 30, 60]) {
      const actual = Number(reproduceCost(secs, rate(interval, interval)).reproducedCost);
      expect(actual / tariffSays(secs)).toBeCloseTo(1, 6);
    }
  });

  it('holds the fix in one place — the engine delegates, it does not compute', () => {
    // If someone reintroduces arithmetic inside reproduceCost, these diverge
    // long before an invoice is wrong. Three layers, one answer.
    for (const [i1, iN] of [[1, 1], [6, 6], [30, 30], [60, 1], [60, 60]] as const) {
      for (const secs of [1, 7, 61, 145]) {
        const r = rate(i1, iN);
        const viaEngine = Number(reproduceCost(secs, r).reproducedCost);
        const viaRate   = rateCall(secs, r).cost;
        const viaCharge = chargeFor(secs, { interval1: i1, intervalN: iN, price1: 0.035, priceN: 0.035 });
        expect(viaEngine).toBe(viaRate);
        expect(viaEngine).toBeCloseTo(viaCharge, 8);
      }
    }
  });

  it('reports the billed seconds the increment rules dictate', () => {
    // billedSecs was always correct — the defect was only in money — so this
    // is a check that the rewrite did not disturb the rounding on its way past.
    expect(reproduceCost(1,   rate(1, 1)).billedSecs).toBe(1);
    expect(reproduceCost(7,   rate(6, 6)).billedSecs).toBe(12);
    expect(reproduceCost(31,  rate(30, 30)).billedSecs).toBe(60);
    expect(reproduceCost(75,  rate(60, 1)).billedSecs).toBe(75);
    expect(reproduceCost(61,  rate(60, 60)).billedSecs).toBe(120);
  });
});

/**
 * WHERE THIS REACHED MONEY — measured 2026-09-04, after getting it wrong twice.
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
 * 60x the tariff, so the defect was in per-line pricing and the total merely
 * inherited it. Sippy's actual_cost for the same period is $0.275368.
 *
 *   stored document   $16.52   (60x)   <- the engine, now fixed
 *   Sippy actual      $0.2754
 *   live re-render    $0.00            <- a SEPARATE defect, still open:
 *                                         the renderer reads five field names
 *                                         that do not exist on its table. See
 *                                         invoice-line-render-contract.test.ts.
 *
 * None of it reached a customer: the delivery record shows testMode true,
 * recipients [junaid@ichibaanlogic.com], subject prefixed [TEST], and
 * invoiceEmailTestMode is still true.
 *
 * ── What fixing the engine does and does not do ────────────────────────────
 * DOES:     every invoice, snapshot and DMR comparison generated from now on.
 * DOES NOT: documents already generated. `invoices.html_content` is frozen at
 *           generation and reads the reproduction stored at that time, so the
 *           existing inflated invoices stay inflated until their snapshots are
 *           regenerated — a separate, owner-triggered act, deliberately not
 *           done here.
 *
 * Two further defects the stored document shows on its face, both still open:
 *   - Its footer reads "DRAFT — NOT APPROVED FOR PAYMENT" while the invoice
 *     row status is 'sent'. The HTML is never regenerated on status change, so
 *     the document that was emailed contradicts the record that says it went.
 *   - It prints "Due Date: 06-Sep-2026" while the row's due_date is NULL and
 *     its terms read "Not configured" — the document computing its own due
 *     date instead of displaying the persisted business value.
 */
