# ER-001 — `product_rates.destination_id` id space

Measured 2026-08-03. Instrument: `scripts/er-001-classification.sql`.

**Outcome: the classification is inapplicable on this database, and the design-phase
measurements do not describe it.** Detail below.

---

## Environment Validation

| | |
|---|---|
| Database | `heliumdb` on `helium`, user `postgres`, PostgreSQL 16.10 |
| `destinations` | 150,422 |
| `global_destinations` | 150,422 |
| `destination_id_map` | 150,422 |
| `product_rates` | **12** |
| `destinations_id_seq.last_value` | 375,991 |
| `max(destinations.id)` | 375,991 |

Workspace and deployment share this database — one Replit-managed Postgres instance, no
separate `DATABASE_URL`. That is inferred from the absence of an override secret, not measured
directly; see the open item below, which puts it in doubt.

### Migration provenance — 059 has drifted

| | |
|---|---|
| Recorded hash | `ccb74bf97f9f3304` |
| Repository hash | `28c3fd361fbcc978` |
| Drift | **YES** — runner declines to re-run |
| Post-application edits | `bd0ac754` recompute level rather than copying across trees |
| | `197f313e` distinguish `duplicate_identity` from a pre-existing match |

### GATE — `destination_id_map` semantics

```
identity    150,408
inserted         14
```

`duplicate_identity` is **absent**. Two explanations remain and the evidence does not separate
them: the live map predates `197f313e`, or there were no collapsed duplicates to classify —
which `inserted: 14` makes entirely plausible. **Repository semantics cannot be assumed for
this table.** Unresolved, and it did not block this run because section D had nothing to
classify.

### Hierarchy shape

```
level1_total          363
level1_non_country     11
level1_countries      352
hidden_by_mitigation    0
level2_parented        36
level2_total      150,047
```

---

## Result — the classification

**All 12 `product_rates` rows have `destination_id IS NULL`.** No identities to classify;
Populations A and B are both empty. The `AMBIGUOUS` and `Orphaned` buckets returned zero
because there is nothing in the column, not because the column is clean.

| Population | Canonical | Legacy | Ambiguous | Orphaned | NULL |
|---|---|---|---|---|---|
| A — distinct identities | 0 | 0 | 0 | 0 | — |
| B — `product_rates` rows | 0 | 0 | 0 | 0 | **12** |

## Decision

The pre-written rule covers all-canonical, all-legacy, mixed and orphaned. This outcome — an
empty column — is none of them, so no branch fires.

**The claim is not falsified; it is unfalsifiable on this database.** `product_rates` holds 12
rows with no destination references, which is a development fixture rather than a rate table.
Phase 4's premise — that `product_rates.destination_id` carries legacy ids needing translation
— is **unsupported here and unmeasured anywhere**. It must not be implemented on the strength
of the co-occurrence signal that raised it.

Not carried forward as "no work needed": carried forward as **not yet answerable**, pending a
database with real rate data.

---

## RESOLVED 2026-08-03 — the payload is PRODUCTION

**Superseded the section below.** The deployment's own startup logs identify it.

Searching the production deployment logs for `dest-seed` returns one line per boot — 22
successive Autoscale instances, each with its own deployment id, in chronological order:

```
2026-07-27 16:43  46be9dad   destinations has 150408 rows
   … 21 boots, all 150408 …
2026-08-01 15:43  c12d7894   destinations has 150408 rows
2026-08-02 03:04  3b308a6a   destinations has 152950 rows
```

**152,950 is the payload exactly.** Not a reconstruction — a startup measurement emitted by the
production process itself, matching the analysed payload row for row.

| Environment | Rows | Source |
|---|---|---|
| Workspace | 150,422 | `psql` + workspace boot log, 2026-08-03 |
| Production, Jul 27 – Aug 1 | 150,408 | 21 deployment boots |
| Production, Aug 2 onward | **152,950** | deployment boot `3b308a6a` |

**Production has never reported 150,422**, across 22 boots in a week. The workspace has never
reported 150,408 or 152,950. They are two databases.

The transition is clean rather than interleaved — 21 consecutive boots at one value, then the
other — so it is a change over time in one store, not two pools alternating.

### What caused the +2,542

`152,950 − 150,408 = 2,542`. **Consistent with** migration 059 executing on production between
Aug 1 15:43 and Aug 2 03:04, and matching the order of magnitude in `cb62b68f`'s commit message
(*"~2,540 operator and service rows became level 1"*) on a database whose `global_destinations`
holds 2,697 rows. The `dest-seed` line does not itself name the operation, so this is an
attribution by arithmetic and timing, not a direct observation of 059 running. Confirmable from
the deployment logs around that window.

