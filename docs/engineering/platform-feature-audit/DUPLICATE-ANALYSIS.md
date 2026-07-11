# Platform Duplicate Analysis Register

> **Project:** Platform Feature Rationalization (PFR) — Phase 1 Discovery
> **Generated:** 2026-07-11 · derived from shared page components and backend-API overlap (Jaccard similarity of `/api/` endpoint sets per page).
>
> **Every entry is a _candidate_, not a confirmed duplicate. Every Decision is Pending. Nothing will be merged, hidden, or deactivated until reviewed and approved.**

## Classification key

| Class | Meaning | Default action |
|---|---|---|
| A — True duplicate | Same screens, backend, workflow | Candidate for merge (after approval) |
| B — Partial duplicate | 60–90% overlap | Needs comparison/redesign |
| C — Shared data, different purpose | Same tables/APIs, different business process | Keep both |
| D — Workflow dependency | One creates records, another reviews them | Never merge |
| E — Unknown | Needs engineering review | Investigate |

## Confidence levels

| Confidence | Meaning |
|---|---|
| High | Likely duplicate — same component or majority backend overlap |
| Medium | Needs workflow review — significant shared data |
| Low | Probably different purposes — minor overlap |
| Informational | Shared backend only — likely different presentations of the same data |

> **Caution:** a shared API is _evidence, not proof_. Two features can be different presentations of the same operational data. The "Shared workflow" column tracks whether both surfaces also perform the same **write actions**; only then does overlap suggest a true duplicate.

## Machine-detected overlap (API/component evidence)

| DUP ID | Feature A | Feature B | Evidence | API overlap | Shared APIs | Shared workflow (writes) | Confidence | Duplicate? | Decision |
|---|---|---|---|---|---|---|---|---|---|
| DUP-001 | AI Ops Center (`/ai-ops`) | Decision Overlay (`/ai-ops?tab=decision-overlay`) | Same page component | 100% | YES | YES (same page) | **High** | Unknown | **Pending** |
| DUP-002 | NOC Command (`/noc-command`) | Ops Console (`/ops-console`) | 7 shared endpoint(s) | 70% | YES | YES (1 shared write op) | **High** | Unknown | **Pending** |
| DUP-003 | Console (`/console`) | Notification Centre (`/notification-centre`) | 2 shared endpoint(s) | 50% | YES | NO — reads only | **Medium** | Unknown | **Pending** |
| DUP-004 | Alerts (`/alerts`) | NOC Command (`/noc-command`) | 3 shared endpoint(s) | 43% | YES | YES (1 shared write op) | **Medium** | Unknown | **Pending** |
| DUP-005 | Account Names (`/account-names`) | Notifications (`/email-centre`) | 2 shared endpoint(s) | 33% | YES | NO — reads only | **Informational** | Unknown | **Pending** |
| DUP-006 | Alerts (`/alerts`) | Ops Console (`/ops-console`) | 3 shared endpoint(s) | 30% | YES | YES (1 shared write op) | **Medium** | Unknown | **Pending** |
| DUP-007 | Route Optimisation (`/route-optimisation`) | Simulation Sandbox (`/simulation-sandbox`) | 2 shared endpoint(s) | 29% | YES | YES (1 shared write op) | **Medium** | Unknown | **Pending** |
| DUP-008 | Organization Mgmt (`/company-profile`) | Create Account (`/client/wizard`) | 2 shared endpoint(s) | 25% | YES | NO — reads only | **Informational** | Unknown | **Pending** |

### Shared-endpoint detail

**DUP-001 — AI Ops Center ↔ Decision Overlay**
- Both routes render `client/src/pages/ai-ops`
- `/api/account-state`
- `/api/account-state/history`
- `/api/actions`
- `/api/actions/`
- `/api/ai-ops/decision-overlay`
- `/api/ai-ops/entity-verdict`
- `/api/ai/actions/`
- `/api/aiops/incidents`
- `/api/aiops/incidents/run`
- `/api/aiops/signals`
- `/api/anomalies`
- `/api/anomalies/`
- `/api/anomalies/run`
- `/api/cdr-anomalies`
- `/api/engine/run-all`
- `/api/incidents`
- `/api/incidents/run`
- `/api/nlq`
- `/api/recommendations`
- `/api/recommendations/run`
- `/api/routing-suggestions`
- `/api/routing-suggestions/`
- `/api/routing-suggestions/generate`

