# Destination Migration Report — v1.0

**Status:** canonical table decided, merge written, cutover pending
**Date:** 2026-08-01
**Evidence:** migration 058's refusal against the deployment, three rounds
**Supersedes:** the assumption that `global_destinations` is canonical

---

## Decision

**`destinations` is the canonical destination store.** `global_destinations` is merged into
it and retired.

This reverses the position held for most of 2026-08-01. The reversal is recorded here rather
than quietly corrected, because the first reading was defensible on what was known and the
reasons it was wrong are the reasons this document exists.

---

## What the deployment reported

```
global_destinations : 2,697 rows,   ids 1-2777,     created 2026-06-05 .. 2026-08-01
destinations        : 150,408 rows, ids 1-375977,   created 2026-07-04 .. 2026-07-04
  rows in destinations with an id global_destinations lacks  : 149,547
  rows in destinations with a (name, dial_prefix) it lacks    : 150,255

COMPOSITION of global_destinations
  shape      : L1/approved 6, L1/pending 1134, L2/approved 5, L2/pending 145,
               L3/approved 24, L3/pending 1383
  prefixes   : with prefix 276, without 2421, roots 2399
  provenance : from migration 053: 4, IBIS cleared by 052: 1135, other noted: 0
  identity   : 149 of 2,697 already exist in `destinations`
```

### How to read it

- **The July 4 import went to the wrong table.** `destinations` was written entirely on
  2026-07-04 — one bulk load. `global_destinations` starts 2026-06-05 and is still being
  written today, but only by migrations and the UI. The catalogue import never reached it.
- **`global_destinations` is largely import residue.** 2,421 of 2,697 rows carry no dial
  prefix, only 35 are approved, and 1,135 had an IBIS code cleared out of `dial_prefix` by
  migration 052 — rows created by the Bulk Import parser defect that reads a rate-offer
  cover letter as destinations.
- **The two tables are not versions of one another.** Only ~150 rows share an identity.

---

## Why the original plan was abandoned

Migration 058 proposed re-pointing `destinations_v` at `global_destinations`, on the belief
that the writes were there and `destinations` was a stale backfill. Applying it would have
cut the visible catalogue from **150,408 rows to 2,697** — a 98% loss, silently, with no
error raised.

It did not happen because 058 refused rather than proceeding, and the refusal carried enough
detail to diagnose the real shape. The guard was worth more than the migration.

**Rule confirmed:** a migration that changes the shape of production data should refuse and
explain, not proceed and hope. A check in a runbook is a check somebody skips.

---

## The one hazard: ambiguous ids

```
product_destination_assignments  total 52 | both 52 | gd-only 0 | dest-only 0 | orphan 0
```

`both 52` reads as safe and is the opposite. Those ids resolve in **both** tables — but since
only ~150 rows share an identity, `global_destinations.id = N` and `destinations.id = N` name
**different destinations**. Migration 053 wrote those 52 assignments against
`global_destinations`. Moving canonical without translating them re-points every one at a
different destination: no FK violation, no error, wrong products on wrong countries.

Verified on a fixture: **all 52 translate to a different id.**

This is why migration 059 writes a permanent `destination_id_map` rather than doing the
merge and discarding the correspondence.

---

## Dependency inventory

Every database object naming either table, from `pg_constraint`, `pg_depend`, `pg_trigger`,
`pg_proc` and `cron.job`. A repository grep cannot see these.

### → `destinations`

| Kind | Object |
|------|--------|
| FK | `destination_group_members.destination_id` |
| FK | `destination_health.destination_id` |
| FK | `destinations.parent_id` (self) |
| VIEW | `destinations_v` |

### → `global_destinations` — 060 must account for each

| Kind | Object | Rows | Work |
|------|--------|------|------|
| FK | `company_markets.destination_id` | 0 | repoint |
| FK | `destination_aliases.destination_id` | 0 | repoint |
| FK | `destination_product_rates.destination_id` | 0 | repoint |
| FK | `destination_status_history.destination_id` | 0 | repoint |
| FK | `product_destination_mappings.destination_id` | 0 | repoint |
| VIEW | `active_product_destination_mappings` | — | recreate over `destinations` |

**No triggers, no functions, no materialised views, no scheduled jobs.** `pg_cron` is not
installed.

### Stored ids, by table

| Table | total | both | gd-only | dest-only | orphan |
|-------|------:|-----:|--------:|----------:|-------:|
| `product_destination_assignments` | 52 | **52** | 0 | 0 | 0 |
| `vendor_rate_normalized_prefixes` | 46,154 | 0 | 0 | 0 | 0 |
| `product_history` | 4 | 0 | 0 | 0 | 0 |
| `company_markets` | 0 | 0 | 0 | 0 | 0 |
| `destination_aliases` | 0 | 0 | 0 | 0 | 0 |
| `destination_group_members` | 0 | 0 | 0 | 0 | 0 |
| `destination_health` | 0 | 0 | 0 | 0 | 0 |
| `destination_product_rates` | 0 | 0 | 0 | 0 | 0 |
| `destination_product_rates_archive` | 0 | 0 | 0 | 0 | 0 |
| `destination_status_history` | 0 | 0 | 0 | 0 | 0 |
| `product_destination_mappings` | 0 | 0 | 0 | 0 | 0 |
| `product_rates` | 0 | 0 | 0 | 0 | 0 |

