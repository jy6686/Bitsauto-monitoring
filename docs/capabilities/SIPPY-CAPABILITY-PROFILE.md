# Sippy Capability Profile — Backlog Specification

**Status:** BACKLOG — specified, not implemented. Owner-proposed 2026-07-27.
**Priority:** after Task #81 (provisioning account investigation) and the orchestration
engine; owner notes it may outrank later orchestration features because it simplifies
every Sippy integration that follows.
**Not** part of the Account Wizard Phase 1 freeze scope — this is new infrastructure
alongside, in the same spirit as the provisioning engine (`server/services/provisioning/`).

## The observation that motivates it

Two independent investigations reached the same wall on the same switch
(**Sippy Softswitch 2024, rev 8.485**):

| Workstream | Symptom | Date |
|---|---|---|
| Service Plan provisioning | `createServicePlan`, `addBillingPlan`, `addServicePlan`, `createBillingPlan`, `billing_plan.add` → all `UNKNOWN_METHOD` | 2026-07-27 |
| Tariff-33 rate push | 9 guessed rate-add method names, all fail | 2026-07-15 |

These are **runtime observations of this switch** — the strongest evidence class available,
and the basis for every capability verdict recorded here. Documentation surveys (below)
rank lower and never override them.

This is not two bugs. It is **one platform characteristic**: this Sippy build predates the
modern XML-RPC surface. Each workstream rediscovered it independently, at cost.

## The duplication it removes (measured, not asserted)

`server/sippy.ts` contains **12+ separate method-name probe loops** — each a hardcoded
array of candidate names tried in sequence until one doesn't fault:

- line 2806 `['listActiveCalls','listAllCalls']` · 4510 · 6290 (service plan, 5 names)
- 6350 (rate add, 9 names) · 6430 `listCustomers`/`user.getUsersList`/… · 6483 · 6519
- 6543 · 6605 · 7671 · 7857 · plus "tries 4 methods" tariff listing at routes.ts:8786

Every one pays full network round-trips for each miss, on every call, forever. None
records what it learned. A new integration adds a 13th array.

## Target design — a Switch Capability Registry (core platform service)

This is a **platform service, not a utility inside `sippy.ts`**. Capability discovery is a
platform concern; `sippy.ts` becomes a consumer of it, not the place it lives:

```
server/services/switch-capabilities/
    analyzer.ts    — runs detection probes (deliberate, operator-triggered)
    registry.ts    — stores/serves profiles per switch
    verifier.ts    — re-verification + staleness
    cache.ts       — in-process read cache

Capability Registry → Provisioning Engine → Sippy Service
```

The platform already manages multiple environments (Production, DID, Testing, Voice OTP,
Lab) via the `switches` table, and they will not have identical capabilities:

| Switch | Version | Service Plan XML-RPC | Portal automation | Rate upload | Status |
|---|---|---|---|---|---|
| PROD-1 | 2024 | ✗ | ✓ | ✓ | Certified |
| PROD-2 | 2025 | ✓ | ✓ | ✓ | Certified |
| LAB | 2023 | ✗ | ✗ | ✓ | Legacy |

Every provisioning decision then becomes deterministic instead of discovered at runtime.

Detect once per switch, store, and have every executor **ask** instead of probe:

```
Sippy Capability Profile (per switch)
  version / build
  XMLRPC_ACCOUNT_CREATE       ✓
  XMLRPC_TARIFF_CREATE        ✓
  XMLRPC_SERVICEPLAN_CREATE   ✗   (UNKNOWN_METHOD, 2026-07-27)
  XMLRPC_RATE_PUSH            ✗
  PORTAL_AUTOMATION           ✓
  PORTAL_SERVICEPLAN_INSERT   ⛔  (permission, not capability — see below)
  PORTAL_RATE_UPLOAD          ?   (undetermined)
```

Executors then read:

```
if (capability.xmlrpcServicePlanCreate)      → XML-RPC path
else if (capability.portalServicePlanInsert) → portal automation path
else                                          → fail with a classified reason
```

