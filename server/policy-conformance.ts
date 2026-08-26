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

/**
 * How an item was obtained. A finance surface must never let one wear the
 * clothes of another.
 *
 *   measured  proven by EXECUTING the shipped code path
 *   derived   computed from runtime state
 *   declared  read from code or configuration, and able to go stale
 */
export type Provenance = 'measured' | 'derived' | 'declared';

export interface PolicyCheck {
  rule:   string;
  status: Conformance;
  kind:   Provenance;
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
      return { rule, status: 'unknown', kind: 'measured',
        detail: 'The resolver returned no rate for a prefix that matches. Probe inconclusive.',
        reference };
    }
    const choseExpired = picked.expirationDate != null;
    return choseExpired
      ? { rule, status: 'diverges', kind: 'measured',
          detail: 'The resolver returned a rate that expired in 2020 over a current one on the ' +
                  'same prefix. Rows are matched on prefix length only; the row chosen depends on ' +
                  'the order the snapshot was serialised, not on when the call started. A tariff ' +
                  'changing rate four times in a day would bill three of the four periods wrong.',
          reference }
      : { rule, status: 'conforms', kind: 'measured',
          detail: 'The resolver skipped an expired row and returned the row current at the call.',
          reference };
  } catch (e: any) {
    return { rule, status: 'unknown', kind: 'measured',
      detail: `Probe failed: ${e.message}`, reference };
  }
}

/**
 * Does the conversion BILLING USES emit the UTC instant it was asked for?
 *
 * Testing `new Date(...)` would measure a JavaScript behaviour, not this
 * platform's. The seeder builds `${periodStart}T00:00:00` and hands it to
 * `getSippyCDRs`, which routes it through `toSippyDate` — and THAT is the
 * function whose output reaches the switch. So the probe feeds it the exact
 * string the seeder builds and compares the emitted GMT stamp against the
 * instant that string is meant to denote.
 *
 * The output is self-labelling: toSippyDate stamps every result "GMT", so a
 * shifted window is not merely wrong, it is wrong while asserting it is not.
 */
function probeBillingDateConversion(toSippyDate: Function): PolicyCheck {
  const rule = 'The date conversion billing uses emits UTC';
  const reference = 'BILLING-POLICY.md §1 · sippy.ts:3565 · routes.ts:32718';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  try {
    // Exactly what the seeder builds for a period starting 16 Aug 2026.
    const emitted  = String(toSippyDate('2026-08-16T00:00:00'));
    const expected = String(toSippyDate('2026-08-16T00:00:00Z'));
    return emitted === expected
      ? { rule, status: 'conforms', kind: 'measured',
          detail: `An offsetless period bound converts to "${emitted}" — the same instant as ` +
                  `the explicit-Z form. Host zone ${zone}.`,
          reference }
      : { rule, status: 'diverges', kind: 'measured',
          detail: `An offsetless period bound converts to "${emitted}" where the UTC instant is ` +
                  `"${expected}". Host zone ${zone}. Every CDR fetch window built without an ` +
                  `explicit Z is shifted by this host's offset — and the output is labelled GMT ` +
                  `either way, so the shift is invisible downstream.`,
          reference };
  } catch (e: any) {
    return { rule, status: 'unknown', kind: 'measured',
      detail: `Probe failed: ${e.message}`, reference };
  }
}

