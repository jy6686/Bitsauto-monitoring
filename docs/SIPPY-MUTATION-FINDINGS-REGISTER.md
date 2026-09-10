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
| SMP-001 | Tariff restore ignores the result of the destructive `clearTariffRates`; a failed or indeterminate clear proceeds to push and writes a `tariff_versions` record that can falsely assert the restored state | **Critical** | OPEN | Fix first |
| SMP-002 | `clearTariffRates` has no mutation boundary; a timeout after a successful delete is represented as an ordinary failure | **High** | OPEN | Fix with explicit boundary / verdict semantics |
| SMP-003 | 76 of 160 `/api/sippy` write routes lack `requireRole`, and `/api/sippy` is absent from `PLATFORM_ROUTE_GROUPS` so `requirePlatformAccess` never runs; the tariff-rate DELETE is reachable by any authenticated session | **Critical** | OPEN | Separate authorization-hardening decision |

Remediation order is **SMP-001 → SMP-002 → SMP-003**.

SMP-001 outranks SMP-002 because an ambiguous retry outcome is one defect, while the restore
combines three: a destructive mutation, an ignored failure-or-unknown result, and a subsequent
audit record that can assert a state that was never reached.

SMP-003 is kept deliberately separate from the boundary work. Authorization scope and mutation
outcome semantics are different controls; remediating them in one change would make both harder
to review, and neither is a substitute for the other.

---

### SMP-001 · Tariff restore discards the result of its own destructive step

**Severity: Critical. Status: OPEN. Fix first.**

**Found:** 2026-09-10, during the mutation-path inventory ordered after `40a2650d`.

**Current behaviour.** [`routes.ts:32325`](../server/routes.ts) restores a locked tariff
snapshot by clearing the tariff and re-uploading:

```ts
await clearTariffRates(config, version.iTariff);   // result discarded
const bulkResult = await bulkPushRates(config, version.iTariff, /* … */);
```

The return value is never read. `clearTariffRates`
([`sippy-tariff.service.ts`](../server/services/sippy/sippy-tariff.service.ts)) catches its own
errors and returns `{ ok: false, error }`, so it never throws either — the failure has no way
to reach the caller. Execution continues to the bulk push in every case.

**Why the existing guard does not catch it.** The route does verify after uploading, but the
test is:

```ts
if (verifiedLiveCount === 0 && snapshotRates.length > 0) { /* abort */ }
```

That detects a failed *push*. It cannot detect a failed *clear*: if the clear did not take and
the push succeeded, the tariff holds the old rates plus the snapshot, the live count is greater
than zero, and verification passes.

**Impact.** The tariff is left holding rates the snapshot does not contain — the restore did not
restore. A new `tariff_versions` row is then written with `snapshotJson` recorded as the live
state and `source: 'restore'`. The audit trail asserts that a tariff matches a snapshot it does
not match, which is worse than the wrong rates alone: the record that would be used to detect
the problem is the record that conceals it.

**Not an authorization gap.** This route is properly gated — admin/management role, a
`confirmation: 'RESTORE'` body guard, and a locked-snapshot requirement. The defect is entirely
in the ignored result.

**Intended fix.** Read the result. A clear that is not confirmed must stop the restore before
`bulkPushRates`, and must not write a version record. Combined with SMP-002, an indeterminate
clear must halt rather than proceed, because "the rates may or may not still be there" is not a
state from which a restore can be reasoned about.

---

### SMP-002 · `clearTariffRates` has no mutation boundary

**Severity: High. Status: OPEN.**

**Found:** 2026-09-10, same audit.

**Current behaviour.**
[`sippy-tariff.service.ts:271`](../server/services/sippy/sippy-tariff.service.ts) wraps
`deleteAllRatesInTariff` in a try/catch that maps any throw to `{ ok: false, error }`. There is
no `MutationBoundary`, so the position of the failure relative to the request is not recorded.

**Impact.** This is the inverse of the usual hazard. A `DELETE` is idempotent, so a retry is not
the danger — the danger is the report. A timeout or a dropped response *after* the delete has
landed is reported as an ordinary failure, and an operator reads that as "the rates are still
there" when every rate in the tariff is gone.

**Intended fix.** The same three verdicts used elsewhere: `success` / `failure` /
`indeterminate`, with `refusedBeforeWrite` set structurally from the boundary's position
immediately before the request, never inferred from message text. Only `failure` means nothing
was sent.

---

### SMP-003 · Authorization gap on `/api/sippy` write routes

**Severity: Critical. Status: OPEN. Separate decision — do not fold into boundary work.**

**Found:** 2026-09-10, same audit.

**Current behaviour.** 76 of 160 `/api/sippy` write routes (`POST`/`PUT`/`PATCH`/`DELETE`) carry
no `requireRole`. Sibling routes show the pattern exists and was simply not applied
consistently — `/api/sippy/users/:id` and `/api/sippy/customers/:id` both gate on
`requireRole(['admin'])`.

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

**Intended fix.** An authorization-scope decision, not a code cleanup: which roles may reach
which Sippy write operations, and whether `/api/sippy` belongs in `PLATFORM_ROUTE_GROUPS`.
Adding `requireRole` route-by-route without that decision would encode 76 individual guesses.

---

## Existing controls

Recorded so they are not re-audited, and so "no boundary" is not mistaken for "unsafe".

### Hardened — boundary present and consumed

| Path | Control |
|------|---------|
| Rate batch engine — `batch-execute.ts`, `verdict.ts`, `preflight.ts` | Reads `refusedBeforeWrite`; only `failure` is retryable |
| `rates.step.ts` → `uploadRatesWorkbook` | Boundary crossed immediately before `uploadBinaryFile`; every return stamped via one `done()` helper (`40a2650d`) |

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
