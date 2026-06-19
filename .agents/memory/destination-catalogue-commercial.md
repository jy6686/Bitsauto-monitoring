---
name: Destination Catalogue Commercial Master
description: Billing increment is a destination attribute; Sprint B1 adds enrichment fields; Sippy push deferred until B2 audit.
---

## Key Decision (LOCKED)

Billing increment belongs to the DESTINATION, not the product. Same country can have different increments per operator (proven by spreadsheet: Afghanistan Mobile AWCC=60/1, Etisalat=1/1, MTN=1/1, Special=60/1).

## Current global_destinations schema
id, parentId, level, name, countryCode, dialPrefix, operatorName, commercialStatus, blockedReason, notes, sortOrder, createdAt

## Fields to add (Sprint B1)
```sql
ALTER TABLE global_destinations
  ADD COLUMN billing_increment_initial    smallint,
  ADD COLUMN billing_increment_following  smallint,
  ADD COLUMN billing_increment_start_date date,
  ADD COLUMN minimum_duration             smallint,
  ADD COLUMN is_high_cost                 boolean NOT NULL DEFAULT false;
```

## Resolution hierarchy
1. Destination Catalog default (billing_increment_initial / billing_increment_following)
2. Customer override (stored exception record — NOT a UI choice)
3. Rate Sheet output

## Complete commercial rate row
Destination | Prefix | Rate | Increment | Currency | Effective Date
comes from: Dest.Catalog | Dest.Catalog | Product Pricing | Dest.Catalog | Customer Profile | Customer Profile

## Sippy increment push — PHASED (do not skip phases)
- Sprint B1: Add fields, import spreadsheet, store/display — NO Sippy push
- Sprint B2: Read-only Sippy audit (compare init_time/inc_time/min_time from live tariffs vs catalog)
- Sprint B3: Only after B2 confirms safety → catalog becomes authoritative for Sippy increments

**Why phased:** Sippy tariffs may already have correct increments set manually. Pushing catalog values without auditing first could overwrite live billing settings on thousands of active prefixes.

## High-cost auto-protection rule
Destinations matching Inmarsat/Iridium/Globalstar/Satellite/Premium Services/Shared Cost → import as isHighCost=true, commercialStatus='blocked' automatically. Explicit manual approval required.

## Approved-only enforcement gap (Sprint B1)
Rate Manager, Send Rate, Rate Editor dropdowns currently show ALL destinations (not just approved). The `/api/product-registry/destinations` flat list endpoint needs `WHERE commercial_status='approved'` filter added.

## Architecture freeze document
Full locked specification at `.local/architecture/platform-freeze.md`

## Client Tariff Profile — DEFERRED
Do not build: Rate Sheet Engine, Status Codes (N/NC/I/D/PI/PD/B/R/DC), Changes Only, Delta Sheets, Notification Engine.
Requires: legacy Client Tariff Profile screens (list + all tabs esp. Status + Rates tabs).
