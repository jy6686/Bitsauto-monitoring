# ADR-001 — The canonical commercial rate store

- **Status:** Proposed. Decision DEFERRED pending ER-002 evidence; the rule that will convert
  that evidence into the decision is registered below and is fixed as of this document.
- **Date opened:** 2026-08-28
- **Decides:** whether `product_rates` or `destination_product_rates` becomes the single
  commercial rate store.
- **Blocks:** migration 060. 060's implementation diverges by branch, so it is not authored
  until this is Accepted.

## Context

Two rate tables are live and neither is redundant.

| | `product_rates` | `destination_product_rates` |
|---|---|---|
| Reaches Sippy | **yes — the only path** | no |
| Buy + sell rate | no (single `rate`) | **yes** |
| Approval workflow | no | **yes** (`approval_status`, `approved_by`, `approved_at`) |
| Activation / expiry dating | `effective_from` / `effective_to` | **yes**, timezone-aware |
| Billing increments | **absent** | `interval_1`, `interval_n` |
| CLI flag, price status, source provenance | no | yes |
| Live consumers | provisioning, rate upload, matrix, templates, notifications | CRUD + approval API, vendor rate matching, destination resolver |
| `destination_id` FK | none declared | **→ `global_destinations(id)`** |

The capability and the billing model are in different tables, and the one that cannot bill has
the better model. That is the whole decision.

`destination_product_rates.destination_id` carrying an FK to `global_destinations` is why this
ADR blocks 060 rather than following it: **`global_destinations` cannot be retired while that
FK stands**, so 062 depends on a decision currently scheduled after it.

## Decision criteria — registered before evidence

Recorded now so the measurement cannot select the criteria.

| # | Criterion | Why it matters |
|---|---|---|
| C1 | Can it provision Sippy without translation? | Provisioning is certified against one path today |
| C2 | Does it hold the required billing model? | buy/sell, approval, activation dating, intervals |
| C3 | FK translation impact | how many legacy ids must move through `destination_id_map` |
| C4 | Risk of data loss | rows or columns with no destination in the other table |
| C5 | Migration complexity | number of write sites and consumers to move |
| C6 | Backward compatibility | what breaks for callers during the transition |
| C7 | Runtime performance | join shape and row counts under real catalogue size |
| C8 | Operational simplicity | what an operator must understand to use it correctly |

### Conflict-resolution rule — also registered before evidence

A criteria list without a tie-break produces a debate, not a decision. C1 and C2 are already
known to point in **opposite** directions, so the ADR is undecidable without this clause:

1. **C4 is a veto.** Any branch that loses commercial data is rejected regardless of every
   other score.
2. **C2 outranks C1.** A missing billing model is a schema gap that must be closed by writing
   columns; a missing Sippy path is an integration that already exists and is being re-pointed.
   Adding columns to a table is more reversible than re-deriving a billing model.
3. **C3 breaks a remaining tie**, in favour of fewer legacy ids in motion.
4. C5–C8 are recorded for the implementation plan and do **not** select the branch.

Rule 2 is the contestable one and is stated plainly so it can be argued with *now*, before any
number is known, rather than discovered as a bias afterwards.

## Evidence this decision waits on

ER-002 (`scripts/er-002-legacy-id-audit.sql`), **run against production**. ER-001 measured the
workspace, where `product_rates` holds 12 rows with `destination_id` entirely NULL — the claim
is unfalsifiable there. Workspace and production are different databases in different migration
states.

The decisive number is C3 per table: how many distinct identities in each rate table are
`Legacy`, and whether any are `AMBIGUOUS`.

## Branches

### Branch A — `product_rates` stays canonical

- Extend its schema: `buy_rate`, `sell_rate`, approval columns, `billing_increment_initial`,
  `billing_increment_following`, `minimum_duration`, `is_high_cost`
- Translate only its own `destination_id` values
- Provisioning unchanged; existing certification remains valid for the code path
- `destination_product_rates` deprecated: frozen to reads, then dropped after its approval
  history is migrated or explicitly declared disposable
- **Cost:** the approval workflow and vendor matching that read the other table must be
  re-pointed or re-implemented

### Branch B — `destination_product_rates` becomes canonical

- Translate every legacy `destination_id` through `destination_id_map`
- Re-point its FK from `global_destinations` to `destinations`
- Move provisioning and the Sippy push onto it
- Retire `product_rates` after parity verification
- **Cost:** the certified provisioning path changes table. Re-certification is mandatory, not
  advisory — same workbook, same upload, same tariff, same notification

Under either branch `destination_id_map` is **kept permanently**. It is the only remaining
answer to "which destination was this id" once `global_destinations` is gone.

## Preconditions for 060 — all five, no partial start

1. ER-002 executed against the target database, workspace and production recorded separately
2. Zero unresolved `AMBIGUOUS` classifications
3. Zero unresolved `Orphaned` classifications
4. FK inventory complete, including runtime-created tables — `destination_status_history` is
   created by `server/routes.ts:38878` with `ON DELETE CASCADE` and is absent from any
   schema-derived list
5. This ADR Accepted

## Rollback strategy

060 changes an identifier space, so it is written to be reversible **by construction** rather
than by restore.

**Mechanism — additive translation, not in-place update.** 060 adds
`destination_id_canonical`, populates it from `destination_id_map`, and leaves `destination_id`
untouched. Nothing reads the new column until 061. Rollback before 061 is dropping a column
that nothing depends on; there is no restore, no downtime, and no window in which a partially
translated table is being read.

**Success is defined before the run:**

- every non-NULL `destination_id` yields exactly one `destination_id_canonical`
- every populated value resolves to a live `destinations.id`
- row count unchanged — translation moves no rows
- zero `AMBIGUOUS`, zero `Orphaned` remaining
- for a sampled set, the destination *named* by the new id is the same commercial destination
  named by the old one. Id equality is not identity equality; this is the 059 trap and it is
  the only check that catches it

**Verification** is ER-002 re-run against `destination_id_canonical`: every table must report
100% `Canonical`. The audit is the acceptance test, not a separate instrument.

**If validation fails:** drop the column, record the failure against the table that produced
it, and do not proceed to 061. 061 is the irreversible step — it moves reads — and it does not
start until every table passes.

## Consequences

- 060 remains unwritten until this is Accepted. That is the intended effect
- Whichever branch loses, its table stops accepting writes at 061, not at 062 — a table still
  taking writes cannot be verified as parity-complete
- The rate engine's *behaviour* is unchanged under both branches. Its *stored ids* change under
  both. "Unchanged" has a data dimension and belongs in the re-certification scope
