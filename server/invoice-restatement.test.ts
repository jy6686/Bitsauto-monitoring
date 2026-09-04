import { describe, it, expect } from 'vitest';
import {
  restateLine, restateInvoice, summariseRestatements, correctedVsActualAgrees,
  REWRITABLE_STATUSES, type SnapshotRow,
} from './invoice-restatement';

/**
 * The fixtures are the three production invoices, at the figures measured on
 * 2026-09-04. C-2608-0007's stored document is quoted verbatim in
 * rating-reproduction-defect.test.ts; these are the same numbers reaching the
 * restatement from the other side.
 */

/** A snapshot as the generator froze it: 1/1 rate, cost stored at 60x. */
const snap = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  id: 1, durationSecs: 429, prefix: '192',
  price1Used: 0.035, priceNUsed: 0.035,
  interval1Used: 1, intervalNUsed: 1,
  connectFeeUsed: 0, freeSecondsUsed: 0, gracePeriodUsed: 0, postCallSurchargeUsed: 0,
  // What the old engine stored: price applied once per one-second interval.
  reproducedCost: 0.035 * 429,
  actualCost: 0.035 * (429 / 60),
  ...over,
});

const inv = (over: Record<string, unknown> = {}) => ({
  id: 7, invoiceNumber: 'C-2608-0007', customerName: 'ABC',
  status: 'draft', periodStart: '2026-08-01', periodEnd: '2026-09-01',
  ...over,
});

describe('restateLine — re-rates from the FROZEN rate, never a live tariff', () => {
  it('recovers the correct cost from the snapshot alone', () => {
    const r = restateLine(snap()) as any;
    expect(r.storedCost).toBeCloseTo(15.015, 4);       // 60x
    expect(r.correctedCost).toBeCloseTo(0.25025, 5);   // 429s at 0.035/min
    expect(r.overstatement).toBeCloseTo(60, 4);
    expect(r.changed).toBe(true);
  });

  it('lands on the switch, which is the check that authorises regeneration', () => {
    const r = restateLine(snap()) as any;
    expect(r.correctedCost).toBeCloseTo(r.actualCost, 6);
  });

  it('leaves a 60/60 line untouched — it was always right', () => {
    const r = restateLine(snap({
      interval1Used: 60, intervalNUsed: 60,
      reproducedCost: 0.035 * 8,        // 429s -> 8 whole minutes
      actualCost: 0.035 * 8,
    })) as any;
    expect(r.changed).toBe(false);
    expect(r.overstatement).toBeCloseTo(1, 6);
  });

  it('refuses to re-rate without a price rather than assume zero', () => {
    // Re-rating a missing price at 0 would produce a free call and call it a
    // correction. That is the silent-zero defect wearing a fix's clothing.
    expect(restateLine(snap({ price1Used: null }))).toMatchObject({ blocked: expect.any(String) });
    expect(restateLine(snap({ priceNUsed: undefined }))).toMatchObject({ blocked: expect.any(String) });
    expect((restateLine(snap({ price1Used: null })) as any).blocked).toContain('Cannot re-rate');
  });

  it('refuses a line with no duration or no stored cost', () => {
    expect(restateLine(snap({ durationSecs: null })))
      .toMatchObject({ blocked: expect.stringContaining('durationSecs') });
    expect(restateLine(snap({ reproducedCost: null })))
      .toMatchObject({ blocked: expect.stringContaining('reproducedCost') });
  });

  it('defaults MISSING intervals to 60/60, the only case the old engine got right', () => {
    // So a snapshot lacking intervals restates to the same figure rather than
    // a surprising one. 429s -> 8 minutes at 0.035.
    const r = restateLine(snap({
      interval1Used: null, intervalNUsed: null,
      reproducedCost: 0.035 * 8,
    })) as any;
    expect(r.correctedCost).toBeCloseTo(0.28, 6);
    expect(r.changed).toBe(false);
  });

  it('carries the fee envelope through the restatement', () => {
    const r = restateLine(snap({ connectFeeUsed: 0.01, postCallSurchargeUsed: 0.02 })) as any;
    expect(r.correctedCost).toBeCloseTo(0.25025 + 0.03, 5);
  });
});

