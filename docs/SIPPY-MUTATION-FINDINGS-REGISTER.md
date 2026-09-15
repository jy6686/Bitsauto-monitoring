# Sippy Mutation & Authorization Findings Register

Every code path that can mutate Sippy, audited for whether the platform can tell "nothing was
sent" from "something was sent and we do not know what happened". Open findings are listed
first; the controls that already hold are listed after, because knowing which paths are safe is
what keeps this audit from being repeated.

Entries are removed when fixed, not marked done — git history is the record of what was.

**Why this register exists.** Commit `40a2650d` found that `uploadRatesWorkbook`, on the live
provisioning write path, had no mutation boundary at all, and collapsed "the token request
failed, nothing was sent" together with "the workbook uploaded and the read-back did not
confirm it" into one retryable failure. The boundary had been built for the Rate Manager push
and quietly assumed to be a property of the system.

> **Rule now in force.** Mutation-boundary safety is NOT generalisable from one Sippy path to
> another. Every independent mutation path must be individually audited before it is
> authorized. Paths eventually calling common Sippy code do not thereby share its semantics.

**What the audit tests for.** A missing boundary only matters where the mutation is
non-idempotent *and* the platform acts on the verdict — by retrying, or by recording a result.
An idempotent SET and a reconciling read-back are legitimate alternatives to a boundary. This
register classifies rather than counts, so that "no boundary" is not read as "unsafe".

---

## Open findings

| ID | Finding | Severity | Status | Required decision |
|----|---------|----------|--------|-------------------|
| SMP-007 | **Tariff 65's importer refuses every rates upload before parsing.** Three attempts (2026-09-15, differing prefix, rate and date) each FAILed with a **zero-byte report**; the identical operation SUCCEEDED on tariff 64. Not a platform defect and not a content defect — the paired test eliminates both | Medium | **OPEN — external** | Sippy-side inspection of the importer state attached to tariff 65. **No application change may be made to compensate.** Do not push to tariff 65 for diagnosis; the fixture is already fully controlled |
| SMP-005 | `POST /api/sippy/upload/file` sends caller-supplied bytes to a **caller-supplied URL** (`?url=`) with no allowlist and `rejectUnauthorized: false`, and returns the response body. Paired with `POST /api/sippy/upload/token`, which accepts an arbitrary `i_tariff`, the two compose into a generic rate-rewrite capability. Both currently ungated | **Critical** (proposed) | OPEN | Not fixable by a role floor alone — needs a destination allowlist. Assess before the create/update pass |
| SMP-004 | Two further shadowed route registrations — `GET /api/reports/asr-acd` and `GET /api/sippy/accounts/:id/info` each registered twice, the second copy unreachable. **Neither carries authorization, so neither is an authorization exposure**: divergent dead implementations, not an open door | Low | OPEN | Decide which implementation is intended, then remove the other |
| SMP-003 | **57 of 160** `/api/sippy` write routes have no gate of any kind, and `/api/sippy` is absent from `PLATFORM_ROUTE_GROUPS` so `requirePlatformAccess` never runs; the tariff-rate DELETE is reachable by any authenticated session, `portal_only` included. Includes a **shadowed gate**: `DELETE /api/sippy/tariffs/:id` is registered twice and the `requireRole(['admin'])` copy is unreachable | **Critical** | OPEN — audited, policy not yet decided | Separate authorization-hardening decision. Evidence: [SMP-003-AUTHORIZATION-AUDIT.md](SMP-003-AUTHORIZATION-AUDIT.md) |

SMP-001 and SMP-002 were fixed together and are removed rather than marked closed — see the
convention above; `git log docs/SIPPY-MUTATION-FINDINGS-REGISTER.md` and the commit that removed
them are the remediation record.

SMP-003 is kept deliberately separate from the boundary work. Authorization scope and mutation
outcome semantics are different controls; remediating them in one change would make both harder
to review, and neither is a substitute for the other.

---

### SMP-003 · Authorization gap on `/api/sippy` write routes

**Severity: Critical. Status: OPEN. Separate decision — do not fold into boundary work.**

**Found:** 2026-09-10, same audit.

**Current behaviour.** **57** of 160 `/api/sippy` write routes (`POST`/`PUT`/`PATCH`/`DELETE`)
have no gate of any kind. Sibling routes show the pattern exists and was simply not applied
consistently — `/api/sippy/users/:id` and `/api/sippy/customers/:id` both gate on
`requireRole(['admin'])`.

