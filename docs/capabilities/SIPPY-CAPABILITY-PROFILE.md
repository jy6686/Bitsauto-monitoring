# Sippy Capability Profile — Backlog Specification

**Status:** BACKLOG — specified, not implemented. Owner-proposed 2026-07-27.
**Priority:** after Task #81 (provisioning account investigation) and the orchestration
engine; owner notes it may outrank later orchestration features because it simplifies
every Sippy integration that follows.
**Not** part of the Account Wizard Phase 1 freeze scope — this is new infrastructure
alongside, in the same spirit as the provisioning engine (`server/services/provisioning/`).

## The observation that motivates it

Two independent investigations reached the same wall on the same switch:

| Workstream | Symptom | Date |
|---|---|---|
| Service Plan provisioning | `createServicePlan`, `addBillingPlan`, `addServicePlan`, `createBillingPlan`, `billing_plan.add` → all `UNKNOWN_METHOD` | 2026-07-27 |
| Tariff-33 rate push | 9 guessed rate-add method names, all fail | 2026-07-15 |

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

## Target design

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

## The design trap — three distinct failure classes must not collapse into one

This is the part that will bite an implementation that treats the profile as a simple
boolean cache. Today's evidence shows **two different failures on the same feature**:

| Class | Example (2026-07-27) | Stability | Cacheable? |
|---|---|---|---|
| **Capability absent** | `createServicePlan` → `UNKNOWN_METHOD` | Stable until a Sippy upgrade | ✅ yes |
| **Permission denied** | portal Service Plan INSERT refused for the provisioning account | Changes the moment the account or its privileges change | ⚠️ account-scoped only |
| **Transient** | timeout, network error, switch restarting | Meaningless | ❌ **never** |

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
   otherwise a bad day for the network silently degrades the platform's model of the switch.

## Value in a multi-switch deployment

The platform already supports multiple switches (`switches` table). Capability differences
between them are currently invisible: an operation that works on one may silently fall back
on another with no record of why. A stored per-switch profile makes that difference explicit
and diagnosable, and gives a single answer to "would upgrading this switch help?" — today
that question requires re-running failed provisioning by hand.

## Related

- [Account Wizard governance](../ACCOUNT-WIZARD-GOVERNANCE-PHASE1.md) §6 — the run that
  produced the `UNKNOWN_METHOD` evidence.
- `server/services/provisioning/` — the step engine this profile would feed.
- Tariff-33 rate-push defect — the second workstream that hit the same wall.
