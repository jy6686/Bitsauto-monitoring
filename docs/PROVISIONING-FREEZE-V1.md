# Provisioning Engine — Freeze v1.0

**Declared 2026-07-31 by the owner. Stages 1–5 of the provisioning engine are frozen. Do not change the files listed below without an approved impact assessment.**

A freeze is about change, not about correctness. These stages are frozen because they now behave correctly against the live switch and every further edit is a new variable. Read the *Evidence* column before assuming any of it is proven — one claim in this document is deliberately weaker than the others.

---

## Frozen

| Area | Files | Evidence |
|---|---|---|
| **Tariff** | `steps/tariff.step.ts` | Created and reused against Sippy. Run `PROV-20260731-YZGPQA`: `Reused existing tariff "Test-312" (i_tariff=65)`. |
| **Service Plan** | `steps/service-plan.step.ts` | Created and reused: `i_billing_plan=35`. Portal fallback path unchanged. |
| **Customer Account** | `steps/account.step.ts` | Created, reused, and **read back**. Mismatched plan detected (`actual=1, expected=35`), patched via `updateAccount`, re-read and confirmed. Sippy's own account list shows `test-312` on plan `Test-312`. |
| **Authentication & IP Authorisation** | `steps/authentication.step.ts`, `auth-rule-set.ts`, `account-prefix.ts` (`buildAuthRuleFields`) | 12 rules created, **12 of 12 verified** — CLD and translation from `listAuthRules`, routing group from `getAuthRuleInfo`. CLDs byte-identical to the planner across the full 4×3 matrix. |
| **Routing resolution** | `routing-group.ts`, `migrations/050_routing_group_mapping.sql` | All 12 `routing_package_entries` mapped. Each rule carries the group the matrix specifies, confirmed per rule. |
| **Capacity** | `steps/capacity.step.ts` | `max_sessions=10, max_calls_per_second=10` applied and read back. |
| **Runner contract** | `runner.ts`, `types.ts` | Additive changes only — a new optional field on `StepOutcome`/`VerifyReport` is allowed; changing the meaning of an existing one is not. |
| **Migration runner** | `server/migrate.ts`, `server/schema-contract.ts` | Recovered a database stranded for weeks and applied 049–056 in one run. |

### The one claim that is weaker

**Routing is verified, not certified.** Every rule carries the routing group the matrix specifies and Sippy confirms it per rule. That proves the *configuration* is right. It does not prove a call traverses that group — only a CDR does, and no live call has been placed.

Sippy's own dialplan test on `test-31` returned `Routing Group: Pakistan First Class` from the matched auth rule, which is strong independent evidence. It is still a simulation.

Do not describe stage 5 as certified until a CDR says so.

---

## Active — still under development

| Area | Files |
|---|---|
| Upload Rates | `steps/rates.step.ts` |
| Rate matrix and workbook | `services/rates/*` |
| Rate upload transport | `sippy.ts` → `uploadRatesWorkbook`, `getUploadToken`, `resolveUploadType` |
| Final provisioning validation | — |
| Rollback and retry | `ProvisioningStep.rollback` (declared, not wired) |

---

## Known defects inside frozen areas

A freeze must not lock in a bug silently. These are approved to fix, and the fix does not need a fresh assessment — this section is the approval.

1. **`auth-rule-set.ts` hardcodes two lookup tables.** `PRODUCT_DIGIT_BY_NAME` and `COUNTRY_CODE` are literal maps. A fifth product, or any country not in the list, becomes a gap and blocks the whole authentication stage for every company that sells it. Both values already exist as platform data (`product_registry.trunk_prefix`, the destination catalogue). Replace the maps with reads.

2. **`failures[].cause` is both a grouping key and prose.** In `authentication.step.ts` the cause string is interpolated into the operator-facing sentence, so rewording it for readability breaks analytics grouping — the exact hazard `PROVISIONING-STEP-METRICS.md` warns about. Make the key stable and separate from the wording.

3. **`storage.ts:889` hardcodes production Sippy credentials in plaintext** and seeds `portalUrl` to a customer's IP rather than the switch. Rotate the credentials on the switch, move them to deployment secrets, correct the URL. They are in git history, so deleting the lines is not sufficient.

4. **Remaining `as any` casts in the provisioning path.** Three separate bugs in one session were each a field passed under a name nothing reads — `iBillingPlan` for `servicePlan`, `maxCalls` for `maxCallsPerSecond`, `input.companyId` for `companyId`. Every one would have been a compile error without the cast. Sweep the path and remove them.

---

## Change control

Frozen files accept **critical bug fixes, security fixes and compatibility fixes only**. No features, no refactoring, no optimisation, no cleanup.

Any change to a frozen file carries this, in the commit message:

```
Freeze area:  <which one>
Reason:       <the defect, and how it was observed — not "improves X">
Impact:       schema / API / UI — state each, or "none"
Evidence:     what proves the fix works
```

"Observed" means a run, a log line, a CDR or a screenshot. A code reading is a hypothesis; this project has had three plausible hypotheses turn out to be about code that was not running.

### Next after the call: split the handover into two emails

Specified by the owner 2026-07-31. Stage 7 becomes **Handover**, with two sends instead of one.

| | Technical Handover | Commercial Handover |
|---|---|---|
| To | support, NOC | commercial |
| Carries | SIP username **and password**, authorised IPs, prefixes, CLD translation, routing package, auth rules, provision id | company, account, portal URL, username, currency, service plan, tariff |
| Never carries | — | **no SIP password, no auth rules, no routing detail** |

**This closes a real defect.** The single email today includes a Password row and goes to
`technical, support, noc, commercial` — so a commercial contact receives the SIP password.
It is currently LATENT: nothing generates an account password, so the row renders
"Provided separately by our NOC team" and no credential ships. It becomes a live exposure
the moment password generation lands, so **the split must land before or with that work**,
not after it.

Recipients come from `notification_profile_events`, which already stores comma-separated
contact roles per event key and resolves them against the company's contacts at send time.
Two keys — `handover.technical`, `handover.commercial` — and the roles become configuration
rather than a hardcoded list in the email service. No address is ever requested during
provisioning; the Create Company wizard remains the single source.

Readiness gains four checks, all warnings rather than blocks: commercial contact email,
support contact email, NOC contact email, SMTP configured. Provisioning continues without
them and the Handover stage reports exactly which send happened and which did not.

### Explicitly out of scope until a call completes

Bundle splitting and lazy loading · repo weight (the 444 MB LFS object, `attached_assets/`) · the enriched per-rule routing report · authentication workbook upload as a second provisioning backend · severity classes for startup checks · Edit-as-management-page (Phase 2).

All are real. None are worth invalidating a certified build for.

---

## What lifts the freeze

The owner's Definition of Done, unchanged:

1. Provisioning finishes
2. Auth rules exist in Sippy
3. Routing groups verify
4. Rates upload, or correctly report skipped
5. A real SIP call authenticates
6. The call routes through the **expected** routing group
7. Rating matches the uploaded tariff

1–4 hold today. 5 and 6 need one call. 7 needs the 128 prices first — the rates step correctly skips while `product_rates` is empty, so an unpriced tariff rates at zero.
