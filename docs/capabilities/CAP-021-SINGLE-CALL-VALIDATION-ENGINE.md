# CAP-021 — Single Call Validation Engine (SCVE)

**Status:** SPECIFIED — architecture frozen 2026-08-03. Not in build.
**Sequencing:** Track A (in-repo validators) after Portal Framework v1.0 cert+merge, same rule as CAP-003 and the IAM program. Track B (Media Evidence Engine) is a separate project and is **not** gated by v1.0 because it does not touch this repository.
**Source:** design sessions of 2026-07-24 → 2026-08-03; RouteInspector wiki + product screenshots used as an *engineering reference*, never as the architecture.
**Scope note:** implementation-neutral. Field lists are contracts, not DDL. No UI is specified — SCVE is a backend capability that existing portals consume.

---

## Glossary

| Term | Meaning |
|---|---|
| **SCVE** | Single Call Validation Engine — the backend engine in this document. Resolves one canonical call and runs validators against it. |
| **BMEE** | BitsAuto Media Evidence Engine — separate project; produces media evidence, decides nothing. |
| **Canonical call object** | The single persisted representation of one call, resolvable from any identifier. |
| **Evidence package** | The custody-compliant bundle BMEE returns for one call. |
| **Evidence provenance** | The source that produced a finding (SIP, CDR, AMI, MixMonitor, DSP, STT, human confirmation, AI, manual override). |
| **Validator** | A plugin that declares its evidence dependency and returns PASS/FAIL, N/A, UNKNOWN or PENDING. |
| **Rule pack** | A versioned set of detection rules stored as data, evaluated by validators. |
| **Completeness** | Proportion of applicable validators that actually executed on available evidence. |
| **Traffic class** | Classification of a call's origin — production, synthetic, certification, engineering, demo, benchmark. |
| **Topology** | The signalling path a call took (`Sippy direct` vs `Asterisk media anchor`). Not comparable across values. |
| **Test Session** | Top-level entity grouping the vendor legs and reference leg of one comparison, certification or monitoring run. |
| **Test Profile** | Saved, reusable test definition; snapshotted onto every result it produces. |
| **Reference carrier / reference leg** | Configured known-good carrier per destination used as the comparison baseline. |
| **Capability layer (L1–L5)** | Maturity levels: signalling → comparative → termination integrity → media playback → interactive conversation. |

---

## 1. Executive summary

SCVE resolves **one canonical call** from any identifier and runs a declared set of
validators against it, producing a verdict, reasons, a completeness measure, and a
permanently retained evidence record.

The unit of analysis is the **call**, not the test. Production calls, scheduled route
tests, AI test calls, customer complaints, fraud investigations and invoice disputes all
enter the same engine. Only two things vary: which validators are applicable, and what
evidence is available.

> **Platform law.** RouteInspector validates *tests*. BitsAuto validates *calls*.

Roughly 60–70% of the validator logic already exists in the platform, scattered across
engines that never run together against one call. CAP-021 is therefore a **consolidation
and correlation** capability, not a greenfield build. The genuinely new components are:
a persisted canonical call/evidence object, the validator pipeline, wider search
resolution, and — outside this repository — a media evidence producer.

> **Governing document.** CAP-021 is the single source of truth for call validation, in
> the same way the Portal Framework documents govern portal architecture. Future
> capabilities — BYE integrity, BMEE, comparative testing, AI conversation — reference this
> document rather than defining their own architecture. Any change to a validator contract,
> the evidence model or a frozen principle is proposed as a revision to CAP-021, never
> documented independently.

---

## 2. Design principles (frozen)