Same pattern serves rate push, routing, DIDs, and every future provisioning step. It
composes with the provisioning engine: a step's `validate()` consults the profile and can
skip or downgrade itself before doing any network work.

## Capability ≠ Attempt (frozen separation)

**Portal diagnostics are not capabilities.** They have different lifecycles and must live in
different places:

| | **Capability Registry** | **Provisioning Attempt** |
|---|---|---|
| Answers | what this switch *supports* | what happened *this time* |
| Changes on | upgrade, licence, module install | every request |
| Examples | `supportsCreateServicePlan=false`, `supportsRateUpload=true`, API version | validation failed, session expired, CSRF invalid, permission denied, timeout |
| Written by | a deliberate verification run **only** | every provisioning execution |

```
Capability Registry            Provisioning Attempt
  Switch                         Attempt
   ├── XML-RPC                    ├── XML-RPC tries
   ├── Portal                     ├── Portal tries
   ├── Rate upload                ├── Response body / hidden fields / cookies
   ├── API version                ├── Status code
   └── Supported features         ├── Trace ID
                                  └── Final reason
```

**Resolution of the account-permission case** (it looks like it belongs to both): an
observed permission denial during a business operation is an **attempt outcome** and never
writes the registry. A permission *state* may be stored — keyed by switch **+ account** —
but only as the result of a deliberate "Verify Switch Capabilities" run. One writer, one
lifecycle: business traffic records attempts; verification records capabilities.

This also improves the provisioning engine's step records, which can then read:

```
SERVICE_PLAN
  Capability: portal supported
  Execution:  session OK → validation error → retry → success
```

instead of a bare `permission denied`.

## The design trap — three distinct failure classes must not collapse into one

This is the part that will bite an implementation that treats the profile as a simple
boolean cache. Today's evidence shows **two different failures on the same feature**:

| Class | Example (2026-07-27) | Belongs to | Cacheable? |
|---|---|---|---|
| **Capability absent** | `createServicePlan` → `UNKNOWN_METHOD` | **Switch** — stable until upgrade/patch/module install | ✅ yes |
| **Permission denied** | portal Service Plan INSERT refused | **Switch + provisioning account** — an identity capability, not a switch one | ⚠️ account-keyed only |
| **Transient** | timeout, network error, switch restarting | Nothing | ❌ **never** |

**Three states, not two.** Alongside `SUPPORTED` / `UNSUPPORTED` there must be
**`UNKNOWN` = never tested**. Without it, "not yet verified" is indistinguishable from
"verified absent", and the tempting shortcut `timeout → mark unsupported` becomes
representable. With `UNKNOWN` as the initial state, it is not.

**Store evidence AND confidence, not just a verdict.** A bare boolean is unmaintainable six
months later, and — more importantly — a documentation-derived guess must never be
indistinguishable from a runtime-proven fact:

| Confidence | Meaning |
|---|---|
| `CONFIRMED` | Observed directly against this switch at runtime |
| `MANUAL` | Verified by a human in the Sippy UI |
| `NEEDS_RUNTIME_VERIFICATION` | Derived from documentation/release notes; **not yet observed** |
| `UNKNOWN` | Never tested |

```
Capability:  XMLRPC_SERVICEPLAN_CREATE
Status:      UNSUPPORTED
Evidence:    runtime — XML-RPC fault "Unknown method createServicePlan" (×5 names)
Confidence:  CONFIRMED
Switch:      Sippy Softswitch 2024 rev 8.485
Verified:    2026-07-27 18:42 UTC   By: Capability Analyzer v1

Capability:  RATE_UPLOAD_API
Status:      SUPPORTED (claimed)
Evidence:    documentation — v5.x release notes mention a file-upload rate call
Confidence:  NEEDS_RUNTIME_VERIFICATION      ← must not drive behaviour yet

Capability:  PORTAL_SERVICEPLAN_INSERT
Status:      DENIED
Scope:       account (not switch)
Evidence:    HTTP 200, portal response "Cannot insert"
Confidence:  MANUAL / CONFIRMED (per verification run)
Verified:    2026-07-27            Account: <provisioning account>
```

