---
name: Rate Manager trunk prefix encoding
description: How product trunk prefixes are encoded and pushed to Sippy — the core of the Rate Manager feature.
---

# Rate Manager — Trunk Prefix Encoding

## The Rule
Product trunk prefix is prepended internally to the destination dial prefix before pushing to Sippy.
User sees: Pakistan Jazz at $0.0270
Sippy receives: prefix="192300" (trunkPrefix "1" + dialPrefix "92300")

## Trunk Prefix Mapping
- First Class Wholesale → `1`
- Business Class Wholesale → `2`
- Special Bravo → `6`
- Special Charlie → `7`

Stored in `product_registry.trunk_prefix` (varchar 8). Seeded via direct SQL.

## Key APIs
- `GET /api/rate-manager/products` — products with trunk prefix
- `POST /api/rate-manager/push-batch` — batch push: accountNames + trunkPrefix + dialPrefix + rate → calls pushRateToSippy per client with fullPrefix
- `GET /api/rate-manager/jobs` — rate_push_jobs history table

## Rate Analysis Flow
1. Frontend: GET /api/sippy/accounts/:iAccount/info → iTariff
2. Frontend: GET /api/sippy/tariffs/:iTariff/rates?limit=500 → rates[]
3. Client-side filter: rates where prefix.startsWith(trunkPrefix)
4. Map rawPrefix = prefix.slice(trunkPrefix.length) → match against globalDestinations.dialPrefix

## Schema
- `product_registry.trunk_prefix` — added via ALTER TABLE (direct SQL, not db:push)
- `rate_push_jobs` — job audit: jobId, productName, trunkPrefix, format, totalClients, pushedClients, failedClients, status, completedAt

**Why:** Sippy internally has no "product" concept — it operates on raw prefixes. The trunk prefix encoding maps the business product layer onto Sippy's flat prefix space without exposing the encoding to end users.
