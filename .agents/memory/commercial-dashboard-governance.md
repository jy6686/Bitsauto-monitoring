---
name: Commercial Dashboard Governance
description: Hard rule — every widget on the Commercial Dashboard must be hierarchy-scoped; any global query is a violation.
---

## The Rule

Every widget, KPI, chart, and table on the Commercial Dashboard must be derived exclusively from the authenticated user's hierarchy scope.

Widgets that cannot be filtered by hierarchy must not appear until the underlying data model supports portfolio scoping.

**Why:** Commercial Dashboard is portfolio-centric (my accounts), NOC Dashboard is network-centric (entire switch). These must never share data scope.

## Data Pipeline (mandatory)

```
Authenticated User → Hierarchy Scope Service → Visible Account IDs → /api/commercial/* → Widgets
```

No shortcut from User → global API.

## Currently Approved KPIs (all portfolio-scoped)

1. Managed Accounts — from /api/kam/portfolio
2. Portfolio Health — avg healthScore from portfolio
3. At Risk — state ∈ {at_risk, degraded} from portfolio
4. Live Calls — sum of account.liveCallCount from portfolio
5. Revenue 24h — sum of account.revenue24h from portfolio
6. No Traffic — count where calls24h === 0 from portfolio
7. Pending Rate — rateNotificationJobs.iAccount IN accountIds (routes-commercial.ts)
8. Pending Approval — same source as above

## Deferred KPIs (data model not yet account-linked)

- Open Invoices: invoices table has no sippy_account_id — must not show
- Open Disputes: billing_disputes is vendor-centric — must not show
- Low Balance Clients: needs currentBalance in portfolio response
- Credit Limit Alerts: needs credit_limits table

**How to apply:** Before adding any widget to kam-dashboard.tsx, check this list. If data can't be filtered by accountIds, it goes in the deferred list, not on the dashboard.

## Enforcement Pattern

New cross-table KPIs go in `server/routes-commercial.ts` → `GET /api/commercial/dashboard/kpis`, filtered by `accountIds` from `getVisibleAccountIds()`.

Authority doc: `.local/governance/COMMERCIAL-DASHBOARD-GOVERNANCE.md`