**DUP-002 — NOC Command ↔ Ops Console**
- `/api/aiops/incidents`
- `/api/alerts`
- `/api/alerts/`
- `/api/anomalies`
- `/api/carrier-scores`
- `/api/sippy/live-calls`
- `/api/vendors/current-balances`

**DUP-003 — Console ↔ Notification Centre**
- `/api/console/incidents`
- `/api/console/incidents/`

**DUP-004 — Alerts ↔ NOC Command**
- `/api/alerts`
- `/api/alerts/`
- `/api/anomalies`

**DUP-005 — Account Names ↔ Notifications**
- `/api/kam`
- `/api/kam/accounts/`

**DUP-006 — Alerts ↔ Ops Console**
- `/api/alerts`
- `/api/alerts/`
- `/api/anomalies`

**DUP-007 — Route Optimisation ↔ Simulation Sandbox**
- `/api/route-optimisation`
- `/api/simulation`

**DUP-008 — Organization Mgmt ↔ Create Account**
- `/api/companies`
- `/api/sippy/billing-plans`

## Capability-cluster review candidates (curated)

These are the business-capability groupings agreed in the PFR plan. They are **comparison candidates, not confirmed duplicates** — several will resolve to class C or D (keep both).

### CLUSTER-01 — Live Operations

| Feature | Path | Page | APIs |
|---|---|---|---|
| Live Calls | `/calls` | `calls-list` | 12 |
| Live Traffic | `/live-traffic` | `live-traffic` | 1 |
| Traffic Map | `/traffic-map` | `traffic-map` | 2 |
| NOC Dashboard | `/noc-dashboard` | `noc-dashboard` | 17 |
| NOC Command | `/noc-command` | `noc-command` | 7 |
| Ops Console | `/ops-console` | `ops-console` | 10 |
| Console | `/console` | `console` | 3 |
| Incident Command | `/noc-incidents` | `noc-incidents` | 2 |

**Review question:** Which surface is the canonical NOC view? NOC Command ↔ Ops Console already show 70% API overlap.

**Decision:** Pending

### CLUSTER-02 — Routing

| Feature | Path | Page | APIs |
|---|---|---|---|
| Routing Manager | `/routing-manager` | `routing-manager` | 20 |
| Route Intelligence | `/route-intelligence` | `route-intelligence` | 32 |
| Routing Intelligence | `/routing-intelligence` | `routing-intelligence` | 4 |
| Route Simulator | `/call-flow-simulator` | `call-flow-simulator` | 3 |
| Route Tester | `/test-call` | `test-call` | 4 |
| Route Optimisation | `/route-optimisation` | `route-optimisation` | 7 |
| LCR Analyser | `/lcr-analyser` | `lcr-analyser` | 2 |

**Review question:** Manager = configuration, Tester/Simulator = validation, Intelligence/Optimisation = recommendations — confirm each owns a distinct step of that lifecycle.

**Decision:** Pending

### CLUSTER-03 — Carrier / Vendor health

| Feature | Path | Page | APIs |
|---|---|---|---|
| Vendor List | `/vendors` | `vendors` | 3 |
| Carrier Scoring | `/carrier-scoring` | `carrier-scoring` | 4 |
| Carrier Intelligence | `/carrier-intelligence` | `carrier-intelligence` | 2 |
| SLA Scorecard | `/vendor-sla-scorecard` | `vendor-sla-scorecard` | 2 |
| Stability Timeline | `/vendor-stability-timeline` | `vendor-stability-timeline` | 1 |
| Vendor RCA | `/vendor-rca` | `vendor-rca` | 1 |

**Review question:** Registry comment in app-nav-shell.tsx says Stability Timeline was removed with "canonical home is BitsEye", yet it is still registered in SIDEBAR_GROUPS.

**Decision:** Pending

### CLUSTER-04 — Prefix / Number

| Feature | Path | Page | APIs |
|---|---|---|---|
| Prefix Intelligence | `/vendor-prefix-intelligence` | `vendor-prefix-intelligence` | 1 |
| Number Intelligence | `/number-intelligence` | `number-intelligence` | 2 |

**Review question:** Vendor-prefix vs number-level analysis — confirm distinct data domains.

**Decision:** Pending

### CLUSTER-05 — Analytics

