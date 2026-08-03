# CAP-022 — Vendor Targeting & Controlled Route Selection

**Status:** STUDY — open. Resolves the last architectural dependency in [CAP-021](CAP-021-SINGLE-CALL-VALIDATION-ENGINE.md) §12.
**Governed by:** CAP-021 v1.0 (architecture baseline). This document does not redefine validator behaviour, evidence contracts or execution semantics — it determines how `VAL-005 Routing intent` becomes enforceable.
**Blocks:** L2B controlled comparison · true vendor attribution · route and vendor certification · AI test profiles · BMEE test execution semantics.
**Type:** Sippy architecture study, not a coding task. It ends in a verification plan and a recommendation, not an implementation.

---

## 1. The problem

`server/services/route-tester.ts:118` iterates `job.vendorIds` and sends an **identical**
call on every iteration:

```
sippy.makeTestCall(username, password, { cli, cld, maxDuration: 10 })
```

No parameter targets a vendor. LCR selects, and the code then reads back
`result.actualVendorName` and records `_vendorMismatch` in `route_test_results.rawResponse`
(`route-tester.ts:150`).

> Today the platform answers *"who did Sippy choose?"*. Every capability in CAP-021 that
> depends on attribution needs it to answer *"how did Vendor B perform?"*. Those are
> different questions, and no amount of downstream analysis converts one into the other.

---

## 2. Mechanism inventory

Verified against `server/sippy.ts`. **"Wrapped"** means BitsAuto already calls it;
**"switch-side unknown"** means the mechanism exists in Sippy but this platform has never
exercised it and it must be probed before being relied on.

| Mechanism | Sippy concept | Status in BitsAuto | Notes |
|---|---|---|---|
| **Routing group** | `i_routing_group`, per **account** | ✅ wrapped — `listSippyRoutingGroups()` (`sippy.ts:8315`), `listRoutingGroups()` confirmed working; set at account creation (`sippy.ts:7007`); `getAccountInfo` returns `iRoutingGroup` | Routing group is an **account property**, not a per-call parameter. This is the decisive constraint. |
| **Account (`i_account`)** | per-call originator | ✅ wrapped — `makeCall(cli, cld, { iAccount, billingCode })` (`sippy.ts:2963`) | The only per-call routing-relevant parameter the wrapper sends today. |
| **Billing code** | `billing_code` | ✅ wrapped, unused by route tester | Required for AE-002. |
| **Vendor / connection** | `i_vendor`, `i_connection` | ✅ wrapped — `listVendors()`, `listVendorConnections()` (`sippy.ts:11966`), `getVendorConnectionInfo()`; CDR filter supports `i_connection` (takes precedence over `i_vendor`) | Read/verify path only. No evidence Sippy accepts a connection selector on origination. |
| **Auth rules** | `addAuthRule()` / `listAuthRules()` | ✅ wrapped (`sippy.ts:14328+`) | How a remote IP/UA maps to an account. Needed for BMEE-originated legs regardless of which option is chosen. |
| **Tariff / billing plan** | `i_tariff`, service plans | ✅ wrapped | Affects rating, not route selection. Not a targeting mechanism. |
| **`tgrp` on the CLD** | trunk-group selector in the R-URI | ❌ not present anywhere in the wrapper | Observed in RouteInspector's INVITEs to a Sippy switch (`sip:...;tgrp=Premium@...`). **Switch-side unknown** on our install. |
| **Dial-prefix routing codes** | switch-configured prefixes | ❌ not configured, not wrapped | Would require dialplan/routing configuration on the switch. |
| **Origination method params** | `call_control.makeCall` | ⚠️ partial | The wrapper sends only `CLI`, `CLD`, `i_account`, `billing_code`, over a fallback chain of `call_control.makeCall` → `makeCall` → `make_call` → `originate`. Whether the switch's method accepts further routing parameters is **unverified** — the wrapper has simply never sent any. |

**Key structural fact:** in Sippy, routing is a property of the **account** (via its routing
group and LCR order), not of the individual call. Any mechanism that appears to select a
vendor per call is either decorating the destination (`tgrp`, dial prefix) or switching
which account originates.

---

## 3. Options

### Option A — synthetic account family (one account per vendor)

