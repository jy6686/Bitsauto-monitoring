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

### PROPOSED policy — awaiting ratification, NOT adopted

Evidence-gathering is complete; this is the decision that remains. Derived from the 92 routes
already gated (destructive → `admin`, 15 of 18; everything else → `admin, management`, 67 of 74).

| Route class | Proposed access |
|-------------|-----------------|
| Destructive / disconnect | `admin` |
| Create / update | `admin`, `management` |
| Read / validation | `admin`, `management` |
| `/api/sippy` from `portal_only` | Deny at the platform boundary |
| Existing approval workflows | Preserve unchanged |

**Explicitly unresolved until reviewed — these do not inherit the default:**

1. `DELETE /api/sippy/tariffs/:id/rates` — blast radius is a customer's entire pricing
2. `PUT /api/sippy/system-config` — switch-wide configuration
3. `POST /api/sippy/invoices/generate` — issues a financial document
4. The three destructive routes currently at `admin, management` — confirm as deliberate
   exceptions or align to `admin`; do not normalise silently
5. The duplicate `DELETE /api/sippy/tariffs/:id` registration — resolve first, or a gate may be
   added to the shadowed copy and appear to work
6. Whether `/api/sippy` joins `PLATFORM_ROUTE_GROUPS` without external deployment-log evidence

### Logging, scoped narrowly

General HTTP request logging is **not** in scope and should not be added under this finding. But
remediation should make an authorization **denial** attributable, or it creates a state where
"the route is correctly blocked" is true and the application cannot demonstrate that the block
occurred. Authorization events only — not a general observability project.

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
