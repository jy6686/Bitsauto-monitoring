# Rate-change policy

The commercial rules a rate push must satisfy before it may reach Sippy. **Specification in
progress** — stated by the owner 2026-09-10, with the gaps marked. Nothing here is implemented.

This is **not** an approval workflow. The owner has decided explicitly that a rate push does not
require approval. It is a deterministic pre-mutation guard: the same shape as the existing
integrity guards, evaluated from data, with no human in the loop.

---

## THE REQUIREMENT — ratified 2026-09-11

> Rate Manager must have a configurable rate-change validation engine modelled on the old BitsAuto
> rule structure. Global configuration defines thresholds and date limits; client + department
> rules determine the consequence. Rate validation occurs before any Sippy mutation. Rate push
> itself does not inherently require approval.

And the consequence **must be capable of being destination-level**, not necessarily whole-batch
rejection.

This supersedes the first formulation below, which was "a >50% decrease is blocked until the rate
is released". That was too coarse in three ways the evidence established: the threshold is
configurable rather than fixed, the consequence is per client and department rather than universal,
and rejection has three blast radii rather than one.

### Where it sits in the existing pipeline

The old system separates the change job from switch propagation via `Is Sync`. That is the same
separation this platform already enforces, and the stages line up:

`validation decision → mutation eligibility → Sippy mutation → synchronisation / verification`

The validation engine is a new stage in front of the boundary work already built. It does not
replace the integrity guards or the mutation boundary; a validation refusal must produce
`refusedBeforeWrite: true` like any other pre-write refusal.

## SUPERSEDED — the rules as first stated

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

**Superseded.** Retained because it is what was originally asked for, and because the gap between
it and the ratified requirement is the value the investigation produced.

### 3. The guard runs BEFORE the mutation boundary

A refused rate must produce **no Sippy mutation attempt** — `refusedBeforeWrite: true`, established
structurally, exactly as the preflight refusals already are. This is the same property the SMP-003
destructive-route acceptance proved for authorization: a refusal is not demonstrated by the
response, but by nothing having been sent.

---

## Evidence from the old system — READ 2026-09-10

`23.106.59.17:8081` → Tools → **Configuration Values**. One configuration record, its fields
grouped into tabs: **Vendor · A-Z · BSR · Global · Client**. The values below are the **Vendor**
tab. **The Client tab has not been read** — the tabs are JavaScript carousel items with no URL, and
reading them requires clicking, which was out of scope for this pass.

| Setting | Unit | Value |
|---------|------|-------|
| Old Effective Date | days | 7 |
| Future Effective Date | days | 14 |
| Dial Code Changes Period | days | 0 |
| **Increase Notice Period** | days | **7** |
| Dial Code Length | number | 20 |
| **Rate Increase Alert** | percent | **50.0** |
| **Rate Decrease Alert** | percent | **50.0** |
| Rate Rounding extent | number | 4 |
| Accepted File size | mb | 5 |
| Acceptable Shortest Duration | days | 1 |
| Acceptable Pending Increase | number | 3 |
| Maximum Delay for CDR Reconciliation | hour | 2 |

### THREE DISCREPANCIES WITH THE RULE AS STATED

These are recorded before interpretation. The old system is the authority the owner nominated, and
where it disagrees with the verbal statement, the disagreement is the finding.

1. **50% is called an ALERT, not a limit.** The owner stated a decrease over 50% "cannot be
   implemented" without a release. The old system names the threshold `Rate Decrease Alert`. An
   alert threshold and a hard block are different controls: one flags, the other refuses. Which one
   the old system actually enforces is NOT established by this screen, and the difference decides
   whether the new guard refuses a push or merely marks it.

2. **The threshold is symmetric — there is a `Rate Increase Alert` at 50% too.** The stated rule
   constrains decreases only. The old system applies the same percentage to increases. Either the
   rule is symmetric and the statement was partial, or increases are alerted but not constrained.