> **Corrected 2026-09-10.** This entry first recorded "76 of 160", from a single-line grep that
> missed `requireRole` on multi-line registrations (8 routes) and an entirely different gating
> mechanism — inline role check plus approval workflow (11 routes). "No `requireRole`" is not
> "no gate". One part of the finding is WORSE than first recorded: `DELETE /api/sippy/tariffs/:id`
> is registered twice and its `requireRole(['admin'])` copy is shadowed and unreachable.
> Full evidence, including the 57 routes by operation and a policy proposal derived from the 92
> already-gated ones, is in [SMP-003-AUTHORIZATION-AUDIT.md](SMP-003-AUTHORIZATION-AUDIT.md).

Two layers were expected to cover this and do not:

- [`routes.ts:937`](../server/routes.ts) requires only that a session exists — any authenticated
  user passes.
- `requirePlatformAccess`, which blocks `portal_only` users, is applied per prefix at
  [`routes.ts:956`](../server/routes.ts) over `PLATFORM_ROUTE_GROUPS`. **`/api/sippy` is not in
  that list**, so the middleware never runs for this group.

**Impact.** `DELETE /api/sippy/tariffs/:id/rates` deletes every rate in any tariff by id, and is
reachable by any authenticated session — including a `portal_only` user, who is not otherwise
permitted on the main platform. The same applies to tariff, trunk, trunk-connection and rate
deletion routes in the ungated set.

**The access-log check cannot be completed.** The platform keeps no per-request access log — no
HTTP logger, no path column, and `AuditInput` carries neither a path nor `platformAccessType`.
Only 3 of the 57 ungated routes write any audit record, so 54 of them, including the tariff-rate
DELETE, leave no trace of who called them. The empirical gate proposed before the
`PLATFORM_ROUTE_GROUPS` decision therefore cannot be met from platform data, and these routes are
**unauditable** both before and after any fix. See the audit for the full check.

### The evidentiary boundary, stated precisely

> No evidence of `portal_only` use was found because the application has no path-level access
> log — **not** because `portal_only` users were proven never to have called `/api/sippy`.
>
> The absence of access records is not evidence that access did not occur; it is evidence that
> **the system cannot determine whether it occurred.**

What the code evidence does establish: `/api/sippy` is absent from `PLATFORM_ROUTE_GROUPS`, no
identified portal-scoped UI calls it, and `client-portal.tsx` is itself restricted to
admin/management. Historical production access cannot be established from application data.

Concretely, if `DELETE /api/sippy/tariffs/:id/rates` has already been exercised, the application
cannot answer who invoked it, when, from which session, whether that session was `portal_only`,
or which tariff was targeted.

**Deployment logs are outside this environment.** External Replit deployment logs could answer
the historical-access question, but there is no route to them from the codebase: no Replit CLI, no
file-based logging in the application, and no local log files. Only someone with Replit console
access can run that check. It is therefore **not a prerequisite for ratification** — the policy
below is forward-looking, and historical `portal_only` usage stays recorded as unknowable from
application data unless that external check is performed and its result added here.

### RATIFIED policy — 2026-09-10

Ratified as the platform's engineering authorization policy on the completed evidence. Derived
from the 92 routes already gated (destructive → `admin`, 15 of 18; everything else →
`admin, management`, 67 of 74) rather than invented.

Ratification is an engineering-policy decision; it does not claim the engineering team owns the
business authorization policy, and implementation remains subject to the organizational owner
where governance requires one to approve who may perform these operations. Ratifying SMP-003
implies **no** authorization for 514/515 deployment or any Sippy write.

| Route class | Proposed access |
|-------------|-----------------|
| Destructive / disconnect | `admin` |
| Create / update | `admin`, `management` |
| Read / validation | `admin`, `management` |
| `/api/sippy` from `portal_only` | Deny at the platform boundary |
| Existing approval workflows | Preserve unchanged |

**The floor applies to everything, including the high-consequence routes.**

The three routes below were first drafted as exceptions to the baseline. That was corrected before
ratification: making them exceptions would have left the most consequential routes open while
lower-risk ones were remediated — the tariff-rate wipe, the clearest exposure in this finding,
would have been last to close. They receive the default floor **in the same pass as everything
else**, and the separate decision is scoped to whether they need MORE control on top. The
exception process can only tighten, never delay.

