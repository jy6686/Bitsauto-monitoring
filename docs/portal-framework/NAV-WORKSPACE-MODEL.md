# Portal Workspace Model — Frozen Governance (NAV-C)

**Status:** BACKEND FROZEN (NAV-A/B @ 76f15515). NAV-C in progress behind a feature flag.
**Supersedes:** the config-service navigation model that NOC **v1.0** was certified on.
**Requires:** a fresh **NOC v1.1** production re-certification before the tag advances.

This document is the single source of truth for portal navigation governance. It records
decisions made 2026-07-24. Do not re-litigate; fill in the next unchecked item.

---

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
5. Sidebar / top-nav / cascade read `workspace.navigation` — never their own query.
6. No component queries navigation tables directly. Everything comes from
   `PortalWorkspaceContext`.
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

## 5. Validation (frozen requirement — BOTH ends)

**Backend** (`getPortalWorkspace`, before returning): verify no duplicate routes, no missing
groups, no orphan modules, no duplicate ids. Fail early with a structured error — a 200 with
a broken tree is not success.

**Frontend** (on workspace load, before rendering): same assertions; on failure render
"Workspace configuration error" instead of a broken nav.

## 6. Sequence (approved 2026-07-24, execution order per owner review)

- [x] **Phase 0 — Freeze the model** (this document)
- [x] **NAV-A/B** — schema, seed, `GET /api/portals/:slug/workspace` (76f15515)
- [ ] **Phase 1 — Migration 031** — apply to dev AND prod; verify tables + seeds +
      workspace endpoint on the migrated schema. Nothing removed from boot yet.
- [ ] **Phase 2 — Remove boot logic** — strip ALL permanent schema/seed from `db.ts`
      (not just the workspace block); commit as its own milestone
- [ ] **Phase 3 — Backend validation** (§5) + §3 module overrides in `getPortalWorkspace`
- [ ] **Phase 4 — Feature flag** — `portalWorkspaceNavigation` (default **false**)
- [ ] **Phase 5 — NAV-C1** — `PortalWorkspaceProvider` + `usePortalWorkspace()` only
- [ ] **Phase 6 — Consumers, one at a time, in this order:**
      Search → Top Menu → Cascade → Sidebar → Breadcrumb → Quick Actions → Favorites.
      Never flip everything simultaneously.
- [ ] **NAV-D** — idempotent apply on Replit (Node script, no psql/heredoc)
- [ ] **NOC v1.1 certification** — runtime-validate in production, THEN advance the tag

**Baseline before Phase 6:** capture screenshots (Main Platform, NOC, Finance × top menu,
cascade, sidebar, search, breadcrumb, dashboard) and compare after each consumer switch.

## 7. Non-goals (this program)

- Migrating the main platform off `DOMAINS[]` (future, low priority).
- In-browser admin UI for portal nav config (separate sprint).
- Real-time nav changes without restart.
