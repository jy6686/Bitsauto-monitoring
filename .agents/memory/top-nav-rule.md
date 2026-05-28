---
name: Top Navigation Rule
description: ALWAYS add new pages/modules to the top navigation (DOMAINS in app-nav-shell.tsx), NEVER to the sidebar. Sidebar is contextual-only.
---

## The Rule

ALL new pages, features, and modules must be added to the **DOMAINS array** in `client/src/components/app-nav-shell.tsx`.

NEVER add new items to `SIDEBAR_GROUPS` or the workspace rail in `client/src/components/layout-shell.tsx`.

**Why:** The user's intended architecture is:
- Top bar = primary workspace controller (portal switcher → domain tabs → section orchestration)
- Sidebar = contextual module list only (thin, domain-scoped)

The sidebar should not be a global navigation mega-list. Only contextual shortcuts relevant to the active domain belong there.

## How to apply

When adding a new page/feature:

1. **Top nav** (`client/src/components/app-nav-shell.tsx`):
   - Find the appropriate domain in `const DOMAINS: Domain[]`
   - Add to the correct group, or create a new group within that domain
   - Each item: `{ href: '/my-page', label: 'My Page', desc: 'Short description', icon: IconComponent }`

2. **Route mapping** (`client/src/lib/workspace.ts`):
   - Add `['/my-page', 'finance']` (or appropriate domain) to `ROUTE_DOMAIN_MAP`
   - This ensures the top nav highlights the correct domain tab when on that page

3. **Do NOT touch** `SIDEBAR_GROUPS` or the workspace rail (`WORKSPACE_SHORTCUTS`) in `layout-shell.tsx`

## Domain → group structure

Finance & Billing domain has these groups:
- `Cockpit & Identity` → Finance Cockpit, Client Identity Map
- `Billing` → Billing, Invoices, Invoice Queue, Invoice Templates, Credit Notes, Credit Control, Disputes, Products, Rate Cards
- `Revenue Assurance` → DMR, Client Recon, Carrier Recon, AI Assurance, Margin Intelligence, Dispute Cases, Dispute Defense, Partner Portal
- `Cost & Analytics` → Cost Optimisation, Revenue Heatmap, Balance Monitor, Finance Reports, CDR Billing

## Historical mistakes to avoid

- Finance Cockpit was incorrectly added to `SIDEBAR_GROUPS['finance']` at lines 279-280 and the workspace rail at lines 390-391. These were removed.
- Client Identity Map had the same mistake. Removed from sidebar, added to top nav DOMAINS.