| Route | Floor (immediate) | Separate decision (may only tighten) |
|-------|-------------------|--------------------------------------|
| `DELETE /api/sippy/tariffs/:id/rates` | `admin` | Confirmation guard, as the restore route has |
| `PUT /api/sippy/system-config` | `admin` | Additional high-impact control if warranted |
| `POST /api/sippy/invoices/generate` | `admin`, `management` | Additional financial control if warranted |

**Still to confirm individually — not blockers:** the three destructive routes currently at
`admin, management` (confirm as deliberate or align to `admin`; do not normalise silently), and
whether `/api/sippy` joins `PLATFORM_ROUTE_GROUPS` absent external deployment-log evidence.

---

### SMP-004 · Two more shadowed route registrations

**Severity: Low. Status: OPEN.**

**Found:** 2026-09-10, by the duplicate-registration guard written for SMP-003 step 1 — which is
the reason that guard covers the whole file rather than the one route the audit had found.

| Route | Serves | Shadowed |
|-------|--------|----------|
| `GET /api/reports/asr-acd` | L5273 | L9551 |
| `GET /api/sippy/accounts/:id/info` | L10759 | L13519 |

**Not an authorization exposure.** Neither shadowed copy carries `requireRole`, so unlike SMP-003
nothing here reads as protected while being open. What remains is a correctness and maintenance
defect: two implementations exist, one can never run, and a change made to the wrong one has no
effect while appearing correct.

**Intended fix.** Determine which implementation is intended — they are not obviously equivalent —
then remove the other. Same behavioural-comparison step SMP-003 required, without the urgency.

Both are pinned by `route-registration.test.ts`, so a NEW duplicate fails the test rather than
joining them silently.

---

### SMP-005 · The upload pair is a mutation capability, and its destination is caller-controlled

**Severity: Critical (proposed). Status: OPEN.**

**Found:** 2026-09-10, while deciding whether the create/update floor could be applied uniformly.
It could not, and this is why the audit's own note — that name-based classification must be read
rather than trusted — was worth writing down.

**Two routes, one capability.**

- `POST /api/sippy/upload/token` (L8602) takes `iUploadType` and a free-form `params` object,
  passed through to `getUploadToken`. `params` is where `i_tariff` goes.
- `POST /api/sippy/upload/file` (L8648) takes a raw binary body up to 200 MB and posts it to
  `req.query.url`.

Together: obtain an upload token for any tariff, then upload a rates workbook to it. That is the
same consequence as `DELETE /api/sippy/tariffs/:id/rates` — a customer's entire pricing — reached
through two routes a name-based classification files under "create". Both are in the ungated 57.

**The destination is caller-controlled, which authorization does not fix.**
`uploadBinaryFile` (`sippy.ts:5263`) does `new URL(uploadUrl)` and posts to whatever hostname it
names. There is no allowlist, no check that the host is the configured Sippy switch, and
`rejectUnauthorized: false` disables certificate verification. The response body is returned to the
caller.

So the route makes the server POST attacker-chosen bytes to an attacker-chosen host and hands back
what it says — usable against hosts reachable from the server but not from the caller. A role floor
narrows *who* can do this; it does not stop an authorized caller doing it, and it is not what the
route is for.

**Intended fix.** Two separable things, and the second is not an authorization change:

1. Floor both routes at `admin`, the destructive tier — not `admin, management` — because
   together they rewrite tariffs.
2. Constrain the destination: `/upload/file` should accept a URL only if it matches the configured
   Sippy host, ideally only a token URL this platform just issued. Whether `rejectUnauthorized:
   false` is still required for the switch's self-signed certificate is a separate question worth
   answering rather than inheriting.

### Implementation safety invariant — ordering, not a single pass

When SMP-003 is implemented, the duplicated route must be resolved as its own step **before** any
gate is added:

1. Resolve the duplicate registration
2. Verify which route now survives and serves
3. Add the authorization gate to it
4. Test the actual reachable route

**Progress:** step 1 complete (`b45017f9`) — duplicate resolved behaviourally, no gate applied.
Step 2 complete — `DELETE /api/sippy/tariffs/:id` established by RUNTIME resolution as the
`deleteTariff` handler. Step 3 complete — `requireRole(['admin'])` applied to **that** registration
and nothing else; the confirmation guard is deliberately NOT included, being a tightening decision
above the floor. Step 4 complete — role-level acceptance driven through the REAL application
(`registerRoutes()` against a real Express app, real `requireRole`, real handler; only
`sippy.deleteTariff` replaced by a recorder). admin → 204 and the mutation is attempted;
management, viewer, destination_manager, finance, noc, and a user with no role → 403 with the
recorder EMPTY; unauthenticated → 401. A denied caller is proven not to reach the mutation, which
is a stronger claim than a 403 in the response body.