| # | Principle |
|---|---|
| **AF-001** | Do not modify existing business logic, scoring algorithms, routing or production workflows. New capability arrives as new evidence sources and new validators. Exceptions require an AE number. |
| **AF-002** | Four layers: **L-I immutable evidence** → **L-II metadata** → **L-III derived analysis** → **L-IV business decisions**. L-III is never the source of truth and must always be recomputable from L-I. |
| **AF-003** | AI-derived signals may flag, explain and escalate. They may never drive scoring, certification or route suspension. Only deterministic evidence survives a vendor dispute. |
| **AF-004** | Recordings and transcripts of human recipients are personal data. Retention period, encryption at rest, access control and deletion-on-request are defined before the first human-facing call. |
| **AF-005** | Test numbers are called only from an approved-number registry with recorded approver, scope and expiry. The registry is a table with an audit trail, not configuration. |
| **AF-006** | Every timestamped event records its **clock source** and the **measured offset** to the platform clock at capture time. Never the source alone. |
| **AF-007** | **Evidence chain of custody.** Every artefact carries: evidence id, parent call id, session id, evidence type, source system, SHA-256, created time, clock source + offset, rule pack version, validator version, derived-from link, access log. |
| **AF-008** | **Intent vs observed reality.** Every execution stores requested routing separately from observed routing (actual vendor / product / CLI, plus reason such as LCR override). The two are never conflated in storage, reporting or documentation. |
| **AF-009** | Comparative attribution requires a defined **reference leg**: a configured, health-monitored carrier per destination that is never its own subject. |
| **AF-010** | **Hard admission control.** Under resource pressure, refuse the test. Never degrade execution — self-inflicted media defects are indistinguishable from vendor defects in the evidence package. |
| **AF-011** | **Portal scope.** SCVE is an internal operational capability. Full functionality exists only in the Main Platform, NOC Portal and Admin Portal. External portals consume certified results and business outcomes only — never validator internals, raw evidence, rule packs or operational controls. |

### Architectural exceptions

| # | Exception | Justification |
|---|---|---|
| **AE-001** | **Synthetic traffic classification.** Production analytics must never include synthetic or platform-generated traffic. | Platform-integrity requirement, not an AI requirement. Today's route-test traffic already contaminates vendor scoring. |
| **AE-002** | **Route tester identification.** The existing route tester passes a billing code / synthetic account so its calls are classifiable. | Without it, AE-001 fixes future contamination while knowingly leaving today's in place. |

Both exceptions are generic, configuration-driven, and benefit every analytics engine —
not only this capability. No other modification to production business logic is sanctioned.

---

## 3. Architecture overview

```
                          BitsAuto (system of record)
        ┌────────────────────────────────────────────────────┐
        │            Single Call Validation Engine           │
        │  search → correlation → validator pipeline → verdict│
        └───────────────────────┬────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
  existing evidence      existing evidence        frozen contract
  (Sippy CDR, SIP,       (route tests, FAS         (evidence package)
   RTP metrics, P&L)      events, AMI)                    │
                                                          ▼
                                        BitsAuto Media Evidence Engine (BMEE)
                                        playback · recording · DSP · RTP capture
                                        announcements · ringback · echo · silence
                                        STT (later) · conversation (later)
                                                          │
                                                    Asterisk → Sippy → Carrier
```

**Build by layer, not by repository.** Validators that consume data BitsAuto already
owns live in BitsAuto — moving them out would duplicate the Sippy data path, the CDR
retrieval, the vendor and destination catalogues, and production credentials, for no
isolation benefit. Validators that require new media technology live in BMEE, which owns
its own failure domain. BMEE decides nothing; it produces evidence.

---

## 4. Canonical call object

One object per call, resolvable from any identifier and persisted permanently.

**Resolution keys:** Call-ID · ANI · DNIS · account · customer · vendor · SIP IP · RTP IP
· ASN · CDR id · session id · invoice id · destination · prefix · operator · time range.

**Sections:** identity · routing intent · routing reality · SIP · SDP · RTP · RTCP · CLI
· media · billing · finance · vendor · client · GeoIP/ASN · fraud · AI · evidence.

