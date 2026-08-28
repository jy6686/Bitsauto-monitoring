# Commercial Catalogue — architecture

**Status: proposed, 2026-08-28.** Blueprint for migration 510 and the module cutover. Written
before the restructure because validating it now is cheaper than discovering a flaw after Rate
Manager, Product Rates and Notifications have been rewritten against it.

Supersedes the single-layer design shipped in migrations 500–502, which versioned business
decisions along with supplier data. That was the mistake this corrects.

---

## The governing separation

> **Supplier data is a versioned snapshot. Business data is persistent.**

Everything below follows from that one line.

| Owned by the **supplier** | Owned by **BitsAuto** |
|---|---|
| prefixes | commercial id (never changes) |
| rates | commercial name |
| billing increments | approval state and history |
| effective dates | product assignment |
| supplier name (audit) | category, owner, notes |
| version history | |

The requirement this exists to satisfy: **a supplier publishing a new file must never make the
pricing team rename the same destination again.** `Pakistan Mobile Jazz` is decided once and
survives every import, whatever the supplier calls it that month.

---

## 1. Supplier layer — immutable snapshots

```
supplier_catalogue_versions   id, label, status(draft|active|archived), source_file,
                              file_sha256, imported_at, imported_by
supplier_destinations         id, version_id, name, source_row          UNIQUE(version_id, name)
supplier_prefixes             id, version_id, supplier_destination_id,
                              prefix, rate, billing_increment,
                              effective_date_raw                        UNIQUE(version_id, prefix)
```

Written once by the importer, never updated. The immutability triggers from 500 carry over
unchanged. A correction from the supplier is a new version, never an edit.

`UNIQUE(version_id, prefix)` stays: within one snapshot a prefix belongs to exactly one supplier
destination, or two identities compete for the same traffic.

## 2. Commercial layer — persistent

```
commercial_destinations       id, commercial_name, approval_status, approved_by, approved_at,
                              category, owner, notes, created_at, retired_at
                              UNIQUE(lower(commercial_name))
```

**No `version_id`.** That absence is the whole design. An id issued here is permanent: product
mappings, customer rates and historical reports point at it and can never be orphaned by a
supplier update.

`commercial_name` is required — a commercial destination with no name of its own has no reason
to exist as a row separate from its supplier source.

`retired_at` handles a destination the supplier stops selling. It does not vanish; see §8.

## 3. The link — where the two layers meet

```
commercial_supplier_links     id, commercial_destination_id, supplier_destination_id,
                              version_id, link_state, linked_by, linked_at, note
                              UNIQUE(version_id, supplier_destination_id)
                              UNIQUE(version_id, commercial_destination_id)
```

One link per supplier destination per version, and one per commercial destination per version.
Both directions are unique: a supplier row feeding two commercial identities, or two supplier
rows feeding one, are both ambiguity about what a customer is being sold.

`link_state` is `auto` | `reviewed` | `pending`. `pending` rows are the review queue.

## 4. Review workflow — the import diff

An import writes the supplier layer, then proposes links. **Proposes.** Nothing is linked
silently except the cases where nothing commercial has changed.

| Supplier row vs previous version | State | Why |
|---|---|---|
| same name, same prefix set | `auto` | nothing changed |
| **different name, same prefix set** | `auto`, flagged *supplier renamed* | our name is ours; the product is the same one. This is the MOBILINK → JAZZ case and it must not create work |
| same name, prefix set changed | `pending` | what is being sold changed |
| prefix set overlaps another destination's | `pending`, flagged *ranges re-cut* | a prefix moving between identities silently re-prices traffic |
| no prefix overlap with any prior row | `pending`, proposed as **new** | genuinely new product, or a re-cut we cannot see |

The reviewer screen is one decision per pending row — **Accept · Link to existing · Create
new** — with the supplier's old and new values side by side. Auto-linked rows are listed but
need no action.

The rule that decides `auto` vs `pending` is **the prefix set, not the name**, because the name
is the supplier's and ours is independent of it. A rename cannot create work; a change to what
is sold always can.

## 5. Activation workflow

