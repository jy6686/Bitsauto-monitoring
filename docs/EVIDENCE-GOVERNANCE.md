# Evidence Governance — platform-wide

**Status:** FROZEN 2026-08-03. Two rules, binding on **every** BitsAuto module that
produces a verdict — not only the Testing Platform.
**Origin:** [CAP-021](capabilities/CAP-021-SINGLE-CALL-VALIDATION-ENGINE.md) AF-013 and
AF-014, promoted out of call validation because neither is specific to calls.
**Applies to:** identity verification, routing governance, fraud and FAS detection, QoS and
MOS analysis, billing validation, NOC incident analysis, and anything added later that
concludes something about a call, a vendor, a customer or an invoice.

---

## The two questions

Any module that emits a verdict must be able to answer both. If either answer is **no**, it
returns `UNSUPPORTED` or `INCONCLUSIVE` rather than making an attribution.

1. **Did this verdict come from deterministic rules over observed evidence?** (EG-1)
2. **Is every attribution bracketed by observations on both sides?** (EG-2)

---

## EG-1 — Deterministic verdict pipeline

```
Raw evidence → Evidence engine → Rule engine → Verdict → Narrator → Conversation / LLM
```

Never:

```
Evidence → LLM → Verdict
```

Three distinct responsibilities, never merged:

| Layer | Owns | May not |
|---|---|---|
| **Rule engine** | Truth | Phrase anything for humans |
| **Narrator** | Wording | Change a verdict |
| **LLM** | Conversation | Produce or alter a verdict |

**Why it is a hard rule.** A verdict produced by a language model is nondeterministic,
not reproducible from the evidence, and cannot survive a vendor dispute — the one situation
where verdicts matter most. The same evidence must yield the same verdict on every
evaluation, months apart, after the model has changed.

A model may phrase a question, route it to a rule, and read the answer back
conversationally. It may flag, explain and escalate. It never decides.

This strengthens CAP-021 **AF-003** from a constraint on AI *outputs* into a constraint on
system *architecture*.

---

## EG-2 — Attribution requires bracketing

A change may be attributed to a component only when the value was observed **entering** it
and **leaving** it.

```
Observation  →  Hₙ  →  Observation          attribution to Hₙ is supported

Observation  →  ?  ?  ?  →  Observation     the change occurred somewhere in the span
```

The second case does **not** mean the first component in the span is guilty. It means the
span is the finding. The correct verdict is `INCONCLUSIVE`, and the correct output is the
span's membership — not a name.

**Why it is a hard rule.** Reaching *past* a component is not the same as bracketing it.
This is easy to get wrong, and the failure mode is a fluent, confident accusation of a
named supplier that gets repeated in a commercial conversation. It was in fact got wrong
during CAP-023 implementation and caught only by building the `INCONCLUSIVE` verdict — see
CAP-023 §12.2.

Generic beyond identity. The same law governs SIP header preservation, RTP and codec
changes, Diversion and History-Info, STIR/SHAKEN attestation, MOS degradation, packet loss
and media anchoring. Every future evidence engine inherits it.

---

## Verdict vocabulary

Shared across modules. **Every verdict implies the next engineering action** — that is the
point of distinguishing them.

| Verdict | Meaning | Action it implies |
|---|---|---|
| `PASS` | Evidence confirms expected behaviour | None |
| `FAIL` | Evidence confirms incorrect behaviour | Fix the fault |
| `PARTIAL` | Components disagree — some correct, some not | Investigate the affected component |
| `UNSUPPORTED` | The required evidence does not exist | Raise the observation ceiling |
| `INCONCLUSIVE` | Evidence exists but the span holds several candidates | Insert an observation inside the span |

`UNSUPPORTED` and `INCONCLUSIVE` are not hedges and are not interchangeable. One says the
evidence was never collected; the other says it was collected and does not isolate a cause.
They send an engineer to different work.

### Observation ceiling

The furthest point reached by **contiguous** evidence. Contiguity is the whole point: an
isolated observation further along does not extend reach, because the gap before it is
exactly what blocks attribution.

```
O1 → O2 → ? → O4        ceiling is O2, not O4
```

Any module producing verdicts over a path should publish its ceiling. It bounds what may be
concluded, and raising it is how roadmap progress becomes a measured number rather than an
assertion.

### Recommended next observation

Every non-deterministic verdict should state the minimum additional evidence that would
decide it, so that "we cannot tell you" arrives as a work item rather than a shrug.

Where the component sits inside a third party's network and cannot be instrumented, say so
and name the closest honest substitute. Putting an impossible task on an operator's list is
its own kind of dishonesty.

---

## The sprint gate

**Architecture freeze declared 2026-08-03.** The design is disciplined enough that further
abstraction returns less than it costs. From here the limiting factor is the quality and
placement of evidence, not software design.

Every sprint opens with one question:

> **What does this let us truthfully conclude that we could not conclude before?**

The primary way to answer it is *raising the observation ceiling* — O2 packet capture,
O3 terminating DID, O4 handset evidence, deterministic vendor targeting. If a proposed
feature raises no ceiling, it needs a specific reason to be next.

**But raising the ceiling is not the only way to answer it**, and the gate must not be read
as "ceiling or nothing", or it blocks three classes of necessary work:

| Work | Ceiling | Why it still qualifies |
|---|---|---|
| **Removing a false conclusion** | none | The VAL-004 fix raised nothing and made the platform more truthful, by deleting a metric that named vendors on evidence that never observed them. Retracting a wrong claim is worth as much as adding a right one. |
| **Configuration investigation** | none | The Sippy tech-prefix question needs no instrumentation — the evidence to ask it already exists. More capture would not answer it. |
| **Making existing evidence interpretable** | none | Destination-aware normalization and the destination catalogue observe nothing new; they make what is already observed mean something. |

What the gate *does* exclude: new abstractions, new frameworks, and features that neither
extend reach nor sharpen what existing reach already supports.

---

## Relationship to CAP-021

CAP-021 remains the governing document for **call validation**. This document governs
**evidence and verdicts** across the platform. Where they overlap, CAP-021 is the more
specific and applies; where a module is outside call validation, these rules still bind.

AF-013 and AF-014 stay in CAP-021's frozen principles table as the call-validation
instances of EG-1 and EG-2.
