# Can the existing governance model hold the ratified rate-change policy?

Inventory taken 2026-09-14, before building anything. The engine (`rate-validation.ts`,
`3f1817df`) evaluates policy; production needs a governed source for the rules it evaluates. The
question is whether `configuration_values` and `validation_rules` can be that source **without
changing their semantics**.

**Answer: the thresholds half can. The rules half cannot.** Two blockers, one of them a direct
contradiction of a property the engine deliberately holds.

---

## What exists

| Table | Shape | Rows |
|---|---|---|
| `configuration_values` | `category` + `config_key` → `value`, with `unit`, `value_type`, `default_value` | seeded, 4 categories |
| `validation_rules` | `scope` + `rule_key` → `selected_action`, pointing at a config value via `config_category`/`config_key` | **18, seeded, singleton** |
| `governance_reviews` | singleton `draft → approved → locked`; locked blocks edits | 1 |

`validation_rules` rows are 6 rules × 3 scopes (`vendor`, `client`, `commercial`). Each names the
threshold it is measured against, which is the right idea: **thresholds are referenced, never
copied into the rule**.

## The six questions

### 1. Can it represent client + department independently? — **NO**

`validation_rules` has **`scope`, not a client and not a department**. `scope = 'client'` means
"the client-side rule stack", generically — one row for the whole platform. There is no
`client_id`, no `company_id` and no `department` column anywhere in the table.

The old system selects **Department AND Company** before it will show a rule. The ratified
requirement is explicit that outcomes are per client and per department, and that a platform-wide
rule would be the wrong shape. This table is exactly the platform-wide shape.

This is the primary blocker, and it is structural rather than a missing value.

### 2. Can it represent the six outcomes exactly? — **YES**

`server/routes-validation-rules.ts:106` validates against exactly:

`ignore` · `reject_rate_sheet` · `reject_country` · `reject_destination` · `approval_reqd` ·
`auto_adjust_effective_date`

A mechanical rename away from the engine's `IGNORE` / `REJECT_RATE_SHEET` / … Nothing to change.

**One latent defect:** the endpoint accepts `auto_adjust_effective_date` for **any** rule. The old
system offers that column on `Rate Increase Notice Violation` only, and the engine treats it
elsewhere as a configuration error. The writer permits a configuration the reader refuses.

### 3. Can global thresholds be referenced without duplicating them per client? — **YES, but on the wrong axis**

`config_category` + `config_key` is a genuine reference, so a threshold lives in one place and the
rule points at it. That half of the design is sound and worth keeping.

But `configuration_values` is keyed by the same `category` axis, and the **same key carries
different values per category**:

| key | vendor | client |
|---|---|---|
| `future_effective_date` | 14 | **15** |
| `old_effective_date` | 7 | 7 |
| `rate_increase_alert` | 50.0 | 50.0 |

So thresholds are already duplicated **per scope**. Since no client axis exists, they cannot be
duplicated per client — the question is moot today and would become live the moment a client axis
is added. The policy says thresholds are global; this model has them per scope. Reconciling that
is a decision, not a migration.

### 4. Can an unconfigured client remain undecidable? — **NO. This is a direct contradiction.**

```
selected_action VARCHAR(64) NOT NULL DEFAULT 'ignore'
```

**There is no unset.** Every rule always carries an action, and the default is the most permissive
one available. The engine holds the opposite property deliberately: silence is not `IGNORE`, and a
rule with no configured outcome is `undecided`, so that an unconfigured client is not the most
permissive client on the platform.

Reading this table as the policy source would invert that on every rule nobody has touched.
Widening the column to nullable would change the meaning of 18 existing rows that a governance
review has already signed off.

### 5. Can configuration changes be effective-dated or audited? — **NO**

`PATCH /api/validation-rules` overwrites `selected_action` in place and sets `updated_at`. There is
no history table, no `writeAudit()` call, and no effective dating. After a change, *"who moved the
decrease rule from ignore to reject_destination, when, and why"* is unanswerable — only that
somebody did, at some point.

