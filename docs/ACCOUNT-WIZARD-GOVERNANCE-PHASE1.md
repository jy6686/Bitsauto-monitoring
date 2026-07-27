# Account Wizard — Governance & Change Policy (Phase 1)

**Status:** APPROVED
**Approved:** 2026-07-27
**Date:** 2026-07-27
**Scope:** Client Account Wizard and its provisioning pipeline
**Supersedes:** nothing
**Review trigger:** any of the Exit Criteria in §5

> This is a **phase policy, not a permanent freeze.** It governs Phase 1 only.
> It deliberately does not declare the current implementation to be the target
> architecture — several known defects are recorded in §4 precisely because the
> current behaviour is *not* considered correct, only *stable*.

---

## 1. Purpose

The Client Account Wizard is the production-certified provisioning workflow for
creating client accounts in Sippy. It is in active operational use.

Service Plan and Tariff automation work is in progress elsewhere in the platform
(Company Profile Setup, provisioning diagnostics). That work has surfaced
inconsistencies in the wizard's provisioning path. This document exists so that
those findings are **recorded rather than acted on**, keeping the production
account-creation flow stable while the automation investigation completes.

The rule this encodes: *fix provisioning around the wizard, not inside it.*

---

## 2. Frozen Scope

For the duration of Phase 1, the following must not change:

| Area | Location |
|---|---|
| Wizard UI and step sequence | `client/src/pages/client-wizard.tsx` |
| Wizard API contracts | `POST /api/client-wizard/submit` (`server/routes.ts:27651`) |
| Provisioning sequence and ordering | `POST /api/companies/:id/provision` (`server/routes.ts:27672`) |
| Service Plan selection logic | `server/routes.ts:27698-27723` |
| Tariff creation logic | `server/routes.ts:27727-27777` |
| Account creation flow | `pushAccountToSippy` call path |

This includes the tariff **naming convention**, even though a name string is not
literally a step, contract, or ordering change — it alters production
provisioning behaviour and is therefore in scope. See DEFECT-CP-001 (§4).

> **On line references.** All `file:line` citations in this document are
> accurate as of **2026-07-27**. `server/routes.ts` is a ~37k-line file under
> active development, so these will drift. The **authoritative anchors are the
> endpoint paths and function names**, not the line numbers:
> `POST /api/client-wizard/submit`, `POST /api/companies/:id/provision`,
> `createSippyServicePlan()`, `pushAccountToSippy()`. Re-locate by identifier
> before assuming a citation is stale or a defect is fixed.

---

## 3. Allowed Changes

Permitted without lifting the freeze, provided **observable provisioning
behaviour is unchanged**:

- Bug fixes for defects causing production **failures** (not latent inconsistencies)
- Logging and diagnostics
- Observability, correlation IDs, error classification
- Performance improvements with identical output
- Comment and documentation corrections

**Additive-only** changes to shared helpers are permitted where the wizard's
consumed surface is untouched. Precedent, for consistency of interpretation:

> `createSippyServicePlan()` (`server/sippy.ts`) is shared by both Company
> Profile Setup and the wizard's provision endpoint. Adding an optional
> `reasonCode` field to its return type was treated as **allowed**, because the
> wizard reads only `success` / `planId` / `alreadyExists` /
> `needsManualCreation` / `error`, none of which changed, and no control flow
> was modified. (commit `bc765382`)

Not permitted: any change altering what gets created in Sippy, in what order, or
under what name.

---

## 4. Deferred Items (documented, not implemented)

Recorded during the Service Plan automation investigation. All are **deferred**
under this policy.

### DEFECT-CP-001 — Tariff naming inconsistency

Two provisioning paths use different naming conventions for the same object:

| Flow | Tariff name | Reference |
|---|---|---|
| Company Profile Setup | `Company` | `server/routes.ts:3472` |
| Account Wizard provision | `Company (USD)` | `server/routes.ts:27733` |

The wizard's duplicate check matches on exact lowercase name, so a tariff named
`Nado Telecom` created by Company Profile Setup will not match the wizard's
lookup for `Nado Telecom (USD)`.

**Consequence:** when both workflows are used for the same client — which is the
intended sequence — the wizard creates a second, unlinked tariff. The account is
still assigned the correct Service Plan, so provisioning succeeds; the duplicate
tariff is orphaned, not harmful, and accumulates one per client.

**Approved standard for future work** (not applied in Phase 1): tariff name and
service plan name both = company name; currency and billing cycle are separate
attributes, not part of the identity. Company Profile Setup already conforms.

### DEFECT-CP-002 — "Auto-select" resolves to an arbitrary plan

`server/routes.ts:27714` — when Billing Package is left on
`— Auto-select during provisioning —`, the code assigns:

```js
servicePlanId = String(bpFallback.plans[0].id);
```

This is the first plan returned by Sippy, not a plan related to this client.
The label implies selection logic; there is none.

### DEFECT-CP-003 — Auto-select suppresses dedicated Service Plan creation

`server/routes.ts:27781` — dedicated plan creation is gated on:

