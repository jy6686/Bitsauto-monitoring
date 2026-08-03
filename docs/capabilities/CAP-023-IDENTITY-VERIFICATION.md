# CAP-023 — Identity Verification Engine

**Status:** SPEC — open. Elaborates `VAL-004 CLI` in [CAP-021](CAP-021-SINGLE-CALL-VALIDATION-ENGINE.md) §7,
and extends the same evidence model to the called number (§9).
**Scope:** both halves of call identity — **CLI** (who is calling) and **CLD**
(who is being called). They are transformed by the same hops, observable at the
same four points, and a troubleshooting session almost always needs both.
**Governed by:** CAP-021 v1.0. This document does not redefine the validator contract, the
four-layer model or evidence custody — it determines *where call identity can be observed*,
*what "correct" means*, and *which of today's identity signals are trustworthy*.
**Depends on:** [CAP-022](CAP-022-VENDOR-TARGETING.md) for attribution (a detected rewrite
cannot be assigned to a vendor without vendor targeting).
**Blocks:** CLI-based vendor scoring, CLI clauses in vendor disputes, the "CLI PASS required"
success criterion in Test Profiles (CAP-021 §11).

---

## 1. The question

> When two people are connected, how do we determine that the CLI was correct or wrong —
> local GSM format, international format, or something else?

And its twin, which the first real PASS forced into view: the same call carried
**three different representations of the called number**, and nothing in the
platform classified the difference.

```
requested   922132803137          entered by the operator
dialled     22211922132803137     tech prefix 22211 applied by us
observed    1922132803137         recorded by Sippy's CDR
```

The call completed and rated correctly as Pakistan/Karachi. It is also not the
transformation the configuration predicts — four of five prefix digits were
removed. "It worked" and "it did what we configured" are different statements,
and only one of them was verified.

There is no single answer, because "correct" is not a property of the CLI string. It is a
relationship between **four different values observed at four different points**, judged
against **the destination country's dial plan** and **the commercial agreement**.

The mistake to avoid is treating this as string comparison. It is a chain-of-custody
problem, and it has exactly the same shape as the rest of CAP-021: observe, record, layer
the verdict separately, and never let a missing observation become a PASS.

---

## 2. Where identity can change

```
Testing Agent      requested CLI            we choose this
      │
      ▼
Asterisk           CALLERID(num) → INVITE   may be overridden by dialplan
      │
      ▼
Sippy              translation rules        may rewrite per account/route
      │
      ▼
Vendor A           may rewrite              transit
      │
      ▼
Vendor B / N       may rewrite again        transit
      │
      ▼
Terminating        may localize             national-format conversion
carrier            may suppress             regulatory / anti-spoofing
      │
      ▼
Subscriber         what the human sees      the only value that matters commercially
```

Every hop is a place the value can change, and only the first and last matter to a
customer. Everything in between matters to a dispute.

**The called number runs the same gauntlet**, with one difference: we transform it
ourselves, on purpose, before it leaves. That makes CLD easier to verify — there is a
configured expectation to check against — and easier to get wrong, because a
transformation that "works" is assumed correct without anyone checking it did what
was configured.

```
Testing Agent      requested CLD           922132803137
      │
      ▼
Asterisk           tech prefix applied     22211922132803137     ← by our own configuration
      │
      ▼
Sippy              tech-prefix routing     1922132803137         ← four of five digits removed
      │
      ▼
Vendor / carrier   may re-translate        ?
      │
      ▼
Terminating switch what was actually rung  ?
```

---

## 3. Defect found in today's VAL-004 (must be fixed before the signal is used)

CAP-021 records VAL-004 as *"🟡 exists"*. Verified against the repository, **the existing
check cannot observe what it is being used to measure.**

`server/services/route-tester.ts:170-190` verifies CLI by probing the CDR cache:

```ts
const cdrHit = await _cdrLookupFn({ callId: result.callId, cld: job.destinationPrefix, ... });
if (cdrHit?.cli) {
  cliReceived = cdrHit.cli;
  const normSent = cliToSend.replace(/^\+/, '').replace(/\s/g, '');
  const normRecv = cliReceived.replace(/^\+/, '').replace(/\s/g, '');
  cliMatch = normSent === normRecv ? 'match' : 'mismatch';
}
```

