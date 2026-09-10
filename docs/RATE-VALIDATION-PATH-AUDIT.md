# Rate Manager validation-path audit

Read-only. Answers one question: **where can the ratified validation engine sit so every rate
operation is evaluated before any Sippy mutation, without disturbing the existing
batch/operation/mutation architecture?**

No code was changed, no migration applied, no Sippy request made, no database written.

---

## The headline: most of this already exists, and nothing enforces it

The old BitsAuto rule model has **already been ported into this platform** — schema, seed data,
CRUD API and a governance sign-off flow. It is not wired to any decision.

| Piece | State |
|-------|-------|
| `configuration_values` | **Seeded verbatim from old BitsAuto** — the same 18 vendor keys with the same values: `increase_notice_period 7`, `rate_increase_alert 50.0`, `rate_decrease_alert 50.0`, `future_effective_date 14`, `old_effective_date 7`, `acceptable_pending_increase 3` |
| `validation_rules` | 18 rules seeded across `vendor` / `client` / `commercial`, each linked to a `config_key`, each carrying `selected_action` |
| `selected_action` vocabulary | **Exactly the six from the old system**: `ignore`, `reject_rate_sheet`, `reject_country`, `reject_destination`, `approval_reqd`, `auto_adjust_effective_date` |
| `routes-validation-rules.ts` | CRUD only |
| `routes-governance-review.ts` | draft → approved → locked; locking freezes both tables |
| **Enforcement** | **NONE.** The only readers are the CRUD API and the governance screen |

`server/services/rates/` contains **no reference to increase, decrease, a current rate, a prior
rate, or a delta**. The rate push has never consulted these tables.

**Scope that statement carefully.** It is true of the push path. It is NOT true of the platform:
`rate_notifications.notification_type` already carries `rate_change | price_increase |
price_decrease | 7_day_notice`. Direction and a seven-day notice exist in the NOTIFICATION layer.
They have simply never reached the layer that writes to the switch.

So this is not a build from nothing. It is **wiring an existing, seeded, governed rule set to the
push path** — and closing three specific gaps.

---

## Where it goes — `batch-runner.ts:122`

```
runRateBatch()
  ├─ preflightOperations(input.operations)   ← HERE. already "deterministic refusals,
  │                                             decided without contacting Sippy"
  ├─ planRateBatch()                          one serial lane per tariff
  ├─ persistPlan()                            a durable row per operation
  ├─ executeRateBatch() → pushRateToSippy()   ← the mutation boundary is inside this
  └─ verdictFromPush()
```

`preflight.ts` is already the right shape and needs no new concept:

- every refusal it returns is typed `refusedBeforeWrite: true` **by construction** — the module
  contacts nothing, so the guarantee is structural rather than asserted;
- `batch-runner` records a deterministic refusal **against its own operation and lets the rest
  proceed** (`status: 'not_attempted'`), which is destination-level rejection already working.

---

## The four gaps

### 1. The currently-offered rate is not available at push time — the blocking gap

`PreflightOperation` carries `operationKey`, `accountName`, `storedITariff`, `resolvedITariff`,
`fullPrefix`, `rate`, `rawIncrement`. **There is no prior rate**, so no rule about direction or
magnitude can be evaluated.

`sippy.getTariffRatesListFull()` exists and is used elsewhere, but the push-batch path never calls
it. Whether the comparison base should be the live Sippy rate, `product_rates`, or the customer's
issued rate sheet is [an open question in the policy](RATE-CHANGE-POLICY.md) — this audit only
establishes that **none of them reaches preflight today**.

### 2. Effective dates reach the route but not the operation

`POST /api/rate-manager/push-batch` accepts `effectiveFrom` / `effectiveTill`, per destination.
Neither is carried into `PreflightOperation`, so the three date rules
(`increase_notice_period`, `future_effective_date`, `old_effective_date`) have nothing to read.

### 3. `validation_rules` cannot express "client + department"

`scope` is a four-value enum — `vendor | client | commercial | global`. There is **no company and
no department column**. The old system configures rules per Company AND per Department
(1GLOBAL / Wholesale), and the ratified requirement says "client + department rules determine the
consequence". **The ported table is one dimension short of the requirement**, and the seed's
`client` scope is a single global default, not a per-client rule.

