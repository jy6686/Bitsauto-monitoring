# ADR-005 — Product Registry / Variant Model

**Status:** Accepted · Sprint C (9-variant migration) pending
**Sources:** `[I]` `.agents/memory/product-variant-architecture.md` (LOCKED), `product-registry-hierarchy.md`, `product-policy.md`; `[V]` §8

## Problem
The earlier "product + segment" label was inconsistent — the same product appeared
as different things across routing, finance, governance, and notifications.

## Decision
- Products are **commercial classes** with immutable **codes** (FC/BC/SB/SC) and an
  internal `trunk_prefix` (never customer-facing — see [ADR-001](ADR-001-product-prefix.md)).
- Lifecycle: `draft → testing → commercial → deprecated → retired`. **Only
  `commercial` products** appear in deal/auth/rate flows.
- Canonical products are **seeded from code** (`workspace-seed.ts CANONICAL_PRODUCTS`,
  idempotent upsert) — the single source of truth; **never seed via manual SQL**.
- Target model: **9 fixed variants** (FC-W, BC-W, SB-W, SB-R, SC-W, SC-R, PM-R, BS-R,
  NP) adding `productClass`/`commercialType`/`productFamily`, replacing `segment`.

## Alternatives considered
- Product + free-form segment label — **rejected** (inconsistent identity).
- Manual SQL seeding — **rejected** (duplicates the code source of truth).

## Consequences
- Codes immutable; names may change.
- Sprint C migration pending (add 3 columns, remove `segment`, seed 9 variants;
  PM-R/BS-R trunk prefixes TBD from legacy sheets).
- Empty `product_registry` in prod is a **runtime** issue (seed swallows its error),
  not a model change — pending `[workspace-seed]` log evidence.
