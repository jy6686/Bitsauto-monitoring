# Approved Configuration Repository (ACR) — Architecture Decision Record

**Status:** Agreed — v2.0 implementation target  
**Decided:** 2026-07-17  
**Authors:** Junaid / Claude governance review session  
**Related:** `platform-freeze-audit.cjs` §9.0, `sippy-watcher.ts` (CGE-003), Phase 2 roadmap

---

## 1. Purpose

The Approved Configuration Repository (ACR) is the authoritative record of what BitsAuto **intends** Sippy to contain. It is not a log of what Sippy has contained — that is `tariffVersions`. It is not a log of approvals — that is `approvalRequests` / `approvalAuditLog`. It is not a change log — that is `sippy_change_events` / `tariff_change_events`.

**Core distinction:**

| Store | Answers |
|---|---|
| `approved_configuration` (ACR) | What should Sippy contain right now? |
| `tariffVersions` | What did Sippy contain at point T? |
| `approvalRequests` | Was this rate import approved? |
| `sippy_change_events` | What did the watcher detect? |

Collapsing any of these would blur intent and observation. They must remain separate.

---

## 2. Architectural Principles

1. **ACR is the system of intent. Sippy is the system of execution.** Every other component (ERLM, CGE watcher, rollback engine, dashboard) is a client of the ACR contract, not a holder of its own notion of "correct" configuration.

2. **Nothing writes to Sippy directly.** Every BitsAuto write follows the sequence: validate → persist intent to ACR → persist provenance → commit to Sippy → verify success → mark `current`. Direct Sippy writes bypass the intent record and break classification.

3. **The watcher classifies reality against intent.** After Phase 2.3, classification is a hash lookup: hash(live Sippy object) → ACR lookup → classification outcome. The watcher does not apply business rules about what constitutes an authorized change — the ACR already encodes that.

4. **Each approved change creates a new immutable ACR version.** No in-place updates to `expected_state`. The previous version is marked `current = false` and `superseded_at` is set. This enables deterministic history, reproducible audits, and future rollback without JSON diff reconstruction.

5. **The canonical hash algorithm is part of the architecture contract.** Once persisted hashes exist in production, changing the serialization algorithm or hash function requires a schema migration and a rehash of all existing rows. This is not an implementation detail — treat it as a versioned dependency.

---

## 3. Core Data Model

### `approved_configuration`

```sql
id                 serial PRIMARY KEY
object_type        text NOT NULL
  -- 'tariff' | 'auth_ip' | 'account' | 'vendor' | 'connection' | 'route' | 'dial_peer' | 'acl'
object_id          text NOT NULL
  -- stable Sippy identifier: iTariff, iAccount, remoteIp+iAccount, iVendor, iConnection, etc.
version            integer NOT NULL
  -- monotonic per (object_type, object_id); incremented on each new approved change
expected_state     jsonb NOT NULL
  -- canonical serialized object (must be produced by canonicalSerialize())
configuration_hash text NOT NULL
  -- SHA-256 of canonicalSerialize(expected_state); used as fast-path comparison by watcher
effective_from     timestamptz
  -- when this version becomes authoritative (null = immediately)
superseded_at      timestamptz
  -- set when a newer version becomes current; null = still current
current            boolean NOT NULL DEFAULT true
  -- only one row has current = true per (object_type, object_id)
write_status       text NOT NULL DEFAULT 'pending'
  -- lifecycle: pending | committed | applied | verified | current | failed | cancelled
created_at         timestamptz NOT NULL DEFAULT now()
updated_at         timestamptz NOT NULL DEFAULT now()
```

**Constraint:** `UNIQUE (object_type, object_id, version)`  
**Index:** `(object_type, object_id, current)` for fast watcher lookup  
**Index:** `(configuration_hash)` for hash-based fast-path classification

### `configuration_provenance`

Polymorphic — avoids nullable FK columns accumulating over time.

```sql
id                   serial PRIMARY KEY
configuration_id     integer NOT NULL REFERENCES approved_configuration(id)
source_type          text NOT NULL
  -- 'rate_import_approval' | 'manual_provisioning' | 'morocco_workflow'
  -- | 'account_creation' | 'vendor_import' | 'api_request' | 'scheduled_job'
source_id            text
  -- polymorphic reference: approvalRequests.id (as text), workflow execution ID,
  -- request UUID, scheduler run ID — depends on source_type
actor                text
  -- user ID, service name, or 'system' for automated paths
originating_request  jsonb
  -- snapshot of the request payload that triggered this write
notes                text
created_at           timestamptz NOT NULL DEFAULT now()
```

