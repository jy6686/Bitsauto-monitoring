# Four Inventories (audit model)

The audit is built from **four complementary inventories** — not one giant document.
The **Business Inventory is primary**; the other three validate it.

| # | Inventory | Source | Answers | Status |
|---|-----------|--------|---------|--------|
| 1 | **Business** ⭐ | Top Menu `DOMAINS` (app-nav-shell.tsx) | What *is* the product? (Domain → Capability → Feature) | ✅ [BUSINESS-INVENTORY.md](BUSINESS-INVENTORY.md) (11 domains, 146 features) |
| 2 | Navigation | `SIDEBAR_GROUPS` (layout-shell.tsx) | Visible? Enabled? Permission? Route? | Existing extractor (visibility); reconcile vs #1 |
| 3 | Technical | code (per page) | APIs · Services · Tables | Partial (API grep in FEATURE-INVENTORY); extend |
| 4 | Dependency | API usage | Reads · Writes · Depends-on (blast radius) | [DEPENDENCY-MATRIX.md](DEPENDENCY-MATRIX.md) |

## Cross-validation (from the Business extractor, verified)
- Business (Top Menu): **146** features · Navigation (SIDEBAR_GROUPS): **111** routes.
- **32 features are in the Top Menu but absent from the Navigation Manager** — incl.
  the whole Commercial/Finance surface (`/rate-manager`, `/product-registry`,
  `/destination-catalog`, `/deals`, `/finance-cockpit`, …). → the prior audit
  (built on SIDEBAR_GROUPS) was **incomplete**.
- **3 in Navigation but not Top Menu**: `/account`, `/server-health`,
  `/ai-ops?tab=decision-overlay` (the dead-deep-link alias, DUP-001).

## Unified tool (target)
Evolve extraction into one CLI with a source selector, producing the four reports
from one framework:
```
extract-features --source=domains       → Business Inventory   (canonical)
extract-features --source=navigation    → Navigation Inventory (visibility)
extract-features --source=technical     → Technical Inventory  (APIs/services/tables)
extract-features --source=dependencies  → Dependency Inventory (reads/writes)
```
Benefits: one parser, four reports, automatic cross-validation (hidden features,
orphaned implementations, missing navigation).

- [x] Business source implemented (`tools/extract-business.mjs`) — **Done**
- [ ] Fold Business/Navigation/Technical/Dependency under one `--source` CLI — **Pending**

## Duplicate analysis operates at the capability level
Compare **capabilities within a domain**, not pages:
`Platform → Routing → {Routing Manager, Route Simulator, Route Tester, Route Intelligence}`
→ which is canonical / views / aliases / consolidation candidates. See
[CANONICAL-CAPABILITY-MATRIX.md](CANONICAL-CAPABILITY-MATRIX.md) and
[CAPABILITY-LIFECYCLE-MATRIX.md](CAPABILITY-LIFECYCLE-MATRIX.md).