The lookup injected at `server/routes.ts:36444` resolves against `cdrCache` and reads
`cli` / `number_a` — **the A-number of our own originating leg, as recorded by Sippy**.

Sippy records the CLI it *received from us* and *sent onward*. It has no feedback path from
Vendor A's network, so this record cannot contain a downstream rewrite. The comparison is
therefore:

> what we asked Sippy to send **vs** what Sippy logged that we sent

That is a genuine and useful check — it catches rewrites by our own Asterisk dialplan or by
Sippy's own translation rules (observation point **O2** below). It is **not** vendor CLI
behaviour, and it is structurally incapable of becoming vendor CLI behaviour.

**Consequences to correct:**

| Location | Problem |
|---|---|
| `route-tester.ts:388` `loadCliHealthSummary()` | Groups this signal **per vendor** over 7 days and publishes a `cliMatchRate`. The rate describes our own origination path, not the vendor. |
| `services/ai/route-copilot.ts:921` | Feeds `"CLI MISMATCH x/y verified (n% match rate)"` into vendor intelligence given to the AI copilot. A vendor can be characterised as rewriting CLI on evidence that never observed that vendor. |
| `route_test_results.cliMatch` | Three separate failure paths set `'unknown'` (`:188`, `:192`, `:196`), so in practice most rows are UNKNOWN — which is honest, but is then averaged into a rate as though absence were data. |

**Required change:** rename the stored field to reflect what it observes
(`originationCliMatch`), remove it from per-vendor scoring and from the copilot's vendor
narrative until a terminating-side observation exists, and keep `unknown` out of every
denominator (CAP-021 completeness rule — UNKNOWN is a property of the evidence, never a
score input).

This is an implementation-exposed gap, so it is a legitimate revision under the CAP-021
architecture freeze rather than design expansion.

---

## 4. The four observation points

| ID | Point | What it proves | Reachable today? |
|---|---|---|---|
| **O1** | **Requested CLI** — the value the profile asked for | Intent | ✅ Yes. BMEE `requested.cli`; already in every session file. |
| **O2** | **CLI on the INVITE leaving Asterisk** | Our own house is in order | ⚠️ Partially. We set `CALLERID(num)`; we do **not** read the wire. Needs packet capture (§4.1). Today's route-tester check is the Sippy-side proxy for this. |
| **O3** | **CLI arriving at the terminating SIP endpoint** | Everything upstream of the last mile | ❌ Not today. Requires a terminating leg we control (§5). |
| **O4** | **CLI displayed on the handset** | The only commercially meaningful value | ❌ Not today. Requires a human report or a device agent (§6). |

The chain is only as strong as its weakest observed link. A test that captures O1 and O2
and nothing else can state *"we presented the right number"* — it can never state
*"the customer saw the right number"*, and the narration must not imply otherwise.

### 4.1 Closing O2 properly

`CHANNEL(sip_call_id)` is unavailable on chan_sip / Asterisk 18 — this is already recorded
as BTA-006 UNKNOWN in the Golden Reference. The same limitation blocks reading the actual
`From` header.

One mechanism closes both: **packet capture on the Sippy-facing interface of the Asterisk
host**, filtered to the signalling port and to our test calls. It yields the true `From`,
`P-Asserted-Identity`, `Remote-Party-ID` **and** the SIP Call-ID that BTA-006 needs to join
the leg to a Sippy CDR. Two UNKNOWNs closed by one capture path.

Constraint from the 2026-08-03 incident: the host's root filesystem filled to 100% and took
MariaDB down for 67 minutes. Any capture must be ring-buffered with a hard size cap and
written outside `/`, or it becomes the next outage.

---

## 5. O3 — the terminating leg we control

The highest-value unlock, and it needs no handset and no human.

Register a **DID that terminates on our own SIP infrastructure** as a test destination.
Call it from the Testing Agent; read `From` / `PAI` / `RPID` on arrival. The delivered CLI
is then machine-observed, on every call, with no manual step.

What this proves: everything from our Asterisk through Sippy, through every transit vendor,
to the point of delivery. That is the entire wholesale path — which is where rewrites
actually happen.

What this does **not** prove: last-mile behaviour of a mobile network. Localization
(`92322…` → `0322…`) and suppression are frequently applied by the terminating mobile
operator *after* the SIP handoff. An O3-only result is silent about those.