**Note on existing approval infrastructure:** For `source_type = 'rate_import_approval'`, `source_id` should be the `approvalRequests.id` cast to text. Do not add a direct FK — the polymorphic pattern keeps the table extensible as new workflow types are added.

### `configuration_write_events`

Lightweight journal — enables operational debugging and latency metrics without overloading the state table.

```sql
id                 serial PRIMARY KEY
configuration_id   integer NOT NULL REFERENCES approved_configuration(id)
event              text NOT NULL
  -- INTENT_CREATED | WRITE_STARTED | WRITE_SUCCEEDED | WRITE_FAILED
  -- | VERIFIED | SUPERSEDED | CANCELLED
timestamp          timestamptz NOT NULL DEFAULT now()
metadata           jsonb
  -- e.g. { "error": "XML-RPC timeout", "durationMs": 4201 }
  --      { "verifiedBy": "sippy-watcher", "hashMatch": true }
```

**Value:** Instead of inferring "why is this row still `applied`?" from state alone, inspect the event sequence. Also provides write latency, XML-RPC failure rate, and verification delay metrics essentially for free.

---

## 4. Write Lifecycle

```
INTENT_CREATED
     ↓
  pending
     ↓
WRITE_STARTED
     ↓
committed                    ← intent + provenance persisted; Sippy write not yet executed
     ↓
WRITE_SUCCEEDED / WRITE_FAILED
     ↓                              ↓
  applied                        failed  ←──── no further lifecycle transitions
     ↓
VERIFIED (by watcher on next poll)
     ↓
  verified
     ↓
  current                      ← supersedes all previous versions for this object
     ↓
SUPERSEDED (when next version becomes current)
     ↓
superseded_at set, current = false
```

**Race condition prevention:** If a Sippy XML-RPC call times out between `WRITE_STARTED` and `WRITE_SUCCEEDED`, the row remains in `committed` state. The watcher sees the hash in the ACR but the write_status is `committed`, not `applied` or `verified`. Classification is `Pending Verification` — not `Authorized`. This prevents the watcher from treating a failed or in-flight write as an approved state.

**Cancelled:** Set when a newer intent supersedes a `pending` or `committed` write before it was applied to Sippy.

---

## 5. Classification Taxonomy

The watcher classifies each detected live Sippy object by looking up its hash in the ACR. Classification is a pure ACR lookup — no business logic in the watcher.

| Live Sippy state | ACR match | write_status | Classification |
|---|---|---|---|
| Hash matches ACR | Yes | `verified` or `current` | **Authorized** |
| Hash matches ACR | Yes | `applied` or `committed` | **Pending Verification** |
| Hash matches ACR | Yes | `failed` | **Repository Failure** |
| Hash matches ACR | Yes | `cancelled` | **Cancelled** |
| No hash match | — | — | **Unauthorized** |
| Object type not yet managed by ACR | — | — | **Unknown** |

**Separation of concerns:**
- The watcher classifies *configuration drift* (Authorized / Unauthorized / Unknown).
- The ACR reports *lifecycle state* (pending / committed / applied / verified / current / failed / cancelled).
These must remain distinct in reporting and dashboards.

---

## 6. Canonical Hash Requirement

### Why it is an architecture contract

All hash-based classification depends on serialization being deterministic. If two representations of the same logical object produce different hashes — due to key ordering, number formatting, whitespace, or null handling — the watcher generates false Unauthorized alerts. Changing the canonical algorithm after hashes are persisted invalidates all stored hashes and requires a full rehash migration.

### Canonical serialization rules

- Object keys: sorted recursively (depth-first)
- Arrays: order preserved (array order is semantically meaningful for rate lists, routing plans, etc.)
- Numbers: native JSON number (no rounding or precision normalization beyond JSON.stringify default)
- Null / undefined: nulls included as `null`; undefined keys omitted (standard JSON.stringify behaviour)
- Whitespace: no indentation (compact JSON)

### Reference implementation

```ts
// server/services/acr/canonical-hash.ts
// Every ACR write path MUST import from this module.
// Do NOT inline serialization in individual services.

import { createHash } from 'crypto';

export function canonicalSerialize(obj: unknown): string {
  return JSON.stringify(sortDeep(obj));
}

export function canonicalHash(obj: unknown): string {
  return createHash('sha256').update(canonicalSerialize(obj)).digest('hex');
}

function sortDeep(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortDeep);
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortDeep(v)])
    );
  }
  return val;
}
```

