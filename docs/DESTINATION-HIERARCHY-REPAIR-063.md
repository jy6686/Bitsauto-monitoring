# 063A/B — measurement addendum after 059

Status: **measurement only. No decisions reopened.**

`DESTINATION-CATALOGUE-V2.md` specifies 063A–E and is frozen. This document does not restate
it. It records one thing: **059 changed 063A's scope by two orders of magnitude**, and the
numbers 063A was written against no longer describe the workspace.

Figures from a full payload snapshot of the **workspace** database (152,950 rows), extracted
from `/api/product-registry/destinations`. The deployment is a different database and must be
re-measured before anything runs.

---

## The scope change

063A budgets for **11 operator rows sitting at level 1** — `Congo Mobile MTN`,
`Gabon Mobile Airtel` — and calls the repair cheap: "48 parented rows in the whole catalogue."

On the workspace after 059 there are **1,145** level-1 rows with no `country_code`.

1,134 of them carry an id ≥ 370,000 — a single contiguous block, which is the 059 insert. The
original 11 are still there (I see `Congo Mobile`, `Gabon Mobility Services`,
`Ivory Coast Mobile MTN`, `Seychelles Special Services` among 16 rows with pre-059 ids). 059
added the rest, via [059:238-245](../migrations/059_merge_global_destinations_into_destinations.sql):
`UPDATE destinations SET level = root_level ... WHERE parent_id IS NULL`, on rows that arrived
flat because [059:202-212](../migrations/059_merge_global_destinations_into_destinations.sql)
only remaps parentage `AND g.parent_id IS NOT NULL`.

063A's approach is unaffected. Its volumetrics are not.

---

## What 063A's three cases look like now

Independent confirmation of two of them, and a divergence on the third:

| 063A case | 063A | Workspace now |
|---|---|---|
| found ISO root AND dial root | 142 | 141 duplicate country names across 352 coded level-1 rows |
| found dial-code root only | 62 | **62** — exact match |
| found ISO root only | 6 | **6** — exact match |

The 62 and the 6 reproduce exactly, which is a good sign that 063A's reconciliation model
still holds.

The divergence: 063A names Russia and United States as the ISO-root-only cases. Measuring
which countries the 1,145 rows need as parents but the catalogue lacks gives a different set —
**Barbados, Canada, Jamaica, Kazakhstan** — 4 of the 152 countries required. Worth reconciling
before 063A runs; it may simply be the workspace/deployment gap.

---

## Selector

`level = 1 AND country_code IS NULL` isolates the damage exactly on this snapshot: of 1,497
level-1 rows, all 352 with a `country_code` are countries and none of the 1,145 without one is.
Cleaner than `mergedFromLegacy`, which is provenance rather than identity, and needs no name
matching.

---

## Evidence for two things 063 already assumes

**There is no non-name source of parentage.** Measured on the 1,145, because 063C's dictionary
approach depends on it: `dial_prefix` present on 13, `operator_name` on 2, `notes` on 13, and
2 have any child. `destination_id_map` records provenance, not hierarchy; 053 states it does
not re-parent operator entries. The names are the only signal, which is what 063C already says
— "unstructured, not absent."

**The operator token never has to be resolved to establish parentage.** `COL Mobile MOVIST`
needs to know it hangs under Colombia → Mobile. Tokens 1 and 2 decide that; token 3 is the
node's own name. Tested against the 264 operator entries in `server/country-codes.json`: of 627
rows with an operator token, 6 match exactly, 43 as a prefix, **578 not at all**. That number
would block 063C's enrichment, and does not block 063A/B's structural repair at all —
`MOVIST` / `MOVISTAR` / `MOBLIN` / `MOBILINK` stay leaf labels under correct parents, and no
abbreviation becomes structure.

---

## Token vocabulary, for 063B

063B classifies on whole-word matching and sends the rest to `Unclassified`. Against the 1,145:

- **Token 1** — 1,072 rows resolve against the 152 alpha-3 codes in
  `server/country-codes.json`. A lookup against ISO 3166-1, not a parse: `CRI` is Costa Rica
  and `DEU` is Germany, neither derivable by similarity.
- **73 rows do not resolve.** ~63 are valid alpha-3 codes the reference simply lacks, almost
  all NANP Caribbean: `AIA ANT ASM ATG BHS BMU CYM DMA DOM GRD GUM KNA LCA MNP MSR PRI TCA TTO
  VCT VGB VIR`. That is a data-file gap in `country-codes.json`, not migration logic. `ANT`
  (Netherlands Antilles) is a deprecated code and needs its own call.
- **Token 2** — 110 distinct. `Mobile` 655, `Speser` 68, `Fixed` 66, `Moser` 55 cover 844.
  `Speser` and `Moser` are not whole words and will fall to `Unclassified` under 063B as
  written — 123 rows, correctly, per the gap-over-guess asymmetry.
- The 106-value tail covering 128 rows is **mostly cities** — `Buenos`, `Dhaka`, `Sofia`,
  `Rio`, `Vienna`, `Recife`, `Curitiba`. Geographic breakouts, not service classes. 063B sends
  them to `Unclassified`, which is the right default; whether they eventually earn a geographic
  tier is a 063D-shaped question, and 053's two-granularities warning is the relevant precedent.

Only **8** service-tier nodes exist in the whole table today (`Mobile` ×4, `Fixed` ×4), so
063B is creating the tier, not populating one.

---

## Post-migration reporting

At 1,145 rows the repair stops being a cleanup that can be eyeballed. 063A/B must emit a
summary and persist its exceptions rather than completing silently.

