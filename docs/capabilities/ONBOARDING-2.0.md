# Onboarding 2.0 — Automated Customer Onboarding

**Status:** DESIGN FROZEN (owner, 2026-07-28). No code written. Implementation follows the
milestones in §9; changes to the principles below need a fresh owner decision, not an
in-flight adjustment.
**Date:** 2026-07-28

## 0. Frozen principles

1. **One source of truth** — BitsAuto is master. Wizard → draft → admin provision → Sippy.
   Nothing exists in Sippy until Provision.
2. **The wizard prepares, it never writes to Sippy.** KAM, NOC and Commercial can all run
   it; only Admin changes the production switch.
3. **Everything becomes defaults** — one backend profile, not 50 exposed telecom fields.
4. **Routing is a package**, not hardcoded countries in provisioning logic.
5. **Provision is a logged pipeline** with per-stage status and retry-from-stage.
6. **No manual Sippy work after Provision** — any remaining human step is automated or
   explicitly documented as a platform limitation.
7. **The Provisioning Matrix (§3.3) is the automation contract**, written before code.
**Supersedes (on completion):** the split flow of Company Profile Setup → Company Create → Client Wizard → manual provision.

## 1. The principle

**BitsAuto is the system of record. Sippy is a background provisioning service.**

The operator thinks in customers. Tariffs, service plans, routing groups, auth rules and
billing packages are implementation detail that the platform manages on their behalf. After
the operator clicks **Provision**, no human logs into Sippy — not to copy a username, not to
pick a routing group, not to assign a service plan, not to enable traffic.

This is the same layering rule CAP-003 states for Finance: UI carries business concepts,
the service layer carries operational ones. See [CAP-003](CAP-003-FINANCE.md).

## 2. Why now