**Immutable metadata (unbackfillable — required from schema v1):**
`trafficClass` · `topology` · `testProfileSnapshot` · `mediaAnchor` · `sessionId` ·
`referenceGroup` · `clockSource` + `clockOffset` · `evidenceVersion` ·
`rulePackVersion` · `validatorVersion` · `evidenceProvenance`.

> Any field in that list added later is permanently null for every prior call. Adding
> `topology` after the fact makes all earlier results uncomparable.

---

## 5. Evidence model and chain of custody

Raw evidence and derived verdicts are stored **separately** (AF-002). Verdicts reference
the evidence they were computed from; improving a detector lets historical calls be
re-evaluated under the new rule pack instead of merely being labelled untrustworthy.

**Custody requirements**

- Artefacts are hashed at **seal time** — for a recording, at file close, not while being written.
- Artefacts must be **ingested into storage BitsAuto controls** before hashing. A hash of a
  file that lives only on the Asterisk host proves nothing; that host can rotate, truncate
  or overwrite it. Record origin path and ingest time alongside the hash.
- **Derived-from edges** are mandatory: transcript ⟵ recording (hash), verdict ⟵ transcript
  + rule pack version. Without the link, custody is an assertion rather than a chain.
- **Access log** covers view, stream, export and hash-verification, per evidence id.

**Evidence provenance** is recorded per finding, not per call: `SIP` · `CDR` · `AMI` ·
`MixMonitor` · `DSP` · `STT` · `human confirmation` · `AI` · `manual override`. This is the
mechanism that enforces AF-003 at the data level rather than by convention.

---

## 6. Validator framework

Validators are plugins with a declared evidence dependency. The engine evaluates
availability, then runs or records absence — it never guesses.

### 6.1 Validator contract — four outcomes

| Outcome | Meaning |
|---|---|
| **PASS / FAIL** | Executed on sufficient evidence; deterministic result. |
| **N/A** | Not applicable to this call — a property of the **call**. (Call died at 500: no RTP was ever expected. Correct outcome, does not lower the verdict.) |
| **UNKNOWN** | Should have run; required evidence unavailable or incomplete — a property of the **evidence**. (Call answered, RTP expected, no RTP telemetry retained.) |
| **PENDING** | Cannot complete yet; future evidence expected (vendor invoice not yet received). |

> **Never collapse N/A into UNKNOWN.** Treating missing evidence as a skip is how a
> validation engine silently returns "VALID CALL" on a call it never examined. Same rule
> the platform already applies to Sippy probing: capability, permission and transient
> failures are distinct states.

### 6.2 Completeness

The canonical call carries a completeness measure: `applicable / executed / unknown / pending`.
A verdict is never published without it.

| Consumer | Minimum completeness |
|---|---|
| Advisory / investigation display | ≥ 50% |
| Vendor scoring contribution | ≥ 80% |
| Automatic route suspension | ≥ 95% |
| Invoice dispute evidence | 100%, or an explicit policy-defined threshold |

"VALID CALL — 6 of 14 applicable validators had evidence" is an honest verdict.
"VALID CALL" on the same data is not.

### 6.3 Rule registry

Detection rules are **data, not code**: identity, thresholds, weights, version. Rule-pack
versioning is meaningless if the rules are `if` statements — "FAS rules v1.2" must be a
queryable row, not a git SHA. Every RouteInspector concept (FAS, BYE delay, RBT, early
media, CLI anomaly, SIP response classification) enters as a rule row, never as a module.

### 6.4 Pipeline order

Identity → routing intent → routing reality → SIP → SDP → RTP → CLI → call setup
integrity → call termination integrity → media continuity → billing integrity → vendor
integrity → finance integrity → **fraud correlation** → AI analysis → evidence builder →
investigation summary.

Fraud sits near the end by design: **fraud consumes evidence, it does not generate it.**

---

## 7. Execution tiers — which calls, and which validators

**Every call enters SCVE. Not every call carries the same evidence.**

The engine is uniform; the evidence is not. Recording, DSP and transcription on every
production call would demand compute, storage and bandwidth out of all proportion to the
value, and is unnecessary for the great majority of calls. The split is therefore by
*evidence availability*, not by a second engine.