/** Does the period module produce half-open UTC weeks starting Monday? */
function probePeriods(billingPeriods: any): PolicyCheck {
  const rule = 'Periods are half-open UTC, weeks run Monday to Monday';
  const reference = 'BILLING-POLICY.md §1.1, §6 · server/billing-periods.ts';
  try {
    const periods = billingPeriods.latestClosedPeriods('weekly', '2026-08-27');
    const p = periods?.[0];
    if (!p) {
      return { rule, status: 'unknown', kind: 'measured',
        detail: 'The period module returned no closed weekly period to inspect.', reference };
    }
    const startsMonday = new Date(`${p.start}T00:00:00Z`).getUTCDay() === 1;
    const halfOpen = new Date(`${p.endExclusive}T00:00:00Z`).getTime()
                   - new Date(`${p.end}T00:00:00Z`).getTime() === 86_400_000;
    return startsMonday && halfOpen
      ? { rule, status: 'conforms', kind: 'measured',
          detail: `Weekly period ${p.start} → ${p.endExclusive} (exclusive) starts on a Monday ` +
                  `and its exclusive bound is one day past its printed end.`,
          reference }
      : { rule, status: 'diverges', kind: 'measured',
          detail: `Weekly period ${p.start} → ${p.end}: startsMonday=${startsMonday}, ` +
                  `halfOpen=${halfOpen}.`,
          reference };
  } catch (e: any) {
    return { rule, status: 'unknown', kind: 'measured',
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
      kind: 'declared',
      detail: 'The seeder builds `${periodStart}T00:00:00` with no offset and ends at ' +
              'T23:59:59 (inclusive, losing the final second). Both differ from the ' +
              'half-open UTC convention the period module already implements.',
      reference: 'BILLING-POLICY.md §1.1 · server/routes.ts:32718-32719',
    },
    {
      rule: 'Money is compared on an absolute band, never a percentage',
      status: 'conforms',
      kind: 'declared',
      detail: 'The completeness classifier uses DEFAULT_MONEY_TOLERANCE_USD = 0.01 for cost ' +
              'and a percentage only for counts. F3 still carries PCT_THRESHOLD = 0.5.',
      reference: 'BILLING-RECONCILIATION-CONTRACT.md §5 · cdr-completeness.ts · ' +
                 'finance/reconciliation.service.ts:57',
    },
    {
      rule: 'The DMR independently reconciles the platform against the switch',
      status: 'diverges',
      kind: 'declared',
      detail: 'The DMR reports informational parity rather than independent reconciliation: ' +
              'every row path sets the platform side equal to the Sippy side, so drift is ' +
              'structurally zero and `missing_cdr` cannot fire.',
      reference: 'BILLING-RECONCILIATION-CONTRACT.md §2.1 · sippy-dmr.service.ts:277-278',
    },
  ];
}

export async function policyConformance(
  opts: { repositoryPopulated?: boolean | null } = {},
): Promise<PolicyCheck[]> {
  const checks: PolicyCheck[] = [];

  try {
    const { toSippyDate } = await import('./sippy');
    checks.push(probeBillingDateConversion(toSippyDate));
  } catch (e: any) {
    checks.push({
      rule: 'The date conversion billing uses emits UTC',
      status: 'unknown', kind: 'measured',
      detail: `Conversion could not be loaded: ${e.message}`,
      reference: 'BILLING-POLICY.md §1 · sippy.ts:3565',
    });
  }

  try {
    const { resolveRate } = await import('./services/sippy/sippy-rating-verification.service');
    checks.push(probeRateRowDating(resolveRate));
  } catch (e: any) {
    checks.push({
      rule: 'Rate rows are selected by the date effective at the call',
      status: 'unknown', kind: 'measured',
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
      status: 'unknown', kind: 'measured',
      detail: `Period module could not be loaded: ${e.message}`,
      reference: 'BILLING-POLICY.md §1.1',
    });
  }

  // Derived — computed from runtime state rather than from executing a rule.
  if (opts.repositoryPopulated != null) {
    checks.push({
      rule: 'The CDR repository holds evidence in this environment',
      status: opts.repositoryPopulated ? 'conforms' : 'diverges',
      kind: 'derived',
      detail: opts.repositoryPopulated
        ? 'raw_sippy_cdrs is populated in the database that answered this request.'
        : 'raw_sippy_cdrs is EMPTY in the database that answered this request. Every ' +
          'completeness figure below is therefore about an environment with no evidence ' +
          'in it, which is not the same finding as data loss.',
      reference: 'BILLING-POLICY.md §7.1 · environment-fingerprint.ts',
    });
  }

  return [...checks, ...declaredChecks()];
}
