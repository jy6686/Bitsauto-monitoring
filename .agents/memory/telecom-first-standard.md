---
name: Telecom-First Design Standard
description: Permanent architecture principle — all features must be designed for Tier-1 wholesale VoIP, not generic ERP/CRM.
---

## Rule
All platform features, APIs, schemas, workflows, dashboards, reports, AI analysis,
and automation must be designed around real-world telecom and VoIP operations.
Generic ERP abstractions only allowed when no telecom-specific concept exists.

**Why:** The platform targets wholesale voice carriers and A2P SMS operators.
Generic business patterns (Orders, Customers, Products) obscure carrier-grade
operational concepts and reduce value for the actual user base.

## Evaluation Checklist (apply to every new feature)
1. Is this how a wholesale VoIP carrier would operate?
2. Does the data model reflect telecom entities, not generic business objects?
3. Can it scale to multi-switch, multi-vendor, multi-currency, multi-country?
4. Does it preserve auditability for carrier disputes and financial reconciliation?
5. Would an NOC engineer, Finance analyst, or Carrier Relations manager recognize this?

## API Naming
- `GET /api/finance/snapshot/revenue` not `GET /api/revenue`
- `GET /api/billing-cycles` not `GET /api/orders`
- `GET /api/business-partners` not `GET /api/accounts`

## Database Naming
Prefer: `cdr`, `dmr`, `financial_snapshot`, `billing_cycles`, `settlements`, `disputes`, `routing_profiles`, `interconnects`, `qos_metrics`, `cps_history`
Avoid when telecom-specific term exists: `orders`, `products`, `customers`, `vendors`

## Financial Integrity Standard (enforced in sippy-snapshot.service.ts)
Every materialization run must verify:
- Σ client sell_amount ≈ aggregate sell_amount (±0.5%)
- Σ vendor buy_amount  ≈ aggregate buy_amount  (±0.5%)
Result stored in `consistency_flag` (boolean) + `consistency_details` (jsonb) on `materialization_runs`.

**How to apply:** Any new finance data pipeline must include an equivalent
post-write aggregate reconciliation check before declaring success.

## Full standard
`.local/governance/telecom-first-design-standard.md`