**Rule:** only `CONFIRMED` and `MANUAL` entries may drive execution decisions. A
`NEEDS_RUNTIME_VERIFICATION` entry is a hypothesis with a place to live — it can prioritise
what to test next, but it must never route a provisioning step.

Consequences that must be designed in:

1. **Never cache a transient failure as "unsupported."** A capability may only be marked
   absent on an explicit `UNKNOWN_METHOD`-class fault, never on timeout/connection error.
2. **Permission results are keyed by account**, not by switch. If Task #81 resolves by
   repointing `SIPPY_PROV_USERNAME` at a privileged account, a switch-scoped
   "unsupported" flag would wrongly keep the working path disabled.
3. **Profiles go stale on upgrade.** Needs an explicit re-detect action (operator-triggered
   is sufficient; a TTL is optional) and the stored `detected_at` must be surfaced wherever
   the profile influences behaviour.
4. **Detection is a deliberate operation**, not a side effect of a failed business action —
   production traffic must not redefine the platform's understanding of a switch. Expose an
   administrator action, **"Verify Switch Capabilities"**, which runs the analyzer
   intentionally and stores an evidence-backed result. This matches the platform's existing
   governance posture: diagnostics are deliberate, versioned, and reviewable rather than
   implicit side effects.

### Precedent already in production code

`createSippyServicePlan()`'s portal path collapsed exactly these classes: a session bounced
to the login form, a refused INSERT, and a thrown request all returned the single
`PROVISIONING_PERMISSION_DENIED`. Only the middle one evidences a permission limit. Fixed
2026-07-27 by recording per-attempt evidence (`portalAttempts`) and classifying from it —
`PROVISIONING_SESSION_REJECTED` and `PROVISIONING_PORTAL_ERROR` now exist as distinct
outcomes. The registry must not reintroduce the collapse at a higher level.

## Value in a multi-switch deployment

The platform already supports multiple switches (`switches` table). Capability differences
between them are currently invisible: an operation that works on one may silently fall back
on another with no record of why. A stored per-switch profile makes that difference explicit
and diagnosable, and gives a single answer to "would upgrading this switch help?" — today
that question requires re-running failed provisioning by hand.

## Vendor documentation survey (2026-07-27)

Searched Sippy's public support portal. **Article bodies were not readable from this
environment** (DNS blocked; search index only) — so the following is folder/index-level
evidence and should be confirmed by opening the articles directly.

Documented XML-RPC folders found: Manipulating Accounts (21 articles) · Manipulate
Customers · Payments · Trunks management · Invoice related methods · Manage Active Calls ·
Test Dialplan · Manipulate Low Balances · Applying Service Plan Charges · Miscellaneous ·
Examples · Caveats.

Two leads — **neither is a finding**. Both are absence-or-presence signals from an index,
and an index that cannot return article bodies cannot establish what is or is not
documented:

1. **No *evidence* of a documented XML-RPC service-plan creation method was found.** The
   service-plan material that did surface concerns *applying* charges (`billingRun()`) and
   *reading* (`getAccountMinutePlans()`). This is **not** proof that no such method is
   documented — only that the search index did not reveal one. It is weak supporting
   material for the runtime evidence, nothing more. **The capability verdict for
   `XMLRPC_SERVICEPLAN_CREATE` rests on the runtime `UNKNOWN_METHOD` responses, which are
   direct observations of this switch — not on this survey.**
2. **Release-note material appears to describe an XML-RPC file-upload rate-processing
   call.** Unverified. If it holds up it is a strong lead for the tariff-33 rate-push
   defect; it should be treated as `Needs Runtime Verification`, never as a capability.

Owner action (has portal access): open [XML-RPC API](https://support.sippysoft.com/support/solutions/107132)
and [Manipulating Accounts](https://support.sippysoft.com/support/solutions/folders/176717)
to confirm (1), and the v5.1/v5.2 release notes for the rate-processing call in (2).

## Related

- [Account Wizard governance](../ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md) §6 — the run that
  produced the `UNKNOWN_METHOD` evidence.
- `server/services/provisioning/` — the step engine this profile would feed.
- Tariff-33 rate-push defect — the second workstream that hit the same wall.
