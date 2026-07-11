# Navigation Registries — canonical source clarification `[V @ code]`

Two distinct nav structures exist. They serve different purposes and **must not be
conflated**:

| Registry | File | Role | Use in this audit |
|----------|------|------|-------------------|
| **Top Menu** (`DOMAINS`) | `client/src/components/app-nav-shell.tsx:44` | **Canonical product architecture** — the 11 business domains | **Source of truth for the inventory** |
| **Navigation Manager** (`SIDEBAR_GROUPS`) | `client/src/components/layout-shell.tsx:150` | **Feature Visibility Registry** — enabled? visible? URL? permission? Marked `[MAINTENANCE-ONLY] — DO NOT ADD NEW FEATURES HERE` | **Completeness cross-check only** |

## Canonical hierarchy (drives the audit)
```
Top Menu → Business Domain → Capability → Feature → Page → API
```

## The 11 Top-Menu business domains `[V @ app-nav-shell.tsx]`
Live Network · Clients · Operations · BitsEye · Analytics · Intelligence ·
**Security · Finance · Products · Voice Trading · Platform**

(The owner's product menu — Dashboard/Chat/Security/Finance/Products/Voice Trading/
Platform/Portals — maps onto these domains; Dashboard/Chat/Portals are top-level
surfaces alongside the domain menu.)

## Rules
- **Duplicate/overlap analysis compares capabilities within a domain**, not menu
  items or sidebar entries. E.g. `Platform → Routing → {Routing Manager, Route
  Simulator, Route Tester, Route Intelligence}` is one cluster reviewed together.
- **Navigation Manager (`SIDEBAR_GROUPS`) never determines business architecture or
  duplicates** — it only confirms every configurable feature appears in the
  inventory (completeness), and reports visibility/permission/URL.

## Correction to the current audit (action item)
The generated `FEATURE-INVENTORY.md` and `tools/extract-features.mjs` currently read
**`SIDEBAR_GROUPS`** (the visibility layer). They must be **re-pointed to `DOMAINS`**
(the Top Menu) so the inventory reflects business architecture, with `SIDEBAR_GROUPS`
used only as the completeness check.

- [ ] Re-point `tools/extract-features.mjs` to parse `DOMAINS` (Top Menu) → regenerate inventory.
- [ ] Add a completeness pass: every `SIDEBAR_GROUPS` feature present in the Top-Menu inventory (flag orphans).
