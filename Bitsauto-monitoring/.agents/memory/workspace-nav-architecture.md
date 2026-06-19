---
name: Workspace Navigation Architecture
description: WorkspaceShell tab-bar system — phases, seeding, and route wrapping pattern
---

# Workspace Navigation Architecture

## Pattern
`withWorkspace(slug, Page)` creates stable component refs at module level in App.tsx. Each wrapped component renders `<WorkspaceShell workspaceSlug={slug}>` above the page, fetching tabs from `/api/workspaces/:slug`.

## DB Tables (created via direct SQL — not db:push, which prompts on routing_groups_cache constraint)
- `workspace_definitions` — one row per workspace
- `workspace_tabs` — tabs within each workspace
- `workspace_tab_items` — items within each tab

## Seeding
`server/workspace-seed.ts` seeds 5 workspaces automatically on startup (idempotent, checks if table is empty).

## Phase 2 — Completed workspaces
| Workspace slug | Routes wrapped |
|---|---|
| billing-ops | /billing, /invoices, /invoice-jobs, /invoice-templates, /credit-notes, /credit-control, /products, /rate-cards, /tariff-versions |
| revenue-assurance | /dmr, /client-reconciliation, /carrier-reconciliation, /ai-assurance, /margin-intelligence, /traffic-forecast, /revenue-heatmap |
| dispute-governance | /billing-disputes, /dispute-cases, /dispute-defense, /commercial-notifications |

## TanStack Query key convention
`queryKey: ["/api/workspaces", slug]` — the default fetcher joins with "/" → fetches `/api/workspaces/billing-ops`.

**Why:** Stable component refs outside React component body prevent remount on every render, which would lose page state.

**How to apply:** When wrapping new phases, always define `const FooWS = withWorkspace("slug", FooPage)` at module level in App.tsx, then use `FooWS` inside the Route.