### The two populations must not be summed

A repair report that reads

```
Rows analysed:              1,145
Resolved by ISO:            1,072
Resolved by dial code:         62
Resolved by existing root:      6
```

double-counts. The 62 and the 6 are 063A's reconciliation of the **352 level-1 rows that
already carry a `country_code`** — countries existing under two identities. The 1,072 are
resolutions among the **1,145 rows that carry none**. Different populations, disjoint, and
`1,072 + 62 + 6` balancing near 1,145 is a coincidence of magnitude, not an accounting. Report
them as two sections with their own totals.

### Frozen report shape

Two sections, each summing to its own population.

```
063A — Country Identity Reconciliation
  Countries analysed:                210
    ISO root AND dial root (merge):  142
    Dial root only (attach ISO):      62
    ISO root only (create dial):       6
  Exceptions — missing identity:       0
                                   -----
                                     210   over 352 coded level-1 rows

063B — Hierarchy Repair
  Rows analysed:                   1,145
    Country ROOT (remain roots):     152
    Country -> Mobile:               621
    Country -> Fixed:                 65
    Country -> Services:              11
    Country -> Unclassified:         223
    Exceptions:                       73
                                   -----
                                   1,145
```

063A's three cases are measured, not carried over from V2 — they reproduce V2's 142 / 62 / 6
exactly on this snapshot, which is the strongest evidence available that the reconciliation
model still holds after 059.

Every row lands somewhere and both columns balance, so a run that fails to account for a row
is visible immediately rather than inferable from a total.

### Idempotence

**Invariant: a second run of 063 changes zero rows.**

```
Rows changed:  0
Exceptions:    unchanged
```

Not a nicety. It is what makes the migration safe to retry on a deployment, and it is what
lets a later `country-codes.json` refresh resolve previously recorded exceptions by re-running
063 rather than by writing a special one-off migration. Without it the reference file and the
hierarchy drift apart, and closing the gap needs bespoke SQL every time.

It also forbids oscillation. Each pass must reach the same hierarchy from the state the last
pass left, which means the rules read from the reference and the row, never from the current
`parent_id` / `level` — those are the outputs. Rule 4, outputs are never sources, applied to
the migration itself.

Mechanically this follows the 059 pattern: guard every write with `IS DISTINCT FROM`, drive
placement from `country-codes.json` plus the row's own name, and upsert exceptions on
destination id so a re-run rewrites rather than accumulates. What it converts 063 from is a
one-off repair; what it converts it into is a normalisation step whose result is stable
however many times it runs.

### Projected placement, workspace snapshot

Pre-flight expectation for 063B under whole-word matching. A run that lands far from this has
either found different data or is applying a different rule:

```
Country -> Mobile                 621
Country -> Unclassified           223
country ROOT (no parent)          152
UNRESOLVED -> exception            73
Country -> Fixed                   65
Country -> Roaming?                 6
Country -> Satellite?               5
                                -----
                                1,145
```

`Roaming` and `Satellite` are marked with a query because 063B's tier is
`Mobile | Fixed | Services | Unclassified`. Whether these 11 rows fold into `Services` or fall
to `Unclassified` is 063B's call, not reopened here. Either way it is 11 rows.

The 152 country roots are the single-token rows (`AFG`, `AGO`) resolving to alpha-3. They get
a `country_code` and stay roots — they are not placed under anything, and counting them as
"repaired children" would misreport the run.

### Exceptions

The 73 unresolved rows persist to `destination_repair_exceptions` — destination id, name,
the token that failed to resolve, and the reason (`unknown_iso3` vs `not_a_destination`),
carrying provenance the way `destination_id_map` and 063C's `destination_classification` do.
21 of the 73 are single-token, 52 multi-token.

They are a visible worklist, not a failure: ~63 clear the moment `country-codes.json` gains the
NANP Caribbean entries, at which point a re-run resolves them with no logic change. The
remainder — `FROM`, `Rate Offer Notification`, `CITIC Telecom International Limited` — are not
destinations and want a commercial decision, not a parent.

Explicitly unknown beats confidently wrong: the migration completes, repairs the deterministic
cases, and leaves the rest legible.

## Owner decisions, 2026-08-07

**Service-type vocabulary (decided).** 063B's tier expands from `Mobile | Fixed | Services |
Unclassified` to: **Mobile, Fixed, Toll Free, Premium, Satellite, VoIP, Paging, Shared Cost,
Personal Number** — whole-word matching as specified, everything unmatched to `Unclassified`
for manual review. The gap-over-guess asymmetry is unchanged.

**Global, not per-country.** 062 (Pakistan Mobile) is the pattern proof, applied and verified
on the workspace: operators at level 3 under the type node, routing series nested beneath by
prefix arithmetic. 063 generalises it; no further country-specific migrations.

**Aliases preserve legacy names without hierarchy.** `Jazz` carries `Mobilink`/`Warid` as
aliases for search and import resolution (the `destination_alias` service is the existing
mechanism); the UI shows the commercial name only. Legacy rows are never deleted.

## The mitigation in cb62b68f

The `!mergedFromLegacy` filter in
[client/src/pages/rate-manager.tsx:1643](../client/src/pages/rate-manager.tsx) stays until
063A/B lands, and is removed as part of it. It is imperfect on its own terms: `United Arab
Emirates` (id 375093, prefix 971) sits inside the 059 block and is filtered out, leaving only
`UAE` (id 7, `AE`) reaching `rate-analysis-batch` — an instance of the `UAE`/`United Arab
Emirates` identity split already named in the V2 principles.
