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

/**
 * A probe that could not run is not a probe that found nothing wrong, and
 * neither is a probe that ran but could not decide. Collapsing the three into
 * one value is how a broken probe comes to read as a clean bill of health.
 *
 *   conforms      the behaviour matches the frozen policy
 *   diverges      the behaviour was measured and contradicts the policy
 *   inconclusive  the probe RAN and could not decide — its fixture found nothing to judge
 *   probe_failed  the probe could not run at all: threw, or the code would not load
 */
export type Conformance = 'conforms' | 'diverges' | 'inconclusive' | 'probe_failed';

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
      return { rule, status: 'inconclusive', kind: 'measured',
        detail: 'The resolver returned no rate for a prefix that matches, so there was nothing ' +
                'to judge. The probe ran; it did not fail.',
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
    return { rule, status: 'probe_failed', kind: 'measured',
      detail: `Probe could not run: ${e.message}`, reference };
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
    return { rule, status: 'probe_failed', kind: 'measured',
      detail: `Probe could not run: ${e.message}`, reference };
  }
}

/**
 * Does the rating engine charge a per-minute price per MINUTE?
 *
 * The first business-level probe: it runs a real call through the shipped
 * `reproduceCost` and compares the money against the tariff's own arithmetic.
 *
 * THE EXPECTED VALUE DOES NOT COME FROM THE CODE UNDER TEST. It is
 * `price_per_minute x (billed_seconds / 60)` computed here, from the tariff
 * alone. That independence is the whole point — three "reconciliations that
 * cannot fail" already exist in this codebase, each because one side of a
 * comparison was derived from the other, and a probe built the same way would
 * report conforms over any defect at all.
 *
 * The fixture is production, not invented: tariff 32, prefix 192, price1 0.035
 * per minute, intervals 1/1 — under which Sippy charged $5.09 for 145.37 minutes
 * while the verifier reproduced $305.27. A ten-second call is the smallest case
 * that exposes it: 0.035 x 10/60 = $0.00583, against $0.35 if the price is
 * applied once per one-second interval.
 */
function probeRatingUnits(reproduceCost: Function): PolicyCheck {
  const rule = 'The rating engine applies per-minute prices per minute';
  const reference = 'BILLING-POLICY.md §3 · sippy.ts:5844 (SippyTariffRate contract) · ' +
                    'sippy-rating-verification.service.ts:164';
  try {
    const PRICE_PER_MINUTE = 0.035;
    const DURATION_SECS    = 10;
    const rate = {
      prefix: '192', price1: PRICE_PER_MINUTE, priceN: PRICE_PER_MINUTE,
      interval1: 1, intervalN: 1,
    };

    const result = reproduceCost(DURATION_SECS, rate);
    // The engine's field is reproducedCost (ReproducedRating), not cost.
    const actual = Number(result?.reproducedCost);
    if (!Number.isFinite(actual)) {
      return { rule, status: 'inconclusive', kind: 'measured',
        detail: 'The engine returned no numeric cost, so there was nothing to judge.', reference };
    }

    // Independent: the tariff's own arithmetic, not the engine's.
    const expected = PRICE_PER_MINUTE * (DURATION_SECS / 60);
    const ratio    = expected === 0 ? Infinity : actual / expected;

    if (Math.abs(actual - expected) <= 0.000001) {
      return { rule, status: 'conforms', kind: 'measured',
        detail: `A ${DURATION_SECS}s call at ${PRICE_PER_MINUTE}/min on 1/1 intervals reproduced ` +
                `as $${actual.toFixed(6)}, matching the tariff's own arithmetic.`,
        reference };
    }
    return { rule, status: 'diverges', kind: 'measured',
      detail: `A ${DURATION_SECS}s call at ${PRICE_PER_MINUTE}/min on 1/1 intervals reproduced as ` +
              `$${actual.toFixed(6)} where the tariff gives $${expected.toFixed(6)} — ` +
              `${ratio.toFixed(1)}x. The per-minute price is being charged once per billing ` +
              `interval, so every tariff whose intervals are not 60/60 is mis-reproduced. ` +
              `Certification cannot converge while this holds; invoices are unaffected because ` +
              `they bill the switch's actual_cost.`,
      reference };
  } catch (e: any) {
    return { rule, status: 'probe_failed', kind: 'measured',
      detail: `Probe could not run: ${e.message}`, reference };
  }
}

