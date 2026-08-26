/**
 * policy-conformance.ts — does the running code obey the frozen billing policy?
 *
 * A provenance header that PRINTS THE POLICY is worse than none at all.
 *
 * The obvious implementation reads docs/BILLING-POLICY.md, or a config object,
 * and renders a green checklist: "Timezone UTC ✓ · Effective dating ✓ · Activation
 * dates ✓". Every one of those would be a claim about behaviour the code does not
 * have. Rate rows are NOT filtered by activation date (§4.1), and CDR ingestion is
 * NOT UTC (§1.1). A header asserting otherwise would certify the defect and put a
 * tick beside it on an audit screen.
 *
 * So this MEASURES. Where a rule can be probed, it is probed against the real
 * implementation at request time, and the answer changes on its own when the code
 * is fixed — no one has to remember to update a flag. Where it cannot be cheaply
 * probed the item is marked `declared`, carries the file:line it was read from,
 * and is understood to be a code-review fact that can go stale.
 *
 * That distinction is the same one the environment fingerprint draws between an
 * exact `populated` and an estimated `approxRows`: say which numbers were
 * measured and which were asserted, and never let the second wear the clothes of
 * the first.
 */

export type Conformance = 'conforms' | 'diverges' | 'unknown';

export interface PolicyCheck {
  rule:   string;
  status: Conformance;
  /** `probed` was measured just now. `declared` was read from code and may be stale. */
  method: 'probed' | 'declared';
  detail: string;
  /** Policy section and the code it governs. */
  reference: string;
}

/**
 * Does the rate resolver honour a row's activation and expiration dates?
 *
 * BILLING-POLICY §4 permits a rate to change several times in one day and
 * requires each call to be priced by the row effective at its timestamp. The
 * probe builds the minimal case: two rows on the same prefix, one long expired,
 * one current. A resolver that reads dates returns the current row. One that
 * matches on prefix alone returns whichever the array happens to hold first —
 * so the expired row is placed first deliberately, making the wrong answer the
 * detectable one rather than the lucky one.
 */
function probeRateRowDating(resolveRate: Function): PolicyCheck {
  const rule = 'Rate rows are selected by the date effective at the call';
  const reference = 'BILLING-POLICY.md §4.1 · sippy-rating-verification.service.ts:110';
  try {
    const snapshot = JSON.stringify([
      { prefix: '92', price1: 0.99, priceN: 0.99, interval1: 1, intervalN: 1,
        activationDate: '2020-01-01T00:00:00Z', expirationDate: '2020-06-01T00:00:00Z' },
      { prefix: '92', price1: 0.035, priceN: 0.035, interval1: 1, intervalN: 1,
        activationDate: '2020-06-01T00:00:00Z' },
    ]);
    const picked = resolveRate('923001234567', snapshot);
    if (!picked) {
      return { rule, status: 'unknown', method: 'probed',
        detail: 'The resolver returned no rate for a prefix that matches. Probe inconclusive.',
        reference };
    }
    const choseExpired = picked.expirationDate != null;
    return choseExpired
      ? { rule, status: 'diverges', method: 'probed',
          detail: 'The resolver returned a rate that expired in 2020 over a current one on the ' +
                  'same prefix. Rows are matched on prefix length only; the row chosen depends on ' +
                  'the order the snapshot was serialised, not on when the call started. A tariff ' +
                  'changing rate four times in a day would bill three of the four periods wrong.',
          reference }
      : { rule, status: 'conforms', method: 'probed',
          detail: 'The resolver skipped an expired row and returned the row current at the call.',
          reference };
  } catch (e: any) {
    return { rule, status: 'unknown', method: 'probed',
      detail: `Probe failed: ${e.message}`, reference };
  }
}

/** Does this process read an offsetless date-time as UTC? */
function probeClock(): PolicyCheck {
  const utc = new Date('2026-01-01T00:00:00').getUTCHours() === 0;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  return {
    rule: 'UTC is the only billing clock',
    status: utc ? 'conforms' : 'diverges',
    method: 'probed',
    detail: utc
      ? `Offsetless date-times resolve to UTC on this host (${zone}).`
      : `Host zone is ${zone}. An offsetless date-time parses as LOCAL, so every window ` +
        `built without an explicit Z is shifted by this host's offset.`,
    reference: 'BILLING-POLICY.md §1 · sippy.ts:3565 toSippyDate',
  };
}

