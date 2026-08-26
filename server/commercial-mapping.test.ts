/**
 * Commercial mapping persistence — the fill-only rule.
 *
 * This decides which tariff a customer is billed on, so every branch is pinned
 * here rather than trusted.
 *
 * The defect it closes: two provisioning paths each wrote half the mapping —
 * the wizard stored sippyITariff with no sippyIAccount, linking stored
 * sippyIAccount with no sippyITariff — and nothing joined them. asterisk sat at
 * account 315 / tariff NULL, and resolveInvoiceTariff (which reads only the
 * stored column, by design) refused with a 422.
 *
 * The defect it must NOT introduce: filling that becomes overwriting. Once a
 * value is stored it IS the billing decision. If Sippy later answers something
 * else, adopting it would re-rate a period at prices nobody approved. So the
 * conflict tests below matter more than the fill tests.
 */

import { describe, it, expect } from 'vitest';
import { planMappingPersistence, describeMappingPlan, mappingStatus } from './commercial-mapping';

describe('planMappingPersistence — filling what is absent', () => {
  it('fills the tariff on a linked account that never had one — the asterisk case', () => {
    const plan = planMappingPersistence(
      { sippyITariff: null, sippyIBillingPlan: null, sippyTariffCurrency: null },
      { iTariff: 32, iBillingPlan: 12, currency: 'USD' },
    );
    expect(plan.updates).toEqual({
      sippyITariff: 32, sippyIBillingPlan: 12, sippyTariffCurrency: 'USD',
    });
    expect(plan.filled).toEqual(['sippyITariff', 'sippyIBillingPlan', 'sippyTariffCurrency']);
    expect(plan.conflicts).toEqual([]);
  });

  it('fills only the absent field, leaving a known one alone', () => {
    const plan = planMappingPersistence(
      { sippyITariff: 32, sippyIBillingPlan: null },
      { iTariff: 32, iBillingPlan: 12 },
    );
    expect(plan.updates).toEqual({ sippyIBillingPlan: 12 });
    expect(plan.unchanged).toContain('sippyITariff');
  });

  it('treats undefined and empty string as absent, not as a stored value', () => {
    // A company loaded without these columns selected, or one holding '',
    // must still be fillable — otherwise the mapping stays broken forever.
    expect(planMappingPersistence({}, { iTariff: 32 }).updates).toEqual({ sippyITariff: 32 });
    expect(planMappingPersistence({ sippyTariffCurrency: '   ' }, { currency: 'USD' }).updates)
      .toEqual({ sippyTariffCurrency: 'USD' });
  });

  it('normalises currency case on the way in', () => {
    expect(planMappingPersistence({}, { currency: 'usd' }).updates)
      .toEqual({ sippyTariffCurrency: 'USD' });
  });

  it('coerces a string tariff from the XML-RPC boundary to a number', () => {
    const plan = planMappingPersistence({}, { iTariff: '32' as any });
    expect(plan.updates.sippyITariff).toBe(32);
  });
});

describe('planMappingPersistence — never overwriting', () => {
  it('WRITES NOTHING when stored and live disagree, and reports the conflict', () => {
    // The rule the owner set: stored 32 / live 41 must STOP, never "use 41".
    const plan = planMappingPersistence({ sippyITariff: 32 }, { iTariff: 41 });
    expect(plan.updates).toEqual({});
    expect(plan.filled).toEqual([]);
    expect(plan.conflicts).toEqual([{ field: 'sippyITariff', stored: 32, discovered: 41 }]);
  });

  it('still fills the other fields when one conflicts', () => {
    // A tariff disagreement must not block learning the billing plan, but it
    // also must not be quietly buried among the successes.
    const plan = planMappingPersistence(
      { sippyITariff: 32, sippyIBillingPlan: null },
      { iTariff: 41, iBillingPlan: 12 },
    );
    expect(plan.updates).toEqual({ sippyIBillingPlan: 12 });
    expect(plan.conflicts).toHaveLength(1);
  });

  it('keeps the stored value when Sippy has no answer', () => {
    // A failed or empty lookup is not evidence that a mapping changed. Nulling
    // a stored tariff here would break billing for a working customer.
    const plan = planMappingPersistence(
      { sippyITariff: 32, sippyIBillingPlan: 12, sippyTariffCurrency: 'USD' },
      { iTariff: null, iBillingPlan: null, currency: null },
    );
    expect(plan.updates).toEqual({});
    expect(plan.conflicts).toEqual([]);
    // notDiscovered, NOT unchanged — "Sippy told us nothing" and "already
    // correct" are opposite operational states and must not share a bucket.
    expect(plan.notDiscovered).toHaveLength(3);
    expect(plan.unchanged).toHaveLength(0);
  });

  it('never nulls a stored value even when everything is absent on both sides', () => {
    expect(planMappingPersistence({}, {}).updates).toEqual({});
  });

  it('does not report a conflict for the same value in a different type', () => {
    // 32 and "32" cross a JSON boundary as the same tariff; reporting that as
    // divergence would cry wolf on every sync and train operators to ignore it.
    expect(planMappingPersistence({ sippyITariff: 32 }, { iTariff: '32' as any }).conflicts).toEqual([]);
    expect(planMappingPersistence({ sippyTariffCurrency: 'USD' }, { currency: 'usd' }).conflicts).toEqual([]);
  });

  it('is idempotent — a second sync after a fill changes nothing', () => {
    const first = planMappingPersistence({}, { iTariff: 32, iBillingPlan: 12, currency: 'USD' });
    const second = planMappingPersistence(
      { sippyITariff: 32, sippyIBillingPlan: 12, sippyTariffCurrency: 'USD' },
      { iTariff: 32, iBillingPlan: 12, currency: 'USD' },
    );
    expect(first.filled).toHaveLength(3);
    expect(second.updates).toEqual({});
    expect(second.filled).toEqual([]);
  });

  it('classifies every field exactly once', () => {
    // A field that slipped through all four buckets would be silently dropped.
    const plan = planMappingPersistence(
      { sippyITariff: 32, sippyIBillingPlan: null },
      { iTariff: 41, iBillingPlan: 12, currency: null },
    );
    const seen = [
      ...plan.filled, ...plan.unchanged, ...plan.notDiscovered,
      ...plan.conflicts.map(c => c.field),
    ];
    expect(seen.sort()).toEqual(['sippyIBillingPlan', 'sippyITariff', 'sippyTariffCurrency']);
  });
});