Activating a **supplier version** switches which snapshot supplies prefixes and rates. It says
nothing about approval.

```
sellable  =  commercial destination is approved
             AND it has a link into the ACTIVE supplier version
```

Both halves are required, and they answer different questions. Approval is *may we sell this*.
The link is *does our supplier currently carry it*. A destination can be approved and
unsellable because the supplier dropped it — that is a fact worth seeing, not an error.

Activation refuses while any link in the target version is `pending`: activating a
half-reviewed snapshot would publish links nobody agreed to.

## 6. How Rate Manager resolves a destination

```
picker        v_catalogue_sellable            approved + active version  →  display_name only
selection     commercial_destination_id       stable, never a supplier id
expansion     link → active version → supplier_prefixes
push          trunk digit (product) + each prefix
```

The operator sees `Pakistan Mobile Jazz` and selects one row. No prefixes are shown, chosen, or
selectable — which is what stops another `92300`. The expansion happens after selection, from
supplier data, so it is always current.

## 7. How Product Rates resolve a destination

Rates attach to `commercial_destination_id`. Never to a supplier row, never to a prefix.

That is the payoff for the persistent id: a rate set against `Pakistan Mobile Jazz` in V1
is still attached to `Pakistan Mobile Jazz` under V4, through however many supplier renames and
range changes. Nothing re-maps, nothing orphans.

## 8. What happens when V2 arrives

1. Importer writes `supplier_catalogue_versions` + `supplier_destinations` + `supplier_prefixes`. The active version is untouched and still serving.
2. Links are proposed per §4. Unchanged and renamed-only rows link automatically.
3. Reviewer clears the `pending` queue.
4. Commercial destinations with **no** link in V2 are reported as *no longer supplied*. They keep their id, name, approval and history; they simply stop being sellable when V2 activates. Retiring one is a separate, explicit decision.
5. Activate V2. Prefixes and rates change over; names, approvals and product mappings do not move at all.

## 9. What happens when prefixes change

Nothing, for a linked destination — prefixes are read through the link, so `9231, 9237` becoming
`9231, 9237, 9239` is live the moment V2 activates.

The exception is a prefix moving **between** commercial destinations. That is not a silent
event: it re-prices traffic, and both affected rows land in the review queue flagged *ranges
re-cut*, showing which prefix moved from where.

## 10. What happens when a supplier renames a destination

The link survives, because it is by id and not by name. `commercial_name` is untouched. The
change appears in the review queue as informational — *supplier now calls this
`PAKISTAN - MOBILE JAZZ`* — and the team may adopt it or ignore it. Nothing is forced and no
work is created.

This is the case that motivated the restructure, and the correct outcome is that nobody notices.

---

## Migration path from 500–502

The applied structure is already the supplier layer with two business columns bolted on, so
510 is mostly renames:

1. `commercial_destinations` → `supplier_destinations`; `commercial_destination_prefixes` → `supplier_prefixes`; `catalogue_versions` → `supplier_catalogue_versions`.
2. Create the new persistent `commercial_destinations` and `commercial_supplier_links`.
3. For each existing row: create one commercial destination carrying its `commercial_name` (falling back to the supplier name), its `approval_status`, `approved_by`/`approved_at`, and link it `auto` to its supplier row. **The nine Pakistan approvals and any renames survive.**
4. Move `commercial_destination_approvals.destination_id` onto the new ids.
5. Rebuild `v_catalogue_sellable` / `v_catalogue_sellable_prefixes` per §5.

501's trigger moves to the new table unchanged. 502's `commercial_name` becomes a required
column there rather than a nullable one.

**Not reversible by rollback** — it moves data between tables. It is reversible by re-import,
since the supplier layer is reconstructible from the workbook and the SHA-256 proves it is the
same file. The business layer is the only thing that cannot be regenerated, which is exactly
why it stops being versioned.

## What this settles

- The pricing team names a destination **once**.
- Supplier renames create no work.
- Prefix and rate changes need no copying and cannot go stale.
- Product mappings and customer rates never orphan.
- Duplicates cannot be introduced by an import — only by a reviewer, deliberately, and the unique commercial name refuses even that.