`governance_reviews` provides a `locked` state that returns **423** and blocks edits, which is a
real control but a **global gate, not per-change provenance**. Eligibility declarations are
attributable; these are not.

### 6. Does anything consume them? — **NO execution consumer**

| Reader | Purpose |
|---|---|
| `routes-validation-rules.ts` | the governance screen: GET, GET all, PATCH |
| `routes-governance-review.ts` | reads both for sign-off |
| `seed-governance.ts` | writes the seed |

**Nothing in the rate path reads either table.** They are governance/configuration-only, exactly as
suspected. That is good news: changing how policy is stored breaks no execution path, because there
is none.

---

## Recommendation — a new table, and reuse of half the existing one

Two things are true at once: `configuration_values` is a **fit** for thresholds, and
`validation_rules` is **not** a fit for per-client outcomes.

**Reuse `configuration_values` as the threshold source.** It already holds every value the engine
needs, with units and types, behind a governance lock. No change.

**Do not extend `validation_rules`.** Adding `client_id` + `department` and making
`selected_action` nullable would change the meaning of 18 rows a governance review has approved,
and would make the existing singleton stack ambiguous — is a row with no client the default, or an
orphan? That ambiguity is the same id-space mistake the catalogue work exists to escape.

**Add a separate table for per-client outcomes**, referencing `configuration_values` for thresholds
exactly as `validation_rules` does. It can then carry what the policy needs and the current model
cannot express:

- `client_id` + `department`, both required
- `selected_action` **nullable** — absent means undeclared, which the engine reads as undecided
- effective dating and attribution, as `product_destination_eligibility` already does

`validation_rules` stays as the platform default stack it currently is, consumed by the governance
screen. The two do not overlap, because one is a default and the other is a per-client override,
and a per-client table with no row for a client is the "undeclared" the engine already handles.

**Not built.** This is the inventory; the table is a decision, not a conclusion.

---

## Where "department" is authoritative — read from production 2026-09-14

The per-client adapter needs `department` on each operation. Before adding a column, the question
was where that concept already lives. Three candidates, read from the live database:

| Candidate | Finding |
|---|---|
| `product_registry.segment` ("Retail \| Wholesale \| Both") | **null on all four products.** Not the authority. |
| `companies.companyType` (default `'retail'`) | populated everywhere, but with a THIRD value: `retail` 21 · `wholesale` 17 · **`client` 11** |
| `companies.department` | **the authority.** `retail` 19 · `wholesale` 17 · `NULL` 13. Written by the client wizard (`routes.ts:28169`). |

**Where both are set they never disagree** (36 of 36). `companyType` is a superset with a value
(`client`) that is not a department at all, so it is not a substitute.

**The 13 with no department** are 11 `companyType = 'client'` rows that look like test or internal
accounts (`acmetel`, `aircel`, `internal-afg`, `internal-bd`, `internal-eritrea`, `jytest1`,
`ptcl`, `test2`, `test3`, `test9`, `testingaccount`), `uzair`, and **PUSHTOTALK** — which is a real,
Sippy-linked client (tariff 2, the same one recorded in [billing readiness](../docs) as priced at
tariff 33's rate while resolving to tariff 2).

**What follows, and what does not.** The adapter should read `companies.department` — no new
column. Under the policy layer, an operation for a company with a NULL department resolves to
`policy_unresolved` and is refused before write. That is the correct behaviour, not a defect to
route around: PUSHTOTALK has no department and therefore no policy scope until somebody sets
one. Setting it is a commercial fact about the customer, entered through the wizard, not a
backfill this work performs.

Two things are not settled by this reading and are left open on purpose: whether the old system's
"Department" (Whole-Sale / Retail on the Change Rate screen) is the same axis as
`companies.department` — the vocabulary matches, the identity has not been proven — and the
threshold category, for which the old system's **Client tab of Configuration Values has never
been read** (recorded in RATE-CHANGE-POLICY.md). That tab is the most likely place the 14-vs-15
question answers itself, and reading it requires the care that document describes: the old
system has GETs that mutate.