| Tier | Calls | Evidence | Cost |
|---|---|---|---|
| **Tier 1 — production** | all production traffic | existing telemetry only: SIP, CDR, PDD, sell/buy duration, CLI, routing, vendor | none beyond what is already collected |
| **Tier 2 — synthetic** | calls BitsAuto generates | everything in Tier 1 **plus** BMEE media evidence: playback, recording, DSP, ringback, announcements, echo, silence, audio-derived FAS, later transcript and conversation | metered, admission-controlled |

### Validator categories

| Category | Runs on | Validators |
|---|---|---|
| **A — always** | every call | identity · routing intent · routing reality · SIP · SDP · CLI · duration integrity (L3A) · billing integrity Stage A · vendor integrity · fraud correlation · investigation summary |
| **B — evidence-conditional** | any call where the evidence exists | RTP quality · media continuity · DSP · echo · silence · ringback · announcement detection. Absent evidence returns **N/A** or **UNKNOWN** per §6.1 — never a silent skip. |
| **C — synthetic only** | generated calls only | playback validation · spoken CLI confirmation · transcript · language validation · conversational quality |

A production call completing at, say, 72% completeness because media evidence was never
collected is a **correct and expected** result, not a defect. The completeness thresholds
in §6.2 are what stop that number being read as certainty.

### Why this matters operationally

The two tiers compose into the capability neither has alone:

```
production call → Tier 1 → duration integrity flags Vendor B
                                    │
                       schedule synthetic test, same destination + vendor
                                    │
                     Tier 2 → recording · announcement · Long-Delay FAS
                                    │
                              Vendor B confirmed
```

**Production traffic detects the anomaly at zero marginal cost; the synthetic call proves
it.** A customer complaint follows the same path: validate what existing telemetry
supports, then generate confirmatory media evidence if the case warrants it. The test call
is confirmatory evidence, never the primary evidence.

---

## 8. Test Session and Test Profile model

**Test Session** is the top-level entity. A session groups the vendor legs plus the
reference leg of one comparison, certification, regression run or monitoring tick.
Individual calls are evidence *within* a session.

```
Certification Session (CERT-20260803-001)
   ├── Call — Vendor A
   ├── Call — Vendor B
   ├── Call — Vendor C
   └── Call — Reference carrier
```

**Test Profile** is a saved, reusable definition:

| Group | Fields |
|---|---|
| Classification | synthetic account (fixed), traffic class, test type |
| Routing intent | vendor(s) or vendor group, product / trunk (`tgrp`), destination by country / operator / prefix / number range, reference carrier |
| CLI | expected CLI, verification mode (automatic detection · recipient confirmation · both), ANI pool / zone |
| Validators | per-validator enable flags (MOS, jitter, loss, echo, one-way, silence, codec, direction, recording) |
| Media | playback stimulus (silence · language-matched speech file) and, at L5 only, conversation level |
| Recording | enabled, channels, transcript, retention |
| Success criteria | e.g. CLI PASS required · MOS > 4.2 · PDD < 5 s · no announcement · FAS not allowed |
| Execution mode | single validation · comparative · certification · regression · continuous monitoring |
| Capacity | concurrency ceiling (admission control, AF-010) |

**Profiles are mutable; results are not.** Every result embeds a **snapshot** of the
profile version it executed under, including success criteria. Otherwise relaxing a
threshold silently rewrites the meaning of every historical PASS.

**Comparison windows.** A comparison group defines a maximum time spread and records the
actual spread. Legs executed minutes apart during a congestion event are not "identical
conditions"; exceeding the limit downgrades confidence or invalidates attribution.

---

## 9. Validator registry

The canonical reference for the validator ecosystem. Rule packs, evidence contracts,
completeness calculations and future validator additions cite **VAL ids**, never prose.
Ids are permanent; a retired validator keeps its id.