```
TEST_VENDOR_A  → routing group A → LCR containing only Vendor A's connection
TEST_VENDOR_B  → routing group B → LCR containing only Vendor B's connection
TEST_VENDOR_C  → routing group C → …
```

Origination selects the vendor by choosing `i_account`, which the wrapper already sends.

| | |
|---|---|
| **Determinism** | Highest. Routing cannot fall through to another vendor if the group holds one connection. |
| **Code impact** | None to existing code paths. `makeCall` already accepts `iAccount`. |
| **Switch work** | N accounts + N routing groups + LCR configuration + auth rules, and ongoing upkeep as vendors are added or removed. |
| **AE-001 impact** | Requires classification on **billing code**, not a single account id, so the whole family resolves to `trafficClass = synthetic`. |
| **Failure mode** | Silent drift: a routing group edited later to include a second connection reintroduces ambiguity with no signal. Needs periodic assertion that each test group still holds exactly one connection. |

### Option B — single TEST account + `tgrp` on the CLD

```
TEST account → routing group containing all vendors
CLD decorated: sip:<number>;tgrp=<trunk>@…
```

| | |
|---|---|
| **Determinism** | Unknown until probed. Selects a *trunk/product*, which may or may not map 1:1 to a vendor. |
| **Code impact** | None to existing paths — BMEE originates through Asterisk and can decorate the R-URI itself. |
| **Switch work** | Minimal *if* supported. |
| **AE-001 impact** | Simplest — one account, one billing code. |
| **Failure mode** | If the switch ignores an unknown `tgrp`, the call still completes via LCR and looks like a successful targeted test. **Silent fallback is the dangerous failure here** and must be detectable. |

### Option C — dedicated routing group swapped per test

Reconfigure one test account's routing group between calls.

Rejected: mutating switch routing configuration at test cadence is operationally hostile,
racy under concurrency, and unauditable. Recorded only so it is not revisited.

### Recommendation (pending §5 verification)

**Option A for vendor, Option B for product/trunk** — the account family gives
deterministic vendor selection using a parameter the platform already sends, while `tgrp`
(if supported) expresses the product dimension of a Test Profile that accounts alone
cannot. If §5 shows `tgrp` is not honoured, product selection collapses into the account
family (one account per vendor × product), which is more accounts but no new mechanism.

---

## 4. What "targeting" must guarantee

Whichever option is adopted, CAP-021 AF-008 still holds: **intent and reality are stored
separately and reconciled per call.** Targeting is never assumed to have worked.

