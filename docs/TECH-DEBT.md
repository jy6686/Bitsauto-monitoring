# Technical Debt Register

Items found during other work, recorded so they are not rediscovered. Each entry states what
the code does today, what it costs now, what it will cost later, and the intended fix.

Entries are removed when fixed, not marked done — git history is the record of what was.

---

## TD-001 · Rate matrix generator materialises one object per skipped cell

**Found:** 2026-08-01, reading `matrix-generator.ts` to decide whether the commercial reset
must precede the destination cutover.

**Current behaviour.** [`generateRateMatrix`](../server/services/rates/matrix-generator.ts)
iterates every destination × every product and pushes a `GeneratorSkip` object for each cell
it does not emit. The `no-rate` branch builds a fresh interpolated string per cell:

```ts
detail: `No price for ${d.name} on ${p.name}. A customer would carry this destination unpriced.`
```

Both `rows` and `skipped` are fully materialised arrays. In the empty case the only value
consumed downstream is `matrix.summary.rowsSkipped` — a count. The array is built in full to
produce a number.

**Impact today: negligible.** The deployment resolves 17 destinations × 4 products = 68
cells. `company_markets` is empty, so the step falls through to
`approved AND dial_prefix IS NOT NULL` against `global_destinations`, which is a 2,697-row
table with 35 approved rows.

**Impact after the cutover: high.** Migration 061 points the same query at `destinations`,
where 150,408 rows are approved:

```
150,408 × 4 = 601,632 skip objects, each with a ~70-character interpolated string
```

Order of 150–200 MB before V8 object overhead, allocated inside the provisioning rate step,
on a run that uploads zero rates. Memory growth, not CPU.

**Mitigation in place.** Migration 060 resets approvals to `unapproved` *before* 061 moves
the write path, so the destination set never reaches that size unreviewed. That is a safety
margin, not a fix — a deliberate approval of a few thousand destinations would reach the same
condition legitimately.

**Intended fix — the cause, not the ledger.** `product_destination_assignments` exists, 053
populated it, and the rate path consults it nowhere:

```
grep productDestinationAssignments server/services/rates/ server/services/provisioning/
-> no matches
```

The generator loops destination x every product the COMPANY bought, rather than destination x
the products that DESTINATION is sold on. That is where the Cartesian product comes from. The
storage format is already correct — `dial_prefix` holds the base code and the product digit is
composed at export (`trunkPrefix + dialPrefix`, "computed here, stored nowhere"), so there are
no per-product duplicate rows to remove.

Driving generation from the assignments removes the cells instead of counting them: the loop
never visits a destination/product pair nobody sells, so the skip ledger cannot grow large.

**Sequencing catch.** Only 52 assignments exist today. Switching the generator to treat them
as authoritative before they are populated would silently narrow what gets sold — the same
failure mode as the `2b8c7c71` fallback in the opposite direction. Populate first, switch
second.

**Interim fix, if the assignment work lands later.** Count exactly, retain a bounded sample:

```ts
rowsSkipped++;
skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
if (skipSamples.length < 100) skipSamples.push({ …, detail });
```

Counts by reason rather than a flat total, so `no-rate 601632, blocked 54, no-dial-prefix 12`
stays readable. This matches the shape already frozen for step metrics —
`failures: [{ cause, count }]` in [PROVISIONING-STEP-METRICS.md](PROVISIONING-STEP-METRICS.md)
— so the generator and the step report agree on how a category of problem is expressed.

**Sequencing.** Not before the provisioning certification. It touches the exact path being
certified, and at 68 cells the current version is correct. Scheduled with 061.

**Related:** [DESTINATION-MIGRATION-REPORT.md](DESTINATION-MIGRATION-REPORT.md) — the reset
ordering depends on this item.

---

## TD-002 · `company_markets` cannot be populated, so every customer falls through to "all approved"

**Found:** 2026-08-01, tracing why a provisioning run resolved 17 destinations.

`company_markets.destination_id REFERENCES global_destinations(id)` (migration 054), but the
wizard sends ids from the catalogue UI, which reads `destinations`. Every insert violates the
FK and is swallowed by a non-fatal handler at [routes.ts:27937](../server/routes.ts:27937),
so the company is created with zero markets and `intent.error` set.

