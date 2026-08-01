# Destination Catalogue v2 — Architecture

**Status:** frozen 2026-08-01. Target architecture for migrations 060 onward.
**Prerequisite:** [DESTINATION-MIGRATION-REPORT.md](DESTINATION-MIGRATION-REPORT.md) — v2
assumes `destinations` is canonical and `global_destinations` is retired.

---

## The root confusion

"Destination" names two different things, and every ambiguity in the catalogue descends from
it:

- a **commercial entity** — the thing a customer buys and we price
- a **routing prefix** — a digit string that identifies an operator series

Today's model is `Destination = Prefix`. v2 is **`Destination CONTAINS Prefixes`**.

That single inversion decides the rest. Approval, product assignment, pricing, markets and
tariff generation all attach to the entity. Matching, routing, fraud and CDR analysis all
attach to the prefixes.

---

## Terminology — used consistently in code, UI, and conversation

| Term | Is | Used by | Roughly |
|---|---|---|---|
| **Commercial Destination** | what a customer buys | approval · product assignment · Rate Manager · company markets · tariff generation | 2,000–5,000 |
| **Technical Prefix** | an operator series | vendor sheet matching · routing · LCR · fraud scoring · CDR analysis | ~150,000 |
| **Product Assignment** | Commercial Destination → Product | which products a destination is sold on | — |
| **Rate** | Commercial Destination × Product | one price | — |
| **Tariff Export** | one row per priced Commercial Destination per product | what Sippy receives | ~128/customer |

Bare "destination" should stop appearing in new code, comments and UI copy. It is the word
that hid the problem.

---

## One table, not two

**`commercial_destinations` will NOT be created as a separate table.** The two layers live in
`destinations`, distinguished by `level` and linked by `parent_id`:

```
level 1  Country            Pakistan
level 2  Type               Pakistan Mobile
level 3  Operator           Pakistan Mobile Jazz     <- commercial boundary
level 4+ Prefix series      92300, 92301, 92302 …    <- technical
```

`level` already carries this. It is documented in the schema, the catalogue UI already renders
it (`LEVEL_LABELS`, expand/collapse on `level === 1`), and adding a `destination_type` column
beside it would be two columns describing one thing with no rule for which wins.

### Why not two tables

Because a two-table split is precisely what produced this, four days before v2 was written:

```
destinations        150,408 rows, ids 1-375977
global_destinations   2,697 rows, ids 1-2777
  -> the same id names a DIFFERENT destination in each
```

Every FK has to choose a side, and the ones that choose wrong fail silently.
`company_markets.destination_id` pointed at the wrong table and rejected every insert for
weeks — swallowed by a non-fatal handler, so no customer had a market recorded and nobody
saw it. One table, one id space, and a prefix cannot drift away from its operator because
`parent_id` points at it.

**If the names are wanted in SQL,** define read-only views — `commercial_destinations` as
`WHERE level <= 3`, `destination_prefixes` as `WHERE level >= 4`. Views over one table share
its id space and cannot diverge. This is not the `destinations_v` situation: that view was a
compatibility shim during an unfinished migration with writes going somewhere else.

---

## Resolution is one-way

**Technical → Commercial only. Never the reverse.**

```
Vendor quotes 923081
        │  resolve UP through parent_id
        ▼
Pakistan Mobile Jazz          (Commercial Destination)
        │
        ▼
FC / BC / SB / SC             (Product Assignment)
        │
        ▼
0.0410                        (Rate)
        │
        ▼
ONE ROW into the Sippy tariff
```

### Why expansion outbound is forbidden

Migration 053 exists to answer this, and its comment is the authority:

> `1923` rates every `923xxxxxxx` call, and the catalogue's finer entries are nowhere near
> it. … Pricing per operator series instead would mean thousands of rows per customer rather
> than 128.

A customer tariff contains only the rows we put in it. One row at the commercial prefix
already covers every series beneath it, because Sippy matches longest prefix *within that
tariff*. Expanding a commercial destination into its prefixes at export turns a 128-row
tariff into a several-thousand-row one, per customer, for no additional pricing precision.

The 150k rows earn their place on the inbound side. They cost nothing on the outbound side
because they never appear there.

---

## What each workflow operates on

| Workflow | Layer | Note |
|---|---|---|
| Approve / block | Commercial | one approval, inherited downward |
| Product assignment | Commercial | `product_destination_assignments` |
| Rate Manager | Commercial | one price per destination × product |
| Company markets | Commercial | what a customer is sold |
| Tariff generation | Commercial | one row out per priced cell |
| Vendor sheet matching | Technical | resolve upward |
| Routing / LCR | Technical | longest-prefix, full detail |
| Fraud scoring | Technical | operator-level granularity is the point |
| CDR analysis | Technical | a dialled number is a prefix, not an entity |

---

## Inheritance

"Approve Jazz, everything below inherits" is the model. It has one implementation
consequence worth stating before it is discovered.

Eight read sites test `commercial_status = 'approved'` directly. Under inheritance a child's
status is **derived**, so either:

- **compute on read** — recursive CTE walking `parent_id` upward. Correct, no denormalisation,
  but all eight queries change.
- **materialise on write** — approving an operator cascades an UPDATE to its descendants.
  Existing queries keep working; the flag can drift.

**Decision: materialise**, with the cascade in exactly one place — one migration or one
service function. A derived flag maintained across the eleven write sites is the mechanism
that split the catalogue in the first place.

---

## Generation is assignment-driven

The rate matrix generator must iterate **Commercial Destination × its assigned products**,
not destination × every product the company bought. See
[TD-001](TECH-DEBT.md) — `product_destination_assignments` exists, 053 populated it, and the
rate path consults it nowhere.

This is the same change as the commercial layer, seen from the code rather than the data.
Both arrive at: *only commercially valid combinations are ever visited.*

**Sequencing:** populate assignments, validate coverage, then switch the generator. Switching
first would silently narrow what gets sold.

---

## Non-goals — recorded so they are not re-proposed

| Not doing | Because |
|---|---|
| Delete the 150k technical prefixes | vendor matching, LCR, fraud and CDR analysis all resolve against them; storage was never the cost |
| Create a `commercial_destinations` table | second id space, and every FK must choose a side — the failure this migration is recovering from |
| Add a `destination_type` column | `level` already carries it and the UI already reads it |
| Merge type into `commercial_status` | *what kind of node* and *may we sell it* are different axes |
| Expand commercial → technical prefixes at export | undoes 053; thousands of tariff rows per customer for no gain |
| Store product-prefixed destinations (`19230`, `29230`) | already correct — the digit is composed at export, "computed here, stored nowhere" |

---

## Path from here

1. **059** — merge `global_destinations` into `destinations`, id map. *(written)*
2. **060** — commercial reset, before the cutover. *(next)*
3. **061** — cutover: translate assignments, repoint FKs, move write sites.
4. **062** — retire `global_destinations`.
5. **Derive the commercial layer** — country/type/operator are already inside the names
   (`9370 Afghanistan Mobile AWCC`) against 363 country roots, so this is a derivation, not
   an import. Reparent the prefix rows beneath it, which makes `level` true rather than
   nominal.
6. **Default the catalogue UI to `level <= 3`**, with a toggle for NOC and engineering.
7. **Switch the generator to assignment-driven** once assignments are populated.

Steps 5–7 are v2 proper. Steps 1–4 are the recovery that makes them possible.