So O3 and O4 are not redundant and one does not replace the other:

- **O3** answers *"did the wholesale route preserve CLI?"* — automatable, continuous, scalable.
- **O4** answers *"what did the subscriber see?"* — the commercial truth, but manual or agent-assisted.

---

## 6. O4 — handset truth

Two acquisition modes, both belonging in the approved-test-number registry that CAP-021
§AF-007 already requires:

**Manual report.** The person answering states what the display showed. Correct for
one-off certification, does not scale, and must be recorded as an attested observation with
who reported it and when — not as machine evidence.

**Device agent.** A companion app on a registered test SIM reports the presented CLI,
arrival time and answer/reject state automatically. Scales, but two constraints must be
stated before anyone plans around it:

1. **iOS cannot do this.** Third-party apps do not get the incoming caller number for
   ordinary cellular calls. Any device-agent plan is Android-only unless the test endpoint
   is a SIP client rather than the native dialler — and a SIP client is O3, not O4.
2. A registered test SIM in a foreign network is a **consent and lawful-use question**, not
   only an engineering one. It belongs to the same open item CAP-021 left outside the
   freeze (approved-test-number consent register).

---

## 7. Normalization — and why it is not string comparison

The naive form of the proposal is:

```
03224861153  →  923224861153   →  compare  →  PASS
```

That is right in direction and wrong in two ways that produce false PASSes.

### 7.1 A national-format number cannot be normalized without knowing whose plan applies

`03224861153` is Pakistan mobile **only if you already assume Pakistan**. The leading-zero
trunk prefix is a national convention; the same digits mean different things under
different plans. Normalization therefore takes the **destination country** as an input, not
the CLI's own apparent country.

If the destination country is unknown, the result is **UNKNOWN**. It is never a guess.

### 7.2 "Localized" is only correct relative to the destination

| Delivered CLI | Destination | Verdict | Why |
|---|---|---|---|
| `03224861153` | Pakistan | ✅ Localized, correct | A Pakistani subscriber can return the call. |
| `03224861153` | United Kingdom | ❌ Broken | A UK subscriber cannot return the call. The number is undialable from where it was delivered. |

Both rows normalize to the same E.164 value. String comparison after normalization scores
them identically. **The real test is callback dialability from the destination country**,
not equality with the requested value.

Therefore: normalize to E.164 for *identity* comparison, but classify the *presented form*
against the destination's dial plan. Both results are recorded; neither substitutes for the
other.

---

## 8. Outcome taxonomy

The proposed five outcomes are sound and incomplete — they have no UNKNOWN, and the
four-state contract is not optional here. A missing report is not a suppressed CLI.

| Outcome | Meaning | Requires |
|---|---|---|
| **EXACT** | Delivered CLI equals requested CLI in E.164 | O3 or O4 observed |
| **LOCALIZED** | Same identity, presented in the destination's national format, dialable there | O3/O4 + destination dial plan |
| **REWRITTEN** | A different but well-formed number was presented | O3 or O4 observed |
| **SUPPRESSED** | Call arrived with **positive evidence of no CLI** — `Anonymous`, `Private`, empty `From` user, `Privacy: id` | O3 or O4 observed |
| **MALFORMED** | Presented value is not a valid number under any applicable plan | O3 or O4 observed |
| **UNKNOWN** | No terminating-side observation exists | — |

**SUPPRESSED requires positive evidence.** "Nobody told us what the phone showed" is
UNKNOWN. Collapsing the two manufactures vendor accusations out of missing data, which is
precisely the failure mode CAP-021's four-state contract exists to prevent.

### 8.1 Observation is not verdict

REWRITTEN is not automatically FAIL. Legitimate causes exist:

- Regulatory CLI substitution on international-origin traffic presenting national CLI
  (several regulators mandate this as anti-spoofing enforcement).
- Attestation regimes such as STIR/SHAKEN causing substitution or downgrade on NANP routes.
- A carrier replacing a presented number that fails its own validity checks.

So the taxonomy above is **L3 — recomputable derived observation**. Whether a given
transformation breaches the agreement is **L4 — business decision**, evaluated by a rule
pack keyed to destination × vendor contract, and versioned so a re-evaluation under revised
rules never mutates the recorded observation. This is the CAP-021 layering applied
unchanged; no new architecture.

