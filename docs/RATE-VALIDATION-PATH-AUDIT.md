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

## Smallest implementation plan

Staged so each step is independently verifiable, in the pattern SMP-003 used. **No step implements
`>50%` / `>=50%`, and none invents "release".**

1. **Carry the inputs.** Add `currentRate` and the effective dates to `PreflightOperation`, and
   populate them in the push-batch route. **No rule, no behaviour change.** Acceptance: the values
   arrive correctly, including when the prefix is new and there is no current rate.
2. **Resolve rules, enforce nothing.** A reader over `validation_rules` + `configuration_values`
   returning the applicable action and threshold for a given scope. Read-only; the result is
   logged and reported, never acted on. Acceptance: the seeded rules resolve to the seeded
   thresholds.
3. **Add the missing dimension.** Migration for the per-client / per-department rule, once the
   owner confirms the resolution order (client+department → client → scope default). **Blocked on
   that decision, not on code.**
4. **Evaluate and refuse — `reject_destination` and `ignore` only.** The two actions the engine
   already expresses. Acceptance is the property SMP-003 established: a refused operation reaches
   no Sippy call, proven by an empty recorder, and the rest of the batch still completes.
5. **The adapter**, for `reject_country` and `reject_rate_sheet`.
6. **`approval_reqd` and `auto_adjust_effective_date`** last. Both change the shape of an
   operation rather than refusing it, and `approval_reqd` must not become a requirement for
   ordinary pushes — it is one configurable outcome.

Steps 1 and 2 change no behaviour and are the whole prerequisite. Step 4 is the first that can
refuse anything, and it cannot run before the owner settles the comparison base (gap 1) and the
boundary condition.