Status is verified against the repository — this table is also the "consolidate, don't
rebuild" record.

| ID | Validator | Layer | Cat | Evidence required | Status / existing implementation |
|---|---|---|---|---|---|
| **VAL-000** | Call resolution | L1 | A | any identifier | 🔵 partial — `server/routes.ts:7603`, Call-ID / CLI / CLD with three-tier fallback: `cdrCache` → live Sippy fetch → `fas_events`. No account / vendor / IP / ASN / invoice resolution. |
| **VAL-001** | Identity | L1 | A | CDR | 🔵 partial — CDR fields; country + trunk-class detection in `server/cdr-enrichment.ts`. |
| **VAL-002** | SIP | L1 | A | SIP response / CDR cause | 🟡 exists — `sipCodeToFailReason()` in `cdr-enrichment.ts`; `sip-probe.ts`. |
| **VAL-003** | SDP | L1 | A | SDP offer/answer | 🔵 partial — per-call `/api/sippy/cdr/sdp`. |
| **VAL-004** | CLI | L1 | A | SIP + expected CLI | 🟡 exists — `services/route-tester.ts` CDR-cache probe by Call-ID, `+`-normalised compare; `loadCliHealthSummary()` 7-day per-vendor mismatch scoring. |
| **VAL-005** | Routing intent | L1 | A | test profile / routing request | ❌ missing — no vendor-forcing mechanism, see §12. |
| **VAL-006** | Routing reality | L1 | A | CDR + routing decision | 🔵 partial — `route-tester.ts:150` records `_actualVendor` / `_vendorMismatch` in `rawResponse`. |
| **VAL-007** | Call setup integrity | L1 | A | SIP timing, PDD | 🔵 partial — PDD and SIP code captured per test; no early-media or RBT analysis. |
| **VAL-008** | Duration integrity | L3A | A | sell / buy / billed duration, setup-connect-disconnect times | 🔵 partial — CDR fields at `sippy.ts:3505`; P&L path parses sell **and buy** duration per call at `sippy.ts:1848`. |
| **VAL-009** | BYE timing integrity | L3B | B | SIP trace, RTP end timestamp | ❌ missing — requires retained per-call signalling. |
| **VAL-010** | Billing integrity — Stage A | L1 | A | CDR + rating | 🔵 partial — rating/P&L exist; no per-call validator. |
| **VAL-011** | Billing integrity — Stage B | L1 | A (PENDING) | vendor invoice | 🔵 partial — invoice and dispute machinery exist; completes at reconciliation. |
| **VAL-012** | Vendor integrity | L1 | A | vendor catalogue + history | 🟡 exists — `vendor-rca.ts`, `vendor-stability.ts`, `carrier-scoring-engine.ts`, `vendor-prefix-intelligence.ts`. |
| **VAL-013** | Comparative attribution | L2 | A | test session (L2A opportunistic / L2B controlled) | ❌ missing — data lands in `route_test_results` (`shared/schema.ts:3847`); no comparison layer. |
| **VAL-014** | RTP quality | L2 | B | RTP metrics | 🔵 partial — `rtp-quality-aggregator.ts` + `mos.ts`, **windowed per vendor/prefix from CDR fields, not per-call packet data**. |
| **VAL-015** | Media continuity | L4 | B | RTP packets | ❌ missing. |
| **VAL-016** | Echo | L4 | B | recording / DSP | ❌ missing. |
| **VAL-017** | Silence & one-way audio | L4 | B | recording / DSP | ❌ missing. |
| **VAL-018** | Ringback analysis | L4 | B | pre-answer audio | ❌ missing — needs recording from Originate, see §13. |
| **VAL-019** | Announcement detection | L4 | B | recording (+ STT later) | ❌ missing. |
| **VAL-020** | Audio-derived FAS | L4 | B | recording + answer timing | ❌ missing. |
| **VAL-021** | Fraud correlation | L1 | A | outputs of VAL-008/009/018/019/020 + `fas_events` | 🟡 exists (CDR half) — `cdr-enrichment.ts:90` `detectFas()`, `detectCallback()`, `calcVendorFraudStats()`. |
| **VAL-022** | Playback validation | L4 | C | playback stimulus + recording | ❌ missing. |
| **VAL-023** | Spoken CLI confirmation | L5 | C | transcript | ❌ missing. |
| **VAL-024** | Language validation | L5 | C | transcript | ❌ missing. |
| **VAL-025** | Conversational quality | L5 | C | transcript + dialogue events | ❌ missing. |
| **VAL-026** | Investigation summary | L1 | A | all validator outputs | ❌ missing. |