- Requested vendor/product recorded on the result from the profile snapshot.
- Observed vendor/product read back from the CDR (`i_connection` / `i_vendor` filter or the
  CDR's own vendor fields) after every call.
- A mismatch is a **first-class finding**, not an error — it is evidence about the switch,
  and under Option B it is the only defence against silent LCR fallback.
- Comparative attribution (VAL-013) consumes only legs where intent and reality agree;
  legs that diverge are retained as evidence but excluded from the comparison.

---

## 5. Verification plan (must run before a decision is ratified)

These questions cannot be answered from the repository. They require controlled calls
against the production switch, ideally on a low-cost destination and outside peak.

| # | Question | Method | Decides |
|---|---|---|---|
| V1 | Does `call_control.makeCall` accept any routing selector beyond `i_account` / `billing_code` on our Sippy build? | probe the method signature / attempt one extra param and inspect the fault | whether a per-call selector exists at all |
| V2 | Does the switch honour `;tgrp=` in the R-URI, and does it map to a vendor or a product? | originate via Asterisk with and without `tgrp`, compare the CDR's `i_connection` | Option B viability |
| V3 | When `tgrp` names an unknown trunk, does the call fail or fall back to LCR? | originate with a deliberately invalid `tgrp` | whether Option B's silent-fallback risk is real |
| V4 | Does an account whose routing group holds a single connection ever route elsewhere (overflow, failover, capacity)? | repeated calls from a single-connection test account; inspect `i_connection` on each CDR | Option A determinism |
| V5 | Is `i_connection` reliably populated on CDRs for our build? | inspect recent CDRs | whether reality can be read back at all (§4) |
| V6 | How many accounts/routing groups is operationally acceptable to maintain? | switch owner decision | Option A scale ceiling |

**V5 is the gating question.** If observed vendor cannot be read back per call, no option is
safe, because targeting could never be verified — only assumed.

---

## 6. Baseline measurement — how bad is divergence today?

The platform has been recording intent-vs-reality since the route tester shipped, in
`route_test_results.rawResponse` (`_targetVendor`, `_actualVendor`, `_vendorMismatch`).
This must be mined **before** any switch change, so the effect of the change is measurable.

> **Execution 1 (2026-08-03) — INCONCLUSIVE.** The script ran successfully against the
> configured database (connection valid, queries correct). `route_test_results` contained
> **zero rows**, so no statistical assessment was possible.
>
> Divergence is therefore **UNKNOWN**, not 0%. The same distinction the validator contract
> draws between UNKNOWN and N/A applies here: absence of observation is not observation of
> absence.
>
> CAP-022 remains **pending execution against an environment containing representative
> route-testing history** — production, or a staging environment populated from it. Query 0
> of the script now reports table counts up front so an unpopulated environment is visible
> before any number is read as a finding.
>
> **Note for the next run:** `_vendorMismatch` exists only on rows written after that
> instrumentation shipped. Even a populated database may have limited assessable history —
> query 6 reports the coverage, and the divergence rate must be quoted against the
> assessable subset, not the full table.

Runnable as [`scripts/cap022-vendor-divergence.sql`](../../scripts/cap022-vendor-divergence.sql)
— read-only, six queries:

```bash
psql "$DATABASE_URL" -f scripts/cap022-vendor-divergence.sql
```

It extends the queries below with a per-vendor **reached %** (which vendors LCR rarely or
never selects) and a coverage check (how much history carries `_vendorMismatch` at all —
rows predating the instrumentation are unassessable in either direction).

```sql
-- Overall divergence rate
SELECT
  count(*)                                                    AS runs,
  count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true') AS mismatches,
  round(100.0 * count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true')
        / nullif(count(*),0), 1)                              AS mismatch_pct
FROM route_test_results
WHERE raw_response ? '_vendorMismatch';

-- By intended vendor: is divergence systematic or random?
SELECT
  raw_response->>'_targetVendor' AS intended,
  raw_response->>'_actualVendor' AS observed,
  count(*)                       AS n
FROM route_test_results
WHERE raw_response ? '_vendorMismatch'
GROUP BY 1, 2
ORDER BY n DESC;

-- By destination prefix
SELECT destination,
       count(*) AS runs,
       count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true') AS mismatches
FROM route_test_results
WHERE raw_response ? '_vendorMismatch'
GROUP BY 1 ORDER BY mismatches DESC LIMIT 25;

-- Over time: is it drifting?
SELECT date_trunc('week', started_at) AS wk,
       count(*) AS runs,
       count(*) FILTER (WHERE raw_response->>'_vendorMismatch' = 'true') AS mismatches
FROM route_test_results
WHERE raw_response ? '_vendorMismatch'
GROUP BY 1 ORDER BY 1;
```

**What the answers mean**

| Finding | Interpretation |
|---|---|
| Divergence rare and random | LCR mostly agrees with intent; opportunistic comparison (L2A) is more trustworthy than assumed, and Option A is a refinement rather than a rescue. |
| Divergence concentrated on specific vendors | Those vendors are rarely or never selected by LCR — they have effectively never been tested, and any historical "vendor" result for them is mislabelled. |
| Divergence concentrated on specific destinations | Routing configuration for those destinations is the real subject; certification claims on them are unsafe. |
| Divergence rising over time | Routing configuration is drifting relative to the test jobs' assumptions. |

Whatever the result, it must be read alongside a correction: **historical
`route_test_results` rows attribute outcomes to `_targetVendor`, not `_actualVendor`.** Any
report ever produced from the intended vendor column is suspect to the degree divergence is
non-zero. Quantifying that is part of this study.

---

## 7. Operational impact

| Depends on vendor targeting | Effect if unresolved |
|---|---|
| Existing route tester | Continues to work; results remain "observed vendor", must not be presented as controlled |
| VAL-005 routing intent | Cannot execute |
| VAL-013 comparative attribution (L2B) | Blocked; only L2A opportunistic comparison available |
| Route / vendor certification | Cannot certify a vendor that was never deterministically reached |
| Test Profiles (Vendor field) | Field must be labelled *preferred* until targeting lands, per AF-008 |
| BMEE test execution | Unaffected in mechanism, but its evidence inherits the same attribution limit |
| Automated routing decisions | Must not be built on unattributed comparisons |

---

## 8. Migration strategy (once an option is ratified)

1. Create the synthetic account family and routing groups on the switch; do **not** touch
   existing accounts (CAP-021 AF-001).
2. Add auth rules for the BMEE/Asterisk origination source, scoped to those accounts only.
3. Assert the invariant: each test routing group contains exactly one vendor connection.
   Re-assert on a schedule — §3 Option A's failure mode is silent drift.
4. Land AE-002 (`billingCode` on the existing route tester) — one added parameter, no logic
   change — so today's synthetic traffic becomes classifiable at the same time.
5. Extend AE-001 classification to match on billing code rather than a single account id.
6. Run the baseline queries again after cutover; divergence on the new accounts should be
   zero. **A non-zero rate means targeting is not working, whatever the switch documentation
   says.**
7. Only then promote the Test Profile Vendor field from *preferred* to *forced*, and enable
   L2B.

---

## 9. V1–V6 runbook

> ⚠️ **These probes place real calls on the production switch.** They cost money, traverse
> vendor networks and appear in production CDRs and analytics. They require the switch
> owner's explicit sign-off on destination, timing and call budget before execution, and
> they are the strongest argument for landing AE-002 first so the probe traffic is already
> classifiable as synthetic.

**Preconditions:** low-cost destination agreed · off-peak window · call budget agreed ·
AE-002 landed if possible · a second operator watching the switch.

| Step | Procedure | Record | Pass condition |
|---|---|---|---|
| **V5** *(run first — gating)* | Inspect the last 500 CDRs for `i_connection` / vendor fields | populated %, by vendor and by date | ≥ 99% populated. **If this fails, stop** — targeting could never be verified, only assumed, and §3 cannot be ratified in any form. |
| **V1** | Call `call_control.makeCall` with one extra routing-ish parameter; inspect the fault string | exact fault text per method name in the fallback chain | a clear "unknown parameter" fault, or acceptance — either is a result |
| **V2** | Originate the same destination twice via Asterisk, once plain, once with `;tgrp=<known trunk>`; compare `i_connection` on both CDRs | both CDRs, both `i_connection` values | differing `i_connection` ⇒ `tgrp` influences routing |
| **V3** | Originate with a deliberately invalid `tgrp` | SIP response + whether a CDR exists | call **fails**. If it completes via LCR, Option B has silent fallback and must not be used without a per-call reality check |
| **V4** | From a test account whose routing group holds one connection, place 20 calls across the window; inspect `i_connection` on each | distribution of `i_connection` | all 20 identical. Any variance = overflow/failover exists and Option A is not deterministic by itself |
| **V6** | Switch owner states the maximum number of accounts/routing groups they will maintain | the number | ≥ vendors × products if `tgrp` fails V2/V3 |

**Recording template** — append results to this section, then move §10 to Ratified:

```
V5  i_connection populated: ____%   (n=____, window ____)
V1  extra param accepted: yes/no    fault: "____"
V2  tgrp changes i_connection: yes/no
V3  invalid tgrp: fails / falls back to LCR
V4  single-connection group determinism: ____/20 identical
V6  account ceiling: ____
Verified by: ____   Date: ____
```

---

## 10. Decision status

| Item | Status |
|---|---|
| Mechanism inventory (§2) | ✅ complete, verified against the repository |
| Options and trade-offs (§3) | ✅ complete |
| Recommendation | 🟡 provisional — Option A + B, pending V1–V6 |
| Switch verification (§5) | ⏳ not started — requires controlled calls |
| Baseline measurement (§6) | ⚠️ executed 2026-08-03, **inconclusive** — target database had zero `route_test_results`; needs an environment with representative history |
| Ratification | ⏳ blocked on the two above |

**CAP-021 has no other open architectural blocker.** Once §5 and §6 are complete and this
document is ratified, Track A (L2/L3 after Portal Framework v1.0) and Track B (BMEE
Sprint 1, immediately) can both proceed against a stable execution model.
