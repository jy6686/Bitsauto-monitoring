# AE-001 / AE-002 — Acceptance Criteria (written before implementation)

**Purpose:** production analytics must never include synthetic traffic. Governed by
CAP-021 AE-001 / AE-002, both frozen 2026-08-03.

**Method:** Sprint 2's lesson applied — acceptance is defined and committed *before* code,
so completion is a testable condition rather than "it seems to work."

---

## The blocker, found while writing this document

There are **three** sources of synthetic traffic, not two, and the third cannot currently
be classified at all:

| Source | Discriminator today | Classifiable? |
|---|---|---|
| Route tester (`makeTestCall`) | none — but `makeCall` already supports `billingCode` / `iAccount` | **AE-002 fixes this** |
| Scheduled probes (`sip-probe`) | own code path | needs review |
| **BitsAuto Testing Agent (BMEE)** | **none reaching Sippy** | ❌ **blocked** |

The Testing Agent sets `BTA_TEST_ID` as an **Asterisk channel variable** — it never leaves
Asterisk and never appears in a Sippy CDR. Its calls use, in the operator's own words,
*"same prefix and same account"* as production Voice OTP traffic. In the CDR they are
**indistinguishable from production**.

So AE-001 as currently specified would classify route-tester traffic and silently leave
~25 Testing Agent calls (and every future one) contaminating the same analytics it exists
to protect.

### The tension that has to be decided first

Making test traffic distinguishable risks making it **non-representative**:

| Option | Cost |
|---|---|
| Distinct Sippy **billing code** on the agent's calls | needs a way to attach one — the agent originates through Asterisk, not the Sippy API |
| Distinct **tech prefix** mapped to a test billing code | cheap (a config value), but a different prefix may take a **different LCR path** — the test would no longer exercise the production route, defeating its purpose. Also blocked by TD-011 until the current prefix is explained |
| Distinct **Sippy account** for the agent's trunk | cleanest classification; same LCR-divergence risk, and Asterisk's trunk is shared with production |
| SIP header (`X-BitsAuto-Test`) from Asterisk | requires dialplan/PJSIP change on a production PBX **and** Sippy recording the header |
| Correlate by SIP Call-ID | **blocked** — `CHANNEL(sip_call_id)` unavailable on chan_sip (BTA-006) |

**This decision precedes implementation.** The governing question: *can a synthetic call be
labelled without changing the route it takes?* If not, AE-001 must accept either
contamination from the agent or a test that no longer measures production behaviour — and
that trade-off is the operator's to make explicitly, not a detail to discover mid-build.

---

## Acceptance criteria

Each is falsifiable by observation, in the Sprint 2 style.

| # | Criterion | How it is verified |
|---|---|---|
| **AC-1** | Every synthetic call carries a discriminator visible at CDR ingestion | place one call from each source; each resulting CDR row resolves to `traffic_class = synthetic` |
| **AC-2** | Classification happens **once**, at `cdrCache` population | grep: exactly one classification site; consumers read the field, never re-derive it |
| **AC-3** | Classification **never** uses CLI | code review + a test call with a production-looking CLI still classifies as synthetic. *CLI is what carriers rewrite, so CLI-based classification misclassifies precisely on the worst routes* |
| **AC-4** | The scoring engines filter on it — carrier scoring, vendor stability, RTP/MOS stats, prefix intelligence, FAS statistics | place a synthetic call during a measured window; its minutes/ASR/PDD appear in **none** of the five |
| **AC-5** | Synthetic evidence is **retained**, not discarded | the same call remains queryable with `traffic_class = synthetic` and appears when synthetic traffic is explicitly included |
| **AC-6** | Governance and revenue exclude synthetic traffic | a synthetic call is not counted in governed minutes, cut rates, or revenue reporting |
| **AC-7** | Cutover is **forward-only** and announced | no backfill attempted; historical CDRs carry no discriminator (CAP-021). Vendor MOS/ASR/ACD/FAS **will visibly shift** at cutover — the shift is the correct behaviour, and saying so beforehand prevents it being read as a regression |
| **AC-8** | AE-002: the route tester passes `billingCode` / `iAccount` | inspect a route-test CDR for the code; today it passes neither although `makeCall` supports both |

## Definition of Done

- [ ] The labelling decision above is made explicitly, with its LCR-divergence trade-off recorded
- [ ] AC-1 … AC-8 all verified by observation, each against a real call
- [ ] The cutover date and expected metric shift are announced before it happens
- [ ] The ~25 existing Testing Agent sessions are documented as **known unclassified
      history** — they predate the discriminator and cannot be retrofitted

## What this does not do

It does not clean historical contamination. Every synthetic call placed before cutover
stays in the analytics, unlabelled and unfindable. That is the price of not having done
this first, and it is bounded only by starting sooner.