describe('restateInvoice — a draft may be rewritten', () => {
  it('restates the whole invoice and lands on the switch', () => {
    // The two prefixes of C-2608-0007: 2.55 min at 0.00985, 7.15 min at 0.035.
    const snaps = [
      snap({ id: 1, prefix: '1880', durationSecs: 153, price1Used: 0.00985, priceNUsed: 0.00985,
             reproducedCost: 0.00985 * 153, actualCost: 0.00985 * (153 / 60) }),
      snap({ id: 2, prefix: '192' }),
    ];
    const r = restateInvoice(inv(), snaps);

    expect(r.eligibility).toBe('regenerate');
    expect(r.storedTotal).toBeCloseTo(16.522, 2);        // the document's $16.52
    expect(r.correctedTotal).toBeCloseTo(0.27537, 4);    // Sippy's $0.27537
    expect(r.storedVsActual).toBeCloseTo(60, 0);
    expect(r.correctedVsActual).toBeCloseTo(1, 3);       // THE number
    expect(r.reduction).toBeCloseTo(16.2467, 3);
    expect(r.reason).toContain("landing on the switch's own");
  });

  it('says so loudly when the restatement does NOT reach the switch', () => {
    // If the corrected total misses actual_cost, something beyond the units is
    // wrong and regenerating would freeze a second bad number.
    const r = restateInvoice(inv(), [snap({ actualCost: 5.0 })]);
    expect(r.eligibility).toBe('regenerate');
    expect(r.reason).toContain('WHICH IT DOES NOT MATCH');
    expect(r.correctedVsActual).not.toBeCloseTo(1, 2);
  });

  it('reports no_change when the invoice was already correct', () => {
    const r = restateInvoice(inv(), [snap({
      interval1Used: 60, intervalNUsed: 60,
      reproducedCost: 0.035 * 8, actualCost: 0.035 * 8,
    })]);
    expect(r.eligibility).toBe('no_change');
    expect(r.reduction).toBeCloseTo(0, 6);
  });
});

describe('restateInvoice — a sent invoice is not editable', () => {
  it('demands a credit note for anything asserted to someone', () => {
    // C-2608-0007's real status. The figure is just as wrong; the remedy differs.
    for (const status of ['sent', 'approved', 'paid', 'disputed']) {
      const r = restateInvoice(inv({ status }), [snap()]);
      expect(r.eligibility).toBe('credit_note_required');
      expect(r.reason).toContain('credit note, not an edit');
      // The money is still reported — refusing to rewrite is not refusing to say.
      expect(r.reduction).toBeGreaterThan(14);
      expect(r.correctedVsActual).toBeCloseTo(1, 3);
    }
  });

  it('treats an UNRECOGNISED status as not rewritable', () => {
    // The failure directions are not symmetric. Refusing to regenerate a draft
    // costs a conversation; silently rewriting a sent invoice costs the audit
    // trail. So the whitelist is the safe default, not a blacklist.
    const r = restateInvoice(inv({ status: 'archived_2026' }), [snap()]);
    expect(r.eligibility).toBe('credit_note_required');
    expect(REWRITABLE_STATUSES.has('archived_2026')).toBe(false);
  });

  it('accepts the three draft-ish statuses and nothing else', () => {
    for (const s of ['draft', 'review', 'pending']) {
      expect(restateInvoice(inv({ status: s }), [snap()]).eligibility).toBe('regenerate');
    }
  });

  it('is case-insensitive about status', () => {
    expect(restateInvoice(inv({ status: 'DRAFT' }), [snap()]).eligibility).toBe('regenerate');
    expect(restateInvoice(inv({ status: 'Sent' }),  [snap()]).eligibility).toBe('credit_note_required');
  });
});

describe('restateInvoice — partial and unusable data', () => {
  it('excludes unratable lines from the totals and says how many', () => {
    const r = restateInvoice(inv(), [snap({ id: 1 }), snap({ id: 2, price1Used: null })]);
    expect(r.linesRestated).toBe(1);
    expect(r.linesBlocked).toHaveLength(1);
    expect(r.linesBlocked[0].snapshotId).toBe(2);
    expect(r.reason).toContain('1 of 2 line(s) could not be re-rated');
    // The total is over the ONE readable line, not silently over both.
    expect(r.correctedTotal).toBeCloseTo(0.25025, 5);
  });

  it('is blocked when nothing at all can be re-rated', () => {
    const r = restateInvoice(inv(), [snap({ price1Used: null }), snap({ price1Used: null })]);
    expect(r.eligibility).toBe('blocked');
    expect(r.reason).toContain('None of the 2 snapshot line(s)');
  });

  it('reports actual-cost coverage rather than assuming it is complete', () => {
    const r = restateInvoice(inv(), [snap({ id: 1 }), snap({ id: 2, actualCost: null })]);
    expect(r.actualCoverage).toBe(0.5);
    // The comparison uses only the lines that carry a switch figure.
    expect(r.actualTotal).toBeCloseTo(0.25025, 5);
  });

  it('handles an invoice with no snapshots at all', () => {
    const r = restateInvoice(inv(), []);
    expect(r.eligibility).toBe('no_change');
    expect(r.reason).toContain('No snapshot lines');
  });
});