3. **`Increase Notice Period` = 7 days exists.** The owner's first statement had increases
   requiring 7 days' notice, then corrected it to "increase would also be immediate". The old
   system carries a 7-day increase notice period as configuration. The correction may be right for
   the Client side, or may have been about the effective-date field rather than the notice period —
   but the setting exists and is not zero.

### The domain vocabulary, from the client rate-sheet template

`/tariffs_profile/clienttariffprofile/16/update/` — a PRESENTATION template. It maps rate-sheet
concepts to spreadsheet cells (`F5`, `B6`), so it holds no rule logic. What it does establish is
the vocabulary, and one structural fact that matters.

**Nine rate status codes**, each a state a rate can carry on a client rate sheet:

`New Code` · `No Change` · `Increase` · `Decrease` · **`Pending Increase`** · **`Pending Decrease`**
· `Block` · `Removed` · `Destination`

**Two separate effective dates on the sheet header**: `increase_effective_date` and
`decrease_effective_date` — distinct fields, not one date with a direction. The stated rule treats
the effective date as a single choice; this model carries one per direction.

### HYPOTHESIS — DISPROVED 2026-09-11, kept only to record the correction

`Pending Increase` / `Pending Decrease` look like the state of a change that has been ANNOUNCED but
is not yet in effect. That would join three things already observed:

- `Increase Notice Period = 7 days` — an increase announced today cannot apply until the notice
  elapses, so it sits somewhere in the meantime. `Pending Increase` is the obvious candidate.
- `Acceptable Pending Increase = 3` — a cap on how many such pending changes are tolerated, which
  only makes sense if pending is a durable state rather than a transient one.
- The owner's **"release"**. If a >50% decrease becomes `Pending Decrease` rather than being
  refused outright, then "release" is plausibly the act that moves it out of pending — which would
  also reconcile discrepancy 1: the threshold is an *alert* because it does not refuse the change,
  it changes its STATE.

**This was wrong.** The validation-rule screen below shows the configured action for a suspect
decrease is `REJECT DESTINATION` — the destination is dropped, not moved to a pending state.
`Pending Increase` / `Pending Decrease` remain rate-sheet STATUS CODES, but they are not the
mechanism the threshold triggers. Recorded rather than deleted, because the reasoning was
plausible and the next person may reach for it again.

## THE RULE ENGINE — `/client_registration/update/validation_rule/`, read 2026-09-11

This is the authority. It is not a global policy at all.

### It is configured PER CLIENT and PER DEPARTMENT

The screen selects a **Department** (e.g. Wholesale) and a **Company** (e.g. 1GLOBAL) before
showing any rule. **There is no single platform-wide rate-change rule to duplicate.** A "50% rule"
implemented as a platform constant would be the wrong shape.

### Six rules, in two groups

| Group | Rule |
|-------|------|
| Rate Changes | Rate Increase Notice Violation (days) |
| Rate Changes | Suspect Rate Increase |
| Rate Changes | Suspect Rate Decrease |
| Suspicious | Number of pending increases exceeds the required limit |
| Suspicious | Effective Date Greater Than Allowed Limit |
| Suspicious | Effective Date Older Than Allowed Limit |

Each names a threshold held in **Configuration Values** — "Allowed Limit", "required limit", the
50% alerts, the 7/14-day dates. **Thresholds are global; outcomes are per client.** That split is
the design.

### Six possible OUTCOMES per rule — this is the part the stated rule was missing

`IGNORE` · `REJECT RATE-SHEET` · `REJECT COUNTRY` · `REJECT DESTINATION` · `APPROVAL REQD` ·
`AUTO ADJUST EFFECTIVE DATE`

Three separate blast radii for a rejection — whole sheet, one country, one destination. A
violating rate does **not** necessarily fail the push; it can drop only its own destination and
let the rest through. "Reject the push" was too coarse.

