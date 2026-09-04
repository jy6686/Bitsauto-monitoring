import { describe, it, expect, vi } from 'vitest';

// The rate resolver lives in a module that reaches for storage and the database.
// Neither is needed to probe a pure prefix-matching function, and neither is
// available in a test run, so both are stubbed — the resolver itself is the real
// shipped implementation, which is the entire point of a probe.
vi.mock('./storage', () => ({ storage: {} }));
vi.mock('./db', () => ({ db: {} }));
// sippy.ts is imported for the real toSippyDate — the conversion billing performs.
// Its module-level integrations are irrelevant to a pure date format and are stubbed
// only where importing would otherwise reach for them.
vi.mock('./email', () => ({}));

import { policyConformance, type PolicyCheck } from './policy-conformance';

const find = (checks: PolicyCheck[], fragment: string) =>
  checks.find(c => c.rule.toLowerCase().includes(fragment.toLowerCase()));

describe('policyConformance — it measures rather than asserts', () => {
  it('probes the real rate resolver and reports the known divergence', async () => {
    const checks = await policyConformance();
    const rate = find(checks, 'Rate rows are selected by the date');

    expect(rate).toBeDefined();
    expect(rate!.kind).toBe('measured');

    /**
     * BILLING-POLICY §4.1: resolveRate matches on prefix length only and never
     * reads activationDate or expirationDate. Handed a rate that expired in 2020
     * ahead of the current one on the same prefix, it returns the expired row.
     *
     * THIS TEST IS EXPECTED TO FLIP. When the resolver is fixed the probe will
     * report `conforms` and this assertion will fail loudly — which is the
     * intended signal, not a regression. Change it to 'conforms' then, and the
     * flip is the proof the fix landed.
     */
    expect(rate!.status).toBe('diverges');
    expect(rate!.detail).toMatch(/expired in 2020/);
    expect(rate!.reference).toMatch(/§4\.1/);
  });

  /**
   * The business-level probe: a real ten-second call through the shipped
   * reproduceCost, judged against the TARIFF's arithmetic, not the engine's.
   *
   * IT FLIPPED, on 2026-09-04, exactly as the previous version of this comment
   * said it would. rateCall is wired in, the engine returns 0.00583, and the
   * probe reports conforms.
   *
   * Worth stating why this is evidence and not circularity: the probe's
   * expected value is `0.035 * (10/60)`, computed inside the probe from the
   * tariff alone. It never calls the engine to find out what the answer should
   * be. Three "reconciliations that cannot fail" already exist in this
   * codebase, each because one side was derived from the other — this one was
   * built to avoid that, which is what makes it flipping mean something.
   */
  it('runs a real call through the rating engine and finds the units correct', async () => {
    const checks = await policyConformance();
    const units = find(checks, 'per-minute prices per minute');

    expect(units).toBeDefined();
    expect(units!.kind).toBe('measured');
    expect(units!.status).toBe('conforms');
    // $0.005833 reproduced, matching the tariff's own arithmetic. It was
    // $0.350000 — exactly 60x — until the units fix landed.
    expect(units!.detail).toMatch(/0\.005833/);
    expect(units!.detail).not.toMatch(/60\.0x/);
  });

  it('probes the period module and finds it conforming', async () => {
    const checks = await policyConformance();
    const periods = find(checks, 'Periods are half-open');

    expect(periods).toBeDefined();
    expect(periods!.kind).toBe('measured');
    // billing-periods.ts is the one component already built to the frozen policy.
    expect(periods!.status).toBe('conforms');
    expect(periods!.detail).toMatch(/Monday/);
  });

  /**
   * Measuring `new Date()` would measure a JavaScript behaviour. What matters is
   * the conversion the seeder's window actually passes through on its way to the
   * switch, so the probe exercises toSippyDate itself.
   */
  it('measures the conversion billing performs, not a zone name', async () => {
    const checks = await policyConformance();
    const conv = find(checks, 'The date conversion billing uses emits UTC');

    expect(conv).toBeDefined();
    expect(conv!.kind).toBe('measured');
    expect(conv!.reference).toMatch(/sippy\.ts:3565/);

    // A probe that cannot load the code it measures is useless, so probe_failed
    // is a test failure here rather than an acceptable outcome.
    expect(conv!.status).not.toBe('probe_failed');

    // Asserted against the host this suite runs on rather than a fixed
    // expectation, since the answer is a property of the machine. Verified both
    // ways before this was committed: TZ=UTC yields conforms, TZ=Asia/Karachi
    // yields diverges — so the probe measures rather than always reporting one.
    const hostIsUtc = new Date('2026-08-16T00:00:00').getUTCHours() === 0;
    expect(conv!.status).toBe(hostIsUtc ? 'conforms' : 'diverges');
  });

  it('reports repository state as derived, not measured', async () => {
    const empty = await policyConformance({ repositoryPopulated: false });
    const check = find(empty, 'The CDR repository holds evidence');
    expect(check!.kind).toBe('derived');
    expect(check!.status).toBe('diverges');
    expect(check!.detail).toMatch(/not the same finding as data loss/);

    const full = await policyConformance({ repositoryPopulated: true });
    expect(find(full, 'The CDR repository holds evidence')!.status).toBe('conforms');

    // Omitted entirely when there is no runtime state to derive it from.
    const none = await policyConformance();
    expect(find(none, 'The CDR repository holds evidence')).toBeUndefined();
  });
});

