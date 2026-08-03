# CAP-023 — CLI Verification Engine

**Status:** SPEC — open. Elaborates `VAL-004 CLI` in [CAP-021](CAP-021-SINGLE-CALL-VALIDATION-ENGINE.md) §7.
**Governed by:** CAP-021 v1.0. This document does not redefine the validator contract, the
four-layer model or evidence custody — it determines *where CLI can be observed*, *what
"correct" means*, and *which of today's CLI signals are trustworthy*.
**Depends on:** [CAP-022](CAP-022-VENDOR-TARGETING.md) for attribution (a detected rewrite
cannot be assigned to a vendor without vendor targeting).
**Blocks:** CLI-based vendor scoring, CLI clauses in vendor disputes, the "CLI PASS required"
success criterion in Test Profiles (CAP-021 §11).

---

## 1. The question

> When two people are connected, how do we determine that the CLI was correct or wrong —
> local GSM format, international format, or something else?

There is no single answer, because "correct" is not a property of the CLI string. It is a
relationship between **four different values observed at four different points**, judged
against **the destination country's dial plan** and **the commercial agreement**.

The mistake to avoid is treating this as string comparison. It is a chain-of-custody
problem, and it has exactly the same shape as the rest of CAP-021: observe, record, layer
the verdict separately, and never let a missing observation become a PASS.

---

## 2. Where CLI can change

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

## 9. Attribution depends on CAP-022

A rewrite detected without vendor targeting tells you the **route** rewrote CLI. It does
not tell you **which vendor** did, because LCR chose the path and nothing pinned it.

CLI verification and vendor breakout selection are therefore the same blocker, not two.
Both become commercially usable at the same moment: when CAP-022 §9 V5 establishes whether
`i_connection` is readable back per call, and a targeting mechanism is bound.

Until then CLI results are attributable to a destination and a time, never to a supplier —
and any UI that shows a vendor name next to a CLI verdict is asserting something the
evidence does not support.

---

## 10. Build order

| # | Step | Depends on | Value without the rest |
|---|---|---|---|
| 1 | Correct today's signal — rename to `originationCliMatch`, remove from vendor scoring and copilot narrative | none | Stops publishing a misattributed metric. Highest value, lowest cost. |
| 2 | Destination-aware normalizer + dial-plan table; E.164 identity compare and presented-form classification separately | destination catalogue | Makes any future observation interpretable. |
| 3 | Packet capture on the Sippy-facing interface — closes **O2** and BTA-006 together | disk safeguards (§4.1) | Proves our own origination is clean; joins BMEE legs to Sippy CDRs. |
| 4 | Terminating DID on our own infrastructure — closes **O3** | inbound test DID | Automatic delivered-CLI verification across the whole wholesale path. |
| 5 | Approved-test-number registry with attested manual reports — partial **O4** | consent register | Handset truth for certification runs. |
| 6 | Device agent (Android only) — automated **O4** | 5, consent, lawful-use review | Handset truth at scale. |
| 7 | Vendor attribution of CLI verdicts | **CAP-022** | Turns CLI evidence into a vendor decision. |

Steps 1 and 2 are pure platform work and are not blocked by anything.

---

## 11. What this capability does not do

- It does not judge whether a rewrite breaches a contract. That is L4 rule-pack territory.
- It does not detect CLI spoofing by third parties. This validates *our* CLI on *our* calls.
- It does not attribute a rewrite to a vendor before CAP-022 is ratified.
- It does not treat a missing observation as evidence in any direction.