`AUTO ADJUST EFFECTIVE DATE` is offered on **`Rate Increase Notice Violation` only** — the other
five rows do not have that column enabled. This resolves the third discrepancy: an increase that
breaches the 7-day notice can have its effective date moved out automatically instead of being
refused, which is how an increase can be "immediate" from the operator's side while a notice
period still exists.

`APPROVAL REQD` is one of the six outcomes, so approval is a configurable result, not absent from
the model. The owner's "no approval needed" holds for the client below, where no rule selects it.

### The configuration observed — 1GLOBAL / Wholesale

| Rule | Outcome |
|------|---------|
| Rate Increase Notice Violation (days) | `IGNORE` |
| Suspect Rate Increase | `IGNORE` |
| **Suspect Rate Decrease** | **`REJECT DESTINATION`** |
| Number of pending increases exceeds the required limit | `IGNORE` |
| **Effective Date Greater Than Allowed Limit** | **`REJECT DESTINATION`** |
| Effective Date Older Than Allowed Limit | `IGNORE` |

One client. Another may differ entirely, and the per-client design means it is expected to.

### Also present, not yet read

- `/rate_change/ratechange/` — "Change Rate". The screen the rule most likely governs.
- `/client_registration/update/validation_rule/` — per-client "Rules Update".
- `/rate_notifications/notificationmanagerapproval/` and `notificationmanagementapproval` — the old
  system DOES have approval stages for rate NOTIFICATIONS. That is not the same thing as approving
  a push, and the owner's "no approval needed" applies to the push; worth keeping the two apart.
- `Old Effective Date 7` / `Future Effective Date 14` — bounds on how far back or forward an
  effective date may be set. The stated rule says "immediate or a selected future date" with no
  bound; this suggests a 14-day forward limit exists.

## The Change Rate workflow — read 2026-09-11, PARTIAL

`/rate_change/ratechange/`. A list of rate-change JOBS — 65 records, all from 2016, all by one
operator. Columns:

`Direction` (Client / Vendor) · `Department` (Whole-Sale / Retail) · `Product` · `All Carrier` ·
`Created On` · `Created By` · **`Is Sync`** · `Actions`

Three things this establishes:

1. **A rate change is a batch JOB, not a per-rate edit.** It is scoped to a direction, a
   department, a product and a set of clients — the same (department, product, client) axes the
   validation rules are configured on, which is consistent.
2. **`Is Sync`** — the job carries a flag for whether it reached the switch. A rate change and its
   propagation are separate states in this model.
3. The products in use are `Premium`, `First Class - Wholesale`, `Business Class - Wholesale`,
   `Standard`, `Special Alpha - Retail`, `Special Delta - Retail` — the same Wholesale/Retail split
   and Greek-letter Special naming the current `product_registry` uses.

### NOT ESTABLISHED — and not reachable by reading alone

`create/` is a wizard: Direction → Department → Product → Clients. The rate grid, and therefore the
calculation, appears only after those selections. The row action is `./update?id=N`, an edit form
over a historical job.

So these remain open, and reaching them requires either driving the wizard or opening a historical
record — both beyond navigate-and-read, and neither done:

- **`>50%` or `>=50%`** — the boundary that decides whether `0.05 → 0.025` passes. Deliberately
  unresolved: neither is to be implemented until the old calculation or another authoritative
  source proves it. `0.05 → 0.02` is unambiguously 60% and beyond a 50% threshold; what remains is
  how the violation is calculated and what the client's rule then does.
- **What "release" is.** Nothing on any screen read so far uses the word, and there is now
  evidence AGAINST equating it with `Pending Increase`, `Pending Decrease`, or `REJECT
  DESTINATION` — those are distinct concepts in the material examined. **Do not invent a release
  mechanism.** It is not the validation
  outcome (that is `REJECT DESTINATION`), and it is not the `Pending` status codes.
- **What "the currently offered rate" is compared against** in the old system.

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
