---
name: Product Policy — BitsAuto
description: Formal product/pricing policy governing separation of commercial classes from destinations across all platform modules
---

# Product Policy — BitsAuto

## Core Principle
Products are **commercial classes** (pricing/routing strategies), NOT destinations.

## Product Classes
| Code | Name | Internal Prefix |
|------|------|----------------|
| FC | First Class | 1 |
| BC | Business Class | 2 |
| SB | Standard Business | 6 |
| SC | Super Class | 7 |

Internal prefix is ROUTING ONLY. Never exposed to customers/partners.

## Correct vs Wrong Display
- ❌ WRONG: 1923 Pakistan / 2923 Pakistan / 6923 Pakistan / 7923 Pakistan
- ✅ CORRECT: 923 Pakistan Mobile | FC=0.0230 | BC=0.0194 | SB=0.0320 | SC=0.0400

## Module Rules

### Product Catalog (`/product-registry`)
- Owns: Commercial Definitions, Routing Templates, Pricing Templates, Customer Assignment
- Shows: Product code, prefix, status — internal use only

### Rate Manager (`/rate-manager`)
- Purpose: Import, Compare, Reconcile, Publish — INTERNAL ONLY
- MAY show: Product, Vendor, Internal Prefix (e.g. 2923), Tariff label
- MUST NOT: Generate customer-facing exports using 1923/2923/6923/7923

### Destination Catalog (`/destination-catalog`)
- Authority for customer-facing destinations
- One row per destination (923 Pakistan Mobile) with per-product rates matrix
- Approval workflow: Upload → Reconcile → Review → Approve → Available

### Rate Sheets (customer/partner exports)
- Show: 923 Pakistan Mobile, 9230 Jazz, 9231 Zong, etc.
- Never show: 1923, 2923, 6923, 7923

### Billing / Invoicing
- Use: Destination name + clean prefix + Product code + Rate
- Example: "Pakistan Mobile | 923 | BC | 0.0194"
- Internal product prefix (2) never appears on invoice

## Future-Proof Rule
Never hardcode prefix→product mapping in business logic.
Always use: `product_registry`, `product_prefixes`, `pricing_templates`, `routing_templates`
Enables future products: Premium Asia, Gold Route, A2P Voice, Retail Voice, Wholesale Voice

**Why:** The separation "Customers buy destinations, Operations manage products" must be
enforced across Product Catalog, Destination Catalog, Rate Manager, Billing, Invoicing,
and all rate sheet exports — permanently.
