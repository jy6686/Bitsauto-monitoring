# Commercial destination identity — frozen principles and open owner decisions

**Frozen by the owner 2026-08-28.** This document records decisions that have been made and
names the two that have not. It is deliberately **not** ADR-002: the identity model cannot be
designed while two commercial policy questions are open, and drafting it now would encode
assumptions as architecture.

ADR-002 (Commercial Destination Identity Model) was blocked on OD-1 and OD-2. **Both were
resolved on 2026-08-28** by the owner adopting the supplier catalogue as authoritative — see
the governing rule below and the two sections at the end.

## Principle 5 — The supplier catalogue is authoritative

> The uploaded destination catalogue is the authoritative source. BitsAuto imports names,
> prefixes, billing increments and effective dates exactly as supplied. The import process does
> not rename, normalise, expand prefixes, or infer commercial relationships. All imported
> destinations are created `UNAPPROVED` and without product assignment.

Consequences that follow, and are not separately negotiable:

- **The full supplier name is the identity, and the pricing unit.** Measured across
  `Destination catalogue New.xlsx`: 0 of 1,344 identities carry more than one rate. Grouping
  any coarser — e.g. folding MOBILINK/WARID/ZONG/UFONE/TELENOR/SCOM into `PAKISTAN - MOBILE` —
  collapses 79 groups holding multiple rates across 2,523 prefixes, worst case `ISRAEL - FIXED`
  at +612%.
- **A push expands to every prefix of the selected identity**, which is lossless precisely
  because of the point above. `PAKISTAN - MOBILE ZONG` → 9231 and 9237, one rate.
- **Per-prefix rate overrides are never a prefix dropdown in the normal push flow.** That is
  exactly how `92300` was selected and pushed. An override is a separate, explicitly recorded
  exception, or it is the same defect with a new name.
- **Renames follow the supplier.** If a later file says JAZZ where this one says MOBILINK, the
  import reflects it rather than preserving the older convention.

---

## Principle 1 — Commercial identity

**One commercial destination = one selectable identity.** Operators select a commercial
destination, never a routing prefix.

```
Pakistan Mobile
Pakistan Mobile Jazz
Pakistan Mobile Ufone
Pakistan Mobile Telenor
Pakistan Mobile Zong
Pakistan Fixed
Pakistan SCO            (placement subject to OD-2)
```

Applies to every user-facing selector, not to one screen: Destination Catalogue, Product Rates,
Vendor Rates, Rate Analysis, Send Rate, Push History, Notifications, Block Destinations,
Routing Templates, search dialogs, and any picker added later.

## Principle 2 — Routing prefixes are backend data

Prefixes belong in a prefix relationship table attached to the commercial destination, never as
separate commercial destinations.

```
Pakistan Mobile Jazz  ->  9230, 9232
Pakistan Mobile Zong  ->  9231, 9237
```

They remain in the database and continue to drive routing, rating, billing, Sippy provisioning
and notifications. They are not displayed in commercial pickers.

This is consistent with **Q1's closure (2026-08-03)**: what stays singular is the *identity*,
not the row count. Product Rates edits one destination; notifications, price lists and the
publisher each emit one row per prefix, so a customer still sees every range they are sold.

## Principle 3 — Temporary safety: the collision suffixes stay

Until the catalogue is deduplicated, `Pakistan Mobile (9236)` and `Pakistan Mobile (92391)`
**remain on screen**.

`breakoutOptions` (`client/src/pages/rate-manager.tsx:130`) appends the prefix *only* when two
rows would otherwise render the same label:

```js
label: (counts.get(base(d))! > 1 && d.dialPrefix) ? `${base(d)} (${d.dialPrefix…})` : base(d)
```

The suffix is a collision marker, not decoration. Removing it today produces two
indistinguishable `Pakistan Mobile` entries selecting different destination ids — and therefore
different rates pushed to Sippy — with nothing on screen to tell them apart.