/** Does the period module produce half-open UTC weeks starting Monday? */
function probePeriods(billingPeriods: any): PolicyCheck {
  const rule = 'Periods are half-open UTC, weeks run Monday to Monday';
  const reference = 'BILLING-POLICY.md §1.1, §6 · server/billing-periods.ts';
  try {
    const periods = billingPeriods.latestClosedPeriods('weekly', '2026-08-27');
    const p = periods?.[0];
    if (!p) {
      return { rule, status: 'unknown', method: 'probed',
        detail: 'The period module returned no closed weekly period to inspect.', reference };
    }
    const startsMonday = new Date(`${p.start}T00:00:00Z`).getUTCDay() === 1;
    const halfOpen = new Date(`${p.endExclusive}T00:00:00Z`).getTime()
                   - new Date(`${p.end}T00:00:00Z`).getTime() === 86_400_000;
    return startsMonday && halfOpen
      ? { rule, status: 'conforms', method: 'probed',
          detail: `Weekly period ${p.start} → ${p.endExclusive} (exclusive) starts on a Monday ` +
                  `and its exclusive bound is one day past its printed end.`,
          reference }
      : { rule, status: 'diverges', method: 'probed',
          detail: `Weekly period ${p.start} → ${p.end}: startsMonday=${startsMonday}, ` +
                  `halfOpen=${halfOpen}.`,
          reference };
  } catch (e: any) {
    return { rule, status: 'unknown', method: 'probed',
      detail: `Probe failed: ${e.message}`, reference };
  }
}

/**
 * Facts established by reading the code, not by measuring it.
 *
 * These go stale silently. Each carries the file:line it was read from so the
 * next reader can re-check rather than trust. Anything here that becomes cheaply
 * probeable should MOVE to a probe.
 */
function declaredChecks(): PolicyCheck[] {
  return [
    {
      rule: 'CDR ingestion builds its fetch window in UTC',
      status: 'diverges',
      method: 'declared',
      detail: 'The seeder builds `${periodStart}T00:00:00` with no offset and ends at ' +
              'T23:59:59 (inclusive, losing the final second). Both differ from the ' +
              'half-open UTC convention the period module already implements.',
      reference: 'BILLING-POLICY.md §1.1 · server/routes.ts:32718-32719',
    },
    {
      rule: 'Money is compared on an absolute band, never a percentage',
      status: 'conforms',
      method: 'declared',
      detail: 'The completeness classifier uses DEFAULT_MONEY_TOLERANCE_USD = 0.01 for cost ' +
              'and a percentage only for counts. F3 still carries PCT_THRESHOLD = 0.5.',
      reference: 'BILLING-RECONCILIATION-CONTRACT.md §5 · cdr-completeness.ts · ' +
                 'finance/reconciliation.service.ts:57',
    },
    {
      rule: 'The DMR independently reconciles the platform against the switch',
      status: 'diverges',
      method: 'declared',
      detail: 'The DMR reports informational parity rather than independent reconciliation: ' +
              'every row path sets the platform side equal to the Sippy side, so drift is ' +
              'structurally zero and `missing_cdr` cannot fire.',
      reference: 'BILLING-RECONCILIATION-CONTRACT.md §2.1 · sippy-dmr.service.ts:277-278',
    },
  ];
}

export async function policyConformance(): Promise<PolicyCheck[]> {
  const checks: PolicyCheck[] = [probeClock()];

  try {
    const { resolveRate } = await import('./services/sippy/sippy-rating-verification.service');
    checks.push(probeRateRowDating(resolveRate));
  } catch (e: any) {
    checks.push({
      rule: 'Rate rows are selected by the date effective at the call',
      status: 'unknown', method: 'probed',
      detail: `Resolver could not be loaded: ${e.message}`,
      reference: 'BILLING-POLICY.md §4.1',
    });
  }

  try {
    const billingPeriods = await import('./billing-periods');
    checks.push(probePeriods(billingPeriods));
  } catch (e: any) {
    checks.push({
      rule: 'Periods are half-open UTC, weeks run Monday to Monday',
      status: 'unknown', method: 'probed',
      detail: `Period module could not be loaded: ${e.message}`,
      reference: 'BILLING-POLICY.md §1.1',
    });
  }

  return [...checks, ...declaredChecks()];
}
