---
name: Finance governance modules
description: Status and conventions for the 5 governance modules added in the T001-T004 + Partner Portal sprint (migrations 015-019).
---

## Completed Modules

All modules fully implemented: schema → storage → service → routes → UI → App.tsx → sidebar.

| Module | Migration | Route Prefix | Page Path | Tables |
|--------|-----------|--------------|-----------|--------|
| Multi-Template Invoice Rendering | 015 | /api/invoice-templates, /api/branding-profiles | /invoice-templates | invoice_templates, client_branding_profiles |
| Credit Notes & Settlement | 016 | /api/credit-notes | /credit-notes | credit_notes |
| Collections & Credit Control | 017 | /api/credit-control | /credit-control | credit_control_rules, collection_events |
| AI Revenue Assurance | 018 | /api/ai-assurance | /ai-assurance | ai_revenue_alerts, ai_scan_runs, adjustment_ledger |
| Partner Operations Portal | 019 | /api/partner-profiles, /api/portal/* | /partner-profiles, /portal/* | partner_profiles |

## Partner Portal Conventions
- Auth is access-code based (separate from Replit OIDC admin auth). Stored in req.session.portalClientName.
- Access codes: 24-char base64url, HMAC-SHA256 hashed with SESSION_SECRET. First 4 chars stored as prefix for fast lookup.
- All /api/portal/* data routes are scoped to portalClientName — never return other clients' data.
- Portal pages live at /portal/* (login, dashboard, invoices, disputes, credit-notes, reconciliation).
- Admin management page at /partner-profiles — creates profiles and generates one-time-visible codes.
- Hashed access code is NEVER returned in API responses.

**Why:** Access codes are the only portal auth mechanism. If the hash leaks, all portal accounts are compromised. Always strip accessCodeHash from responses.

## AI Assurance Conventions
- Advisory-only governance rule: AI suggests → human approves → platform acts. Never auto-finance actions.
- 5 detectors: margin_collapse, asr_drop, revenue_drop, reconciliation_drift, credit_note_clustering.
- Idempotency: won't re-create same OPEN alert type+client within 24h.
- anomaly_score 0-100: <35=low, 35-60=medium, 60-80=high, ≥80=critical.

## Storage Pattern
- All new tables: add to IStorage interface first, then DatabaseStorage implementation, then import at top of storage.ts.
- Barrel exports in server/services/sippy/index.ts.
- Routes use lazy dynamic imports: `await import('./services/sippy/index')`.

## Migration Convention
- Advisory-only platform: migrations run via `psql $DATABASE_URL -f migrations/NNN.sql` ONLY. NEVER db:push.
- Next migration number: 020.

**Why:** The platform is designed for safe 24/7 production operation; db:push could destructively alter live tables.
