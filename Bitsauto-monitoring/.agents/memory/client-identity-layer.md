---
name: Client Identity Layer
description: Architecture and gotchas for the client_identity_map table and resolveClientIdentity() canonical identity system.
---

## What it is
`client_identity_map` is the canonical identity resolution layer for all finance/governance systems. Every invoice, DMR row, dispute, reconciliation entry, and AI alert should resolve through `resolveClientIdentity()` rather than raw Sippy field lookups.

## Key fields
- `i_account` — canonical Sippy account ID (unique key)
- `sippy_username` — operational source username
- `billing_name` — legal/invoice name
- `display_name` — UI label
- `crm_name`, `portal_name`, `external_ref` — cross-system aliases
- `risk_tier` — low | standard | elevated | critical
- `active` — lifecycle flag

## API routes
- `GET /api/identity` — list (search, activeOnly params)
- `GET /api/identity/resolve/:iAccount` — resolve one account → { displayName, billingName, iAccount, sippyUsername, riskTier }
- `POST /api/identity` — upsert (create or update by i_account)
- `PATCH /api/identity/:id` — update specific fields
- `DELETE /api/identity/:id` — delete
- `POST /api/identity/seed` — pull all Sippy accounts and upsert (uses listSippyAccounts + accountNameCache fallback)

## Storage
- `storage.resolveClientIdentity(iAccount, fallbackUsername?)` — returns safe defaults if not in map
- `storage.upsertClientIdentity(data)` — idempotent by i_account

## Server restart gotcha
Routes deep in routes.ts (line ~27143+) only activate after a **full server restart**, not just Vite HMR. Adding routes that return HTML instead of JSON means the server hasn't reloaded yet. Use `restart_workflow("Start application")` to force it.

**Why:** tsx watch restarts the server, but HMR only updates client bundles. Very long routes.ts files (28k+ lines) can cause the tsx reload to be slower than expected.

## Frontend pages
- `/client-identity` — management table with search, create, edit, delete, seed-from-Sippy
- `/finance-cockpit` — unified finance workspace (KPI strip + Collections Queue + Revenue Assurance Grid + AI Assurance Queue)

Both are protected routes (admin/management roles) and appear in the Finance & Billing sidebar section and the finance workspace rail.