---

## 9. CLD — called-number transformation

Same evidence model, same four observation points, same UNKNOWN discipline. The one
structural difference is that CLD has a **configured expectation** to check against: we
know what prefix we applied, so each stage can be classified as matching that expectation
or not.

Implemented in `server/services/identity/cld.ts`.

| Observation | Meaning |
|---|---|
| **UNCHANGED** | Recorded exactly as requested — no transformation at this stage |
| **PREFIX_APPLIED** | The configured prefix is present and the requested number intact behind it |
| **PREFIX_STRIPPED** | An applied prefix was fully removed, leaving the requested number |
| **PREFIX_RESIDUAL** | Part of the applied prefix survived — **the case observed on the first PASS** |
| **DIGITS_PREPENDED** | Digits unrelated to the configured prefix were added |
| **TRUNCATED** | The requested number is no longer intact at the tail |
| **REWRITTEN** | The requested number is not present at all |
| **UNKNOWN** | Not observed |

Each carries `asConfigured: boolean | null` — whether the observation matches what the
configuration predicts — kept separate from the observation itself, so changing the
configured prefix re-derives the judgement without touching recorded evidence.

### 9.1 The observed case

```
requested   922132803137
dialled     22211922132803137     PREFIX_APPLIED    asConfigured: true
observed    1922132803137         PREFIX_RESIDUAL   asConfigured: false
```

Four of the five configured prefix digits were removed; `1` remained. The call completed
and rated correctly, so the translation is operational — but it is not the full removal the
configured `22211` prefix implies.

**What is determinable and what is not.** That the observed value equals `1` + the
requested number is certain — it is string arithmetic. *Why* is not: Sippy may match a
four-digit routing rule `2221`, or strip all five and prepend `1`, or treat `1` as a
service selector. All three produce identical output. So the engine records the
relationship and flags it for confirmation against the Sippy translation rules; it never
asserts the mechanism. Confidence is therefore capped at `medium` for this observation.

Corroborating signal: `1922132803137` does not parse as a dialable number under any plan,
which points to the CDR CLD being an intermediate, pre-translation form rather than what
was offered to the carrier. Recorded as `observedIsDialableNumber: false`, used as
supporting context and never as the verdict.

---

## 10. Narration

Every identity analysis is rendered in plain language by
`server/services/identity/narrate.ts` — deterministic, no LLM, regenerated on read and
never stored (CAP-021 L3).

The style rule is **describe, do not accuse**: report what was observed, what the
configuration predicted, and what remains unobserved. Real output for the first PASS:

> The requested caller ID was 923224861153. Every point we can see recorded the identical
> value — our own network recorded 923224861153 — so there is no evidence of rewriting
> within the parts of the path we observe.
>
> At Asterisk egress the called number was recorded as 22211922132803137. The configured
> 22211 prefix was applied and the requested number is intact behind it.
>
> At Sippy ingress the called number was recorded as 1922132803137, which is not what the
> configuration predicts. Only 4 of the 5 configured prefix digits were removed …
>
> No vendor or handset evidence exists for this call, so nothing can be concluded about
> caller identity beyond our own network. A carrier further along the path could have
> rewritten, localized or suppressed the CLI and this call would look exactly the same to us.

That last paragraph is mandatory and not decorative. A fluent summary that omits it is how
an evidence tool starts misleading the person reading it.

---

## 11. Identity timeline

`server/services/identity/timeline.ts` renders one row per point in the path, for both
halves of identity, naming the transformation between each observed pair.

```
● Requested        O1  CLI 923224861153   CLD 922132803137
● Asterisk egress  O2  CLI Unknown        CLD 22211922132803137  ← +22211 applied
● Sippy ingress    O2  CLI 923224861153   CLD 1922132803137      ← residual "1"
○ Vendor           O3  CLI Unknown        CLD Unknown
○ Carrier          O3  CLI Unknown        CLD Unknown
○ Handset          O4  CLI Unknown        CLD Unknown
```

**The path is a fixed list, so unobservable stages appear as rows rather than being
absent.** A timeline that silently stops at Sippy reads like the call stopped at Sippy. A
timeline whose last three rows say Unknown tells the operator exactly how far the evidence
reaches — which is the question they are really asking when they open it.