| Feature | Path | Page | APIs |
|---|---|---|---|
| Traffic Analytics | `/analytics` | `analytics` | 4 |
| RTP Analytics | `/rtp-analytics` | `rtp-analytics` | 1 |
| ASR / ACD | `/asr-acd` | `asr-acd-report` | 3 |
| QoS Heatmap | `/qos-heatmap` | `qos-heatmap` | 1 |
| Codec Analytics | `/codec-analytics` | `codec-analytics` | 1 |
| Revenue Heatmap | `/revenue-heatmap` | `revenue-heatmap` | 2 |
| BitsEye | `/bitseye` | `bitseye` | 8 |
| BitsEye 2 | `/bitseye2` | `bitseye2` | 14 |
| Graphs | `/graphs` | `graphs` | 12 |
| Reports | `/reports` | `reports` | 8 |

**Review question:** BitsEye vs BitsEye 2 dual registration needs an owner decision; each analytics page should own one metric family.

**Decision:** Pending

### CLUSTER-06 — Margin / Cost

| Feature | Path | Page | APIs |
|---|---|---|---|
| Margin Intelligence | `/margin-intelligence` | `margin-intelligence` | 10 |
| Cost Optimisation | `/cost-optimisation` | `cost-optimisation` | 1 |
| AI Assurance | `/ai-assurance` | `ai-assurance` | 4 |

**Review question:** Margin reporting vs cost recommendation vs assurance — verify boundaries.

**Decision:** Pending

### CLUSTER-07 — AI / Decisioning

| Feature | Path | Page | APIs |
|---|---|---|---|
| AI Ops Center | `/ai-ops` | `ai-ops` | 23 |
| Decision Overlay | `/ai-ops?tab=decision-overlay` | `ai-ops` | 23 |
| Intelligence Hub | `/intelligence` | `intelligence` | 1 |
| Validation Console | `/intelligence-validation` | `intelligence-validation` | 2 |
| Simulation Sandbox | `/simulation-sandbox` | `simulation-sandbox` | 2 |
| Traffic Steering | `/traffic-steering` | `traffic-steering` | 4 |

**Review question:** Decision Overlay is the same page as AI Ops Center (tab deep-link) — a nav alias, not a separate feature.

**Decision:** Pending

### CLUSTER-08 — Approvals & audit

| Feature | Path | Page | APIs |
|---|---|---|---|
| Approval Queue | `/approvals` | `approval-queue` | 3 |
| Approval Rules | `/approval-settings` | `approval-settings` | 1 |
| Audit Log | `/audit-log` | `audit-log` | 2 |
| Compliance | `/compliance` | `compliance` | 1 |

**Review question:** Likely class D (workflow dependency) — queue executes, rules configure, log records. Never merge without workflow review.

**Decision:** Pending

### CLUSTER-09 — Reconciliation

| Feature | Path | Page | APIs |
|---|---|---|---|
| Client Reconciliation | `/client-reconciliation` | `client-reconciliation` | 12 |
| Carrier Reconciliation | `/carrier-reconciliation` | `carrier-reconciliation` | 12 |

**Review question:** Mirror-image workflows sharing 3 endpoints — confirm they stay separate or share one engine.

**Decision:** Pending

### CLUSTER-10 — Rating / Tariff

| Feature | Path | Page | APIs |
|---|---|---|---|
| Tariff Versions | `/tariff-versions` | `tariff-versions` | 5 |
| Rating Snapshots | `/rating-snapshots` | `rating-snapshots` | 6 |
| Rating Verification | `/rating-verification` | `rating-verification` | 5 |
| Rate Cards | `/rate-cards` | `rate-cards` | 9 |

**Review question:** Version control vs snapshot vs verification vs commercial cards — verify lifecycle boundaries.

**Decision:** Pending

### CLUSTER-11 — Notifications

| Feature | Path | Page | APIs |
|---|---|---|---|
| Notifications | `/email-centre` | `email-centre` | 4 |
| Notification Centre | `/notification-centre` | `notification-centre` | 3 |
| Commercial Notices | `/commercial-notifications` | `commercial-notifications` | 4 |
| Sender Profiles | `/sender-profiles` | `sender-profiles` | 2 |
| WhatsApp Alerts | `/whatsapp-alerts` | `whatsapp-alerts` | 3 |
| Console | `/console` | `console` | 3 |

**Review question:** Console ↔ Notification Centre share 50% of endpoints; multiple notification surfaces need one ownership map.

**Decision:** Pending

## Governance

Sequence: Inventory → purpose verification → overlap analysis → joint review → approval → merge/retirement plan → regression testing → production validation → only then deactivate/archive.

No feature will be hidden, merged, archived, or removed before explicit approval of the corresponding DUP/CLUSTER entry.