`rates.step` then falls through to "all approved destinations". **No customer on the
deployment has a market recorded**, which means per-customer commercial scope does not
currently constrain anything.

**Fix:** migration 061 repoints the FK. The table is empty, so the repoint itself is free.

**Watch for:** the fallback added in commit `2b8c7c71` widens scope further by looking
unresolved prefixes up across *all* approved destinations. It was written to paper over this
symptom. Remove it once markets record properly — priced-but-out-of-scope is information for
an operator, not a licence to sell.

---

## TD-003 · Vendor rate normalisation never resolves to a destination

**Found:** 2026-08-01, in migration 058's dependency inventory.

```
vendor_rate_normalized_prefixes : 46,154 rows, every destination_id NULL
```

46k normalised vendor prefixes exist and not one is linked to a catalogue destination. The
vendor sheet pipeline runs to normalisation and stops there, so vendor pricing cannot inform
commercial approval or cost comparison.

**Related:** Vendor Sheets Sprint 2, which also owns the Bulk Import parser that put 1,135
IBIS codes into `dial_prefix` (cleaned by migration 052).

---

## TD-004 · The catalogue shows a routing table to commercial users

**Found:** 2026-08-01, asking whether the 150k prefix rows should be deleted.

**The question.** The catalogue lists ~150,408 rows. A commercial user sells a few thousand
destinations. "Why do I have 150,000 destinations when I only sell 3,000?" is a fair question
and it will be asked repeatedly.

**They must not be deleted.** The operator-series detail (`9370 Afghanistan Mobile AWCC`) is
what vendor comparison, LCR, fraud scoring and prefix matching all resolve against. When a
vendor quotes `92308`, resolving it to Jazz / Karachi / Pakistan Mobile is only possible with
these rows. Deleting them means re-importing them, and 150k rows costs Postgres nothing. The
problem is presentation, not storage.

**The type dimension already exists — do not add another.** From the schema's own comment on
`global_destinations`:

```
level: 1=Country, 2=Type(Fixed/Mobile), 3=Operator, 4=Sub-type
```

Levels 1-2 are the commercial layer, 3-4 the technical one, and the catalogue UI already
reads it (`LEVEL_LABELS`, level-coloured rows, expand/collapse on `level === 1`). Adding a
`destination_type` column beside `level` would be two columns describing one thing, free to
disagree, with no rule for which wins. The default view is a `WHERE level <= 2` filter, not a
migration.

`commercial_status` stays a separate axis. What kind of node this is, and whether we may sell
it, are different questions.

**Blocked on the commercial layer existing.** Migration 053 created FOUR commercial nodes.
Hiding levels 3-4 today yields a catalogue of about four rows — an empty catalogue, not a
clean one. The layer has to be built before the detail can be hidden behind it.

**It is derivable, not importable.** The names already carry the structure — country, type
and operator are in the string, against 363 country roots — so Country -> Type -> Operator
falls out of grouping data that is already present. No vendor re-import, and additive only.

**Order:** derive the commercial layer · reparent the prefix rows beneath it, which makes
`level` true rather than nominal · default the UI to `level <= 2` with a toggle for NOC and
engineering · point pricing and provisioning at the commercial layer.

