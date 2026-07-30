# Provisioning step metrics — platform contract

**A provisioning step reports two things about what it did. `detail` is prose for a person. `metrics` is counts for a query. Never parse one to get the other.**

| | `provisioning_steps.detail` | `provisioning_steps.metrics` |
|---|---|---|
| Type | `TEXT` — JSON array of strings | `JSONB` — object |
| Audience | the operator reading the company card | a dashboard, a report, a rate over history |
| Authored by | the step, in the step's own words | the step, using the frozen keys below |
| May change freely | **yes** — wording is a display decision | **no** — a key's meaning is a contract |
| Added by | migration `055` | migration `056` |

Both are set from the same values inside the step, so they cannot disagree about a number the operator is reading.

---

## Why the split

`detail` exists because a passing step used to report only a tick and a duration. Every executor already built the lines — how many rules it created, how many it reused, that the rates are effective immediately — and the runner logged them once to a console saturated with AMI events and then discarded them. The operator's question after a run is not *did it pass*; the tick answers that. It is *what exists on the switch now*.

`metrics` exists because the answer to *what is our authentication verification success rate* must not depend on the wording of a sentence. Rewording a `detail` line is a display change that should cost nothing. If a query regex-matched it, that change would break the query silently, and it would stay broken until someone noticed a rate had gone flat.

---

## The frozen keys

A step emits whichever of these apply to it, **in this sense and no other**. This is what makes a figure comparable across steps; without the agreement, `metrics` is just a second free-form blob.

| Key | Type | Meaning | Applies to |
|---|---|---|---|
| `requested` | number | Units the step set out to create or confirm | every step |
| `created` | number | Units it created **on this run** | steps that create |
| `reused` | number | Units already in the wanted state, left alone | idempotent steps |
| `verified` | number | Units **read back and confirmed correct** | steps with a `verify()` |
| `failed` | number | Units not in the wanted state at the end | every step |
| `skipped` | number | Units deliberately not attempted | optional steps |
| `failures` | `{cause, count}[]` | Why things failed, counted | any step with failures |

`cause` is free text, but it must be stable enough to group on across runs — it is what answers *most common provisioning failure*. Write the class of problem (`routing group mismatch`), never the instance (`54321292* expected 5`); the instance belongs in `detail`.

### Step-specific keys

Anything else, alongside the frozen keys. These carry no cross-step meaning and no step should read another's.

```jsonc
// authentication
{ "ips": 1, "cells": 12, "routingGroupsConfirmed": 12 }

// rates
{ "iTariff": 62, "byProduct": { "FC": 32, "BC": 32, "SB": 32, "SC": 32 },
  "effectiveImmediately": true, "products": 4, "destinations": 32 }
```

---

## Two rules that are easy to get wrong

### `verified` is never assumed equal to `requested`

They answer different questions — *what did we ask for* and *what did we confirm* — and the gap between them is the most valuable number in the object. Two real states this platform has produced:

```jsonc
// Sippy accepted the workbook and did not import it — the Tariff-33 failure.
{ "requested": 128, "created": 128, "verified": 0 }

// Twelve rules exist and translate correctly, but the switch returned the routing
// group from neither listAuthRules nor getAuthRuleInfo. The rules exist; that they
// route anywhere is unproven. Those are different claims.
{ "requested": 12, "created": 12, "verified": 12, "routingGroupsConfirmed": 0 }
```

A step that cannot check something reports a smaller `verified`. It does not report success and stay quiet.

`verify()`'s metrics are merged **over** the executor's for this reason: `execute()` knows what it asked for, `verify()` knows what the switch holds.

### `NULL` means unknown, not zero

A run from before migration 056 has no metrics. A rate computed over history must count only rows that **have** the key — `COUNT(*) FILTER (WHERE metrics ? 'verified')`, not `COALESCE(metrics->>'verified', '0')`. Treating absence as zero silently reports every historical run as a total failure.

---

## Adding a step

1. Emit the frozen keys that apply, in their frozen sense.
2. Put counts in `metrics` and sentences in `detail`, both derived from the same values.
3. If the step verifies, return a `VerifyReport` so the check's own counts and lines are recorded on a **pass** as well as a failure — a check that proves something should say what it proved.

The types are in [`server/services/provisioning/types.ts`](../server/services/provisioning/types.ts) (`StepMetrics`, `VerifyReport`). `server/services/provisioning/steps/authentication.step.ts` and `rates.step.ts` are the worked examples.

---

## Rendering

The UI renders `detail` verbatim and does not format `metrics`. A client-side renderer would need a case per step, so adding a step would mean changing the browser code — and some lines are not derivable from counts at all. *"Effective immediately — no activation date set"* is a fact about how the workbook is built, which is knowledge that belongs with the step.

`metrics` is returned by `GET /api/provisioning/jobs/:id` for callers that chart it.