Also missing and not a validator: the **canonical persisted call object** — today the trace
endpoint returns a transient answer from cache.

**Fraud collision rule.** `detectFas()` remains authoritative for CDR-derived FAS
(AF-001). The SCVE fraud validator **consumes** `fas_events` and layers media-derived
evidence on top; it must never recompute a competing FAS verdict. Combined assessment is
expressed as agreement — *CDR FAS high, media evidence supports, confidence 98%* — or
disagreement — *CDR FAS medium, media evidence contradicts, recommend manual review*.

---

## 10. Comparative intelligence (L2)

| Tier | Requires | Produces |
|---|---|---|
| **L2A — opportunistic** | nothing new | Compare vendors LCR actually selected, over time, on the same destination. Genuinely useful; **not** controlled attribution. |
| **L2B — controlled** | synthetic account family + `tgrp` product selection + reference leg | True attribution: "Vendor B shows 42 s PDD, artificial ringback and announcement playback; A, C and the reference completed normally under identical conditions." |

The two tiers must never be conflated in documentation or in anything shown to a carrier.

---

## 11. Call termination integrity (L3)

| Sub-validator | Evidence | Availability |
|---|---|---|
| **L3A — duration integrity** | sell vs buy vs observed duration, setup/connect/disconnect times, `i_connection` | **Available today.** Detects duration inflation, sell/buy mismatch, BYE-delay revenue leakage, per-vendor trend. |
| **L3B — BYE timing integrity** | SIP BYE timestamps, RTP end timestamp, transaction history | Requires signalling retention. Detects delayed / early / missing / double BYE, RTP after BYE, RTP before 200 OK. |

L3A produces money-denominated evidence from data already retrieved, with no media path
and no compliance surface. It is the strongest single argument this capability can make
to a vendor.

**Billing integrity is a two-stage validator.** Stage A completes at call end (customer
billed vs observed duration → provisional). Stage B completes at invoice reconciliation
(vendor billed duration, invoice amount, financial variance → final). Validator results
therefore need a `PENDING → COMPLETE` lifecycle; not every validator finishes during the call.

> Do not build a "BYE Delay Detector". Small teardown delays are normal — SBC processing,
> proxies, NAT traversal, retransmission, congestion. Value comes from persistent patterns
> per vendor, not isolated calls.

---

## 12. Known blocker — vendor targeting

`services/route-tester.ts` iterates `job.vendorIds` but sends an **identical**
`makeTestCall(cli, cld, maxDuration)` on every iteration. No parameter targets a vendor;
LCR decides, and the code then reads back `actualVendorName` and flags `_vendorMismatch`.

**Today the platform measures vendor selection; it does not control it.** L2B cannot exist
until routing intent is bound. Candidates, in preference order:

1. **Synthetic account family** (`TEST_VENDOR_A/B/C`), each with a single-vendor routing
   group. Requires AE-001 to classify on **billing code**, not a single account id.
2. **`;tgrp=` on the CLD** for product / trunk selection. Sippy accepts this — observed in
   RouteInspector's own INVITEs against a Sippy switch.
3. Dial-prefix routing codes, if configured on the switch.

Recommended: account family for vendor, `tgrp` for product. This is a **Sippy
configuration decision, not a code decision**, and it gates L2B.

