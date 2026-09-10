# Rate-change policy

The commercial rules a rate push must satisfy before it may reach Sippy. **Specification in
progress** — stated by the owner 2026-09-10, with the gaps marked. Nothing here is implemented.

This is **not** an approval workflow. The owner has decided explicitly that a rate push does not
require approval. It is a deterministic pre-mutation guard: the same shape as the existing
integrity guards, evaluated from data, with no human in the loop.

---

## The rules as stated

### 1. Effective date is independent of direction

An earlier draft had increases requiring 7 days' notice. **Corrected by the owner:** direction does
not govern the effective date.

| Change | Effective date |
|--------|----------------|
| Increase | Immediate, or a selected future date |
| Decrease | Immediate, or a selected future date |

### 2. A decrease is capped at 50% of the currently offered rate

The load-bearing rule, and the reason this guard exists. A lower rate is not acceptable merely
because it is arithmetically valid.

With a currently offered rate of `0.05`:

| Requested | Change | Outcome |
|-----------|--------|---------|
| `0.07` | increase | Allowed — immediate or scheduled |
| `0.03` | −40% | Allowed |
| `0.025` | −50% | Allowed — the boundary is inclusive as stated |
| `0.02` | −60% | **Refused.** The offered rate must be RELEASED first |

> A rate decrease of up to 50% from the currently offered rate may be implemented. A decrease
> greater than 50% cannot be applied directly; the existing offered rate must first be released
> before the lower rate can be implemented.

### 3. The guard runs BEFORE the mutation boundary

A refused rate must produce **no Sippy mutation attempt** — `refusedBeforeWrite: true`, established
structurally, exactly as the preflight refusals already are. This is the same property the SMP-003
destructive-route acceptance proved for authorization: a refusal is not demonstrated by the
response, but by nothing having been sent.

---

## UNDEFINED — must be sourced, not invented

The rules above cannot be implemented as they stand. Each gap below changes the outcome for real
rates, and the old BitsAuto system (`23.106.59.17:8081`, `/rateeditor/`) is the authority for them.

1. **What "release" means.** The owner has stated it is the mechanism that permits a >50% decrease,
   and explicitly that it should be taken from the old system rather than invented. Is it a state
   on the offer, an action a person takes, a withdrawal of the rate sheet, a notice period? Whether
   this guard is implementable at all depends on the answer.

2. **What "the currently offered rate" is.** Candidate sources disagree in this platform: the live
   Sippy tariff rate, `product_rates`, and the rate on the customer's issued offer or rate sheet.
   [Tariff resolution](../docs) already records that the two tariff-resolution paths disagree for
   22 of 26 companies, so "the current rate" is not a single unambiguous value here.

3. **50% of which value** — the rate currently effective, or the rate originally offered? These
   diverge as soon as one lawful decrease has been applied. Two −40% steps reach −64% of the
   original while each step is individually compliant.

4. **The scope of comparison** — per prefix, per destination, per product, per customer, or per
   tariff. A destination now carries many prefixes, so "the offered rate" may be a set rather than
   a value.

5. **The first rate for a prefix**, where there is no prior offered rate to compare against. The
   rule must state whether that is unconstrained.

6. **Whether the 50% boundary is inclusive.** Recorded as inclusive above because the owner's
   example put −50% in the allowed column; worth confirming against the old system.

---

## How the old system will be read

The old BitsAuto instance is a **live production system that writes rates to the same Sippy switch
this platform writes to**, and the Sippy write freeze is in force. Two things follow, and they are
recorded here because they are easy to forget once someone is clicking around a UI:

- **No control that could submit anything may be used.** Not Apply, not Reset, not anything under
  the `Send Rate` tab. Reading the rules must not become a rate push.
- **A URL that looks like a view may not be one.** This codebase already recorded that
  `status/<id>` on the old system is a CANCEL action — a GET that mutates — which is the same class
  as Sippy's own `rates_tariff.php?action=change`. Blind navigation is therefore unsafe; pages must
  be reached deliberately, not by following links to see where they go.

The old UI is the source for the **rules and terminology**, not a template to reproduce. The
implementation enforces the commercial rule; it does not recreate the screen.