describe('describeMappingPlan', () => {
  it('says a conflict was not written, so the log cannot be misread as an update', () => {
    const plan = planMappingPersistence({ sippyITariff: 32 }, { iTariff: 41 });
    const line = describeMappingPlan('asterisk', plan);
    expect(line).toContain('CONFLICT');
    expect(line).toContain('stored=32');
    expect(line).toContain('live=41');
    expect(line).toContain('not written');
  });

  it('names what was filled', () => {
    const plan = planMappingPersistence({}, { iTariff: 32 });
    expect(describeMappingPlan('asterisk', plan)).toBe('asterisk: filled sippyITariff=32');
  });

  it('distinguishes "already current" from "learned nothing"', () => {
    // These used to share the message "no change", which is how a successful
    // sync and a sync that discovered nothing became indistinguishable in
    // production. The two lines must never be the same string again.
    const already = describeMappingPlan('asterisk',
      planMappingPersistence({ sippyITariff: 32 }, { iTariff: 32 }));
    const nothing = describeMappingPlan('asterisk', planMappingPersistence({}, {}));

    expect(already).toBe('asterisk: already current (sippyITariff)');
    expect(nothing).toBe('asterisk: nothing discovered in Sippy');
    expect(already).not.toBe(nothing);
  });
});

/**
 * The one-word verdict.
 *
 * It exists because `persisted:false, filled:[], conflicts:[]` could not be
 * read on its own: a re-sync of a correct company and a sync that learned
 * nothing produce identical arrays, and an operator had to compare the stored
 * tariff against the discovered one by eye to tell which had happened. That
 * cost a full round of debugging on a live billing question.
 */
describe('mappingStatus', () => {
  it('reports a fill', () => {
    expect(mappingStatus(planMappingPersistence({}, { iTariff: 32 }))).toBe('filled');
  });

  it('reports an already-correct company — the re-sync case', () => {
    expect(mappingStatus(planMappingPersistence({ sippyITariff: 32 }, { iTariff: 32 })))
      .toBe('already_current');
  });

  it('reports when Sippy had nothing to offer', () => {
    expect(mappingStatus(planMappingPersistence({}, {}))).toBe('nothing_discovered');
    expect(mappingStatus(planMappingPersistence({}, { iTariff: null }))).toBe('nothing_discovered');
  });

  it('reports a conflict', () => {
    expect(mappingStatus(planMappingPersistence({ sippyITariff: 32 }, { iTariff: 41 })))
      .toBe('conflict');
  });

  it('lets a conflict outrank a successful fill', () => {
    // A divergence must never be buried under a partial success — it is the
    // only outcome meaning billing and the switch disagree about a price.
    const plan = planMappingPersistence(
      { sippyITariff: 32, sippyIBillingPlan: null },
      { iTariff: 41, iBillingPlan: 12 },
    );
    expect(plan.filled).toEqual(['sippyIBillingPlan']);
    expect(mappingStatus(plan)).toBe('conflict');
  });

  it('separates already_current from nothing_discovered — the whole point', () => {
    expect(mappingStatus(planMappingPersistence({ sippyITariff: 32 }, { iTariff: 32 })))
      .not.toBe(mappingStatus(planMappingPersistence({ sippyITariff: 32 }, { iTariff: null })));
  });
});