```js
if (iTariff && !servicePlanId) { ... }
```

Because DEFECT-CP-002 populates `servicePlanId` whenever any plan exists in
Sippy, this branch is skipped. The per-client tariff created immediately above
is therefore never linked to a Service Plan, and the account is assigned the
unrelated `plans[0]` instead.

Tariff creation (`27727-27777`) runs **unconditionally**, independent of plan
selection — so this produces an orphaned tariff on every run where auto-select
is used.

### DEFECT-CP-004 — Billing cycle constant mislabelled

`server/routes.ts:27787` passes `3` with the comment `// Weekly billing cycle`.
Per `BILLING_CYCLES` in `client/src/pages/company-profile.tsx`, `3` is
**Monthly** (`1` is Weekly). Behaviour and comment disagree; behaviour has not
been verified against Sippy's own enum.

### DEFECT-CP-005 — Inconsistent billing-cycle defaults within one function

`server/sippy.ts` — `createSippyServicePlan()` defaults the same parameter
differently on its two code paths:

- line 7814 (XML-RPC): `billing_cycle: billingCycle ?? 3`
- line 7890 (portal form): `billing_cycle: String(billingCycle ?? 1)`

A caller omitting `billingCycle` gets a different cycle depending on which path
succeeds.

### DEFERRED-CP-006 — Billing Package model redesign

The wizard's single "Billing Package" dropdown conflates two provisioning
models: dedicated billing (tariff + plan per client, typical wholesale) and
shared billing (reuse a standard plan, typical retail). Making the operator's
intent explicit is the proposed resolution for CP-002/003, and is deferred to a
planned redesign.

**Cross-reference — CAP-003 (Finance/Billing capability).** See
`docs/capabilities/CAP-003-FINANCE.md`, which states the layered rule as platform
law: *UI = business concepts only; service layer = operational concepts
(rating, snapshots, Sippy, tariffs); infrastructure = technical concepts.*

That dossier addresses CP-006 directly: the dedicated-vs-shared distinction is
**operator intent — a business concept** — and must be modelled explicitly,
while tariff/plan mechanics stay in the service layer. Any CP-006 redesign must
be reconciled with that rule **before** it is designed, so the same distinction
is not specified twice and differently by the provisioning and Finance
workstreams.

### DEFERRED-CP-007 — Review step omits tariff

Wizard Step 5 (Review & Save) lists the Billing Package but not the tariff that
will be created, so an incorrect name or currency cannot be caught before it
reaches Sippy.

---

## 5. Exit Criteria

This policy may be lifted, in whole or in part, when **any** of the following is
met and explicitly approved:

1. **Service Plan automation investigation concludes** — the root cause of
   automated Service Plan creation falling back to manual is identified
   (`PROVISIONING_NOT_CONFIGURED` / `PROVISIONING_LOGIN_FAILED` /
   `PROVISIONING_PERMISSION_DENIED`) and either resolved or accepted as a
   platform limitation.
2. **Company Profile provisioning is complete and certified** — tariff and
   Service Plan creation is reliable ahead of the wizard, so the wizard can
   consume provisioning results rather than perform provisioning.
3. **A unified provisioning redesign is approved** — covering DEFERRED-CP-006,
   at which point the deferred defects in §4 are addressed together rather than
   incrementally.

Until then, the deferred items remain documented and unimplemented.

---

## 6. Next Action (Phase 1) — RESOLVED 2026-07-27

> **RESULT CAPTURED.** The gating question below has been answered from a live
> run. Findings recorded at the end of this section; the original question is
> left intact for audit.

### Result (live run, 2026-07-27, company "Jamil", tariff 42)

Two independent blockers confirmed, both **Sippy-side, neither in BitsAuto**:

**1. No XML-RPC method for Service Plan creation on this build.** Every
candidate returned `UNKNOWN_METHOD`, including the officially documented
`createServicePlan`:

```
createServicePlan=UNKNOWN_METHOD | addBillingPlan=UNKNOWN_METHOD
addServicePlan=UNKNOWN_METHOD | createBillingPlan=UNKNOWN_METHOD
billing_plan.add=UNKNOWN_METHOD
```

`createServicePlan` is documented as "available since Softswitch 2025", so this
deployment predates it. **API-based Service Plan creation is not available**
until Sippy is upgraded.

**2. Portal INSERT refused.** `reasonCode=PROVISIONING_PERMISSION_DENIED` —
`ssp-root` authenticates to the portal but Sippy rejects the Service Plan
INSERT.

Everything else in the pipeline provisions automatically: Company, Tariff
(ID 42 created in this very run), Account, Routing, Products, Rates, Email.
Service Plan creation is the single non-automated step.

**Correction for the record.** Commit `04a20873` asserted the root cause "was
never credentials or permissions". That was wrong. The missing method name was a
genuine gap, but closing it changed nothing, and the original
`PROVISIONING_PERMISSION_DENIED` classification was correct throughout.