/**
 * Does the invoice DOCUMENT read the fields the invoice ROW carries?
 *
 * The business-level probe the owner asked for: one invoice rendered in memory
 * through the REAL shipped renderer (`generateInvoiceHtml`, the html_content
 * every generation path stores), with zero writes — the renderer is a pure
 * function returning a string, so the probe is structurally unable to persist.
 *
 * ── Sensitivity testing, not format parsing ─────────────────────────────────
 * An adversarial review killed three of five originally designed checks as
 * tautologies — comparisons whose two sides came from the same arithmetic, the
 * exact "reconciliation that cannot fail" shape this platform has produced
 * three times. What survived is a method that cannot be tautological: render
 * twice with ONE field changed, and if the output does not move, the document
 * provably does not read that field. No expected value is derived from the
 * code under test, and no date/number format has to be guessed.
 *
 * ── The fixture is shaped like PRODUCTION rows ──────────────────────────────
 * `invoice_cdr_snapshots` has one writer, and it sets `callee` to the
 * VERIFICATION'S DESTINATION NAME (sippy-rating-snapshot.service.ts:192), not
 * a dialable number. A fixture with a dialable callee — the first draft's —
 * would tick green over a live identity failure, because the renderer resolves
 * country by dial-code lookup on that field. The fixture therefore carries
 * exactly what production carries: a name in `callee`, digits in `prefix`.
 */
function probeInvoiceDocument(generateInvoiceHtml: Function): PolicyCheck[] {
  const mkSnapshot = (over: Record<string, unknown>) => ({
    id: 0, cdrId: null, cdrStartTime: '2026-08-18T14:35:00Z',
    // Production shape: destination NAME in callee, digits in prefix.
    callee: 'Pakistan Mobile', prefix: '192',
    durationSecs: 10, iTariff: '32', tariffVersionId: 1, ratingVerificationId: null,
    reproducedCost: 0.35, actualCost: 0.00583, delta: null,
    interval1Used: 1, intervalNUsed: 1, price1Used: 0.035, priceNUsed: 0.035,
    connectFeeUsed: 0, gracePeriodUsed: 0, freeSecondsUsed: 0, postCallSurchargeUsed: 0,
    verificationStatus: 'locked', snapshotHash: 'probe', lockedAt: new Date(0), createdAt: new Date(0),
    ...over,
  });
  const mkInvoice = (over: Record<string, unknown>) => ({
    id: 0, invoiceNumber: 'PROBE-0000', iTariff: '32', customerName: 'PROBE',
    periodStart: '2026-08-17', periodEnd: '2026-08-23',
    totalReproduced: 0, totalActual: 0, totalDelta: 0, lineCount: 2,
    status: 'draft', generatedAt: new Date('2026-08-24T00:00:00Z'),
    dueDate: '2026-09-15', htmlContent: null,
    ...over,
  });
  const render = (invoice: unknown, snapshots: unknown[]): string =>
    String(generateInvoiceHtml({
      invoice, snapshots, lineItems: [], customerName: 'PROBE',
      periodLabel: '2026-08', branding: null, customerBranding: null,
    }));

  const checks: PolicyCheck[] = [];
  const base = [mkSnapshot({}), mkSnapshot({ cdrStartTime: '2026-08-19T09:00:00Z' })];

  // ── Which cost column feeds the document? ─────────────────────────────────
  // Invoices bill actual_cost — the switch's figure — settled when the preview
  // was made canonical. Move each column separately and watch the output.
  {
    const rule = 'The invoice document bills the switch\'s actual cost';
    const reference = 'BILLING-RECONCILIATION-CONTRACT.md §2 · sippy-invoice.service.ts:128';
    try {
      const doc      = render(mkInvoice({}), base);
      const docActal = render(mkInvoice({}), base.map(r => ({ ...r, actualCost: 999.99 })));
      const docRepro = render(mkInvoice({}), base.map(r => ({ ...r, reproducedCost: 888.88 })));
      const readsActual = docActal !== doc;
      const readsRepro  = docRepro !== doc;
      checks.push(
        readsActual && !readsRepro
          ? { rule, status: 'conforms', kind: 'measured',
              detail: 'Moving actual_cost changes the document; moving reproduced cost does not. ' +
                      'The document bills the switch\'s figure.', reference }
          : !readsActual && readsRepro
            ? { rule, status: 'diverges', kind: 'measured',
                detail: 'Moving reproduced cost changes the document; moving actual_cost does NOT. ' +
                        'The stored html_content bills the rating engine\'s reproduction — currently ' +
                        'up to 60x wrong — while the canonical PDF sums actual_cost. The two ' +
                        'renderers still disagree about which column is money.', reference }
            : { rule, status: 'inconclusive', kind: 'measured',
                detail: `Sensitivity unclear (actual:${readsActual}, reproduced:${readsRepro}).`,
                reference },
      );
    } catch (e: any) {
      checks.push({ rule, status: 'probe_failed', kind: 'measured',
        detail: `Probe could not run: ${e.message}`, reference });
    }
  }

  // ── Does the document print the invoice row's own due date? ───────────────
  {
    const rule = 'The invoice document prints the stored due date';
    const reference = 'BILLING-POLICY.md §6 · sippy-invoice.service.ts:190-192 vs invoice-terms';
    try {
      const a = render(mkInvoice({ dueDate: '2026-09-15' }), base);
      const b = render(mkInvoice({ dueDate: '2026-12-31' }), base);
      checks.push(a === b
        ? { rule, status: 'diverges', kind: 'measured',
            detail: 'Changing the invoice row\'s due date does not change the document. The ' +
                    'document recomputes its own due date as periodEnd + (branding days ?? 6), so ' +
                    'the row and the printed document can carry different due dates computed by ' +
                    'different rules.', reference }
        : { rule, status: 'conforms', kind: 'measured',
            detail: 'The document\'s due date follows the invoice row\'s.', reference });
    } catch (e: any) {
      checks.push({ rule, status: 'probe_failed', kind: 'measured',
        detail: `Probe could not run: ${e.message}`, reference });
    }
  }

  // ── Does destination identity survive production-shaped rows? ─────────────
  {
    const rule = 'The document resolves destinations for production-shaped snapshot rows';
    const reference = 'BILLING-POLICY.md §2 · sippy-invoice.service.ts:122-125 · ' +
                      'sippy-rating-snapshot.service.ts:192';
    try {
      const doc = render(mkInvoice({}), base);
      const resolved = /pakistan/i.test(doc);
      const unknown  = /unknown/i.test(doc);
      checks.push(
        resolved && !unknown
          ? { rule, status: 'conforms', kind: 'measured',
              detail: 'A row whose callee holds the destination name resolves to its country.',
              reference }
          : { rule, status: 'diverges', kind: 'measured',
              detail: 'The renderer resolves country by DIAL-CODE lookup on `callee` — but the ' +
                      'snapshot writer stores the destination NAME there, which no dial-code ' +
                      'table matches. Production-shaped rows render ' +
                      (unknown ? 'as country "Unknown"' : 'without their country') + '. The ' +
                      'catalogue, not a dial-code lookup on a name, owns identity.', reference },
      );
    } catch (e: any) {
      checks.push({ rule, status: 'probe_failed', kind: 'measured',
        detail: `Probe could not run: ${e.message}`, reference });
    }
  }

  return checks;
}