**The single-route remediation is complete.** Two things it deliberately does NOT do, asserted as
behaviour so they stay visible: a `portal_only` session holding an admin role is still allowed,
because `/api/sippy` is absent from `PLATFORM_ROUTE_GROUPS` and the role floor is not a substitute
for that boundary; and no confirmation is required, that being a tightening decision above the
floor. Both remain open scope.

The assertion that closes this out lives in `route-reachability.test.ts`: it resolves the request
through real Express and requires the gate to be on the line Express lands on — not merely present
somewhere in a handler for that path, which is what passed while the shadowed copy carried the
gate. Re-creating that defect (an ungated copy registered earlier, gated copy still in source)
fails 5 assertions there, while a source grep still reports one gated registration and reads as
protected.

**Not "resolve and gate in one pass."** Express serves the first matching registration, so a gate
added to the shadowed copy is present in the source and inert at runtime. A source-level
assertion — the style used throughout this work, grepping the handler for `requireRole` — would
pass on exactly that arrangement while the ungated first registration keeps serving. The test
would be green and the route open.

Step 4 means the reachable route, established at step 2, not the one a grep happens to find.

**Why step 2 is a separate step and not a formality.** "Exactly one source registration" is
necessary and not sufficient: it cannot see path-pattern shadowing. A different pattern registered
earlier — `/api/sippy/:resource/:id`, a mounted router, a wildcard — intercepts the request while
the source still shows one literal registration of the path. `route-reachability.test.ts` resolves
the request through real Express over the application's actual registration order, with every
handler replaced by a marker so no real handler code and no Sippy call can run.

Demonstrated, not asserted: injecting `DELETE /api/sippy/:resource/:id` ahead of 9059 fails the
reachability test on 4 assertions, while step 1's source-level test passes 9 of 9 and sees
nothing.

### Logging, scoped narrowly

General HTTP request logging is **not** in scope and should not be added under this finding. But
remediation should make an authorization **denial** attributable, or it creates a state where
"the route is correctly blocked" is true and the application cannot demonstrate that the block
occurred. Authorization events only — not a general observability project.

**Intended fix.** An authorization-scope decision, not a code cleanup: which roles may reach
which Sippy write operations, and whether `/api/sippy` belongs in `PLATFORM_ROUTE_GROUPS`.
Adding `requireRole` route-by-route without that decision would encode 76 individual guesses.

---

### SMP-006 · Effective-dated pushes are applied twice: the future row AND the live row — **CLOSED / VERIFIED 2026-09-15**

**Found:** 2026-09-14, on the first legitimate write since the freeze (`job-1789402775430`, Test-31,
tariff 64, `19370` 0.133 → 0.196 effective 2026-09-22). Policy layer passed it correctly. The write path
did not honour the date.

**Mechanism.** `pushRateToSippy` (`server/sippy.ts`) uploads the XLSX via `getUploadToken`; Sippy
created a NEW rate row `iRate 9175` @ 0.196 with activation `2026-09-22` — the correct result. The
upload status settled at `FILE_UPLOADED`, so the code verified by reading the tariff back.
`verifySippyRate` selects `result.rates.find(r => r.prefix === prefix)` — the FIRST row for the prefix,
with no regard to activation date — and found the still-current row at 0.133. It reported
`confirmed=false`, the primitive fell through fourteen XML-RPC method guesses, and the `portal_csv`
fallback then EDITED the live row `iRate 9115` to 0.196 / 60/1 (from 0.133 / 1/1), Sippy setting its
expiry to 2026-09-22. Read-back afterwards: two rows, both 0.196. **The rate changed today, not on the
effective date, and the billing increment on the live row changed today too.**

**Boundary semantics.** Two mutations occurred; the operation record shows one (`attempts: 1`,
`method: portal_csv`, `verification: confirmed`). The first write is invisible to the record because
its own verification called it a failure. This is the same family as the tariff-64 mechanism already
recorded under `sippy-rate-upload-format`: a verifier that cannot see what it just wrote invites a
second write.