describe('correctionImpact — the four questions, pre-answered', () => {
  it('reproduces the C-2608-0009 shape from the real figures', () => {
    // $10,050.38 reproduced against Sippy's $167.51 — the 60x, at scale.
    // One 1/1 line long enough to produce those totals.
    const secs = 167.51 / 0.035 * 60;      // minutes -> seconds at 3.5c/min
    const r = restateInvoice(inv({ id: 9, invoiceNumber: 'C-2608-0009', status: 'draft' }), [
      snap({ durationSecs: secs, reproducedCost: 0.035 * secs, actualCost: 167.51 }),
    ]);
    const i = r.correctionImpact;

    expect(i.invoice).toBe('C-2608-0009');
    expect(i.previousTotal).toBeCloseTo(10050.6, 0);
    expect(i.correctedTotal).toBeCloseTo(167.51, 2);
    // delta is corrected MINUS previous: an invoice coming down is negative.
    expect(i.delta).toBeLessThan(0);
    expect(i.delta).toBeCloseTo(-9883.1, 0);
    expect(i.relativeErrorPct).toBeCloseTo(5900, 0);
    expect(i.overstatementFactor).toBeCloseTo(60, 1);
    expect(i.action).toBe('regenerate');
    expect(i.agreesWithSwitch).toBe(true);
    expect(i.materiality).toBe('critical');
  });

  it('answers "is this a credit note" for an asserted document', () => {
    const i = restateInvoice(inv({ status: 'sent' }), [snap()]).correctionImpact;
    expect(i.action).toBe('credit_note');
    expect(i.actionReason).toContain('do not rewrite it');
    expect(i.actionReason).toContain('$14.76');       // the money, in the answer
  });

  it('answers "no action required" without the reader doing arithmetic', () => {
    const i = restateInvoice(inv(), [snap({
      interval1Used: 60, intervalNUsed: 60, reproducedCost: 0.28, actualCost: 0.28,
    })]).correctionImpact;
    expect(i.action).toBe('none');
    expect(i.delta).toBe(0);
    expect(i.materiality).toBe('none');
    expect(i.overstatementFactor).toBeCloseTo(1, 6);
  });

  it('says INVESTIGATE when the restatement misses the switch, draft or not', () => {
    // "It is only a draft" is not a reason to freeze a second wrong number.
    // Checked before eligibility, so a draft cannot slip through as safe.
    const i = restateInvoice(inv({ status: 'draft' }), [snap({ actualCost: 5.0 })]).correctionImpact;
    expect(i.action).toBe('investigate');
    expect(i.agreesWithSwitch).toBe(false);
    expect(i.actionReason).toContain('replace one wrong figure with another');
  });

  it('grades materiality so a cent is not queued beside ten thousand dollars', () => {
    const at = (stored: number, corrected: number) =>
      restateInvoice(inv(), [snap({
        interval1Used: 60, intervalNUsed: 60,
        durationSecs: 60, price1Used: corrected, priceNUsed: corrected,
        reproducedCost: stored, actualCost: corrected,
      })]).correctionImpact.materiality;

    expect(at(0.035,   0.035)).toBe('none');       // unchanged
    expect(at(0.5,     0.035)).toBe('minor');      // under $1
    expect(at(50,      0.035)).toBe('major');      // under $100
    expect(at(10050,   0.035)).toBe('critical');
  });

  it('refuses a percentage rather than reporting infinity', () => {
    // A corrected total of zero has no meaningful multiple or percentage.
    const i = restateInvoice(inv(), [snap({
      durationSecs: 0, reproducedCost: 5, actualCost: 0,
    })]).correctionImpact;
    expect(i.relativeErrorPct).toBeNull();
    expect(i.overstatementFactor).toBeNull();
    expect(i.delta).toBe(-5);                      // the money is still stated
  });

  it('is JSON-safe, for the endpoint and the UI', () => {
    const i = restateInvoice(inv(), [snap()]).correctionImpact;
    expect(JSON.parse(JSON.stringify(i))).toEqual(i);
  });
});