/** Does the period module produce half-open UTC weeks starting Monday? */
function probePeriods(billingPeriods: any): PolicyCheck {
  const rule = 'Periods are half-open UTC, weeks run Monday to Monday';
  const reference = 'BILLING-POLICY.md §1.1, §6 · server/billing-periods.ts';
  try {
    const periods = billingPeriods.latestClosedPeriods('weekly', '2026-08-27');
    const p = periods?.[0];
    if (!p) {
      return { rule, status: 'inconclusive', kind: 'measured',
        detail: 'The period module returned no closed weekly period, so there was nothing to ' +
                'inspect. The probe ran; it did not fail.', reference };
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
    return { rule, status: 'probe_failed', kind: 'measured',
      detail: `Probe could not run: ${e.message}`, reference };
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
      // Re-checked 2026-09-04 against the code as it now stands. The offsetless
      // window this described is gone: the seeder delegates to computeSeedSlices,
      // which parses `${periodStart}T00:00:00Z` explicitly and ends at
      // `${endDate}T00:00:00Z` + 24h — an exclusive upper bound, so the final
      // second is no longer lost.
      //
      // Left as a `declared` CONFORMS rather than deleted, because the rule is
      // still worth asserting. But a stale "diverges" is worse than no check at
      // all: it teaches people to discount the whole panel, and this one had
      // been pointing at routes.ts line numbers that moved long ago.
      rule: 'CDR ingestion builds its fetch window in UTC',
      status: 'conforms',
      kind: 'declared',
      detail: 'computeSeedSlices parses `${periodStart}T00:00:00Z` with an explicit offset ' +
              'and bounds the period at `${endDate}T00:00:00Z` + 24h — half-open, matching ' +
              'the period module. Verified 2026-09-04; the previous offsetless form no ' +
              'longer exists in the seeder.',
      reference: 'BILLING-POLICY.md §1.1 · server/seed-slices.ts:66-69',
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
      status: 'probe_failed', kind: 'measured',
      detail: `Conversion could not be loaded: ${e.message}`,
      reference: 'BILLING-POLICY.md §1 · sippy.ts:3565',
    });
  }

  try {
    const { resolveRate, reproduceCost } =
      await import('./services/sippy/sippy-rating-verification.service');
    checks.push(probeRateRowDating(resolveRate));
    checks.push(probeRatingUnits(reproduceCost));
  } catch (e: any) {
    checks.push({
      rule: 'Rate rows are selected by the date effective at the call',
      status: 'probe_failed', kind: 'measured',
      detail: `Resolver could not be loaded: ${e.message}`,
      reference: 'BILLING-POLICY.md §4.1',
    });
  }

  try {
    const { generateInvoiceHtml } = await import('./services/sippy/sippy-invoice.service');
    checks.push(...probeInvoiceDocument(generateInvoiceHtml));
  } catch (e: any) {
    checks.push({
      rule: 'The invoice document reads the fields the invoice row carries',
      status: 'probe_failed', kind: 'measured',
      detail: `Renderer could not be loaded: ${e.message}`,
      reference: 'sippy-invoice.service.ts:175',
    });
  }

  try {
    const billingPeriods = await import('./billing-periods');
    checks.push(probePeriods(billingPeriods));
  } catch (e: any) {
    checks.push({
      rule: 'Periods are half-open UTC, weeks run Monday to Monday',
      status: 'probe_failed', kind: 'measured',
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
