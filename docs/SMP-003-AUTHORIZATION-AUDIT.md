# SMP-003 · Authorization audit of `/api/sippy` write routes

Evidence for the authorization-policy decision recorded as SMP-003 in
[SIPPY-MUTATION-FINDINGS-REGISTER.md](SIPPY-MUTATION-FINDINGS-REGISTER.md). **Audit only — no
code was changed, no route was re-gated, and no Sippy request was made.** SMP-003 remains OPEN.

The purpose is to make the role→operation decision from evidence rather than by adding
`requireRole` to every ungated route, which would encode one guess per route.

---

## Correction to the register

The register recorded **76 of 160** routes as lacking `requireRole`. **That number was wrong and
is corrected here to 57 with no gate of any kind.** The original figure came from a single-line
grep, which misses two real patterns:

- **Multi-line registration.** `requireRole` frequently sits on the line *after* the path, so 8
  gated routes were counted as ungated.
- **A different gating mechanism.** 11 routes gate through an inline role check
  (`getUserRoleRecord` + `canSubmit`) and an approval workflow, returning `202 requiresApproval`
  rather than mutating at all. Destination-set and routing-group writes are all of this kind.

"No `requireRole`" is not the same as "no gate" — the same lesson as "no `MutationBoundary`" not
meaning "unsafe". The count is the only thing that changes; the finding stands, and one part of
it is worse than recorded (see the shadowed gate below).

| Mechanism | Routes |
|-----------|--------|
| `requireRole` middleware | 92 |
| Inline role check + approval workflow | 11 |
| **None** | **57** |
| | **160** |

---

## NEW · A shadowed authorization gate

`DELETE /api/sippy/tariffs/:id` is registered **twice**:

| Line | Gate | Effect |
|------|------|--------|
| 9059 | none | **Wins** — Express matches the first registration |
| 12684 | `requireRole(['admin'])` | **Shadowed — unreachable** |

The first handler terminates the request and never calls `next()`, so the admin gate at 12684 can
never run. This is worse than a plainly missing gate: a reviewer reading line 12684 concludes
tariff deletion is admin-only, and it is not. A duplicate-route check is worth having regardless
of how the policy decision lands, because any gate added at the wrong one of a duplicated pair is
invisible dead code.

This was the only duplicate method+path pair in the 160.

---

## The 57 ungated routes, by what they can do

Classification is by the Sippy function each handler calls. Two were initially mis-bucketed by
name (`bulkAddDIDs`, `bulkDeleteDIDs` — the `bulk` prefix defeats a `delete*`/`add*` match) and
are placed correctly below; automated classification by function name has this limit and the
list should be read, not trusted wholesale.

### Destructive — 14

| Line | Route | Operation |
|------|-------|-----------|
| 9161 | `DELETE /api/sippy/tariffs/:id/rates` | `deleteAllRatesInTariff` |
| 9059 | `DELETE /api/sippy/tariffs/:id` | `deleteTariff` *(gate shadowed, above)* |
| 9929 | `DELETE /api/sippy/rates` | `deleteSippyRateEntry` |
| 9755 | `DELETE /api/sippy/trunks/:id` | `deleteTrunk` |
| 9836 | `DELETE /api/sippy/trunk-connections/:id` | `deleteTrunkConnection` |
| 8737 | `DELETE /api/sippy/ssl-certificates/:id` | `deleteSSLCertificate` |
| 8872 | `DELETE /api/sippy/ca-lists/:id` | `deleteCAList` |
| 14241 | `DELETE /api/sippy/dids/:id` | `deleteDID` |
| 14151 | `DELETE /api/sippy/dids/delegations/:id` | `deleteDIDDelegation` |
| 14196 | `DELETE /api/sippy/dids/bulk` | `bulkDeleteDIDs` |
| 14309 | `DELETE /api/sippy/accounts/:id/conferences/:confId` | `deleteConference` |
| 4426 | `POST /api/sippy/calls/:id/disconnect` | `disconnectSippyCall` |
| 4487 | `POST /api/sippy/accounts/:iAccount/disconnect` | `disconnectSippyAccount` |
| 4824 | `POST /api/sippy/customers/:iCustomer/disconnect` | `disconnectSippyCustomer` |