Service Plan automation was proven end to end on 2026-07-28 (tariff + service plan created
via the portal path, id read back from Sippy's own redirect). That was the last unproven
link. Everything else in the chain already exists as working code — see §5.

## 3. Two phases, one engine

**Phase 1 — Client Wizard 2.0.** Keep the wizard operators already know; automate what sits
behind it. Improving a production workflow, not replacing it.

**Phase 2 — AI one-page onboarding.** Only after the engine is proven. The wizard then
becomes the manual fallback.

Both surfaces produce the **same Provisioning Draft**, so there is one engine to maintain:

```
Client Wizard  ─┐
                ├─→  Provisioning Draft  →  Provisioning Engine  →  Sippy
AI One-Pager   ─┘
```

**Governance rule for phase 2:** the AI interprets input and populates a draft. It never
touches the switch. The engine stays deterministic and rule-based, so provisioning remains
auditable and reproducible — an AI that could vary the switch configuration between
identical inputs is not something we can certify.

### 3.1 Phase 1 — the wizard PREPARES, it does not provision

**The wizard is a Customer Preparation Wizard. It performs zero writes to Sippy.**

This is the load-bearing rule. KAM, NOC and Commercial can all run the wizard (§6), so if
any wizard step created a tariff or a service plan, those roles would be writing to the
production switch — which the permission matrix forbids. Preparation and execution must be
cleanly separated, or the admin-only gate is theatre.

```
KAM / NOC / Commercial          ADMIN ONLY
   prepare customer      →      Provision      →   Completed
   (no Sippy writes)            (all Sippy writes)
```

Same five steps, same navigation, same UX. **What changes is the backend behind each step**
and what the operator is asked.

| Step | Remove from UI | Operator still enters | Backend does (no Sippy) |
|---|---|---|---|
| 1 Company | **Tariff · Service Plan · Billing Package** | name, short code, type, department, country, currency, KAM | validate uniqueness, reserve name, open draft |
| 2 Commercial | most billing fields | overrides only | apply payment term from company type + profile defaults |
| 3 Technical | codec, media relay, CPS, sessions | IPs, SIP port, transport, auth mode | generate authentication / routing / security profile |
| 4 Products & Routing | per-group routing assignment | product choice if overriding | resolve product + routing package, stage IP registration and notifications |
| 5 Review | — | — | show **provision readiness**, not entered values |

Step 5 reads as a readiness check — `✓ Company · ✓ Commercial · ✓ Technical · ✓ Routing ·
✓ Products · ✓ Notifications · ✓ Validation → **READY FOR PROVISION**` — and the Provision
button is visible only to admins.

### 3.1.1 Sprint 2 objective — stated precisely

> **Replace every Sippy-specific field in the wizard with backend defaults, while
> preserving the business information required to operate the customer after
> provisioning.**

The goal is **zero manual Sippy work**, *not* minimal fields. Those are different
objectives and conflating them loses data the business needs. Remove technical
complexity; keep business information.

| | Category | Disposition |
|---|---|---|
| **A** | **Required by the business** — company name, customer type, KAM, authentication type, customer IP(s), primary / technical / billing contacts | **Keep in UI** |
| **B** | **Required by the process** — department, sales/CRM reference, account status (draft/ready/active), internal notes, testing contact, time zone | **Keep in UI** |
| **C1** | **Commercial contract** — payment term, billing cycle, grace period, dispute policy, currency | **Keep in UI, pre-filled from the profile, editable** |
| **C2** | **Financial controls** — credit limit, balance, threshold, auto-recharge, credit adjustments | **Remove — owned by Finance / Balance Management** |
| **D** | **Provisioning objects** — tariff, service plan, product package, routing package, notification profile | **Remove — profile-only, never in the UI** |
| **E** | **Operational network controls** — codec, media relay, max CPS, max sessions, routing group, traffic status, authentication | **Remove from wizard — NOC/Admin manage these post-provision (§3.1.3)** |

### The line between C and D

**Commercial terms are contract terms, not switch settings.** They legitimately vary per
customer: one wholesale customer invoices weekly and another monthly; a trusted carrier
carries a USD 10,000 credit limit rather than USD 2; a retail customer is prepaid with no
credit at all. Removing them would force those agreements into side channels — email and
spreadsheets — which is the practice this program exists to end.

So the profile **pre-fills** them and the operator **may override**:

| Field | Default | Editable in wizard |
|---|---|---|
| Payment term | derived from company type (Wholesale → Postpaid · Retail → Prepaid) | ✅ |
| Billing cycle | Weekly (7 days) — also **Bi-Weekly (14)** and **Monthly** | ✅ |
| Grace period | 3 days | ✅ |
| Dispute policy | USD 100.00 or 1% | ✅ |
| Currency | company default | ✅ |
| **Credit limit** | USD 2.00 applied by the profile | ❌ **Finance only** |

**Credit limit is deliberately not editable here.** Balance Management already owns credit
limit, balance, threshold, alerts, recharge and adjustments. Exposing it in the wizard as
well would create two places to change one number, and the first question after any
discrepancy is "which one is real?". The profile applies the default at provision; Finance
changes it thereafter. The company card may *display* it with a link to Balance
Management, but never edit it.

Category D stays profile-only. Changing a codec or a routing package for one customer is a
platform decision made by editing the profile — not a per-customer choice, because the
operator has no basis on which to make it and DEFECT-CP-002 shows what happens when a
control offers a choice with no logic behind it.

**Rule of thumb:** if a salesperson could negotiate it, it belongs in the wizard. If only an
engineer could justify it, it belongs in the profile.

**Why category A is not shrunk to four fields.** The day a customer reports a problem,
KAM, Finance and NOC each ask: who is the billing contact, who receives invoices, who
receives rate changes, who is the technical contact, who owns the account. Information not
captured at onboarding gets recollected later by email and spreadsheet — which is the
practice this program exists to end. Shrink further only with real usage data showing a
field is unused.

Removing category C also deletes a control that invited a choice with no logic behind it —
DEFECT-CP-002 exists precisely because "Auto-select" had no selection rule.

### 3.1.3 Operations panel — post-provision, on the company card

Category E settings change *after* onboarding and have nothing to do with the commercial
agreement: a customer upgrades 10 → 20 CPS, buys 100 concurrent ports, needs a codec
changed for interoperability, or media relay adjusted for NAT. None of that should require
re-running the onboarding wizard, and none of it is a sales decision.

The **Company List becomes the operational control centre.** Each card gains a focused
Operations surface rather than sending operators back through the wizard:

```
Operations                     Manage ▾
  Approved IPs      2            · Manage IPs
  Max CPS          10            · Traffic limits (CPS / sessions)
  Max sessions     10            · Authentication
  Routing          Wholesale Default   · Routing
  Traffic          🟢 Enabled     · Suspend / Resume traffic
  Auth             IP             · Re-sync to Sippy   (Admin)
                                  · Provision          (Admin)
Finance
  Credit limit     USD 2.00      → Open Balance Management   (no edit here)
```

Changes to a provisioned company queue an update to Sippy and write an audit entry. Values
are validated before dispatch — the platform must not send a session limit it has not
checked.

### 3.1.2 Notification recipients — a matrix, not a field per type

Separate fields for invoice email, balance alert email, traffic trend email and rate
notification email mean a schema change every time a notification type is added. Model it
as recipients × subscriptions:

```
Email                Notifications
noc@abc.com          ☑ traffic_trend  ☑ fraud_alert
billing@abc.com      ☑ invoice        ☑ balance_alert
kam@abc.com          ☑ rate_notification  ☑ welcome
tech@abc.com         ☑ system
```

**Schema note (first Sprint 2 item):** `notification_profiles` from migration 038 holds the
*platform default* set of events. Per-customer recipients are different data and need a
`company_notification_recipients` table — `(company_id, email, event_key)`. The profile
says which events exist and default on; the recipient rows say who receives them for a
given customer. Both are required; neither substitutes for the other.

**Tariff, Service Plan and Billing Package leave the UI entirely.** They are provisioning
objects, not business objects; the operator should not know they exist. This is also what
makes the wizard honest — those dropdowns currently invite a choice that the platform is
better placed to make, and DEFECT-CP-002 exists precisely because a "choose one" control
had no selection logic behind it.

**Step 5 shows intent, not input.** `Company ✓ · Tariff ✓ auto · Service Plan ✓ auto ·
Authentication ✓ · Routing ✓ · Products ALL · Email ✓ · Traffic BLOCKED until provision`.

**Draft-until-finish.** Steps write only to a draft; records are created at provision time,
so an abandoned wizard leaves no half-built customer. (Tariff and service plan from step 1
are the exception — they exist already and are idempotent, reused by name on a later run.)

## 3.2 Configuration-driven engine — three tables, not scattered constants

Defaults live in the database, never in provisioning code. The engine is
configuration-driven: change a business default by editing a row, not by touching the
pipeline.

**Three separate tables**, because they vary independently — a routing package is reused
across several provisioning profiles, and duplicating it per profile would guarantee drift:

```
Customer
   │
   ▼
Provisioning Profile ──┬── billing defaults          (Standard Wholesale / Retail / Carrier / Enterprise)
                       ├──→ Routing Package          (Default Wholesale / Premium / Retail / Carrier)
                       ├──→ Notification Profile     (Welcome / Billing / Low Balance / Technical)
                       └── product package
   │
   ▼
Admin Provision Engine  →  Sippy
```

| Table | Holds | Example rows |
|---|---|---|
| `provisioning_profiles` | billing + technical defaults, FK to routing package and notification profile | Standard Wholesale · Standard Retail · Carrier · Enterprise |
| `routing_packages` | country → product routing sets | Default Wholesale · Premium Wholesale · Retail · Carrier |
| `notification_profiles` | which emails fire and their templates | Welcome · Billing · Low Balance · Technical Alerts |

Countries are **never hardcoded in provisioning logic** — adding Sri Lanka to the default
package is a routing-package edit, not an engine change.

**Standard Wholesale profile (owner-specified 2026-07-28):**

| Setting | Default |
|---|---|
| Trunk / product package | **ALL** |
| Credit limit | USD 2.00 |
| Billing cycle | Weekly (7 days) |
| Grace period | 3 days |
| Dispute value | USD 100 or 1% |
| Payment term | **derived from company type** — Wholesale → Postpaid · Retail → Prepaid |
| Codec preference | Auto |
| Media relay | Default |
| Max CPS | 10 |
| Max sessions | 10 |
| Invoice template | Default |

**Routing package:**

| Country | Products |
|---|---|
| Pakistan | First Class · Business Class · Special Bravo · Special Charlie |
| India | First Class · Business Class · Special Bravo · Special Charlie |
| Bangladesh | First Class · Business Class · Special Bravo · Special Charlie |

Extends to the full destination catalogue later; the operator still sees a business-level
choice, or none at all when ALL is standard.

**Never asked again, in any surface:** tariff id, service plan id, billing plan id, parent
customer id, Sippy customer id, routing rule ids, codec ids, product ids, database ids,
internal UUIDs, XML-RPC ids. These are for the engine to resolve.

## 3.3 Provisioning Matrix — the automation contract

One authoritative table for what is automatic, what has a default, what may be overridden,
and **when it is applied**. Write this before any code; disagreements surface here cheaply
and in the implementation expensively.

| Item | Source | Default | Override | Applied at |
|---|---|---|---|---|
| Tariff | Backend | auto-create | ❌ | **Provision** |
| Service Plan | Backend | auto-create | ❌ | **Provision** |
| Sippy account | Backend | auto-create | ❌ | **Provision** |
| Product package | Provisioning Profile | ALL | ✅ | Provision |
| Payment term | Company type | Wholesale → Postpaid · Retail → Prepaid | ✅ **in wizard** | Provision |
| Credit limit | Provisioning Profile | USD 2.00 | ✅ **in wizard** | Provision |
| Billing cycle | Provisioning Profile | Weekly (7) · Bi-Weekly (14) · Monthly | ✅ **in wizard** | Provision |
| Grace period | Provisioning Profile | 3 days | ✅ **in wizard** | Provision |
| Dispute value | Provisioning Profile | USD 100 or 1% | ✅ **in wizard** | Provision |
| Currency | Company | company default | ✅ **in wizard** | Provision |
| Codec | Provisioning Profile | Auto | ✅ | Provision |
| Media relay | Provisioning Profile | Default | ✅ | Provision |
| Max CPS | Provisioning Profile | 10 | ✅ | Provision |
| Max sessions | Provisioning Profile | 10 | ✅ | Provision |
| Invoice template | Provisioning Profile | Default | ✅ | Provision |
| Routing package | Provisioning Profile | PK / IN / BD × FC·BC·SB·SC | ✅ | Provision |
| Authentication (IP rules) | Wizard input | — | ✅ | **IP approval** |
| Traffic enable | Policy | blocked | ❌ | **IP approval, admin only** |

Every row's "Applied at" is Provision or later. **Nothing in this matrix is applied during
the wizard** — that is the same rule as §3.1, stated per field so it cannot drift.

## 4. The provisioning pipeline

One stage per concern. Each receives the previous stage's output, writes its status to
`provisioning_jobs`, and **retry resumes from the failed stage** rather than restarting.

```
Provision
   ├── 1 Authentication      create Sippy account (pushAccountToSippy)
   ├── 2 Routing             addRoutingGroup + addRoutingGroupMember from template
   ├── 3 Products            customer_product_assignments (FC/BC/SB/SC)
   ├── 4 Rates               push product rates to the tariff created in step 1
   ├── 5 Service Plan        assign the plan created in step 1 — ids already known
   ├── 6 Email               welcome + credentials + connection details
   ├── 7 IP approval request raised to admin
   └── 8 Traffic             REMAINS BLOCKED
```

**Traffic is the last gate and it is not automatic.** Everything above may exist —
authentication, routing, rates, products — while the customer still cannot pass live
traffic. Enforced in Sippy (`max_sessions=0`) rather than only in BitsAuto state, so the
block is real on the switch. Traffic is enabled **only** when an admin approves the IP.

**Every stage logs** to `provisioning_jobs`: started · completed · failed · retry count ·
duration · result. Without duration and retry count, a stage that succeeds on the third
attempt after 40 seconds is indistinguishable from one that succeeded immediately — and
that difference is exactly what predicts the next production incident.

Failure display is per stage, not a single verdict:

```
Authentication ✓   Routing ✓   Products ✓   Rates ✗   Email —   Traffic Blocked
                                                   [ Retry from Rates ]
```

### No manual Sippy work — and no silent gaps

After Provision, nothing may require a human in Sippy: not tariff, service plan,
authentication, routing, product assignment, rate upload, or traffic enablement.

**Any step that still needs a human is either automated or explicitly recorded here as a
platform limitation.** It is never left as an undocumented manual habit — that is precisely
how the Service Plan step stayed manual for weeks while appearing to be "how it works".

## 5. Foundation — verified 2026-07-28, not assumed

Present and working: `pushAccountToSippy`, `addSippyAuthRule`, `addRoutingGroup`,
`addRoutingGroupMember` (all in `server/sippy.ts`); tables `routing_templates`,
`provisioning_jobs`, `ip_sharing_approvals`, `client_ip_requests`,
`customer_product_assignments`, `smtp_sender_profiles`; `companies.provisioningStatus` /
`provisionedAt` / `sippyIAccount`; auth rules already auto-create on IP approval; tariff +
service plan creation proven end to end.

Gaps to build: company-name and email uniqueness validation · routing templates are empty
and never applied · no automatic rate push after account creation · no destination package
assignment · no onboarding email · no enforced traffic block · `provisioning_jobs` never
written · no per-stage progress UI · no internal-IP whitelist UI · no single-submission flow.

**The foundation is roughly two-thirds built. This is wiring and sequencing, not new
invention** — which is why it is worth doing as one coherent redesign rather than another
increment on the split flow.

## 6. Permissions (frozen — owner, 2026-07-28)

**Maker–checker.** Operational teams prepare customers; only admins touch the production
switch.

**Governing rule:** *KAM prepares and monitors; NOC operates the live account; Admin alone
touches production provisioning.* KAM's authority ends when the company is created — after
that they have **read-only** visibility, which is what they need to answer a customer's
question without being able to change live service behaviour.

**Preparation — before the company exists**

| Function | Admin | NOC | KAM | Commercial | Finance |
|---|:--:|:--:|:--:|:--:|:--:|
| Create company · run wizard · save draft | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit company (pre-provision) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage contacts · upload/assign rates | ✅ | ✅ | ✅ | ✅ | ❌ |
| Submit IP request · run pre-provision checks | ✅ | ✅ | ✅ | ✅ | ❌ |

**Operations — after the company exists (§3.1.3)**

| Function | Admin | NOC | KAM |
|---|:--:|:--:|:--:|
| View technical settings, IPs, routing, limits | ✅ | ✅ | ✅ **read-only** |
| Manage approved IPs | ✅ | ✅ | ❌ |
| Change max CPS · max sessions | ✅ | ✅ | ❌ |
| Change codec · media relay · authentication · routing | ✅ | ✅ | ❌ |
| Suspend / resume traffic · reset SIP password | ✅ | ✅ | ❌ |
| Change billing cycle · payment term · grace period | ✅ | ✅ | ❌ |
| Change notification contacts | ✅ | ✅ | ❌ |
| **Approve IP** | ✅ | ❌ | ❌ |
| **Provision to Sippy** | ✅ | ❌ | ❌ |
| **Re-sync to Sippy** | ✅ | ❌ | ❌ |
| **Retry failed provision · delete live account** | ✅ | ❌ | ❌ |

Credit limit appears in neither table — it is Finance's, via Balance Management.

NOC has the same *preparation* rights as KAM because they onboard during 24×7 operations,
and broader *operational* rights afterwards; neither has activation authority. Re-sync is
admin-only alongside provision: both push local state onto the production switch, and the
distinction between them is invisible from the switch's side.

**Enforced server-side, not by hiding buttons.** `POST /api/companies/:id/provision` and the
IP-approval endpoint must reject non-admin callers even when the endpoint is called
directly. UI role-gating is presentation, never the control.

## 7. Validation before creation

- **Company name** unique, case-insensitive.
- **Email** unique across companies.
- **Customer IP** must not conflict with any provisioned company's approved IPs —
  block with the conflicting customer named, e.g. *"116.202.233.93 already in use by
  ABC Telecom"*.
- **Internal whitelist bypass**: predefined internal IPs skip the conflict check
  (`ip_sharing_approvals`), managed from Settings.

This replaces the current email round-trip to NOC asking whether a name or IP conflicts.
The answer becomes a green/red field in the form, resolved before submission.

## 8. Documents become outputs, not inputs

Today the Interconnect Form is an Excel file a human fills and emails. Under 2.0 the wizard
holds that data and **generates** the Interconnect Form as a PDF for customer signature.
The spreadsheet stops being a data-entry step.

## 9. Milestones (owner sequence)

**0. Provisioning Matrix** (§3.3) agreed and frozen — the contract everything else builds to.

**1. Backend defaults.** Create the Provisioning Profile table + seed the standard profile.
Remove Tariff / Service Plan / Billing Package from the wizard UI. Apply defaults in the
backend. *No change to how provisioning executes.*

**2. Wizard automation.** Wizard UI, steps and navigation unchanged; the backend behind each
step now produces a complete **Ready for Provision** draft. Add name/email/IP validation
with the internal whitelist bypass, naming the conflicting record.

**3. Admin provision engine.** Admin-only. Executes the full pipeline (§4) end to end with
per-stage status in `provisioning_jobs` and retry-from-stage. No manual Sippy work remains.

**4. AI one-page onboarding.** Reuses the same engine. Replaces the wizard as the primary
surface only once the engine is proven; the wizard stays as manual fallback.

Milestones 0–2 are safe alongside current operations — they change what the wizard *asks*
and *stores*, not what it *does to Sippy*. **Milestone 3 changes live provisioning
behaviour** and takes the governed-change route used for `createSippyServicePlan`
(see [ACCOUNT-WIZARD-GOVERNANCE-PHASE1](../ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md)).

## 9.1 Configuration layers — frozen at four

Configure the platform once; configure a customer only when they are an exception.

| Layer | Object | Configured by | In the wizard? |
|---|---|---|---|
| 1 | **Provisioning Profile** — business + technical defaults | Admin, once | ❌ (commercial fields pre-filled from it) |
| 2 | **Routing Package** — country × product | Admin, once | ❌ |
| 3 | **Notification Profile** — event → sender + contact roles | Admin, once | ❌ |
| 4 | **Customer** — company, contacts, authentication, commercial terms | Operator, per customer | ✅ |

Plus `company_notification_recipients` for exceptions and `company_provisioning_snapshot`
for the audit record.

**No further configuration tables** until Sprints 2 and 3 are running and operational
experience shows a need. Authentication Profile and Fraud Profile are plausible fifth and
sixth layers and are deliberately **not** built now — adding them before the engine runs
would be designing against speculation rather than usage.

This is also what makes the phase-2 AI tractable: it never needs to understand 200 Sippy
settings, only to select the right profiles. Wholesale → Standard Wholesale + Wholesale
Default + Standard Notifications. Deterministic, auditable, explainable.

## 10. Open — needed before milestone 1 is final

The **Interconnect Form** (`Voxonex telecom LLC_Interconnect Form R.xlsx`) and the **IP
confirmation email** are the authoritative field sources for steps 2, 3 and 6. They could
not be read from `~/Downloads` (blocked by macOS privacy protection for this process), so
the field lists in §3 come from the owner's summary and are **unverified against the
documents**. Place both files inside the repo or the session scratchpad and the field lists
should be reconciled against them before the wizard is built.