**Blast radius.** Any push with `effectiveFrom` in the future, on a prefix that already exists in the
tariff. For a real client that is an early rate change with billing consequences and a customer notice
that states a date the switch did not honour. Pushes with no effective date are unaffected (the
future row and the live row are the same row).

**Fix, when authorised.** In `verifySippyRate`, when an effective date was requested, confirm on the
row whose activation equals that date (or the latest-activating row for the prefix), and treat a
future-dated row at the expected rate as CONFIRMED. Then the fallback never runs. Do not "fix" it by
removing the fallback: it is the path that makes same-day edits work on this Sippy build.

**Second cause, found 2026-09-15.** Sippy's `getUploadStatus` for the 2026-09-14 token shows the
import reached `DONE` at 16:20:29 — 43 s after processing began — while the push's poll loop (15 × 2 s)
gave up at ~36 s and verified a tariff the import had not finished writing. The verifier was early as
well as date-blind. The same 15-poll budget sat in `uploadRatesWorkbook`, the provisioning path.

**Fix (local, commit after ac296ddb).** Both pollers wait up to 60 × 2 s. The status struct is kept:
the trace now records `status_changed_on` and the report URL instead of one word. On `FAIL` the push
reads the tariff back and, if unchanged, returns `verificationResult: 'mismatch'` — a retryable
failure that never continues into the XML-RPC guesses or the portal fallback.

**Closing pilot #1, 2026-09-15 08:39Z (`job-1789461549245`, Test-312, tariff 65, `192` 0.04 → 0.05
effective 10:00 GMT).** Sippy's importer refused the file (`FAIL` at +9 s); tariff 65 unchanged; the
fallback gate REFUSED the future-dated portal edit and returned `indeterminate`. Under the pre-fix
code the live row would have been edited. **Negative path proven on production.** The reason for the
FAIL is at `https://191.101.30.107/download/reports/eedf88b9-f448-40a6-8ee1-53cef0465522` (Sippy
login); the code that discarded it is the code fixed above. Positive path (scheduled row created,
live row untouched, verified as DONE) still to be shown.

**Tariff-64 state re-read 2026-09-15 13:09Z, under owner authorisation, before the proposed
discriminating write.** Two rows for `19370`, both at 0.196 and both `60/1`: `iRate 9115` activated
2026-07-31 17:00 with an `expirationDate` of 2026-09-22 00:00, and `iRate 9175` activating
2026-09-22 00:00. This is the damaged state SMP-006 produced, unchanged since. Note the live row now
carries an explicit expiry, so the scheduled row supersedes it cleanly — the defect is the rate and
increment that changed on 09-14, not the succession.