Before designing further, read the `_vendorMismatch` data already accumulated in
`route_test_results.rawResponse` — it sizes the problem empirically.

---

## 13. Media Evidence Engine contract (BMEE)

BMEE is a separate project with its own lifecycle. It is an evidence producer and decides
nothing. **The contract is frozen before the first call, not after** — an ad-hoc evidence
shape cannot be retrofitted with a hash or a clock offset.

**Evidence package:** session id · call id · evidence id · traffic class · topology ·
profile snapshot · playback type · recording (+ per-direction channels where available) ·
transcript · waveform · DSP metrics · timeline events · clock source + offset · SHA-256 ·
derived-from links · rule pack version · validator version · evidence provenance.

**Runtime isolation requirements** (code isolation is not runtime isolation — BMEE shares
the Asterisk host with production governance):

- **Dedicated dialplan context** and a **dedicated CLI pool** that no `call_governance_rules`
  pattern can match. Governance selects calls by callee/caller pattern; an unmatched test
  call is the only safe test call.
- **Dedicated AMI user** (`bitsauto-ai`), separate login and event subscription. The
  existing `amiGovernance` listener is a singleton and must not be shared.
- **Recording mode differs from governance.** Governance MixMonitor uses option `b`
  (post-bridge only, deliberately excluding ringback). Announcement, ringback and
  Long-Delay-FAS analysis need recording from **Originate**, so BMEE requires its own
  recording mode.
- **Credentials:** BMEE holds synthetic-account credentials only. Never production Sippy
  admin credentials.
- **Capacity:** admission control per AF-010.

**The media plane is not the control plane.** Asterisk needs persistent processes and raw
SIP/RTP; it already lives on its own host, reached over AMI/TCP with recordings pulled via
SFTP. BMEE orchestrates that host — it does not contain it.

**Topology is not neutral.** `BitsAuto → Asterisk → Sippy → Carrier` is not signal-identical
to `BitsAuto → Sippy → Carrier`: PDD includes the extra hop and codec negotiation happens
against Asterisk. Record topology per result and never compare PDD across topologies.

---

## 14. Governance and compliance

- **Phase gate.** Silent media testing (playback, recording, DSP, announcements, ringback,
  silence, one-way audio, audio-derived FAS) requires no consent framework because there is
  no conversational interaction. Interactive conversation (L5) does not begin until AF-004
  and AF-005 are satisfied: retention policy, encryption at rest, access control, approved
  number registry, consent lifecycle, deletion policy.
- **Naturalness, never impersonation.** Human-quality speech is a *media realism*
  requirement — it exercises codecs, echo cancellers and packet-loss concealment as real
  traffic does. Engineering variability to prevent carriers or recipients from identifying
  calls as automated is not a requirement this specification will carry.
- **Deployment scope for L5:** customer-approved test numbers, carrier test endpoints, or an
  opt-in tester network. Never unsolicited recipients.
- **AE-001 cutover is forward-only.** Historical CDRs carry no discriminator and cannot be
  reclassified. Cutover is announced, not silent — vendor MOS, ASR, ACD and FAS values will
  visibly shift on the day it lands. Retain before/after snapshots. Suggested procedure:
  T-7 baseline · T-1 monitoring only · T0 classification live · T+7 comparison · T+30 retire
  legacy baseline.
- **Classification never uses CLI.** CLI is precisely what carriers rewrite, so CLI-based
  classification misclassifies synthetic traffic as production on exactly the worst routes.
  Classify on an immutable origin identifier: synthetic account, billing code, or test
  profile id.

---

### Portal scope (AF-011)