describe('summary rollups — the work queue, not just a count', () => {
  const build = () => [
    restateInvoice(inv({ id: 7, invoiceNumber: 'C-7', status: 'sent'  }), [snap()]),
    restateInvoice(inv({ id: 8, invoiceNumber: 'C-8', status: 'draft' }), [snap()]),
    restateInvoice(inv({ id: 9, invoiceNumber: 'C-9', status: 'draft' }), [snap({ actualCost: 5.0 })]),
    restateInvoice(inv({ id: 10, invoiceNumber: 'C-10', status: 'draft' }), [snap({
      interval1Used: 60, intervalNUsed: 60, reproducedCost: 0.28, actualCost: 0.28,
    })]),
  ];

  it('groups by action, with counts AND money', () => {
    const s = summariseRestatements(build());
    expect(s.byAction.credit_note.invoices).toBe(1);
    expect(s.byAction.regenerate.invoices).toBe(1);
    expect(s.byAction.investigate.invoices).toBe(1);
    expect(s.byAction.none.invoices).toBe(1);
    // "3 invoices" and "$14.76" are different arguments for acting today.
    expect(s.byAction.regenerate.delta).toBeCloseTo(-14.7648, 3);
    expect(s.byAction.none.delta).toBe(0);
  });

  it('names the invoices that do NOT restate to the switch', () => {
    const s = summariseRestatements(build());
    expect(s.notReachingSwitch).toEqual(['C-9']);
    expect(s.headline).toContain('do NOT restate to the switch');
    expect(s.headline).toContain('must be investigated before any regeneration');
  });

  it('stays quiet about that when every restatement lands', () => {
    const s = summariseRestatements([
      restateInvoice(inv({ status: 'draft' }), [snap()]),
    ]);
    expect(s.notReachingSwitch).toEqual([]);
    expect(s.headline).not.toContain('do NOT restate');
  });

  it('counts materiality across the set', () => {
    const s = summariseRestatements(build());
    expect(s.byMateriality.none).toBe(1);    // the already-correct invoice
    expect(s.byMateriality.major).toBe(3);   // $14.76 each: over $1, under $100
    expect(s.byMateriality.critical).toBe(0);
    // Every invoice lands in exactly one bucket.
    const total = Object.values(s.byMateriality).reduce((a, b) => a + b, 0);
    expect(total).toBe(s.invoices);
  });
});

describe('correctedVsActualAgrees', () => {
  it('accepts a cent of absolute drift, or half a percent on larger sums', () => {
    expect(correctedVsActualAgrees(0.27537, 0.275368)).toBe(true);
    expect(correctedVsActualAgrees(167.51, 167.9)).toBe(true);      // 0.23%
    expect(correctedVsActualAgrees(167.51, 200)).toBe(false);
    expect(correctedVsActualAgrees(1, null)).toBe(false);           // nothing to agree with
  });
});

describe('summariseRestatements — what the operator reads first', () => {
  it('counts each disposition and totals the money', () => {
    const s = summariseRestatements([
      restateInvoice(inv({ id: 7, status: 'sent' }),  [snap()]),
      restateInvoice(inv({ id: 8, status: 'draft' }), [snap()]),
      restateInvoice(inv({ id: 9, status: 'draft' }), [snap({
        interval1Used: 60, intervalNUsed: 60, reproducedCost: 0.28, actualCost: 0.28,
      })]),
    ]);

    expect(s.invoices).toBe(3);
    expect(s.regenerable).toBe(1);
    expect(s.creditNoteRequired).toBe(1);
    expect(s.noChange).toBe(1);
    // Draft money and total money are separate: only the first is actionable
    // without a credit note, and conflating them overstates what a click fixes.
    expect(s.reductionOnDrafts).toBeCloseTo(14.7648, 3);
    expect(s.reductionAll).toBeCloseTo(29.5295, 3);
    expect(s.headline).toContain('1 regenerable draft(s)');
    expect(s.headline).toContain('1 requiring a credit note');
  });

  it('says so when there is nothing to assess', () => {
    expect(summariseRestatements([]).headline).toBe('No invoices to assess.');
  });
});