That last step is [TD-001](#td-001--rate-matrix-generator-materialises-one-object-per-skipped-cell)
arriving from the other direction: an assignment-driven generator and a commercial-layer
catalogue are the same change seen from the code and from the data.

**Expansion runs INBOUND only.** A proposal to expand a commercial destination into its
technical prefixes when generating a tariff would undo migration 053, whose comment answers
it directly: "1923 rates every 923xxxxxxx call... Pricing per operator series instead would
mean thousands of rows per customer rather than 128." A customer tariff contains only the
rows we put in it, so one row at the commercial prefix already covers every operator series
beneath it.

The two layers are used in opposite directions, and conflating them is the trap:

```
technical prefixes  INBOUND   given a number, what is it?   vendor matching, CDR, fraud, LCR
commercial dests    OUTBOUND  what do we charge?            approval, assignment, tariff
```

`923081` from a vendor resolves UP to Jazz -> Pakistan Mobile -> an FC price. That lookup
needs all 150k. The tariff still receives one row.

**Inheritance changes what `commercial_status` means on a child row.** Eight read sites query
`commercial_status = 'approved'` directly. Under "approve Jazz, children inherit" the child's
status is derived, so either compute on read (recursive CTE, all eight queries change) or
materialise on write (cascade an UPDATE, existing queries unchanged, flag can drift). Prefer
materialising — but the cascade belongs in one migration or one service function, never spread
across the eleven write sites. A derived flag maintained in eleven places is how `destinations`
and `global_destinations` diverged.

---

## TD-005 · Pricing and Routing Templates are built, documented in the UI, and read by nothing

**Found:** 2026-08-01, looking for where to enter opening rates for provisioning certification.

Product Registry → **Pricing Templates** says *"Define buy rates and margin per destination.
Used when auto-provisioning Sippy tariffs."* Product Registry → **Routing Templates** says
*"Define vendor priority order per product. Used when auto-provisioning new accounts."*

Neither statement is true. Both have complete CRUD in
[routes-product-templates.ts](../server/routes-product-templates.ts) — create, update, delete,
per-prefix rates — and no consumer:

```
pricingTemplateRates  -> shared/schema.ts + its own CRUD file. Nothing else.
routingTemplate       -> its own CRUD file. Nothing else.
```

`rates.step` reads `product_rates`, written by Rate Manager → Product Rates
(`POST /api/product-rates`). The provisioning engine never touches either template table.

**Why this matters more than an unused table.** The screen tells an operator it feeds
provisioning. Someone will fill in a pricing template, provision an account, and get an
unpriced tariff with no error anywhere — the same silent-wrong-answer shape as approvals
landing in a table nobody read.

**Fix, in order of honesty:** either wire them into provisioning, or change the copy to say
what they currently are. Do not leave a screen claiming an effect it does not have.

**Related:** [[audit-before-building]] — this is the eighth capability found built and
disconnected. Check before implementing, and check the claim in the UI copy too.

---

## TD-006 · `product_rates` has no bulk entry path

**Found:** 2026-08-01, loading opening rates for provisioning certification.

`POST /api/product-rates` accepts one row. It is the only writer —
[routes-rate-manager.ts:214](../server/routes-rate-manager.ts:214) is the single insert into
the table. There is no CSV paste, no XLSX import, no array endpoint.

`buildBulkRateXlsx` exists but runs the other way: it builds the workbook sent OUT to Sippy.
Nothing loads rates IN.

**Impact today: small.** 17 commercial destinations x 4 products = 68 rows, a one-off of about
twenty minutes.

**Impact at the next step: this becomes the bottleneck.** Migration 053 sizes a customer
tariff at ~128 rows, and prices change — a vendor sheet lands, a market is repriced, a quarter
turns. Re-typing 128 rows per revision is where an operator starts keeping the real prices in
a spreadsheet and the platform stops being the source of truth.

**Not the 601,688-row problem it first looks like.** Pricing is per COMMERCIAL destination, and
one tariff row at `923` already covers every operator series beneath it — see
[CATALOGUE-V2](DESTINATION-CATALOGUE-V2.md), expansion is inbound only. The number is hundreds,
not hundreds of thousands. But hundreds, re-entered by hand every revision, is still the wrong
shape.

**Fix:** a bulk endpoint taking an array, plus paste-a-column or XLSX upload on the Product
Rates tab. Validate the whole batch before writing any of it, and report rejected rows with
their reason rather than failing the upload — the same contract the provisioning steps use.

**Sequencing:** after certification. It is a new write path into the table the rate engine
reads, and adding one while proving that engine works is how the two get confused.

---

## TD-007 · Rate notifications are sent regardless of whether the rate upload succeeded

**Found:** 2026-08-01, in the first end-to-end provisioning run that reached a Sippy tariff.

`account-email.step.ts` calls `sendRateNotificationEmails(ctx.companyId)` unconditionally. It
reads `product_rates` — what the platform *intends* to charge — and never consults
`ctx.results.rates`. The rate upload's outcome does not reach it.

Observed on run `PROV-20260801-5DTO9F`:

```
x Upload Rates          "the tariff does not hold what was sent"
v Send Account Details  "Rate notifications: 4 sent, 0 failed, 0 skipped"
```

Four rate sheets went to the customer for a push the platform believed had failed. In this
instance the upload had in fact succeeded — the rows are on tariff 66 — so the emails were
truthful by luck rather than by design.

**Why it matters:** on a genuinely failed upload the customer is told prices the switch is not
using. Violates the frozen invariant in
[DESTINATION-CATALOGUE-V2.md](DESTINATION-CATALOGUE-V2.md): *billing notifications follow
verified provisioning*.

**Fix, and its order dependency.** The gate is `ctx.results.rates?.verified > 0`. **Do not add
it before the read-back is fixed** — verification currently returns false negatives
([TD-008](#td-008)), so gating today would suppress notifications on runs that succeeded, which
is the harder failure to notice. Read-back first, gate second.

---

## TD-008 · Rate verification reports a false negative on a successful upload

**Found:** 2026-08-01, same run.

The step reported `only 0/3 sampled rate(s) read back — the tariff does not hold what was sent`
while all 11 uploaded rows were visibly present in Sippy tariff 66 three minutes later, with
correct product-digit prefixes and prices.

The sample is drawn from the rows that were built, so all three sampled prefixes were among the
eleven that landed. Partial pricing explains 11 rows instead of 52; it cannot explain 0/3.

**Two candidates, distinguished by one log line** — `[RateManager] bulk verify <prefix>: …`:

- `prefix N not found in tariff after push` -> Sippy's import had not applied at +35s. Fix is to
  poll until present rather than verify once. `getUploadStatus` never reaches `DONE` on this
  build, so the 15x2s poll always runs its full course and then verifies regardless.
- anything else -> `getSippyRateList` itself failed. It declares `tariffId: string` and passes
  it as `i_tariff`; the serialiser emits `<int>` only for a `number`, so this asks Sippy for
  `<string>66</string>`. Every tariff call that works declares `iTariff: number`.

**Consequence while unfixed:** a successful provisioning run reports COMPLETED_WITH_WARNINGS
saying the tariff does not hold what was sent. That message is what would stop an operator
trusting a run that worked — and it is the likeliest explanation for the tariff-33 defect
having stayed open for two weeks against a path that may have been functioning throughout.

---

## TD-009 · AMI access on reve-otp survives only until the next reboot or firewall reload

**Found:** 2026-08-03, during Sprint A of the Testing Platform. Elevated from a session note
to a tracked item because it cost significant time to isolate the first time and will
present identically the second time.

**Current state.** The Testing Platform reaches Asterisk Manager on `reve-otp` (159.223.32.59)
through port 5038. The host's `INPUT` chain permitted only `34.132.235.103` and `127.0.0.1`
on that port, followed by a `DROP` for `0.0.0.0/0`. Access was restored during Sprint A with:

```
iptables -I INPUT ...
```

**`iptables -I` writes to the running kernel table only.** Nothing persisted it. FreePBX
manages this host's firewall and regenerates the chain from its own configuration.

**Failure mode.** A reboot, a `fail2ban` reload, or any FreePBX firewall regeneration
silently removes the rule. There is no error and no log entry that names the cause.

**What it looks like when it happens.** The readiness panel turns red on the AMI check. The
failure text is a connect timeout, which reads as a network problem — and the previous
symptom in this same situation looked like a wrong password, which is what sent the first
investigation down the wrong path. Everything else stays green, so the Testing Platform
appears broken while both the platform and Asterisk are healthy.

**Why it matters more now than it did in Sprint A.** During Sprint A this was one person
debugging a new tool and expecting problems. Once the platform is used for day-to-day route
validation, the same silent failure arrives mid-investigation, and the natural reading is
"the testing tool is unreliable" rather than "a firewall rule vanished".

**Fix.** Add the allow-list entry through the **FreePBX Firewall UI** so it is written to
FreePBX's own configuration and survives regeneration, rather than as a raw `iptables`
rule. Scope it to the source address the Testing Platform connects from — the port should
not be opened broadly, since AMI is an unauthenticated-until-login control channel for the
switch.

**Acceptance criteria — two cold boots, not one.**

```
Configure the rule in the FreePBX Firewall UI
        ↓
Reboot                              ← removes the original in-memory state
        ↓
AMI readiness = PASS
        ↓
Synthetic call = PASS               ← proves the path, not just the port
        ↓
Reboot again                        ← proves the first result was persistence, not residue
        ↓
AMI readiness = PASS
```

One reboot is not sufficient. A persistence mechanism has not been proven until the
original in-memory state is gone *and* the result survives being reproduced. The call
between the reboots matters too: an open port proves reachability, not that AMI still
authenticates and originates.

**Not architecture.** This raises no observation ceiling and changes no design. It qualifies
under the sprint gate as operational hardening of an already-validated capability — the
evidence is only as good as the platform's ability to collect it on a Tuesday morning.

**Evidence update (2026-08-04) — mechanism identified, fix applied, acceptance pending.**
The chain listing dated the smoking gun: `/etc/sysconfig/iptables` was last written
**Jul 3 11:08**. `iptables-services` is active, so every boot restores the July 3
baseline — which is why every rule added in-memory since (including Sprint A's) died on
restart. The original hypothesis ("FreePBX firewall regeneration") was half right: the
FreePBX firewall module is *also* present (`fwconsole firewall trust` succeeds), so the
box has two firewall managers, and a rule must survive both.

The same artifact exposed the second face of the problem: the chain held **two
different Pakistani ISP addresses for the operator's Mac** (103.244.178.127,
175.107.203.134) and the **stale Replit egress IP** (34.132.235.103) alongside the
current one (34.29.247.124). Both AMI clients — the operator's Mac and the monitoring
platform on Replit — have rotating source addresses. A static per-IP allow-list will
keep breaking, one client at a time, with the same silent timeout.

**Correction (same day):** the belt-and-suspenders advice was wrong and caused an
incident. `fwconsole firewall trust` **woke the dormant FreePBX firewall**, which
regenerated the chains under its zone model and locked the operator out of the web GUI
(connection refused). A reboot cleared it — the module was never persistently enabled,
so the wake-up died with the boot. **Standing decision: one firewall owner.**
`iptables-services` + the saved baseline owns this box; the FreePBX firewall module
stays disabled; `fwconsole firewall trust` is off the runbook.

**Root cause, completed by the reboot:** the same reboot came up with an **empty
chain** — no 5038 rules, no DROP, the production PBX briefly open to the internet with
AMI bound to 0.0.0.0 — because `iptables.service` was **never enabled** (`systemctl
enable` created the symlink for the first time on 2026-08-04). So TD-009 had two
independent legs: rules never saved (file dated Jul 3), and a load service that never
ran at boot. Both closed: `service iptables save` + `systemctl enable iptables`.
A subtlety for the record: after that reboot the readiness panel showed **green for
the wrong reason** — the port was open to everyone, not allowed for us. A client-side
check cannot distinguish those; only the server-side chain listing can.

Still open before this entry closes:
1. **Two-cold-boot acceptance** — now legitimate: baseline saved *and* service
   enabled. The earlier reboot does not count (it exposed the gap; that was its job).
2. **The rotation decision** — static egress for the Replit deployment, or tunnel AMI
   instead of exposing 5038 to rotating addresses. The chain now carries two ISP IPs
   for the operator's Mac, a stale Replit IP, and a live one — per-IP rules against
   rotating clients keep breaking one client at a time. Also present: a stale
   GUI-created AMI manager `bitsauto-testin` (truncated name, pinned to an old ISP
   IP) — cleanup candidate once validation is done, not before.

---

## TD-010 · The "expected" side of a comparison carries no provenance

**Found:** 2026-08-03, when the operator stated that the production technical prefix is
`2221` and has been since day one — while `SIPPY_TECH_PREFIX=22211` in the Testing
Platform's `.env`.

**How the wrong value got there.** It was inferred, by me, from one live dialplan trace:

```
Dial("PJSIP/sippy-endpoint-…", "SIP/sippy/22211923088202412,3600,Tt")
```

Reading `923088202412` as a 12-digit Pakistan mobile leaves `22211` in front, so `22211`
was written into the config as the tech prefix. That is a plausible split of the string. It
is not the only one, and it was never checked against the switch.

**What it caused.** `compareCld()` reported `PREFIX_RESIDUAL` with `asConfigured: false`
against the Golden Reference — "only 4 of the 5 configured prefix digits were removed" —
and that finding was reported to the operator as a probable switch misconfiguration. If the
real prefix is `2221`, Sippy removed exactly its own prefix and the surviving `1` is a
deliberate element of the dial string, not a residue. The anomaly would then be an artefact
of the expected value, not a property of the call.

**The general defect.** Every observation in `cli_evidence` / `cld_evidence` carries
provenance — evidence level, confidence, and a stated reason. The value it is compared
*against* carries none. `configuredPrefix` arrives as a bare string from `.env` with no
record of whether it was read from the switch, supplied by an operator, or inferred.

A comparison is only as trustworthy as both of its inputs. Recording the observation
rigorously and the expectation casually produces confident findings about the wrong thing —
which is the same class of error as CAP-023 §3, arriving from the opposite direction.

**Fix.** Give the expected side a provenance field (`verified-from-switch` /
`operator-supplied` / `inferred`) and refuse to raise `asConfigured: false` above
`confidence: low` when the expectation is `inferred`. An unverified expectation may produce
an observation; it may not produce an anomaly.

**Blocked on:** the Sprint 2 switch review, which establishes the real value. Until then the
Golden Reference's CLD finding should be read as *"the dial string and Sippy's record differ
by one digit"* — which is a fact — and not as *"the switch is misconfigured"*, which is an
inference resting on a config value nobody verified.

---

## TD-011 · The production dial string carries a digit nothing explains

**Found:** 2026-08-03, when the operator stated the technical prefix has been `2221` since
day one, while every observed dial string carries `22211`.

**The evidence, with no inference.**

```
production dialplan   Dial(… "SIP/sippy/22211923088202412,3600,Tt")
Testing Platform      22211 + 922132803137  →  22211922132803137
Sippy CDR (CLD)                                 1922132803137
```

If the configured rule is *strip `2221`*, Sippy removed exactly its own prefix and behaved
correctly. The `1` is then not a residue of the prefix — it is a digit **we send**, present
in the string before it leaves Asterisk, on both the production and the test path.

**Question 1 — where is it introduced?** Partly answered already:

| Path | Where the string is built | Status |
|---|---|---|
| Testing Platform | [`applyTechPrefix()`](https://github.com/jy6686/bitsauto-testing-agent) — `techPrefix + destination`, one opaque field from `SIPPY_TECH_PREFIX` | **Answered.** No separate digit exists in code. The `1` is there only because the config value is `22211`, which was inferred (TD-010), not verified. |
| Production | Asterisk dialplan, `sippy-media-anchor` context | **Open.** Needs `grep -R "2221" /etc/asterisk` to see whether the dialplan composes it from parts or carries `22211` literally. |

Neither path introduces the digit downstream of Asterisk. It is not added by Sippy and not
added by an intermediate layer — that much is settled.

**Question 2 — what does it mean?** Open, and independent of Question 1. Candidates: service
selector, route class, billing indicator, national access digit, or a genuine part of the
prefix (making `22211` correct and the operator's recollection of `2221` incomplete). The
evidence cannot distinguish them; only the switch configuration can.

**Why it is debt rather than a bug.** Production has worked this way since day one, so
nothing is broken. The cost is that an element of every production dial string is
undocumented, which means nobody can say whether a future change to it is safe — and that
`SIPPY_TECH_PREFIX` may be one field representing two concepts.

**Do not change `SIPPY_TECH_PREFIX` until both questions are answered.** The configuration
model should follow the verified behaviour of the production system, not lead it. If `2221`
and `1` are genuinely separate concepts, the platform needs two fields with recorded
provenance; if they are not, one field is correct and only its value is wrong. Splitting
the field on the strength of the current evidence would encode a guess into the schema.

**Related:** TD-010 (expectation provenance) — the two entries share a cause.