### Create — 14
`upload/file` (`uploadBinaryFile`), `ssl-certificates`, `ca-lists`, `tariffs`, `trunks`,
`trunk-connections`, `balances`, `dids`, `dids/:id/delegations`, `dids/bulk` (`bulkAddDIDs`),
`accounts/:id/conferences`, `routing-groups`, `routing-groups/:id/members`,
`invoices/generate` (`generateInvoice` — creates a real financial record).

### Update — 11
`ssl-certificates/:id`, `ca-lists/:id`, `network-services/:protoTransport`, `tariffs/:id`,
`trunks/:id`, `trunk-connections/:id`, `rates` (`setSippyRateEntry`), `apply-translation-rule`,
`dids/delegations/:id`, `dids/:id`, **`system-config` (`setSystemConfig` — switch-wide
configuration)**.

### Read, connect, or non-mutating — 18
Connection tests, session clear, upload-token issue, rate analysis, account/customer
authentication, balance ref-counting, password validation, match-rule checks, packet dumps,
audit-log writes, invoice preview and template validation, dialplan tests.

`POST` on a read is normal here — these take a request body — so being in this bucket is not by
itself a reason to leave a route ungated. `POST /api/sippy/upload/token` in particular issues an
upload token, which is the first half of the workbook mutation path.

---

## Who currently reaches these routes

Two layers were expected to apply. Neither restricts this group.

1. **`routes.ts:937`** requires only that a session exists. Any authenticated user passes; no
   role is consulted.
2. **`requirePlatformAccess`**, which returns 403 for `platformAccessType === "portal_only"`, is
   applied per prefix at `routes.ts:956` over `PLATFORM_ROUTE_GROUPS`. **`/api/sippy` is not in
   that list**, so it never runs for this group.

So the 57 are reachable by **any authenticated session, of any role — `viewer` included — and by
a `portal_only` user**, who is by definition not permitted on the main platform.

Roles in use: `super_admin`, `admin`, `management`, `finance`, `destination_manager`, `noc`,
`viewer`.

### Exact exposure of `DELETE /api/sippy/tariffs/:id/rates`

The route named in the register. Its handler resolves settings and credentials, reads `iTariff`
straight from the URL, and calls `deleteAllRatesInTariff`. There is **no role check, no ownership
or tenant check, and no confirmation guard** — no equivalent of the tariff-restore route's
`confirmation: 'RESTORE'` body requirement. Any authenticated session can empty any tariff by id,
including tariffs belonging to other customers, and the id space is small and guessable.

For contrast, the tariff *restore* workflow — which also clears a tariff — requires
admin/management, a `confirmation: 'RESTORE'` body, and a locked snapshot.

---

## Should `/api/sippy` join `PLATFORM_ROUTE_GROUPS`?

**Evidence says yes, with one caveat to confirm.**

Six client-facing pages call `/api/sippy`: `clients.tsx` (48 references), `client-config.tsx`
(12), `client-portal.tsx` (6), `client-rate-report.tsx` (3), `client-reconciliation.tsx` (2),
`client-wizard.tsx` (1). Despite the naming, none is a `portal_only` surface —
`client-portal.tsx` is routed at `/client-portal` behind
`requiredRoles={['admin','management']}`, i.e. an admin view *about* client portals.

No portal-scoped surface calls `/api/sippy`, so adding the prefix should not break a
`portal_only` user's UI.

**Caveat.** That is client-side routing evidence. It establishes that no portal surface is built
to call these routes; it does not by itself prove no portal_only session ever does.

### The access-log check cannot be completed — there is no access log

Attempted 2026-09-10 as the final evidence gate before the `PLATFORM_ROUTE_GROUPS` decision.
**The platform keeps no per-request access log**, so the question "has a `portal_only` session
ever called `/api/sippy`?" cannot be answered from its own data. Every candidate was checked:

| Candidate | Why it cannot answer |
|-----------|----------------------|
| `sessionActivityMiddleware` (`security/sessions.ts`) | Updates a `lastActivity` timestamp on `user_sessions`. Records no path |
| HTTP request logger | None exists — no morgan, no equivalent |
| Tables with a `route` column | `navigation_modules`, `user_favorites`, `workspace_tab_items` — navigation config, bookmarks and tabs. None records an API request |
| `audit_events` via `writeAudit` | `AuditInput` has no path and no `platformAccessType` field, and it is written only by explicitly instrumented operations |
| `requirePlatformAccess` denials | Not logged, and it never runs for `/api/sippy` anyway |

**Only 3 of the 57 ungated routes write any audit record at all** — the two disconnect routes and
`POST /api/sippy/audit-logs`. The other 54, including
`DELETE /api/sippy/tariffs/:id/rates`, leave no trace of who called them.

**This changes how the decision has to be made, in two ways.**

1. The empirical check cannot be the final gate, because the data does not exist. The decision
   rests on the code evidence above — no portal-scoped surface calls `/api/sippy` — plus whatever
   HTTP logs exist *outside* the application (Replit deployment logs), which are not reachable
   from the codebase and were not consulted here.
2. **A wider finding: these routes are unauditable.** If the gap has already been exercised there
   is no record of it, and after a policy change there would still be no record of an attempt.
   Absence of evidence here is not evidence of absence, and cannot become so without adding
   request logging — which is a code change and outside this audit's scope.

Adding a `portal_only` denial log, or request logging over `/api/sippy`, is worth considering as
part of the SMP-003 remediation rather than after it — a gate whose refusals are invisible cannot
be shown to be working.

---

## Proposed policy — a conclusion drawn from the gated 92, not an assumption

The 92 already-gated routes are not gated arbitrarily. They follow a consistent convention:

| Route kind | `requireRole(['admin'])` | `requireRole(['admin','management'])` |
|------------|--------------------------|----------------------------------------|
| Destructive | **15** | 3 |
| Everything else | 7 | **67** |

That is the platform's own de facto policy, and it is legible enough to extend rather than invent:

1. **Destructive operations → `['admin']`.** Deletes and disconnects.
2. **Create and update → `['admin', 'management']`.**
3. **Reads and validations → `['admin', 'management']`** at minimum, since they expose switch
   state and consume Sippy credentials.
4. **`/api/sippy` added to `PLATFORM_ROUTE_GROUPS`**, so `portal_only` is refused at the group
   level rather than route by route.
5. **Three routes warrant a decision of their own, above the default:**
   - `DELETE /api/sippy/tariffs/:id/rates` — the blast radius is an entire customer's pricing.
     A confirmation guard, as the restore route already has, is worth considering alongside the
     role.
   - `PUT /api/sippy/system-config` — switch-wide configuration.
   - `POST /api/sippy/invoices/generate` — issues a financial document.
6. **Resolve the duplicate `DELETE /api/sippy/tariffs/:id` registration** before or with any
   gating change, or the gate may be added to the shadowed copy and appear to work.

The 3 destructive routes currently gated at `['admin','management']` should be confirmed as
deliberate exceptions or aligned to `['admin']`; this audit does not assume which.

---

## Method and limits

- Routes extracted by parsing `app.(post|put|patch|delete)('/api/sippy/…'` from `server/routes.ts`,
  with each handler bounded at the next top-level route registration, and the gate read from the
  registration arguments rather than the whole body.
- Mutation kind inferred from the Sippy function each handler calls. **This is name-based and
  imperfect** — `bulkAddDIDs` and `bulkDeleteDIDs` were mis-bucketed on the first pass and
  corrected by reading them. Any route acted on should be read, not taken from the table alone.
- Routes gating through the approval workflow were identified by `submitApprovalRequest`; they
  return `202 requiresApproval` and do not mutate Sippy directly.
- **The access-log check was attempted and could not be completed** — see above. No production
  system was contacted; the conclusion is drawn from the absence of any logging mechanism in the
  codebase and schema.
- **Read-only.** No code changed, no route re-gated, no Sippy request made, no migration applied.

**Posture:** migrations 514/515 unpublished and unapplied, eligibility empty, `40a2650d` and
`94b6ee4a` committed but unpushed, Sippy write freeze ACTIVE. SMP-003 remains OPEN and no
authorization change has been made.