It publishes one derived value, `observationCeiling` (here `O2`), and that single field is
what makes attribution answerable without guessing.

---

## 12. Investigator

`server/services/identity/investigate.ts` answers a bounded question set from the recorded
evidence: *what happened · can I blame the vendor · can I blame our switch · why is the CLD
different · what did the subscriber see.*

### 12.1 Why this is deterministic and not a model call

The questions operators ask under pressure are **attribution** questions, and those are not
judgements about the call. They are set-membership tests on evidence coverage: does any
observation exist at or beyond the point being blamed? That is computable exactly from
`observationCeiling`.

Routing it through a language model would take an answer that is currently always right and
make it usually right. The failure mode is a fluent, confident accusation of a named
supplier — the most expensive mistake this platform could make, because it gets repeated to
that supplier in a commercial conversation.

So the reasoning is fixed code and the evidence is the input. A model belongs on top of
this later, phrasing questions and routing them to these answers — never deciding them.
This is CAP-021 **AF-003** applied literally: AI may flag and explain, never drive.

### 12.2 Attribution requires bracketing (AF-014)

Reaching past a hop does not license blaming it. To attribute a change to hop *N* you must
have observed the value **entering** *N* and the value **leaving** it. Otherwise a change
seen further along could have been made by anything in the gap.

This was caught by building INCONCLUSIVE. The first implementation answered the vendor
question from the observation ceiling alone, so handset evidence showing a rewrite would
have returned **yes — blame the vendor** while Vendor, Carrier and the terminating mobile
network were all unobserved. Three suspects, one accusation.

| Evidence | Verdict | Why |
|---|---|---|
| Nothing past Sippy | `unsupported` | The evidence never existed |
| Sippy + handset, nothing between | `inconclusive` | Change is real; span holds Vendor, Carrier, Handset |
| Sippy + Vendor + Carrier, value unchanged across Vendor | `no` | Bracketed and cleared |
| Sippy + Vendor + Carrier, value changed across Vendor | `yes` | Bracketed and isolated |

The comparison is between the values at the two bracketing observations — not a scan for
any downstream change. Scanning blamed the vendor for a rewrite the carrier made two hops
later.

### 12.3 Verdicts

There are **three ways of not knowing**, and they lead to different next actions:

| Verdict | Meaning | What to do about it |
|---|---|---|
| `unsupported` | The evidence never existed | Raise the observation ceiling (O2/O3/O4) |
| `inconclusive` | Evidence exists but does not resolve it | Add an observation point inside the span |
| `no` | Evidence reaches the subject and clears it | Nothing — the finding is elsewhere |

`unsupported` is a first-class verdict, not a hedge. *"No, the vendor did not do it"* and
*"nothing was observed at the vendor"* are different statements and only one is currently
true. `partially` exists because CLI and CLD routinely disagree — a clean CLI with an
unexpected CLD is the exact shape of the first PASS, and collapsing them into one yes/no
produced a verdict that contradicted its own first sentence.

Real output, for the first PASS:

> **Can I blame the vendor?** — *unsupported*
> No — and not because the vendor is cleared. There is no observation point inside or beyond
> the downstream vendor network on this call, so no conclusion about vendor behaviour can be
> supported in either direction.

> **Can I blame our switch?** — *partially*
> Not for the caller identity. The requested CLI was originated as configured and recorded
> unchanged at every point we can see inside our own network.
> For the called number, a transformation inside our own path did not match the
> configuration: only 4 of the 5 configured prefix digits were removed…

---

### 12.4 Recommended next observation

Every non-deterministic verdict carries the minimum additional evidence that would decide
it, so "we cannot tell you" arrives as a work item rather than a shrug.

| Verdict | Recommended next observation |
|---|---|
| `unsupported` — vendor | Terminating DID (O3), plus CAP-022 targeting for supplier attribution |
| `unsupported` — subscriber | Attested handset report, or Android device agent (O4) |
| `unsupported` — our switch | Ring-buffered packet capture on the Sippy-facing interface (O2) |
| `inconclusive` | The first unobserved hop inside the span |
| `observed` — CLD transformed | Confirm the Sippy tech-prefix translation rule — a config review, not an observation |

