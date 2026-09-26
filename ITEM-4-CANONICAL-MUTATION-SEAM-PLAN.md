# Item 4 — A single canonical mutation seam with multiple entry points

**Plan only. No code written. Nothing wired.** Audited 2026-09-26/27 against
`server/routes.ts`, `batch-runner.ts`, `batch-execute.ts`, `tariff-lock.ts`.

## The invariant this establishes

> No production rate mutation may reach `setSippyRateEntry` or `pushRateToSippy`
> except through the canonical batch execution seam.

`push-batch` already satisfies it. `change-client-rates` does not.

---

## Q1 — Input contract, and whether it can be represented exactly

| | push-batch | change-client-rates |
|---|---|---|
| Accepts | `accountNames[]`, `destinations[]`, `productName`, `clientRequestId` | `accountName`, `iTariff`, `prefixes[]`, `rate`, `effectiveFrom`, `effectiveTill` |
| Scope | many accounts × many destinations | **one** account, one rate, many prefixes |
| Tariff | resolved per account | **supplied by the caller** |
| Prefixes | expanded from a catalogue destination | **literal, caller-supplied** |

**Answer: not exactly, and forcing it would change its meaning.** Rate Analysis edits a
specific prefix at a specific tariff; it is not destination-shaped. Per
`commercial-ui-destination-model` a Commercial UI row is a destination, but this path is
deliberately the other thing.

**So the seam must admit two operation origins, both carrying a resolved `iTariff`:**

```
destination-derived   product + destination → expand → prefixes   (push-batch)
literal-prefix        caller-supplied prefixes, tariff given      (change-client-rates)
                              │
                              └──► one RateOperation[] → runRateBatch
```

`RateOperation` already carries `prefix` and the plan is built per tariff, so this is an
adapter at the entry point, **not a change to `batch-plan` or `batch-runner`**. That
matters: the execution engine is certified and must not be reshaped for this.

---

## Q2 — Operation preservation, and a correction

**My earlier reading was wrong.** I reported `change-client-rates` as having *stronger*
operation-row and readback behaviour (11 vs 3, 12 vs 4). Those are reference **counts**,
and re-reading the code they are manual plumbing of what the canonical seam already does:
`change-client-rates` writes operation rows inline and threads `verificationResult`
through by hand; `push-batch` delegates both to `runRateBatch`. Its own comment says
*"Same closure push-batch keeps per operation"* — it is duplication, not strength.

**What genuinely must survive, and it is one thing:** the explicit failure log when the
terminal operation update itself fails —

> `terminal update FAILED — … the operation stays pending and the job will not be terminalised`

That preserves the `job-terminalization.ts` invariant (`terminal ⇒ zero pending
operations`) and is the difference between a recoverable record and a permanently wrong
one. It belongs **in the shared seam**, applying to both entry points.

**Canonical:** `runRateBatch`'s delegated recording. **Discarded:** the inline duplicate.

---

## Q3 — Lock scope, confirmed to cover the mutation

`batch-runner.ts` lines 350–368 (single) and 399–443 (grouped):

```
acquireTariff(lock, iTariff)          ← BEFORE the row is marked running
   │  try {
   │      runOnePush(operation)       ← the actual Sippy mutation
   │  } finally {
release()                             ← released even if the push threw
```

**Confirmed: the lock wraps the mutation, not merely preparation.** The comments state the
reasoning — claimed before `running` so a waiting batch never sees a row that is only
queued behind a lock, and released in `finally` or *"Postgres would hold the tariff until
the connection died"*. Grouped execution claims once per group, because one upload is one
write.

**Nothing to change here.** The work is routing the second entry point through it.

---

## Q4 — Eligibility moves to the seam

Today it sits **inside the `push-batch` handler** (~line 328 of the handler), resolved
defensively: a failed lookup leaves `eligible` UNDEFINED rather than false, and preflight
does the refusing. `change-client-rates` has **zero** eligibility references.

**Plan:** the eligibility decision moves to the shared seam so both entry points get the
same refusal. The defensive `undefined` semantics are preserved exactly —
`commercial-increment-feature` records eligibility as an *enforcement boundary*, and
`rate-validation` holds that **absence is not permission**; neither may be softened by
being relocated.

**Behaviour change to declare:** `change-client-rates` begins refusing ineligible
destinations. That is the intended fix, and it is why this cannot ship silently.

---

## Q5 — Concurrency: the direct loop goes

`change-client-rates` runs `for (const [opIdx, prefix] of prefixes.entries())` calling
`setSippyRateEntry` / `pushRateToSippy` directly, with **no lock and no lane**. It reaches
neither `runRateBatch` (0 refs vs 3) nor `createPostgresTariffLock` (0 vs 1).

Consequence today: **the two entry points can write the same tariff concurrently, and this
one can write while a batch holds the advisory lock, because it never asks for it** — the
exact failure `batch-plan` exists to prevent (jobs #37–#45, *"Tariff N is locked"*).

**Plan:** the loop is deleted, not guarded. Operations are handed to `runRateBatch`, which
serialises them through the same advisory lock and the same lane.

---

## Q6 — Readback

Per the Q2 correction: `push-batch`'s readback is not smaller, it is delegated.
`runRateBatch` owns verification and `verificationResult` flows from it.

**Plan:** adopt the delegated readback for both; drop the hand-threading. The preserved
behaviour is the *record*, not the plumbing.

---

## Q7 — Audit and obligations

`push-batch` records the obligation **after** `runRateBatch` returns (handler ~line 748),
and an obligation that was not recorded is re-derived later rather than lost.
`change-client-rates` records **none** — no customer is told its rate changed.

**Plan:** obligation recording moves to the seam, after execution, with the re-derivation
fallback intact. Both entry points then produce one authoritative trail.

---

## Q8 — Failure semantics: already half-built

A lock refusal is **already** distinguished from a write failure, structurally:

```ts
if (!release) return {
  verdict: 'failure',
  message: `Tariff ${iTariff} is being written by another push and did not become free in time.
            Nothing was sent for ${prefix}; the tariff is unchanged by this operation.`,
  refusedBeforeWrite: true,
};
```

`refusedBeforeWrite: true` is the fact that matters: nothing was sent, so the tariff is
*provably* untouched — a failure, never an unknown outcome.

**Gap:** it is *typed* as `failure`, so a lock wait and a rejected write share a verdict
and differ only by a flag. That is precisely what `stage-failure.ts` would resolve
(`infrastructure`, retryable, distinct code). **Per instruction, `stage-failure.ts` is NOT
wired as part of this item.** Recorded as the natural first consumer when the wiring phase
opens.

---

## Required proof

```
change-client-rates → runRateBatch → canonical mutation     ✓ asserted
change-client-rates → setSippyRateEntry                     ✗ asserted impossible
```

1. No direct `setSippyRateEntry` / `pushRateToSippy` call is reachable from the handler.
2. Two entry points, same tariff, cannot write concurrently — both serialise on the lock.
3. Eligibility refuses identically from both.
4. The advisory lock is held for every write from both.
5. Operation records preserved, including the terminal-update-failure log.
6. Readback preserved via the delegated path.
7. Post-push obligation produced by both.
8. A failure cannot yield a false successful completion.
9. **Blind guard:** bypassing the seam must make tests fail.

## Boundary

Built **unwired**, behind the existing deployment hold. Two declared behaviour changes
when it is eventually wired: `change-client-rates` starts **waiting on a lock** it now
ignores, and starts **refusing on eligibility**. Both are the point; neither may ship
silently.