The workspace arithmetic corroborates it from the other side: `150,408 + 14 = 150,422`, and the
workspace's `matched_by` reads `inserted: 14`. Both databases began from the same 150,408-row
catalogue; 059 inserted 14 rows on the workspace, whose `global_destinations` was already a
150,422-row copy, and ~2,542 on production, whose `global_destinations` is the original 2,697-row
legacy table.

### Consequences

- The design documents' figures — **1,497 level-1 rows, 1,145 non-country, 621/223/152, the
  063A volumetrics** — describe **production**. They are not unplaced. They are accurate for the
  database that serves customers.
- `375979` being `AFG` in production and `INDIA MOBILE` on the workspace is the 059 trap across
  two databases rather than two tables.
- **The picker bug is real, on production, now.**
- `hidden_by_mitigation = 0` is a workspace fact. On production, where ~2,542 rows were
  inserted, the same filter would hide them — so the mitigation in `cb62b68f` probably works
  there. The screenshot predates the deploy that carries it; **"Finish update" is still
  pending**, so customers are on a build without it.
- `063A`'s "11 operator rows at level 1" describes the **workspace**, and still measures 11 there.

**`64d30706` was correct and is reinstated.** Its workspace/production reasoning was withdrawn
on 2026-08-03 on the strength of "no override secret exists, therefore one database" — an
inference from absence, which was the only thing supporting the single-store conclusion. It lost
to a log line. The section below is kept as the record of that reasoning, not as a finding.

---

## SUPERSEDED — the payload as an unidentified database

*Written before the deployment logs were searched. Its facts about `heliumdb` hold; its
conclusion that the payload's origin was unidentifiable does not.*

The quantitative figures in `DESTINATION-HIERARCHY-REPAIR-063.md` and
`DESTINATION-COMMERCIAL-HIERARCHY-PROPOSAL.md` come from a 152,950-row payload captured
2026-08-01. Five independent facts place it elsewhere:

1. `destinations` is 150,422 here, 152,950 there.
2. Payload max id 378,519; this database's max id **and sequence** are both 375,991 — it never
   issued an id above that, so the missing rows cannot have been deleted from it.
3. Every payload row absent here — exactly **2,528** — has an id above 375,991, one contiguous
   band. `152,950 − 150,422 = 2,528`. The arithmetic closes.
4. **Id 375979 names a different destination in each**: `AFG`, level 1, no parent, no country
   code — versus `INDIA MOBILE`, level 2, parent 47387, country code 91. A repair moves a row;
   it does not rename it and reassign its country. This is the 059 trap exactly: an id valid in
   two places naming a different destination in each.
5. `DESTINATION-CATALOGUE-V2.md`'s 063A cites "11 operator rows sitting at level 1". This
   database measures **11**. That figure was never stale.

**Consequence.** The architecture stands — it rests on structural findings (the endpoint
transforms nothing, parentage is essentially absent, Pakistan exists in multiple
representations, operator tokens do not resolve) which hold independent of database identity.
Every *count* attached to it — 1,145 rows to repair, 621/223/152 placement, the 063A
volumetrics — is a historical measurement of an **unidentified** catalogue. Not wrong, not
confirmed, unplaced.

`64d30706` claimed the payload was the deployment and this the workspace. That reasoning is
**falsified**: they are one database.

---

## Open items

**1. RESOLVED — the original bug is real and it is on production.** The session began with a
screenshot of `vo-ip-watcher--junaid70.replit.app/api/product-registry/destinations` returning
`COL Mobile MOVIST` and `CYP Mobile CYTA` at level 1. Those rows exist in the production
database, not in `heliumdb`. The country picker on production lists ~1,145 non-country rows.
The fix in `cb62b68f` is written and pushed but **not deployed** — "Finish update" is pending.

**1a. Open — is `product_rates.destination_id` populated on production?** ER-001's actual
question is still unanswered, because it was asked of the wrong database. `heliumdb` holds 12
rows with NULL. Production is unmeasured, and it is the one that matters. **Re-run
`scripts/er-001-classification.sql` against the production database.** That requires a
connection string the workspace shell does not carry.

**2. `matched_by` semantics** — see the gate above.

**3. The picker mitigation hides nothing here.** `hidden_by_mitigation = 0`, against 11
non-country level-1 rows. The filter at `client/src/pages/rate-manager.tsx:1643` is inert on
this database. Whether it is inert everywhere depends on item 1.

**4. Deployment connection-pool timeouts.** `Connection terminated due to connection timeout`
across multiple services in the deployment log. Unrelated to any of the above, and a
production issue in its own right.