Two hops are marked `directlyObtainable: false`: **Vendor** and **Carrier** sit inside
networks we do not run. Their entries name the substitute that actually narrows the span —
vendor targeting, or a terminating DID that collapses Carrier and Handset into one endpoint
we control — rather than pretending the hop itself becomes visible. Putting an impossible
task on an operator's list is its own kind of dishonesty.

### 12.5 As a service

```
POST /api/identity/investigate   { resultId, question? }
GET  /api/identity/coverage
```

Deterministic: same evidence in, same verdict out, every time. The response carries
`verdict`, `answer`, `basedOn`, `limits`, `observationCeiling` and the full timeline. A
language model may sit in front of it — phrasing the question, reading the answer back
conversationally — and never produces the verdict. That is AF-013 as an interface boundary
rather than a convention.

`/api/identity/coverage` reports how far evidence reaches platform-wide, as a green/grey
path strip in the UI. The ceiling is the last **contiguous** observed stage: an isolated
observation further along does not extend reach, because the gap before it is exactly what
blocks attribution. Every capability on the build order raises this number, which makes
roadmap progress measured rather than asserted.

---

## 13. Attribution depends on CAP-022

A rewrite detected without vendor targeting tells you the **route** rewrote CLI. It does
not tell you **which vendor** did, because LCR chose the path and nothing pinned it.

CLI verification and vendor breakout selection are therefore the same blocker, not two.
Both become commercially usable at the same moment: when CAP-022 §9 V5 establishes whether
`i_connection` is readable back per call, and a targeting mechanism is bound.

Until then CLI results are attributable to a destination and a time, never to a supplier —
and any UI that shows a vendor name next to a CLI verdict is asserting something the
evidence does not support.

---

## 14. Build order

| # | Step | Depends on | Value without the rest |
|---|---|---|---|
| 1 | Correct today's signal — rename to `originationCliMatch`, remove from vendor scoring and copilot narrative | none | Stops publishing a misattributed metric. Highest value, lowest cost. |
| 2 | Destination-aware normalizer + dial-plan table; E.164 identity compare and presented-form classification separately | destination catalogue | Makes any future observation interpretable. |
| 2b | CLD transformation classification against the configured prefix, plus identity narration | 2 | Turns "it worked" into "it did what we configured", at every stage we can see. |
| 2c | Identity timeline + deterministic investigator | 2b | Operator can see how far the evidence reaches and what may be concluded from it. |
| 3 | Packet capture on the Sippy-facing interface — closes **O2** and BTA-006 together | disk safeguards (§4.1) | Proves our own origination is clean; joins BMEE legs to Sippy CDRs. |
| 4 | Terminating DID on our own infrastructure — closes **O3** | inbound test DID | Automatic delivered-CLI verification across the whole wholesale path. |
| 5 | Approved-test-number registry with attested manual reports — partial **O4** | consent register | Handset truth for certification runs. |
| 6 | Device agent (Android only) — automated **O4** | 5, consent, lawful-use review | Handset truth at scale. |
| 7 | Vendor attribution of CLI verdicts | **CAP-022** | Turns CLI evidence into a vendor decision. |

Steps 1 and 2 are pure platform work and are not blocked by anything.

---

## 15. What this capability does not do

- It does not judge whether a rewrite breaches a contract. That is L4 rule-pack territory.
- **It does not build an evidence graph.** Cross-call questions — "show every route with
  this same residual CLD transformation", "which destinations exhibit this translation
  pattern" — need an accumulated corpus, not more architecture. Deliberately postponed
  until the corpus exists; building the graph first would be designing against imagined
  data. Recorded here so it reads as a deferral, not an omission.
- It does not answer open natural-language questions over the evidence corpus. The
  investigator answers a bounded, fixed set. Free-form querying ("show all calls where
  localization occurred") needs the accumulated evidence store and a query layer, neither of
  which exists yet.
- It does not assert *why* a transformation happened. It records the relationship between
  what was sent and what was recorded; the mechanism belongs to the switch configuration,
  which lives outside this platform.
- It does not detect CLI spoofing by third parties. This validates *our* CLI on *our* calls.
- It does not attribute a rewrite to a vendor before CAP-022 is ratified.
- It does not treat a missing observation as evidence in any direction.