describe('policyConformance — the invoice document probe', () => {
  /**
   * All three are sensitivity tests: render twice with one field moved, and if
   * the output does not move the document provably does not read that field.
   * No expected value comes from the code under test, so none can be a
   * tautology — the failure mode an adversarial review found in three of the
   * five originally designed checks.
   *
   * All three assert diverges on TODAY's code and each is expected to flip
   * when its defect is fixed; flip the assertion then, deliberately.
   */
  it('finds the document bills reproduced cost, not the switch figure', async () => {
    const checks = await policyConformance();
    const cost = find(checks, "bills the switch's actual cost");
    expect(cost!.kind).toBe('measured');
    expect(cost!.status).toBe('diverges');
    expect(cost!.detail).toMatch(/renderers still disagree/);
  });

  it('finds the document ignores the stored due date', async () => {
    const checks = await policyConformance();
    const due = find(checks, 'prints the stored due date');
    expect(due!.status).toBe('diverges');
    expect(due!.detail).toMatch(/different rules/);
  });

  it('finds production-shaped rows lose their destination identity', async () => {
    const checks = await policyConformance();
    const dest = find(checks, 'production-shaped snapshot rows');
    expect(dest!.status).toBe('diverges');
    expect(dest!.detail).toMatch(/destination NAME/);
  });
});

describe('policyConformance — declared facts are labelled as such', () => {
  it('never presents a code-review fact as a measurement', async () => {
    const checks = await policyConformance();
    const declared = checks.filter(c => c.kind === 'declared');

    expect(declared.length).toBeGreaterThan(0);
    // A declared fact goes stale silently, so every one must carry the place it
    // was read from for the next reader to re-check rather than trust.
    for (const c of declared) {
      expect(c.reference).toMatch(/\.(ts|md)/);
      expect(c.detail.length).toBeGreaterThan(40);
    }
  });

  it('still records the DMR divergence, which is real and unfixed', async () => {
    // The DMR sets its platform side equal to the Sippy side on every row
    // path, so drift is structurally zero and `missing_cdr` can never fire.
    // That is the hole at the centre of the reconciliation story and it must
    // stay visible until the DMR genuinely compares two sources.
    const checks = await policyConformance();
    expect(find(checks, 'The DMR independently reconciles')!.status).toBe('diverges');
  });

  it('no longer claims the fetch window is offsetless — that was fixed', async () => {
    // This check asserted a divergence against routes.ts line numbers that had
    // moved, describing a seeder that no longer exists: computeSeedSlices
    // parses `T00:00:00Z` explicitly with a half-open upper bound.
    //
    // A stale "diverges" is worse than no check. It is the same failure this
    // whole panel exists to prevent — a confident claim that stopped matching
    // reality — and it teaches people to discount every other row.
    const checks = await policyConformance();
    const c = find(checks, 'CDR ingestion builds its fetch window in UTC')!;
    expect(c.status).toBe('conforms');
    expect(c.reference).toContain('seed-slices.ts');
    expect(c.detail).not.toContain('no offset');
  });

  it('reports every check with a status, a method and a reference', async () => {
    const checks = await policyConformance();
    expect(checks.length).toBeGreaterThanOrEqual(6);
    for (const c of checks) {
      expect(['conforms', 'diverges', 'inconclusive', 'probe_failed']).toContain(c.status);
      expect(['measured', 'derived', 'declared']).toContain(c.kind);
      expect(c.rule).toBeTruthy();
      expect(c.reference).toBeTruthy();
    }
  });
});