| Surface | Access | Role |
|---|---|---|
| **Main Platform** | full | System of record — investigations, call timeline, evidence viewer, comparative testing, certification reports, historical analytics |
| **NOC Portal** | full | Operational workspace — run immediate and scheduled tests, live sessions, recordings, waveforms, playback, RTP/CLI/FAS/BYE investigation, route certification, vendor comparison, evidence review |
| **Admin Portal** | full | Configuration and governance — validator registry, rule registry and pack versioning, test profiles and session templates, reference carrier registry, traffic class config, AE-001/AE-002 settings, BMEE integration, retention policy, approved test number registry, admission control, language packs, playback audio library, scheduler. Admins define how the engine behaves; they do not run investigations. |
| **Finance Portal** | outputs only | invoice exceptions, billing integrity alerts, duration variance, vendor dispute queue |
| **Commercial / KAM** | outputs only | route certified status, vendor quality score, route health, certification date |
| **Client Portal** | none | — |
| **Partner Portal** | none | — |

**Never exposed outside the three internal surfaces:** validator registry · rule packs ·
FAS analysis · BYE integrity · fraud correlation · raw SIP · RTP and DSP analysis ·
recordings · AI evidence · comparative vendor results · reference carrier configuration.

---

## 15. Capability maturity roadmap

| Level | Capability | New infrastructure | Track |
|---|---|---|---|
| **L1** | Signalling intelligence — identity, SIP, SDP, routing, CLI, billing | none | A |
| **L2** | Comparative intelligence — sessions, reference leg, attribution (L2A now, L2B after vendor targeting) | none (L2A) / Sippy config (L2B) | A |
| **L3** | Call termination integrity — L3A duration now, L3B BYE timing later | none (L3A) | A |
| **L4** | Media playback intelligence — playback stimulus, recording, DSP, announcements, ringback, echo, silence, one-way audio, audio-derived FAS, media continuity | Asterisk playback + recording (largely exists) | B |
| **L5** | Interactive conversation — AudioSocket/ARI external media, STT, TTS, dialogue, spoken CLI confirmation | real-time bidirectional streaming | B |

**Track A** begins after Portal Framework v1.0 cert+merge. **Track B** may begin
immediately; it does not touch this repository.

> **Sequencing caution.** The two highest-value capabilities (L2, L3A) need no media path
> and no AI. Track B being the track that can start first must not quietly promote media
> intelligence ahead of the capabilities that actually change routing decisions.

**RouteInspector's "Conversation (English / Arabic / Farsi / …)" is canned audio playback**,
selected from a *Play sound* dropdown alongside *Silence* — not an interactive agent. The
industry baseline for "conversational testing" is a one-way speech-shaped stimulus. That is
L4, achievable with playback injection that already exists, with no STT, TTS or LLM on the
critical path.

---

## 16. Future extensions

Video / WebRTC evidence · screen-share evidence · autonomous route certification with
policy-driven suspension · customer-facing evidence export for disputes · cross-platform
evidence federation. All inherit the §6 validator contract and the §5 custody model
unchanged — which is the point of freezing both before implementation.

---

## Appendix — decision register

| Ref | Decision | Date |
|---|---|---|
| AE-001 | Synthetic traffic classification, forward-only, classify at CDR-cache population, never by CLI | 2026-08-03 |
| AE-002 | Route tester emits billing code / synthetic account | 2026-08-03 |
| AF-001 | No modification of existing business logic | 2026-08-03 |
| AF-002 | Four-layer model; derived analysis recomputable | 2026-08-03 |
| AF-003 | AI flags, never enforces | 2026-08-03 |
| AF-004 | Retention, encryption and PII governance | 2026-08-03 |
| AF-005 | Approved test number registry and consent lifecycle | 2026-08-03 |
| AF-006 | Clock source and measured offset | 2026-08-03 |
| AF-007 | Evidence chain of custody | 2026-08-03 |
| AF-008 | Intent vs observed reality | 2026-08-03 |
| AF-009 | Defined reference leg for attribution | 2026-08-03 |
| AF-010 | Hard admission control | 2026-08-03 |
| AF-011 | Portal scope — Main Platform, NOC and Admin only | 2026-08-03 |

**Open items:** vendor-targeting mechanism (§12) · AE-002 scope confirmation · reference
carrier selection per destination · BMEE hosting and repository name.
