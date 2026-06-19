---
name: Portal Governance 3-level navigation
description: Architecture of the DB-driven 3-level portal nav system — workspace switcher, domain section tabs, contextual sidebar.
---

## Rule
Portal navigation is 3 levels:
1. **WorkspaceSwitcherPill** (top-right pill) — switches between portals (kam/noc/finance/partner/admin)
2. **PortalTopNav** (top-bar center tabs) — Level 2 domain section tabs from `portal_sections` table; replaces DOMAINS tabs when `isPortalMode=true`
3. **PortalSidebar** (left sidebar) — contextual, shows only `sectionModules` (filtered by `activeSection`)

**Why:** Matches Salesforce/AWS/Azure enterprise nav hierarchy. Sidebar must never contain everything — only active section's modules.

## DB tables (migrations 020 + 021)
- `portal_definitions` — 5 portals seeded (kam, noc, finance, partner, admin)
- `navigation_modules` — 43 modules in global registry
- `portal_module_assignments` — maps modules→portals with section, display_order, visibility
- `portal_sections` — Level 2 tab metadata per portal (section_key, title, icon, sort_order); query: `GET /api/portal/sections/:slug`

## Key files
- `client/src/context/portal-context.tsx` — `PortalProvider`; exposes `sections`, `activeSection`, `setSection`, `sectionModules`
- `client/src/components/portal-sidebar.tsx` — `PortalSidebar` (contextual), `WorkspaceSwitcherPill`, `PortalTopNav`
- `client/src/components/app-nav-shell.tsx` — when `isPortalMode`, renders `<PortalTopNav />` in center; hides standard DOMAINS + nav config toggle
- `client/src/components/layout-shell.tsx` — when `isPortalMode`, renders `<PortalSidebar>` instead of standard NavContent
- `server/storage.ts` — `getPortalSections(slug)` method
- `server/routes.ts` — `GET /api/portal/sections/:slug`

## Query key convention
- Portal definitions: `["/api/portal/definitions"]`
- Portal modules: `["/api/portal/modules", activePortal]` → `/api/portal/modules/kam`
- Portal sections: `["/api/portal/sections", activePortal]` → `/api/portal/sections/kam`

(TanStack default fetcher joins queryKey array with "/" so array element order matters)

## Section→sidebar flow
`activeSection` (string, e.g. "clients") is stored in localStorage key `bitsauto_active_section`.
`sectionModules = modules.filter(m => m.section === activeSection)` — computed in context.
When portal changes, activeSection resets to null and then defaults to first section from DB.
