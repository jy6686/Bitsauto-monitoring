# Canonical Capability Matrix

| Field | Value |
|-------|-------|
| Purpose | Which **module owns each business capability** — the map that eventually drives consolidation |
| Status | STARTER — populate against the frozen [METHODOLOGY](METHODOLOGY.md) |
| Last verified | 2026-07-11 |

> Capabilities, **not** pages or APIs. "Canonical" = the intended system-of-record
> surface for that capability; "Supporting" = Views/Consumers/Extensions of it (per
> the classification taxonomy). Owners here are **candidate/heuristic** until
> confirmed by business-purpose review — Status stays `Review` until then.

| Capability | Canonical module | Supporting modules (class) | Status |
|-----------|------------------|----------------------------|--------|
| Alert Management | Alerts | NOC Command · Ops Console · AI Ops (Consumer) | Review |
| Incident Management | Incident Command | NOC Command · AI Ops (Consumer/Extension) | Review |
| Carrier Performance | Carrier Scoring | Carrier Intelligence · SLA Scorecard · Vendor Health (View) | Review |
| Route Analysis | Route Intelligence | Route Simulator · Route Tester · Route Testing (View/Extension) | Review |
| Vendor Analysis | Vendor RCA | Vendor SLA · Stability Timeline (View) | Review |
| Live Traffic | Live Traffic | Traffic Map · Live Traffic Map (View) | Review |
| AI Decisioning | AI Ops Center | Decision Overlay (Alias — REVIEW-DUP-001) | Review |
| NOC Operations | Ops Console | NOC Command (Extension/Candidate — REVIEW-DUP-002) | Review |
| Telemetry Platform | BitsEye 2.0 (FROZEN) | BitsEye Classic (legacy — strategic decision, not duplicate) | Review |

## How to use
1. For each capability, name the intended **canonical** owner.
2. Classify every other surface touching it (Alias/View/Consumer/Extension/Candidate).
3. Set Status: `Canonical` (confirmed) or `Review` (pending business purpose).
4. This matrix — not the page list — is what a future consolidation decision reads.

## Open Questions
- [ ] Confirm each canonical owner via business-purpose review — **Institutional Knowledge Required**
- [x] Registry source reconciled — **RESOLVED [V]**: **Top Menu `DOMAINS` (app-nav-shell.tsx) is canonical**; `SIDEBAR_GROUPS` (layout-shell.tsx, `[MAINTENANCE-ONLY]`) is the Feature Visibility Registry (completeness check only). See [NAVIGATION-REGISTRIES.md](NAVIGATION-REGISTRIES.md).
- [ ] Re-point the extractor/inventory from `SIDEBAR_GROUPS` → `DOMAINS` (action in NAVIGATION-REGISTRIES.md) — **Pending**
