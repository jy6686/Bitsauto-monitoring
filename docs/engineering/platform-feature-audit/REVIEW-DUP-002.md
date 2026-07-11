# Structured Review — DUP-002: NOC Command ↔ Ops Console

**Confidence:** High · **Class:** A/B (true duplicate candidate — subset relationship) · **Decision: Pending**

## Features under review

| | NOC Command | Ops Console |
|---|---|---|
| Path | `/noc-command` | `/ops-console` |
| Page component | `noc-command.tsx` (553 LOC) | `ops-console.tsx` (877 LOC) |
| Registry group | Live Network | Live Network |
| Badge | — | NEW |
| Roles | admin, management, super_admin, noc_operator, team_lead | **identical** |

## Evidence

1. **API subset.** NOC Command's entire API set (7 endpoints) is a **strict subset** of Ops Console's (10 endpoints): `aiops/incidents`, `alerts`, `anomalies`, `carrier-scores`, `sippy/live-calls`, `vendors/current-balances`. Ops Console adds `cdr-cache/vendor-summary`, `entity-timeline`, `vendors/balance-history`.
2. **Identical write workflow.** Both pages implement the *same two actions* with the same endpoints: acknowledge alert (`POST /api/alerts/:id/acknowledge`) and resolve alert (`POST /api/alerts/:id/resolve`) — `noc-command.tsx:296-302`, `ops-console.tsx:258-263`. This is shared **workflow**, not just shared data.
3. **Identical personas.** Same role list in the registry.
4. **Registry descriptions:** NOC Command — "Operator command centre"; Ops Console — "Unified operations surface". The descriptions themselves overlap.

## Review fields

- **Business purpose:** both are NOC operator consoles combining live calls, alerts, anomalies, carrier scores, and vendor balances into a single operational surface.
- **User personas:** identical (NOC operators, team leads, admins, management).
- **Primary workflows:** identical (monitor + acknowledge/resolve alerts); Ops Console adds vendor balance history, CDR vendor summary, and entity timeline views.
- **Data ownership:** neither owns a namespace — both are pure consumers (see DEPENDENCY-MATRIX.md). Retiring either loses no data ownership.
- **Shared APIs:** YES (7, 70% Jaccard). **Shared workflow:** YES (identical write ops).
- **UI overlap:** to be confirmed visually in the runtime audit, but the functional envelope of NOC Command is fully contained in Ops Console.

## Recommendation (for approval — no action taken)

Strongest true-duplicate candidate on the platform. Ops Console is a functional **superset** of NOC Command and is the newer surface (NEW badge).

1. **Preferred:** designate Ops Console as canonical; hide NOC Command from navigation (URL remains accessible per Navigation Manager behaviour) after a runtime side-by-side confirms no NOC-Command-only UI capability exists.
2. Alternative: keep both if the runtime audit reveals a distinct NOC Command capability not visible in the API layer (e.g., layout optimized for wall displays).

Prerequisite before any decision: runtime side-by-side review of both screens with an actual NOC workflow.

**Decision:** Pending