### 4. Three blast radii, one engine scope

The engine records outcomes **per operation**. Of the six actions:

| Action | Fits today? |
|--------|-------------|
| `ignore` | Yes — no refusal recorded |
| `reject_destination` | **Yes, exactly** — `not_attempted` + `refusedBeforeWrite: true` |
| `approval_reqd` | Partly — job status `needs_review` exists, but nothing gates on it |
| `auto_adjust_effective_date` | No — mutates the operation rather than refusing it |
| `reject_country` | **No** — needs to refuse a GROUP of operations |
| `reject_rate_sheet` | **No** — needs to refuse the whole batch |

`reject_country` and `reject_rate_sheet` have no representation in a per-operation vocabulary.
An adapter is required: evaluate rules, expand a country/sheet-scoped refusal into the set of
operations it covers, then refuse each one individually so the existing persistence and reporting
stay unchanged.

---

## Decision A — the comparison base. Evidence, not a recommendation.

Nothing may be enforced until this is settled, because `0.05 → 0.02` is only a 60% decrease once
we know which `0.05` is authoritative. What the repository establishes about each candidate:

### 1. The live Sippy tariff rate

Authoritative for what the switch charges right now. Two costs. **Which tariff is itself
contested** — push-batch resolves via the Sippy billing plan while deal-approve uses
`company.sippyITariff`, and those disagree for 22 of 26 Sippy-linked companies. And it couples
validation to switch availability: a read per tariff per push, so a switch that is slow or
unreachable stops rates being validated rather than merely stopping them being sent.

### 2. `product_rates`

The platform's own default matrix. **Per product, not per client** — so it structurally cannot
express what a particular customer was offered, which is the thing the rule protects. Also empty
in production, cause unresolved.

### 3. The issued rate sheet — `rate_notification_template_destinations`

**This is not hypothetical; the structure already exists and is written to.**

`rate_notification_templates` is keyed on **client name + product**. Its destination rows carry
`destinationName`, `dialPrefix`, **`rate`**, **`baseRate`**, and **`activationDate` /
`activationTime`**. The schema's own comment calls them "the rate sheet entries".

That is the closest match to the old system's semantics, where the offered rate is what was sent
to the customer on a rate sheet with an activation date.

**Two things are NOT established** and neither can be answered from the repository: how completely
this table is populated in production, and whether it is maintained as the record of what is
currently offered or only as a template for composing the next send. Both need a production read,
which this audit did not perform.

**A loose thread worth noting, not concluding:** the pairing of `rate` with `baseRate` may be the
answer to "50% of which value" — the currently offered rate versus the rate it was originally
derived from. That would resolve an open question in the policy. It is a guess from column names
and is recorded only so the question is asked of the data rather than of the schema.

## Smallest implementation plan

RATIFIED SEQUENCE. An earlier draft of this plan put "carry the inputs" first. **That was wrong**
and was corrected by the owner: populating `currentRate` *is* choosing the comparison base, so the
plumbing cannot be built before the decision — a plumbing test made to pass against an assumed
source silently ratifies that source.

| | Step | Gate |
|---|------|------|
| **A** | Establish the authoritative comparison base | **Owner decision. Nothing may begin before it.** |
| **B** | Carry the correctly-sourced current rate + effective dates into `PreflightOperation` | Needs A |
| **C** | Establish client/department rule resolution, then the migration for the missing dimension | Owner decision on precedence. `client+department → client → scope default` is a CANDIDATE, not ratified |
| **D** | Define the exact threshold boundary, `>` or `>=` | Owner decision; unresolved by the evidence |
| **E** | Enforce `ignore` and `reject_destination` — the two the engine already expresses | First step that can refuse anything |
| **F** | Adapters for `reject_country` and `reject_rate_sheet` | |
| **G** | `approval_reqd` and `auto_adjust_effective_date`, separately | Neither may become a requirement for ordinary pushes |

Throughout: **validation refusal → `refusedBeforeWrite: true` → no Sippy mutation**, with E's
acceptance being the property SMP-003 established — a refused operation reaches no Sippy call,
proven by an empty recorder, while the rest of the batch completes.

No step implements `>50%` / `>=50%`, and none invents "release".
