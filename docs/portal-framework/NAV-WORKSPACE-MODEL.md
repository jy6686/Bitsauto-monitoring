# Portal Workspace Model — Frozen Governance (NAV-C)

**Status:** BACKEND FROZEN (NAV-A/B @ 76f15515). NAV-C in progress behind a feature flag.
**Supersedes:** the config-service navigation model that NOC **v1.0** was certified on.
**Requires:** a fresh **NOC v1.1** production re-certification before the tag advances.

This document is the single source of truth for portal navigation governance. It records
decisions made 2026-07-24. Do not re-litigate; fill in the next unchecked item.

> **Default: Domain Assignment. Exceptions: Module Override.**
>
> That single sentence is the entire navigation philosophy. A portal owns domains;
> owning a domain exposes everything under it; a module override hides (or shows) one
> module as the rare exception. Nothing else governs what is navigable.

---

## 0. Portal layout (frozen): portals have NO left sidebar

**Portals do not render the global left sidebar.** The portal's top menu is the primary
navigation. Cascade menus provide the second level, and modules are the third level.
Search, favorites, quick actions, and breadcrumbs all derive from the Portal Workspace.

```
Main Platform:  Header + Left Sidebar          (administration workspace)
Portals:        Header + Top Menu + Cascade    (dedicated application; no sidebar)

Portal Workspace
│
├── Header
│     ├── Logo
│     ├── Top Menu (Main Menu)
│     ├── Search
│     ├── Favorites (★)
│     ├── Quick Actions (+)
│     ├── Notifications
│     └── User Menu
│
├── Cascade Menu
│
├── Content
│
└── Footer (optional)
```

Consequences:
- `PortalSidebar` is **removed** from portal mode (not rewired to the workspace).
- Favorites (★) and quick actions (+) live in the **header** (or dashboard widgets).
- Breadcrumb = `Domain > Module`, resolved from the workspace tree.
- `portal_workspace.sidebar_style` stays in the schema as a **reserved** column; the
  frontend ignores it. Do not build UI on it.

## 1. The one invariant (frozen)

**The Top Menu is the Main Menu — the root of the portal navigation tree.**
Every navigation surface is a *projection* of the same tree; none queries the DB independently.

```
Portal
  └─ navigation_domains        ← Top Menu (Main Menu) = root
       └─ navigation_groups    ← Cascade sections
            └─ navigation_modules ← clickable pages
```

A portal chooses which **domains** it owns via `portal_domain_assignments`.
Assigning a domain exposes **all** its groups and modules by default.

## 2. Governance model: navigation vs composition (frozen)

Two different concerns, two different authorities. Do not conflate them.