**This vindicates the `blocking=false` design** for the `service_plan` step in
migration 037. Had the step been made a hard gate ahead of account creation as
originally proposed, account provisioning would now be completely broken on this
deployment.

### Open question this hands off to

Whether **any** Sippy account can create a Service Plan through the portal. If
one exists, pointing `SIPPY_PROV_USERNAME` at it restores full automation with
no architectural change. If none does, this is a genuine platform limitation and
Exit Criterion 3 applies. That question is answerable only inside Sippy, not from
this codebase.

---

### Original gating question (retained for audit)

> **This policy is not stasis. It has exactly one open action, and it is the
> gate on its own exit.**

Automated Service Plan creation currently falls back to manual. The
classification (`reasonCode`) that distinguishes a **configuration** problem
from a **Sippy permission limitation** has been instrumented (commit
`bc765382`) but **not yet captured from a live run**.

**Action:** run Company Profile Setup once with a previously unused company
name — a reused name short-circuits on the existing tariff/plan match in
`createSippyServicePlan()` step 0 and never exercises the provisioning path —
and record the returned `reasonCode`.

**Why it gates everything:** the result decides which exit criterion applies.

| Result | Meaning | Exit path |
|---|---|---|
| `PROVISIONING_NOT_CONFIGURED` | Credentials absent from the vault | Criterion 1 — configuration fix |
| `PROVISIONING_LOGIN_FAILED` | Credentials present but rejected | Criterion 1 — configuration fix |
| `PROVISIONING_PERMISSION_DENIED` | Authenticated, INSERT refused by Sippy | Criterion 3 — platform limitation, redesign |

Diagnostics for this are explicitly permitted under §3. Until this single
result exists, any decision about redesigning provisioning is speculation.

### Known architectural gap (recorded 2026-07-27, addressed by migration 036)

Independent of the above: **Company Profile Setup persists nothing.** Its
payload carries no `companyId` and the handler makes no `storage.updateCompany`
call — the tariff and plan IDs are returned in the HTTP response and discarded.
`companies.sippyITariff` exists but is written only by the *wizard's* provision
endpoint, at the end of provisioning. There is no service-plan-ID column on
`companies` at all.

The intended architecture (Company Profile provisions → wizard consumes) is
therefore currently inverted (Company Profile provisions and discards → wizard
re-creates and persists). Making Company Profile Setup's output durable is
additive and freeze-safe; making the wizard *consume* it is not, and requires
either an approved §2 exception or Exit Criterion 2.

**Resolved by migration 036** (commit `9d8ab2b2`) — the persistence half only.
Consumption remains deferred.

---

## 7. State Machine Ownership (platform rule)

Adopted 2026-07-27, prompted by a collision caught during the migration 036
design: the initial proposal reused `companies.provisioning_status` for billing
provisioning. That column is the **wizard's** account state machine, and
`POST /api/companies/:id/provision` returns **409 and refuses to provision**
when it reads `'provisioned'`. A billing action writing it could have blocked
account provisioning outright — from a change that looked purely additive.

> **Rule.** Each subsystem owns its own lifecycle fields. A subsystem must not
> write another subsystem's status column, and must not introduce values outside
> that column's documented vocabulary.

| State machine | Owner | Fields |
|---|---|---|
| Account provisioning | Account Wizard | `provisioning_status`, `provisioned_at`, `provisioned_by`, `sippy_i_account` |
| Billing provisioning | Company Profile Setup | `billing_provision_status`, `billing_provisioned_at`, `billing_provision_reason_code`, `billing_provision_error`, `billing_provision_trace_id`, `sippy_i_billing_plan`, `sippy_billing_cycle`, `sippy_tariff_currency` |
| Rate provisioning | Rate Management | *not yet catalogued* |
| Routing provisioning | Routing Manager | *not yet catalogued* |

The last two rows are deliberately marked uncatalogued rather than guessed. The
table becomes authoritative only once their fields are identified from code.

`sippy_i_tariff` is currently written by **both** owners (the wizard at the end
of account provisioning; Company Profile Setup on success). This is shared by
design — it is an object reference, not a lifecycle state — but is noted here so
it is not mistaken for a violation.

### VIOLATION-SM-001 — Company Onboarding writes the wizard's status column

`client/src/pages/company-onboarding.tsx` (~line 394) issues
`PUT /api/companies/:id` with `provisioningStatus` set to `"draft"` or
`"active"`.

Two problems under the rule above:

1. It is a **different subsystem** writing the Account Wizard's lifecycle field.
2. `"active"` is **not in that column's vocabulary.** The values the wizard's own
   code produces and gates on are `draft`, `pending_provision`, `provisioned`,
   and `imported`. Every gate tests `=== 'provisioned'`, so a company left in
   `"active"` is treated as *not provisioned* by the wizard.

Whether that is the intended effect has **not** been determined — it predates
this policy and its consequences are untraced. Recorded for review, **not**
scheduled for a fix here: `company-onboarding.tsx` is outside this policy's
scope (§2), and changing status semantics could alter wizard gating, which is
exactly what §2 forbids. Assess before the next provisioning phase.