**The suffixes disappear because the duplicate identities disappear, not because the UI stops
displaying them.** Any change that strips them ahead of deduplication is a regression, however
much better it looks.

## Principle 4 — The resolution invariant

> **Every commercially selectable destination must resolve to exactly one canonical
> destination identity.**

Not one *or more*. Not *first match*. Exactly one.

This is the invariant the other three principles serve, and it is the one to test against when
a future change looks reasonable in isolation. Each of the defects being cleaned up is the same
violation wearing different clothes:

| Symptom | The violation |
|---|---|
| Duplicate picker entries | one identity resolving to several rows |
| `(9236)` suffixes in the dropdown | the UI disambiguating what the data could not |
| A prefix owned by two identities | one number resolving to several destinations |
| Split identities (`PAK Mobile` / `Pakistan Mobile`) | one identity stored under several names |
| Unresolved aliases | an identity that resolves to none |
| Five modules disagreeing about destinations | five resolvers, so several answers |

**Enforcement.** `scripts/er-002c-commercial-reachability-audit.sql` tests it as stage 1 and
reports `INVARIANT VIOLATED — publication blocked` while any identity resolves to more than one
row. It is stage 1 rather than a later check because every stage after it presumes a single
answer: if an identity resolves to two rows, "does it have a rate" has two answers and neither
one is wrong.

---

## OD-1 — Warid — **RESOLVED 2026-08-28: Option B**

**Resolved by the supplier catalogue.** `PAKISTAN - MOBILE MOBILINK | 9230` and
`PAKISTAN - MOBILE WARID | 9232` are separate identities, both at $0.0265. Warid is sold
independently — Option B — and the platform stores `WARID`, not `Jazz`. The
`Jazz (Legacy Warid)` note-driven label was a third state and does not survive the import.

The original framing is kept below as the record of the decision.

| | Commercial catalogue | Prefixes |
|---|---|---|
| **Option A** — Warid retired | `Pakistan Mobile Jazz` only | Jazz owns 9230 **and** 9232 |
| **Option B** — Warid sold independently | `Pakistan Mobile Jazz` + `Pakistan Mobile Warid` | Jazz 9230, Warid 9232 — no aliasing |

Today the catalogue carries `Pakistan Mobile Jazz (Legacy Warid)`, whose label comes from
`d.notes` matching `/legacy warid/i` — a third state that is neither option and must not
survive dedup.

**Why it needs an owner, not a migration rule:** the two options differ in whether 9232 is a
separately priced product. Inferring it from the data merges or splits a price point silently.

## OD-2 — SCO — **RESOLVED 2026-08-28: under Mobile**

**Resolved by the supplier catalogue**: `PAKISTAN - MOBILE SCOM | 9235` sits under Mobile, and
the stored name is `SCOM`. The original framing is kept below.

```
Pakistan > Mobile > SCO          or          Pakistan > SCO
```

Both are valid hierarchies; which is correct depends on how Ichibaan sells it. `065` classified
it under Mobile by vocabulary match, so choosing the second is a **re-parent in data**, not a
display change — and the same question applies to every `Special Services` row globally, not
only Pakistan's.

---

## Sequence

1. ~~ADR-001 — canonical rate store~~ — written, `docs/adr/ADR-001-canonical-commercial-rate-store.md`
2. ER-002 executed against the real databases (`scripts/er-002-legacy-id-audit.sql`)
3. **OD-1 and OD-2 answered** ← the gate for everything below
4. ADR-002 — Commercial Destination Identity Model
5. Deduplication migration(s) — catalogue range 500+, see `MIGRATIONS.md`
6. Prefix relationship implementation
7. Commercial picker rollout across all consuming modules

Steps 4–7 do not start early. The current UI is faithfully reporting a data-model problem;
normalising the catalogue is what makes the picker clean, and nothing before step 5 changes
what an operator sees.