| Concern | Authority | Consumed by |
|---|---|---|
| **Navigation** (what's reachable) | `portal_domain_assignments` → domains/groups/modules | Top menu, cascade, sidebar, search, breadcrumb, quick actions |
| **Composition** (what's featured) | `portal_module_assignments` | Home-page cards, dashboard widgets |
| **Exceptions** (hide/show a module in a portal) | module-level override (see §3) | Navigation, as a filter on the default |

`portal_module_assignments` is **no longer the navigation authority.** It is composition +
the override mechanism. This is the deliberate change from v1.0.

## 3. Domain-driven default + optional module overrides (frozen — Q3 "Other")

```
Default:     Domain Assignment      (portal_domain_assignments)
Exceptions:  Module Override        ("portal module overrides" — hide/show one module)
```

- **Default:** domain assignment exposes every module under it. Most portals need nothing more.
- **Exception:** an optional module-level `hide`/`show` override for the rare case where a
  single module under an owned domain must not appear in a given portal.
- **Naming (frozen):** in all documentation and code the navigation exception mechanism is
  called **portal module overrides** — never "module assignments". The legacy
  `portal_module_assignments` table remains for *composition* (home cards, dashboard
  widgets) only; it is NOT the navigation mechanism and future developers must not treat
  it as such.
- Overrides are the exception, **not** the primary model — we do not hand-maintain hundreds
  of per-portal module rows.
- The workspace API applies overrides as a filter *after* resolving the domain default.

## 4. Permanent rules (frozen — no exceptions in portal mode)

1. No `DOMAINS[]` constant in **portal** mode. (It stays for the main platform at `/`.)
2. No `PORTAL_OWNED_DOMAINS` constant.
3. No portal filtering logic inside `CascadeMenu` / `app-nav-shell`.
4. Search reads `workspace.search.index` — never a global `navigation_modules` query.
5. Top-nav / cascade read `workspace.navigation` — never their own query. There is no
   sidebar in portal mode (§0).
6. No component queries navigation tables directly. Everything comes from
   `PortalWorkspaceContext`. **No additional navigation endpoints, no alternate search
   endpoint, no special sidebar query — the workspace response is the only source.**
7. **No schema creation or seed data in application boot — for ANY table, not just the
   workspace.** Target state for `server/db.ts`:
   ```
   db.ts → connect → health checks → runtime only
   ```
   All permanent schema+seed live in numbered migrations
   (`migrations/031_portal_workspace_model.sql` for the workspace; the remaining
   `runSafeMigrations()` blocks get extracted the same way). Runtime **reads only**.
8. `portalRoute` is always computed server-side (`/${slug}/${moduleKey}`). The frontend
   never constructs portal routes.
9. **No UI component may construct its own navigation tree.** Never `DOMAINS.map(...)`
   inside a portal component; never query `navigation_modules` (or any nav table) from a
   UI component. Top Menu, Cascade, Search, Favorites, Quick Actions, and Breadcrumb all
   read the same `PortalWorkspaceContext` object — nothing else.

## 5. Validation (frozen requirement — BOTH ends)

**Backend** (`getPortalWorkspace`, before returning): verify no duplicate routes, no missing
groups, no orphan modules, no duplicate ids. Fail early with a structured error — a 200 with
a broken tree is not success.

**Frontend** (on workspace load, before rendering): same assertions; on failure render
"Workspace configuration error" instead of a broken nav.

## 6. Sequence (approved 2026-07-24, revised per owner review #2)

- [x] **Phase 0 — Freeze the model** (this document)
- [x] **NAV-A/B** — schema, seed, `GET /api/portals/:slug/workspace` (76f15515)
- [x] **Phase 1a — Migration 031 authored + locally verified** (7307444f: from-scratch
      020→021→029→031 chain, idempotent re-apply, counts + integrity green on PG16)
- [ ] **Phase 1b — Apply 031 to dev (Replit) AND prod (Neon)** via
      `scripts/apply-portal-workspace.mjs`; both must report verification green
- [ ] **API freeze** — the workspace JSON contract (§7) is frozen; every frontend
      component consumes this object and nothing else
- [ ] **API certification** — independent check BEFORE any React work: JSON schema keys,
      duplicate routes, orphan groups, orphan modules, portal counts, search index,
      permissions (`scripts/certify-portal-workspace.mjs`). Certify, then freeze.
- [ ] **Phase 2A — Remove ONLY the Portal Workspace boot block** from `db.ts`
      (navigation_domains / navigation_groups / portal_domain_assignments /
      portal_workspace). Verify. Commit as a standalone milestone.

      **Phase 2A gate — preconditions / execution / postconditions:**

      *Preconditions (must already be true before the deletion starts):*
      | # | Check |
      |---|---|
      | P1 | Development migration applied |
      | P2 | Development certification passed |
      | P3 | Production migration applied |
      | P4 | Production certification passed |
      | P5 | Workspace API returns `workspaceVersion` |
      | P6 | Workspace API returns `navigationChecksum` — **record the certified
             checksum now; it is the invariant for P/C7** |

      *Execution:* delete only the Portal Workspace boot block from `db.ts`; no other
      code changes; boot the application against the migrated database.

      *Postconditions (re-verified before the commit is created):*
      | # | Check |
      |---|---|
      | C1 | Application boots successfully |
      | C2 | `GET /api/portals/noc/workspace` returns the certified contract |
      | C3 | HTTP certification passes |
      | C4 | NOC home module resolves |
      | C5 | Search index matches navigation scope |
      | C6 | No startup regressions |
      | C7 | **`navigationChecksum` is IDENTICAL to the pre-deletion certified value.**
             A changed checksum means runtime behavior changed — do NOT commit until
             the cause is understood. Phase 2A changes where navigation data comes
             from (migration instead of boot seeding), never what navigation is served. |

      If any postcondition fails: revert the deletion, don't patch around it — the boot
      block stays until the cause is understood.

      Diff discipline: delete only the Portal Workspace boot block — no formatting
      changes, no opportunistic cleanup, no API changes, no frontend changes. Small,
      reviewable, revertible.
- [ ] **Phase 2B — Move remaining legacy boot tables** (portal_definitions,
      navigation_modules, user_favorites, caches, noc_incidents, …) to numbered
      migrations. Unrelated to NAV-C; separate milestone for easy rollback.
- [ ] **Phase 3 — Backend §5 validation + §3 module overrides** in `getPortalWorkspace`
- [ ] **Phase 4 — Feature flag** — `portalWorkspaceNavigation` (default **false**)
- [ ] **Phase 5 — NAV-C1** — `PortalWorkspaceProvider` + `usePortalWorkspace()` only
- [ ] **Baseline snapshots (MANDATORY before Phase 6)** — Main Platform, NOC, Finance ×
      top menu, cascade, sidebar, search, breadcrumb, dashboard; compare after EVERY phase
- [ ] **Phase 6 — Consumers, one at a time, in this order:**
      Search → Top Menu → Cascade (+ **sidebar removed**, §0) → Breadcrumb →
      Favorites → Quick Actions. Breadcrumb comes right after navigation because it
      derives from the same route hierarchy; favorites/quick actions are less critical.
      Never flip everything simultaneously.
- [ ] **NAV-D** — Replit deploy + delete Model B `/api/workspaces` + `seedWorkspacesIfEmpty`
- [ ] **Portal acceptance checklist** (§9) per portal — NOC first — before the flag is
      enabled in production
- [ ] **NOC v1.1 certification** — runtime-validate in production, THEN advance the tag
      and declare **Portal Framework v1.1** (§8)

## 7. Frozen API contract — `GET /api/portals/:slug/workspace`

Top-level shape (frozen; additive-only changes, never breaking):

```json
{
  "workspaceVersion":   1,
  "navigationChecksum": "4d6d9…",
  "portal":       { "slug": "", "name": "", "theme": "", "defaultRoute": "" },
  "workspace":    { "homeModule": "", "defaultDomain": "", "searchScope": "portal",
                    "sidebarStyle": "(reserved — ignored by frontend)", "dashboardLayout": "" },
  "navigation":   { "domains": [ { "id": "", "label": "", "iconKey": "", "colorClass": "",
                      "displayOrder": 0, "groups": [ { "id": 0, "label": "", "iconKey": "",
                      "displayOrder": 0, "items": [ { "moduleKey": "", "title": "",
                      "iconKey": "", "route": "", "portalRoute": "" } ] } ] } ] },
  "search":       { "scope": "portal", "index": [ "…same item shape…" ] },
  "quickActions": [],
  "favorites":    [],
  "dashboard":    { "layout": "grid", "sections": [] }
}
```

Rules: `portalRoute` server-computed only; `search.index` contains exactly the modules
reachable through `navigation` (no wider); `favorites`/`quickActions` are stubs today and
will be populated per-user later WITHOUT shape changes. No other endpoint may serve
navigation, search, favorites, or quick-action data to portal UI.

`workspaceVersion` = contract version (bumped only on additive shape changes).
`navigationChecksum` = server-computed hash of the navigation tree; the frontend logs
`Loaded workspace v{N} checksum {…}` on load so stale caches and mismatched deployments
are diagnosable at a glance.

## 8. Portal Framework v1.1 — permanent architectural rules

Declared when NAV-C completes + NOC passes §9. These are the platform's permanent
navigation contract; future work builds on them, never around them:

1. Top Menu = Main Menu.
2. No sidebar in portals.
3. The Workspace is the only navigation source.
4. Search is portal-scoped.
5. Domain Assignment by default.
6. Module Override by exception.
7. The navigation API is additive-only.
8. Components never build navigation independently.

## 9. Portal acceptance checklist (before the flag is enabled in production)

Run per portal — NOC first, then Finance, KAM, Client, Partner:

- [ ] Top menu matches the portal's assigned domains.
- [ ] Every cascade renders correctly.
- [ ] Search returns only portal-scoped modules.
- [ ] Favorites and Quick Actions are portal-scoped.
- [ ] Home module is reachable.
- [ ] No orphan routes or duplicate entries.
- [ ] No sidebar is rendered.

## 10. Single-owner rule for infrastructure milestones (frozen, operational)

**Only one active owner may perform an infrastructure-changing milestone.** Examples:
schema migrations, boot-logic removal, navigation-source changes, runtime switching,
feature-flag activation. Routine feature work may run in parallel; infrastructure
milestones never do — one designated owner, one commit, other flows pull afterwards.

Current assignments (2026-07-24):
- **Phase 2A** — owner: the Mac-clone flow (author of 031/certify/checksum/this doc).
  Scope frozen: *"Remove Portal Workspace schema/seed boot logic from db.ts. No API
  changes. No frontend changes. No refactoring. No formatting cleanup. No unrelated
  migration work."* Anything outside that block = separate commit.
- **Other flow** — does NOT execute 2A; pulls origin after 2A lands; then NAV-C1 work
  may be parallelized (backend: provider/flag/validator · frontend: consumers) on the
  frozen contract.

**NAV-C1 exit criteria — ALL must be true before PortalWorkspaceProvider work starts:**
dev migration applied ✚ dev certification passed ✚ prod migration applied ✚ prod
certification passed ✚ Phase 2A committed & pushed ✚ other flow has pulled 2A.

## 11. Non-goals (this program)

- Migrating the main platform off `DOMAINS[]` (future, low priority).
- In-browser admin UI for portal nav config (separate sprint).
- Real-time nav changes without restart.
