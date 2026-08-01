# Rate Ecosystem Audit — v1.0

**Date:** 2026-08-01
**Question:** which parts of the platform create, read, modify, approve, send or consume a rate?
**Method:** reader/writer map per table from the code, not from the screens.
**Status:** findings only. No code changed. Nothing here is a proposal to build.

---

## The headline: two APIs with the same name, on different tables

```
/api/product-rates                        -> product_rates              -> PROVISIONING READS THIS
/api/destination-catalog/product-rates    -> destination_product_rates  -> provisioning ignores it
```

Both are "product rates". Both have full CRUD. They are different tables with different
capabilities, and **only the first one reaches Sippy.**

| | `product_rates` | `destination_product_rates` |
|---|---|---|
| API | `/api/product-rates` | `/api/destination-catalog/product-rates` |
| UI | Rate Manager → **Product Rates** tab | Destination Catalogue → rate panels |
| Holds | sell rate, effective from/to | buy AND sell, approval workflow, activation/expiration |
| Approval workflow | none | `approval_status`, approve / reject / approve-all-pending / pending-count |
| Written by | `routes-rate-manager.ts` (Drizzle) | `routes.ts` (raw SQL, line 37344) |
| **Read by provisioning** | **YES** — `rates.step`, `preflight`, `rate-upload.service` | **NO** |
| Rows on deployment | **0** | — |

**This is the single most expensive ambiguity in the platform.** The richer table — the one
with buy rates, an approval workflow and activation dates — is the one provisioning does not
read. An operator who prices through the Destination Catalogue produces an approved, complete,
audited rate that never reaches a tariff, and nothing anywhere says so.

It is the same shape as the catalogue split: two representations of one concept, no declared
canonical, and the failure is silent.

---

## Reader / writer map

Every rate-related table, with who writes it and who reads it. A table whose only reader is its
own route file is a closed loop — it stores data that leaves no other trace in the system.

| Table | Written by | Read by | Verdict |
|---|---|---|---|
| `product_rates` | `routes-rate-manager` | `routes-rate-manager`, `rate-upload.service`, `preflight`, **`rates.step`** | **canonical for provisioning** |
| `destination_product_rates` | `routes.ts` (raw SQL) | `routes.ts`, `routes-vendor-rates` | competing store, richer, unwired to provisioning |
| `product_destination_assignments` | `routes.ts` | `routes.ts` | closed loop — [TD-001](TECH-DEBT.md) |
| `pricing_template_rates` | `routes-product-templates` | `routes-product-templates` | closed loop — [TD-005](TECH-DEBT.md) |
| `vendor_rate_normalized_prefixes` | `routes-vendor-rates` | `routes-vendor-rates` | closed loop — [TD-003](TECH-DEBT.md), 46,154 rows, every `destination_id` NULL |
| `rate_card_entries` | `storage.ts` | `storage.ts` | closed loop; read by migration 053 for coverage |
| `customer_product_assignments` | `routes.ts`, `routes-product-templates` | `routes.ts`, `routes-rate-manager`, `routes-product-templates` | genuinely wired |
| `rate_push_jobs` | `routes-rate-manager` | `routes-rate-manager` | job ledger, Push History |
| `rate_notifications`, `rate_notification_*` | `routes-rate-manager` | `routes-rate-manager` | notification path |
| `tariff_versions`, `tariff_change_events` | — | — | not exercised by the current flow |

**Five of the eleven never leave their own route file.** That is the measured version of "every
screen has its own truth."

---

## The one path that reaches Sippy

Exactly one chain ends at a tariff:

```
Rate Manager -> Product Rates tab
        POST /api/product-rates                       (one row per call; no bulk — TD-006)
                v
        product_rates
                v
        rates.step         inArray(productId) AND effective_from <= today
                v
        matrix-generator   destination x product; skips non-approved, no-prefix, no-rate
                v
        buildBulkRateXlsx  prefix = product.trunkPrefix + destination.dialPrefix
                v
        sippy.uploadRatesWorkbook -> tariff
                v
        sampled read-back  -> `verified`
```

Everything else in the rate ecosystem either feeds this chain indirectly or feeds nothing.

**Nothing else writes `product_rates`.** Not Pricing Templates, not the Destination Catalogue
rate panels, not vendor sheets, not GDS. Every one of those screens can be filled in
completely and correctly and the provisioning engine will still report *"no price is effective
today"*.

---

## Where each screen gets its destinations

The symptom that started this audit — the same country appearing differently on different
screens — has three separate causes, and only one is a bug.

| Screen | Source | Note |
|---|---|---|
| Destination Catalogue | `destinations_v` -> `destinations` | 152,950 rows after 059 |
| Rate Analysis destination picker | `global_destinations` | shows `PAK Karachi`, `PAK Mobile MOBLIN` — the rows migration 052 cleaned but deliberately did not rename |
| Product Rates | free-text `prefix` on `product_rates` | no destination lookup at all |
| Send Rate | Country -> Operator Type picker | a third shape again |

**Duplicate `Pakistan` entries are not a rendering bug** — they are the duplicate country roots
(`PK` and `92`), measured and documented as 063A in
[CATALOGUE-V2](DESTINATION-CATALOGUE-V2.md).

**Pending vs approved differing between screens** is the same cause: two rows, two statuses,
one country.

---

## What this audit does NOT support

Recorded because these were live hypotheses and the code says otherwise.

- **"Vendor telemetry is broken."** No — `/api/bitseye/live-slice` reads in-memory caches only,
  populated from live calls. The empty Top Routes panel was cache warm-up, and it filled in.
- **"Rate Analysis and Send Rate read different tables, therefore one is wrong."** They read
  different tables because they answer different questions — Rate Analysis inspects existing
  Sippy tariffs, Send Rate composes a push. The defect is that neither uses the same
  destination vocabulary as Product Rates, not that both exist.
- **"Product Rates storing prefixes violates the commercial-entity principle."** `923` *is*
  Pakistan Mobile's commercial prefix. The granularity is right; the missing piece is the name
  beside it and a picker that resolves it.

---

## Conclusions

1. **`product_rates` is canonical for provisioning.** Declare it, and make every other rate
   screen either feed it or say plainly that it does not.
2. **`destination_product_rates` is the better model and the wrong one to be unwired.** Buy and
   sell, approval workflow, activation dates — that is what a commercial rate needs. The choice
   is to wire it into provisioning or retire it; leaving both is what produced this audit.
3. **Five closed loops** already have TD entries. None is a missing feature; each is a built
   feature with no consumer.
4. **One shared destination selector is the fix for the screen-to-screen inconsistency**, and it
   depends on the commercial layer existing — 063B — because a selector needs something to
   select that is not 150,000 prefixes.

**Order this suggests:** finish provisioning certification against `product_rates` (it is the
only path that reaches Sippy, and it is unblocked) → decide `product_rates` vs
`destination_product_rates` and write the decision down → then the catalogue work, which now
has a reason to exist beyond tidiness.