**`gd-only` is zero everywhere** — no production row depends exclusively on a
`global_destinations` id, so the canonical store can move without a rescue.

Two entries deserve their own attention, neither blocking:

- **`vendor_rate_normalized_prefixes`: 46,154 rows, every bucket zero.** Every
  `destination_id` is NULL. The vendor rate normalisation pipeline has never resolved a
  single prefix to a catalogue destination.
- **`product_rates`: 0 rows.** The rate matrix the provisioning engine reads is empty on the
  deployment.

---

## Write and read paths

```
WRITES  ->  global_destinations   11 sites in server/routes.ts
            destinations           0 sites
READS   <-  destinations_v         8 sites  ->  SELECT ... FROM destinations
            global_destinations    2 sites
```

The crossing is the defect. The UI lists rows from `destinations` (ids to 375,977), the
operator clicks Approve, and the endpoint runs
`UPDATE global_destinations ... WHERE id = <that id>` against a table whose ids stop at
2,777. Zero rows updated, no error. That is the whole of "approvals do nothing".

`company_markets.destination_id REFERENCES global_destinations(id)` (migration 054) is the
same defect with a constraint attached: the wizard sends catalogue ids, the FK rejects them,
and a non-fatal handler swallows it — so **no customer on this deployment has a market
recorded**, and the rate step falls through to "all approved destinations".

---

## Migration sequence

| # | Does | State |
|---|------|-------|
| **058** | Abandoned. No-op, retained under its original filename with the evidence. | written |
| **059** | Merge `global_destinations` into `destinations`; write `destination_id_map`. Data only. | written |
| **060** | Translate the 52 assignments; repoint 5 FKs and 1 view; move the 11 write sites; point `destinations_v` at `destinations`. | not started |
| **061** | Retire `global_destinations` after a soak. | not started |
| **062** | Commercial reset: `approved` → `unapproved` with `destination_status_history` preserved. | not started |

### Why 058 is a no-op rather than deleted

The runner halts on the first failure. A refusing 058 blocks 059, 060 and everything after —
the trap 051-after-049 and 059-after-053 both fell into this week. It is kept under its
original filename because a database that already applied it (the development workspace,
where the guard legitimately passed) must not re-run a different file under the same name.

---

## Expected 059 results

| Database | matched by identity | inserted | after |
|---|---:|---:|---:|
| Deployment | 149 | 2,548 | 152,956 |
| Workspace | 150,408 | 14 | 150,422 |

Verified on PG16 fixtures of both shapes, including duplicate identities inside
`global_destinations` (which map onto one canonical row rather than importing the
duplication) and a `destinations` table with an unfillable NOT NULL column (refused).

---

## Commercial reset (062), after the cutover

The governance goal: `approved` means "commercially validated and offerable", not "exists".

1. Snapshot `id, name, dial_prefix, commercial_status, blocked_reason` — there is no
   `approved_by` or `approved_at` column, because nothing ever wrote one.
2. `approved` → `unapproved` in one transaction, writing `destination_status_history` rows in
   the same statement. A bulk UPDATE that skips the history table leaves 150k status changes
   with no audit trail.
3. Use **`unapproved`**, not `pending`. The unapprove endpoint already writes `unapproved`;
   `pending` means "never reviewed" and conflating them loses the distinction.
4. Duplicate sweep before re-approval — 053 halts on any `dial_prefix` with more than one
   approved entry, and approving everything at once is what exposed `PAK`.

**Sequencing:** the reset makes every destination unsellable until re-approved
(`matrix-generator.ts:128` drops non-approved rows), so it comes **after** Test-31 is
certified, not before.

---

## Open, not blocking

- **Bulk Import parses a rate-offer cover letter as destinations** — offered 24,653 rows with
  `"CITIC Telecom Tower"` as a prefix; only a `varchar(4)` constraint stopped it. This is how
  the 1,135 IBIS-code rows got in. Vendor Sheets Sprint 2.
- **Product Mapping 404** — client calls `/api/product-mapping/refresh`, server serves
  `/api/gcs/product-mappings/refresh`.
- **Market Intel** crashes the tab; 150k rows unvirtualised.
- **`canonical_vendors` empty** — vendor dropdown has nothing to show; only writer is
  `routes-call-governance.ts:1627`.
- **Checksum drift** on `042_rename_welcome_rates_event.sql` and
  `048_schema_migrations_diagnostics.sql` — edited after they were applied.
- **`workspace navigation is seeded (migration 031)` → `ok: false`** on the deployment.