**Module location:** `server/services/acr/canonical-hash.ts`  
**Invariant:** All write paths (ERLM rate deployment, provisioning actions, Morocco workflow, scheduled jobs) must call `canonicalHash()` from this module. Never re-implement inline.

---

## 7. Phase 2 Roadmap

### Phase 2.1 — Schema  
Create `approved_configuration`, `configuration_provenance`, `configuration_write_events` tables and indexes via Drizzle migration. No behavior changes. No write paths modified. No watcher changes.

**Exit criteria:** Migration runs cleanly in production. Tables exist and are empty. Existing functionality unchanged.

### Phase 2.2 — Write-through invariant  
Wire every BitsAuto → Sippy write path through the ACR. Sequence: validate → `approved_configuration` insert (`pending`) → `configuration_provenance` insert → Sippy XML-RPC → on success: update status to `applied` → on failure: update status to `failed`. Log `configuration_write_events` at each transition.

**Priority order for wiring:** (1) tariff/rate deployment (ERLM RLM-009), (2) auth IP provisioning, (3) account/vendor/connection creation.

**Exit criteria:** Every BitsAuto-initiated Sippy write produces an ACR row with provenance before the Sippy call executes. No Sippy write occurs without a prior ACR record.

### Phase 2.3 — Watcher lookup and classification  
On each polling cycle, after detecting a change, look up `configuration_hash` in `approved_configuration WHERE current = true`. Apply classification taxonomy from Section 5. Persist classification result alongside the `sippy_change_events` record. No enforcement — detect and classify only.

**Exit criteria:** Every watcher-detected change carries a classification label (Authorized / Pending Verification / Unauthorized / Repository Failure / Unknown). CGE-008 drift dashboard can source from classified events.

### Phase 2.4 — Classification dashboard (CGE-008)  
Surface watcher classification results in a UI: live view of approved vs actual configuration per object type, unauthorized change count, pending verification queue, repository failure alerts. Sources from `sippy_change_events` (with classification) + `approved_configuration` (current rows).

**Exit criteria:** Operators can see the full governance state without querying the database directly.

---

## 8. Non-Goals for Phase 2

The following are explicitly out of scope for all Phase 2 milestones:

- **No rollback logic** — rollback is Phase 3 (Shadow Rollback Engine, CGE-011)
- **No automatic enforcement** — enforcement is Phase 4 (CGE-012) and Phase 5 (CGE-013)
- **No replacement of `tariffVersions`** — tariff history and ACR answer different questions; both remain
- **No changes to existing watcher detection during Phase 2.1** — the detection layer (CGE-001–004) is complete; Phase 2 adds classification on top of existing detection output
- **No changes to existing approval workflow** — `approvalRequests` and `approvalAuditLog` remain unchanged; ACR provenance references them via polymorphic `source_id`

---

## 9. Dependencies

| Dependency | Role in ACR |
|---|---|
| `approvalRequests` / `approvalAuditLog` | Provenance source for `source_type = 'rate_import_approval'` |
| `sippy-watcher.ts` | Consumer of ACR during Phase 2.3 classification lookup |
| `sippy-tariff-versioning.service.ts` | Parallel history ledger; not replaced by ACR |
| Morocco workflow (`runIntervalChangeWorkflow`) | Write path to be wired through ACR in Phase 2.2 |
| ERLM rate deployment pipeline (RLM-009) | Primary write path for commercial rate objects |
| `seed-governance.ts` | Governance config referenced by provenance rules |

---

## 10. Future Phases (post-Phase 2)

- **Phase 3 (Shadow Rollback / CGE-011):** For Unauthorized classifications, compute rollback diff (current ACR `expected_state` vs live Sippy state), display for human approval. No automatic execution.
- **Phase 4 (Auto-Enforcement, low-risk / CGE-012):** Automatically revert Unauthorized changes for low-risk object types (auth IPs, ACLs). Gate: Phase 3 shadow rollback validated in production.
- **Phase 5 (Auto-Enforcement, commercial / CGE-013):** Automatic tariff/rate rollback. Gate: Phase 2.5 Certification confirms BitsAuto is the verified write path for all rate objects.

---

*This document reflects architectural decisions made July 17, 2026. Changes to the canonical hash algorithm, write lifecycle states, or classification taxonomy require a new ADR entry and a schema migration plan before implementation.*