**Discriminating write, 2026-09-15 13:26Z — tariff 64, `19370` 0.133-era row untouched, requested
0.200 effective 2026-09-15 14:30 GMT (owner-authorised, run from the owner's browser after the
session's permission classifier refused it locally).**

Result: Sippy's importer refused the upload again. `FAIL` at 13:26:29 GMT, 64.8 s into the push.
Read-back: tariff 64 unchanged, both rows still 0.196 / 60/1, `9115` expiring and `9175` activating
2026-09-22. Verdict `failure` (retryable), method `upload_token`. The message names the date logic
explicitly: *no row activating 20260915; judged the latest-activating row (20260922)*.

**The reason, read 2026-09-15 after the report reader was fixed.** The importer's own words, one
row, echoing the upload back: `A | | 19370 | | 60 | 1 | 0.2 | 0.2 | 0 | 1 | 2026-09-15 14:30:00 | |`
— **"Another Rate with conflicting \"Prefix\" or \"Activation/Expiration Date\" already exists."**

The upload was well-formed. Sippy parsed it, echoed the activation back as a proper date cell, and
rejected it on a **date conflict**, which the tariff's own rows explain completely: `9115` occupies
2026-07-31 17:00 → 2026-09-22 00:00 and `9175` occupies 2026-09-22 00:00 → ∞. An added row
activating 2026-09-15 14:30 with no expiration overlaps both. There was no gap to add into.

**PREVIOUS CONCLUSION WITHDRAWN.** On first reading this FAIL — before the report was legible — this
entry said the fault was "the future-dated import path itself" and that tariff 65 was eliminated as
special. **Both claims were wrong**, and the error is instructive: the discriminator was run against
the very state SMP-006 had damaged, so it tested a tariff that already held two rows covering the
requested date. It measured the damage, not the path.

**What is actually established.**
1. **Future-dated A-uploads DO work on this build.** The 2026-09-14 push created `9175` with
   activation 2026-09-22 correctly. That was never the defect; the extra portal edit was.
2. **Tariff 64's refusal is legitimate and specific** — a real overlap, correctly refused, correctly
   reported. Sippy behaved well here.
3. **Tariff 65 is NOT eliminated.** Its report is genuinely zero bytes and its FAIL came at +9 s
   against +64.8 s here. Different timing, different report, different mode. Pilot #1's cause
   remains UNKNOWN.

**What still held, and is worth keeping.** Under a real refusal the boundary behaved: tariff
unchanged, no `portal_csv` fallback, verdict `failure` (retryable), correct tariff and prefix, no
premature increment change. And the 60 × 2 s poller observed a FAIL at +64.8 s that the old 15 × 2 s
budget would have missed entirely — the exact second cause of SMP-006.

**Reading the report at all required a fix.** It is an XLSX workbook; `fetchUploadReport` decoded
the ZIP as UTF-8 and returned `PK` followed by replacement characters. Fixed in `a7103a82`
(`rawGetBinary` + exceljs, judgement extracted as the pure `interpretUploadReport`, which keeps a
login page, zero bytes, a workbook and an UNPARSEABLE workbook distinct — the last must never be
reported as the first). A second defect in the reader itself was found by reading this very report:
a date cell rendered as `"2026-09-15T14:30:00.000Z"`, JSON quotes included, which is what first
made the upload look malformed. `reportCellText` now renders dates in the switch's own form.
**A reader that decorates evidence manufactures a false lead, and this one did, for one reading.**

**To prove SMP-006's positive path** the push must go somewhere with no conflicting window: a prefix
with a single open-ended row, or an activation after the last row's. That is a Sippy write and needs
the owner's word.

**Closing pilot #2, 2026-09-15 14:53Z — the clean fixture, and the t65 mode REPRODUCED.**
Tariff 65, Test-312, `192` 0.04 → 0.05, effective 2026-09-16 10:00 GMT. Chosen after a read-only
survey precisely to remove every confound the tariff-64 attempt carried: the tariff holds **one**
row for `192` (`9116`, 0.04, 1/1, activating 2026-07-31 17:00, **no expiration**), so no overlap is
possible; and the catalogue increment for destination 883 (PAKISTAN - FIXED, prefix `92`) is `1/1`,
identical to the switch row, so the increment does not move either. Only the price changes.

**Result: refused again, pre-parse, with a ZERO-BYTE report.** `FAIL` 17 s after processing began.
Tariff unchanged: `9116` still 0.04 / 1/1 / no expiration. Verdict `failure`, method `upload_token`,
no `portal_csv`.

| | t65 pilot #1 | t65 pilot #2 | t64 discriminator |
|---|---|---|---|
| processing → FAIL | **9 s** | **17 s** | **52 s** |
| report | **0 bytes** | **0 bytes** | 1 row, a real error |
| overlap possible? | no | **no** | yes |
| verdict | indeterminate (gate) | failure | failure |

**This is the important outcome: the unknown mode is now REPRODUCIBLE ON DEMAND**, on a fixture with
no overlap, no increment change and a known-good shape. A defect that can be summoned is a defect
that can be found; before today it had happened twice and could not be distinguished from bad luck.

**Eliminated by this run.**
- *Overlap.* There was nothing to overlap. The tariff-64 explanation does not transfer.
- *Increment mismatch.* Catalogue and switch agree at 1/1 here.
- *Tariff configuration.* `getTariff` for 64, 65 and **66** (the only tariff that has ever accepted
  an `upload_token` import) is **byte-identical** across every field: currency USD, type 1, connect
  fee 0, free seconds 0, grace 0, **lossProtection true**, maxLoss 0, costRoundUp true, precision 20,
  averageDuration 200, localCalling false, empty extra. Whatever separates these tariffs is not in
  their configuration.
- *Loss protection specifically.* True on the tariff that parses AND the tariff that does not.

**Still unknown: why tariff 65's importer dies before parsing.** A zero-byte report is the signature
of a refusal that happens before any row is read, so the file's contents cannot be the cause — and
tariff 64 proves the same builder produces a file this importer will parse. The remaining difference
is the tariff itself, or something the importer holds about it. The platform retains no copy of the
uploaded workbook (`push-xlsx-list` is empty), so the bytes cannot be diffed after the fact.

**The discriminator that would settle it** is one logical change — a prefix absent from both tariffs,
1/1, future-dated — pushed to tariff 64 AND tariff 65. Identical content, two tariffs. If 64 parses
and 65 dies pre-parse, the tariff is implicated and the file is exonerated for good. Two Sippy
writes; the owner's word is required for each.

### SMP-006 POSITIVE PATH PROVEN — 2026-09-15 15:07Z, tariff 64, `19233`

The control leg of the tariff-64/65 discriminator, and the first `upload_token` success since
2026-09-02. Fixture chosen to carry no confound: PAKISTAN - MOBILE UFONE, a single-prefix
destination already eligible for First Class, at `1/1`, **absent from both tariffs**, so no
declaration was written, no overlap was possible and no increment could move.

`19233 @ 0.05`, effective **2026-09-17 10:00 GMT**. Result: `success`, `upload_token`, 21.9 s,
*"Rate updated — upload token DONE, verified (prefix=19233 rate=0.05)"*.

**Read back at 15:22Z — every acceptance condition met:**

| iRate | prefix | rate | incr | activation | expiration |
|---|---|---|---|---|---|
| **9218** | **19233** | **0.05** | **1/1** | **2026-09-17 10:00:00** | none |
| 9175 | 19370 | 0.196 | 60/1 | 2026-09-22 00:00 | none |
| 9115 | 19370 | 0.196 | 60/1 | 2026-07-31 17:00 | 2026-09-22 00:00 |

A scheduled row at the requested activation, **nothing applied today**, both `19370` rows byte-for-byte
as they were, `upload_token` throughout and **no `portal_csv` anywhere in the trace**.

**This closes SMP-006.** The defect was a verifier that could not see what it had just written: it
looked for the new rate on the first row for the prefix, found the old one, called its own
successful write a failure, and let the portal fallback edit the live row. Today the date-aware
verifier found row 9218 by its activation, confirmed it, and the push stopped there. Under the old
code this exact operation would have fallen through to `portal_csv` and changed a price today that
the customer was told changes on the 17th.

**A second, older question closes with it: NEW-PREFIX CREATION WORKS on `upload_token`.** `19233`
did not exist on tariff 64 and now does. The standing record in [[sippy-rate-upload-format]] — "our
Rate Manager has never successfully created a NEW prefix in a Sippy tariff" — was true of the
PORTAL path, whose add form scrapes an `i_rate` from a blank form. It is **not** true of the upload
path. Do not carry that claim forward unqualified.

**What is now unambiguous about tariff 65.** The same builder, the same transport, the same
verifier, the same `1/1`, the same activation instant and the same rate succeed on tariff 64. If
tariff 65 refuses this identical content, the file is exonerated and the difference is the tariff or
Sippy-side state associated with it.

### The tariff-64/65 discriminator, COMPLETE — 2026-09-15 15:26Z. The file is exonerated.

Test B, the subject leg. **Byte-for-byte the same logical change as Test A** — `19233 @ 0.05`,
`1/1`, effective 2026-09-17 10:00 GMT, product First Class, same builder, same transport, same
verifier. The only variable is the tariff.

| | Test A · tariff 64 | Test B · tariff 65 |
|---|---|---|
| verdict | **success** | **failure** |
| importer | DONE, 21.9 s | **FAIL, 33 s** |
| report | n/a | **0 bytes** |
| result | row 9218 created, activation 2026-09-17 10:00 | **nothing; tariff still holds 1 rate** |

**Conclusion, stated to its exact reach.** The test exonerates the uploaded CONTENT and this
application's write path **for the tested healthy tariff**. It does not establish what Sippy has
internally attached to tariff 65, and nothing here should be read as doing so. What it does settle
is that no change to the file or to this code can account for the difference, because neither
varied.

**Three refusals on tariff 65, all identical in kind:**

| pilot | processing → FAIL | report |
|---|---|---|
| #1 (`192`, 08:39Z) | 9 s | 0 bytes |
| #2 (`192`, 14:53Z) | 17 s | 0 bytes |
| #3 (`19233`, 15:26Z) | **33 s** | 0 bytes |

The prefix changed, the rate changed, the date changed, the increment stayed; the refusal did not.
A zero-byte report means the refusal precedes any row being read, which is consistent with all of
it and inconsistent with a content defect.

**LEADING HYPOTHESIS, not established: a stuck import on tariff 65.** From 2026-09-07 onward this
project recorded failures reading *"Tariff N is locked — processing of uploaded file is in
progress"*, and tariff 65 was the target of jobs #44 and #45 on 2026-09-09, both of which failed.
An import record left pending would refuse every later upload for that tariff before parsing, would
be persistent, and would be invisible to us: the lock BANNER is universal for the ssp-root session
and is not per-tariff evidence, and no API on this build lists a tariff's import queue. The rising
durations (9 → 17 → 33 s) are an observation, not a finding; three points cannot establish a
pattern.

**This is SMP-007, and it is OUTSIDE the platform.** It is tracked separately from SMP-006 on
purpose: SMP-006 is a defect in this code that a controlled A/B experiment has closed, and an
unresolved Sippy-side condition must not be allowed to reopen it. Resolving SMP-007 needs Sippy-side inspection of tariff 65's import
queue — the operator's panel or Sippy support. No code change here will clear it, and no further
push to tariff 65 will produce new information; the fixture has been fully controlled and the
answer did not change.

**What the platform has proven today.** Catalogue → eligibility → pricing gate → per-client policy →
preflight → mutation boundary → `upload_token` → date-aware verification → scheduled row, end to
end, on a healthy tariff, with the refusal path exercised three times on an unhealthy one and the
tariff left untouched every single time.

**Remediation of the evidence.** Tariff 64 is disposable. Restoring `9115` to 0.133 / 1/1 until
2026-09-22 is a Sippy write and the owner's decision; leaving both rows as evidence is equally valid.

## Existing controls

Recorded so they are not re-audited, and so "no boundary" is not mistaken for "unsafe".

### Hardened — boundary present and consumed

| Path | Control |
|------|---------|
| Rate batch engine — `batch-execute.ts`, `verdict.ts`, `preflight.ts` | Reads `refusedBeforeWrite`; only `failure` is retryable |
| `rates.step.ts` → `uploadRatesWorkbook` | Boundary crossed immediately before `uploadBinaryFile`; every return stamped via one `done()` helper (`40a2650d`) |
| `clearTariffRates` → `deleteAllRatesInTariff` | Boundary crossed immediately before the XML-RPC request; returns `success` / `failure` / `indeterminate` with `refusedBeforeWrite` |
| Tariff restore (`routes.ts`) | Captures the clear's verdict, **reads the tariff back unconditionally** before pushing, aborts while the tariff still holds rates, and writes no version record on any abort path |

### Safe by design without a boundary

| Path | Why it is safe |
|------|----------------|
| `authentication.step.ts` (`addAuthRule`) | **Reconciles by read-back.** Re-lists existing rules keyed on `(remote_ip, incoming_cld)` inside `execute`, so a retry finds a landed rule and reuses it rather than duplicating it. Keying on IP alone would not work — Sippy allows many rules per IP, differing by incoming CLD |
| `account.step.ts`, `capacity.step.ts` (`updateAccount`) | A SET operation. Applying the same values twice reaches the same state |
| `action-executor.ts` | Behind a dual-approval gate; not unattended execution |

### Latent — unwired, and must not be wired without their own treatment

| Path | State |
|------|-------|
| `recordPayment` → `makePayment` | Zero external callers. **A payment is not idempotent**: a request sent, a response lost, and a retry is a second payment |
| `createSippyAccount` → `createAccount` | Zero external callers. Not idempotent |

Neither may be connected to automated execution without mutation-safety treatment decided at
that time. Their being unwired is the only thing making them safe today, and that is a property
of the call graph, not of the code.

---

## Audit scope and method

- **Surface enumerated** from the transport primitives in `server/sippy.ts` — the XML-RPC method
  names actually invoked, the portal paths carrying a mutating `action=`, and `uploadBinaryFile`
  — then traced to callers.
- **False positives excluded.** `sippy-dataflow-generator.ts`, `doc-generator.ts` and
  `feature-registry-generator.ts` contain these method names in documentation strings, not
  calls; `storage.ts` matched on `createTariffVersion`.
- **Read-only.** No code was changed, no Sippy request was made, and no migration was applied
  during this audit.

**Posture at the time of writing:** migrations 514 and 515 unpublished, 515 unapplied,
eligibility empty by design, no Sippy write performed, Sippy write freeze ACTIVE.
