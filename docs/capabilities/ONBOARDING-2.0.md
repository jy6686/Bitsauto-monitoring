# Onboarding 2.0 — Automated Customer Onboarding

**Status:** SPEC — awaiting owner sign-off. No code written.
**Date:** 2026-07-28
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

## 3. The wizard

Replaces "Company Profile Setup" (name it **Create New Customer**). Every step carries the
company name forward; it is typed once.

| # | Step | Contents | Side effects |
|---|---|---|---|
| 1 | Customer | name, short code, country, currency, company type, contract type, KAM, department | validate uniqueness · **create tariff + service plan (invisible)** |
| 2 | Corporate | address, phone, fax, website, primary contact + designation + mobile + email, billing contact + email | draft only |
| 3 | Technical | Internet/MPLS, softswitch, gateway, SIP IP, backup IP, tech prefix, dial pattern, SIP port, codec, fax support, RFC2833, DTMF, protocol, transport | draft only |
| 4 | Routing | routing template, inbound/outbound, products (First Class / Business / Special Bravo / Special Charlie), destination package (Top 3 / Top 5 / custom) | draft only |
| 5 | Authentication | username, password, IP auth, registration, prefix, capacity, max calls — **generated, operator reviews** | draft only |
| 6 | Testing | per-destination test grid (Pakistan, India, Bangladesh, UK, USA, …) with Pass / Fail / Retest | draft only |
| 7 | Review | full summary of everything above | draft only |
| 8 | Finish | — | **runs the provisioning pipeline (§4)** |

**Step 1 behaviour.** On Next, provisioning runs silently. On success the wizard advances
with no interstitial screen. On failure it offers **Retry** or **Continue in manual mode** —
it never dead-ends the operator.

**Draft-until-finish.** Steps 1–7 write only to a draft. Company, auth, products, rates and
notifications are created at **Finish**. An abandoned wizard leaves no half-built customer.
(Exception: the Sippy tariff and service plan from step 1 already exist — they are
idempotent and reused by name on a later run.)

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

Failure display is per stage, not a single verdict:

```
Authentication ✓   Routing ✓   Products ✓   Rates ✗   Email —   Traffic Blocked
                                                   [ Retry from Rates ]
```

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

| Function | Admin | NOC | KAM | Commercial | Finance |
|---|:--:|:--:|:--:|:--:|:--:|
| Create / edit company | ✅ | ✅ | ✅ | ✅ | ❌ |
| Run the wizard, save draft | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create tariff / service plan | ✅ | ✅ | ✅ | ✅ | ❌ |
| Submit IP request | ✅ | ✅ | ✅ | ✅ | ❌ |
| Run pre-provision checks | ✅ | ✅ | ✅ | ✅ | ❌ |
| View provision status | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Approve IP** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Provision to Sippy** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Retry failed provision** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Delete live Sippy account** | ✅ | ❌ | ❌ | ❌ | ❌ |

NOC has the same preparation rights as KAM — they onboard during 24×7 operations — but no
activation authority.

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

## 9. Milestones

1. **Wizard shell** — 8 steps, draft model, name carried through, provisioning invisible at step 1.
2. **Validation** — name/email/IP uniqueness + internal whitelist, with the conflicting record named.
3. **Pipeline** — stages 1–8 against `provisioning_jobs`, retry-from-stage, per-stage UI.
4. **Routing templates** — schema fields, CRUD, Settings UI, one seeded default.
5. **Email + documents** — onboarding template, recipients (customer / CC KAM + NOC), generated Interconnect Form.
6. **Permissions** — server-side admin gate on approve/provision/retry/delete; role-aware company cards.

Sequence note: milestones 1–2 are safe alongside current operations. Milestone 3 changes
live provisioning behaviour and should follow the governed-change route used for
`createSippyServicePlan` (see [ACCOUNT-WIZARD-GOVERNANCE-PHASE1](../ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md)).

## 10. Open — needed before milestone 1 is final

The **Interconnect Form** (`Voxonex telecom LLC_Interconnect Form R.xlsx`) and the **IP
confirmation email** are the authoritative field sources for steps 2, 3 and 6. They could
not be read from `~/Downloads` (blocked by macOS privacy protection for this process), so
the field lists in §3 come from the owner's summary and are **unverified against the
documents**. Place both files inside the repo or the session scratchpad and the field lists
should be reconciled against them before the wizard is built.
