---
name: Finance governance modules
description: Status and conventions for the 4 telecom finance governance modules added in the T001-T004 implementation sprint (migrations 015-018).
---

## Completed Modules

All 4 modules are fully implemented: schema → storage → service → routes → UI → App.tsx → sidebar.

| Module | Migration | Route Prefix | Page Path | Tables |
|--------|-----------|--------------|-----------|--------|
| Multi-Template Invoice Rendering | 015 | /api/invoice-templates, /api/branding-profiles | /invoice-templates | invoice_templates, client_branding_profiles |
| Credit Notes & Settlement | 016 | /api/credit-notes | /credit-notes | credit_notes |
| Collections & Credit Control | 017 | /api/credit-control | /credit-control | credit_control_rules, collection_events |
| AI Revenue Assurance | 018 | /api/ai-assurance | /ai-assurance | ai_revenue_alerts, ai_scan_runs, adjustment_ledger |

## AI Assurance Conventions
- Advisory-only governance rule: AI suggests → human approves → platform acts. Never auto-finance actions.
- 5 detectors in sippy-ai-assurance.service.ts: margin_collapse, asr_drop, revenue_drop, reconciliation_drift, credit_note_clustering.
- Idempotency: won't re-create same OPEN alert type+client within 24h.
- anomaly_score 0-100 maps to severity: <35=low, 35-60=medium, 60-80=high, ≥80=critical.
- Detectors use stored data (DMR reports, invoices, reconciliation records, credit notes) — no live Sippy calls.

## Storage Pattern
- All new tables follow: add to IStorage interface first, then DatabaseStorage implementation, then import at top of storage.ts.
- Barrel exports in server/services/sippy/index.ts.
- Routes use lazy dynamic imports: `await import('./services/sippy/index')`.

## Migration Convention
- Advisory-only platform: migrations run via `psql $DATABASE_URL -f migrations/NNN.sql` ONLY. NEVER db:push.
- Next migration number: 019.

**Why:** The platform is designed for safe 24/7 production operation; db:push could destructively alter live tables.
