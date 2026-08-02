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

## The design-phase payload is a different database

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

**1. The original bug is unexplained.** The session began with a screenshot of
`vo-ip-watcher--junaid70.replit.app/api/product-registry/destinations` returning
`COL Mobile MOVIST` and `CYP Mobile CYTA` at level 1. Id 376472 — `COL Mobile TIGO` in the
payload — does not exist in this database and never did. If the deployment truly shares
`heliumdb`, that response could not have come from it. Either the shared-database inference is
wrong, or the deployment was serving something other than this store. **Unresolved, and it is
the problem that started the investigation.**

**2. `matched_by` semantics** — see the gate above.

**3. The picker mitigation hides nothing here.** `hidden_by_mitigation = 0`, against 11
non-country level-1 rows. The filter at `client/src/pages/rate-manager.tsx:1643` is inert on
this database. Whether it is inert everywhere depends on item 1.

**4. Deployment connection-pool timeouts.** `Connection terminated due to connection timeout`
across multiple services in the deployment log. Unrelated to any of the above, and a
production issue in its own right.
