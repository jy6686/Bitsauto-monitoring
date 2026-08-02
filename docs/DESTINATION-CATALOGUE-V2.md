# Destination Catalogue v2 — Architecture

**Status:** frozen 2026-08-01. Target architecture for migrations 060 onward.
**Principles:** one entity one id · structure before status · resolution is one-way · outputs are never sources
**Prerequisite:** [DESTINATION-MIGRATION-REPORT.md](DESTINATION-MIGRATION-REPORT.md) — v2
assumes `destinations` is canonical and `global_destinations` is retired.

---

> ## Commercial decisions are made on commercial entities.
> ## Technical prefixes inherit those decisions; they never own them.

If a rule in this document is ever unclear, that sentence decides it.

```
WRONG                            RIGHT
approve 923081                   approve Pakistan Mobile Jazz
assign FC to 923081              assign FC to Pakistan Mobile Jazz
price 923081                     price Pakistan Mobile Jazz
```

150,422 rows are approved today because the catalogue let a prefix own a commercial decision.
Nobody approved 150,422 destinations; a bulk operation did, because there was no entity to
approve instead.

---

## Three models that had become one

Most of the confusion came from three different kinds of data living in one table with one
vocabulary. They have different owners, different change rates, and different rules.

| Model | Holds | Changes | Owned by | Rows |
|---|---|---|---|---|
| **Reference** | countries, ISO2, dial codes, aliases | almost never | ISO 3166 / ITU E.164 — external | ~300 |
| **Commercial** | what we approve, assign, price and sell | daily | Sales · Pricing · Product | 2,000–5,000 |
| **Technical** | operator prefix series | on every vendor import | the network — vendor sheets, CDRs | ~150,000 |

Reference data is seeded and never derived from our own catalogue. Commercial entities carry
`commercial_status` and product assignments. Technical prefixes carry neither — they resolve
upward and inherit.

Deleting the technical layer was considered and rejected: it is what vendor matching, LCR,
fraud scoring and CDR classification resolve against. It was never too large. It was playing
the wrong role.

---

## The lesson underneath all of this: identity

The catalogue did not break because there were two tables. It broke because there were two
**authoritative id spaces** whose ranges overlapped:

```
destinations         ids 1-375977
global_destinations  ids 1-2777
  -> id 1500 is a VALID id in both, naming a DIFFERENT destination in each
```

An FK pointing at the wrong table still resolves. It does not error, it does not warn, and
the row it finds is plausible. That is strictly more dangerous than a broken FK, which at
least announces itself. `product_destination_assignments` held 52 rows in exactly this state
and every one of them would have silently re-pointed at a different country.

Everything below follows from refusing to allow a second id space to exist.

### The same defect appeared at four scales in one day

Every problem found on 2026-08-01 reduced to one entity carrying two identities, with nothing
declaring which was canonical. None announced itself; each was found by asking the database a
question whose answer had been assumed.

| Scale | Two identities | Found by |
|---|---|---|
| Table | `destinations` / `global_destinations` | 058's refusal |
| Country root | `Afghanistan/AF` / `Afghanistan/93` | listing level-1 rows |
| Country name | `UAE` / `United Arab Emirates` | single-root audit |
| Identifier | `country_code` meaning dial code, not country | NANP drill-down |

### Structure before status

The second principle, and the one that explains why the first kept being violated.

```
WRONG   approve -> block -> assign products -> price -> ... -> build hierarchy later
RIGHT   identity -> hierarchy -> assignments -> pricing -> approval -> provisioning
```

Every defect debugged this week came from **status being applied before identity was settled**.
150,422 rows were approved before anything established what a row was; products were assigned
against ids before it was settled which table owned them; markets were recorded against a FK
pointing at the wrong catalogue.

A status set on an entity whose identity is still moving is not a decision — it is a guess that
will need re-making, and it looks exactly like a decision until someone queries it.

### Outputs are never sources

**No external system owns destination data.** Sippy tariffs, Sippy's own destination table,
customer rate sheets, rate notification workbooks and provisioning payloads are all
GENERATED from the catalogue. None of them is a place destination truth is maintained.

This is the identity principle at the system boundary rather than the table boundary, and it
is the one that decays quietly. Editing a destination name directly in Sippy is fast, works
immediately, and creates a second source that nothing reconciles — the same shape as
`destinations` / `global_destinations`, one layer out, and with no migration able to detect
it.

Concretely: Sippy's destination table is a publish target. It is written by the catalogue and
read by the switch. It is never edited in place, and anything found there that the catalogue
does not know about is drift to be resolved, not data to be preserved.

See [SIPPY-DESTINATION-PUBLISH.md](SIPPY-DESTINATION-PUBLISH.md) for the transport this
publishing uses and why the row strategy is safe without knowing whether Sippy merges or
replaces.

### The rule, without exceptions

**Every foreign key referencing a destination references `destinations.id`. Nowhere else.**

No aliases. No compatibility ids. No "temporary" FK to something else. If a translation is
ever needed it exists for the duration of a migration and is never read at runtime after it.

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

**Never create another table that represents a destination.** `destinations` is the entity.
Everything else referencing it is a view, a lookup, an assignment, or a history table.

**If the names are wanted in SQL,** define read-only views — `commercial_destinations` as
`WHERE level <= 3`, `destination_prefixes` as `WHERE level >= 4`. Views over one table share
its id space and cannot diverge. This is not the `destinations_v` situation: that view was a
compatibility shim during an unfinished migration with writes going somewhere else.

---

## Measured state of the catalogue

Measured on 2026-08-01, not inferred. Numbers are from the development workspace after 059; the
deployment differs and must be measured separately.

```
rows                150,422       all commercial_status = 'approved'
level 1                 363       0 with a parent
level 2             150,047       36 with a parent
level 3                  12       12 with a parent
```

**99.97% of the catalogue is flat.** 48 parented rows in 150,422. The hierarchy this document
describes does not exist yet — and `level` is not merely unpopulated, it is *wrong*: 150,011
rows claim level 2 and have no parent.

That is the most important fact for planning. Restructuring costs 48 reparented rows today and
will never be cheaper.

### What level 1 actually contains

```
142 countries appearing TWICE   ISO root (no dial_prefix) + dial-code root
 68 countries appearing ONCE    62 dial-code only, 6 ISO only
 11 operator rows               'Congo Mobile MTN', 'Gabon Mobile Airtel' — not countries
```

Two imports — a country seed list and the catalogue load — neither aware of the other.

Of the 6 ISO-only rows, four are name variants whose partner exists under another spelling
(`UAE`/`United Arab Emirates`, `Vietnam`/`Viet Nam`, `North Macedonia`/`Macedonia`,
`Congo DR`/`Democratic Republic Of The Congo`). **Two — Russia and United States — have no
dial-code root at all**, while 2,967 and 3,003 rows respectively carry their dial codes. The
two largest markets have no routable country node.

### Type classification is 92.75% deterministic

```
Mobile          116,950   77.75%
Fixed            22,558   15.00%
Other service         6    0.00%
unclassified     10,908    7.25%
```

Matched on whole words — `(^| )mobile( |$)`, never `LIKE '%Mobil%'`. Not theoretical:
`Slovenia Mobility Services` is a service category, and a substring match sells it as mobile.

The 10,908 are five problems, not one: geography (`Venezuela Movilnet Caracas`), operators
(`Bosnia And Herzegovina BH Telecom`), commercial categories (`Peru High Cost`), service
categories (`Latvia Special Services`) and international networks
(`International Networks 1 Orange`). `Other service : 6` is not evidence that premium and
satellite are absent — it is evidence they sit in the unclassified bucket under names the
keyword list does not match.

They concentrate by country — Lithuania 1,538, Estonia 1,246, NANP 869 — so the countries
actually sold can be finished long before the tail.

---

## Country identity: a seeded reference table

`country_code` is a **numbering plan**, not a country. `1` is 22 countries; `7` is Russia and
Kazakhstan; `262` is Réunion and Mayotte; `883` is not a country at all.

```
countries (id, canonical_name, iso2, dial_code, classification)
  dial_code is NOT unique — NANP, +7, +262, +672 fall out naturally
  classification: country | territory | international_service
```

**Seeded from ISO 3166 and ITU E.164. Never derived from our own catalogue.** An alias list
built by scanning `destinations` makes a vendor's misspelling canonical the first time it
appears — the dictionary meant to normalise bad input would be defined by it. This is the one
place in the system where the right answer comes from outside. ~250 countries, ~30 territories,
a handful of ITU global services (`+878` UPT, `+888` Disaster Relief).

**Aliases are exact-match only. Never prefix, never fuzzy.** `Congo` and
`Democratic Republic Of The Congo` are different countries (+242, +243), as are `Dominica` and
`Dominican Republic`. A fuzzy matcher merges both pairs, and the error surfaces as a rate
applied to the wrong country.

**`countries` is reference data; the country NODE in `destinations` is the commercial entity**
and carries `country_id`. One says what Afghanistan is, the other says whether we sell it. The
moment `countries` grows a `commercial_status` or a parent link, the split is rebuilt one level
up.

---

## Freeze and visibility are two axes, not three

| Axis | Column | Question |
|---|---|---|
| Sellable | `commercial_status` | may we offer this? **`blocked` = frozen** |
| Catalogue layer | `level` | business entity, or routing prefix? |

**`blocked` + `blocked_reason` is the freeze mechanism and it already exists.** The endpoint at
`routes.ts:37009` writes it with a reason and a `destination_status_history` row, and
`matrix-generator` drops anything not `approved`. A separate `frozen` flag would be a third
column describing sellability, free to disagree with the other two. Nothing else — not
`frozen`, not `technical`, not `destination_type`. Everything else derives from the hierarchy.

A technical prefix is not *blocked*. It is simply not a commercial entity.

### What may be frozen now, and what may not

**Safe now, by predicate:** international networks and global services (`878`, `881`, `882`,
`883`, `888`, `979`), premium, satellite, special services. They are already identifiable
without a hierarchy, and nobody sells them.

**NOT yet: NANP.** `WHERE country_code = '1'` covers all 22 NANP countries — USA, Canada,
Jamaica, Dominican Republic, Trinidad, Puerto Rico, Bahamas. Those are commercially different
markets and some are actively sold. Blocking them wholesale would hide live markets, and
unblocking selectively afterwards requires knowing which rows are Jamaica and which are Canada
— which is precisely the identity work 063A does. **Wait for the hierarchy, then block by
node.**

The same holds for Russia and the United States: blocking those country nodes today changes one
row each, because the `+1` and `+7` prefixes have no parent and status does not inherit.

Any bulk status change writes `destination_status_history` in the same transaction. A plain
`UPDATE` leaves no audit trail.

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

**Technical prefixes are never individually approved or blocked.** Commercial decisions are made
at the commercial node — country, type, operator — and prefixes inherit. A prefix carrying its
own approval is how 150,422 rows came to be approved without anyone deciding anything.

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
first would silently narrow what gets sold — with 52 assignments in existence, an
assignment-driven generator produces almost nothing.

### The invariant at the workbook boundary

> **Assignment answers "should this destination exist for this product?"**
> **Price answers "can it be provisioned?"**
> **Only Yes + Yes reaches the workbook.**

Commercial state may exist without a price. Provisioning output may not.

| Stage | Missing price allowed | Visible to the operator |
|---|---|---|
| Destination Catalogue | yes | yes |
| Assignments | yes | yes |
| Product Rates | yes — shown as `⚠ Unpriced` | yes |
| Generator report | yes — `skipped: no-rate` | yes |
| **Workbook** | **never** | — |
| **Sippy** | **never** | — |

A row reaching a tariff with a missing or zero rate is free termination on a live switch,
discovered in the CDRs. "Assigned but unpriced" is a state the platform shows and the switch
never sees. `matrix-generator` implements this today — `rate === undefined` pushes a `no-rate`
skip and `continue`s — and the assignment-driven rewrite must preserve it exactly.

### Extended: missing commercial data is an error, never a default

> **Only fully defined commercial products may leave the platform.**

The rate is not the only field that can be missing. `rate-matrix.ts:91` emits `1, 1` for
Interval 1 and Interval N — hardcoded — while `destination_product_rates` holds **356,820 rows
(47.5%) specifying 60/60, 60/1 or 30/6**. A workbook built from a row with no interval is not
incomplete, it is *wrong*: it silently asserts per-second billing on a contract that says
otherwise.

Eligibility therefore requires the whole commercial definition, not just a price:

```
approved + assigned + rate + interval + connect fee + grace period + effective date
        -> eligible for the workbook
anything missing -> REJECTED, reason named, no row, no push, no notification
```

This is already how the migrations behave — 050 refused to decide commercial routing, 052
refused to invent a dial prefix and NULLed instead, 059 refuses on a NOT NULL column it cannot
fill. Each chose "explicitly unknown" over "confidently wrong". The workbook builder is the one
component that does the opposite, and it does it on nearly half the priced rows.

### Notification follows verification, for anything that changes billing

| Class | Examples | Order |
|---|---|---|
| **A — billing** | rate, interval, connect fee, grace period | change → provision → **verify** → notify |
| **B — catalogue** | destination added or removed, product availability | change → notify → provision |

Class A notifies only after the switch confirms, because telling a customer their billing
changed while the switch still bills the old tariff is a written statement that is not true.

**A failed Class A notification must raise an alert, not record a status.** If the push
verifies and the email does not send, the customer is billed something they were never told —
worse than the reverse. This is not hypothetical: the deployment's Push History already shows
`Notifications` jobs at `Failed`, unattended.

### Job status is derived, not stored alongside the metrics

`rate_push_jobs.status` must be computed from the frozen step metrics
([PROVISIONING-STEP-METRICS.md](PROVISIONING-STEP-METRICS.md)), never maintained in parallel —
a status that can disagree with the numbers it summarises is another second identity.

```
verified > 0                 Completed
created > 0, verified = 0    Pushed, not verified      (the tariff-33 signature)
created > 0, skipped > 0     Completed with warnings
requested = 0                Rejected — nothing to send  (NEVER Completed)
```

The deployment currently shows `Completed` jobs with `Dests —`. A job that delivered an empty
payload reporting success is what lets someone believe rates have shipped.

### What actually changes in the generator

Only the iterator. `for each APPROVED destination` becomes `for each ASSIGNED destination`;
the price lookup, the skip contract, the prefix composition and the workbook builder are
untouched. That is the whole change, and it is why the regression surface is small.

The fallback becomes a commercial statement rather than a technical shortcut. Today "no
explicit markets" means *the whole approved catalogue*. After the switch it means *the
destinations attached to the products this customer bought* — which is a rule someone decided,
rather than a default nobody chose. It also retires the `2b8c7c71` global-catalogue fallback
by making it unnecessary, instead of deleting it and restoring the symptom it was papering
over.

### 063 is not a prerequisite for this

Assignments key on `destination_id`. A destination is a row whatever its `level` or `parent_id`
says, so assignments can be populated against today's flat catalogue and the generator switched
immediately — at 17 destinations if that is what resolves.

What 063 buys is the selection experience: ticking `Pakistan Mobile` in a tree requires a tree
containing `Pakistan Mobile`. Valuable, and not a dependency. Recognising that reorders the
work — the commercial model can be corrected before the catalogue is beautiful.

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
| Add a `frozen` flag | `commercial_status = 'blocked'` already is one, with a reason and history |
| Bulk-block NANP before 063A | `+1` is 22 countries, some actively sold, and unblocking selectively needs the identity work |
| Derive the country alias list from our own catalogue | a vendor's misspelling would become canonical |
| Fuzzy or prefix matching on country names | merges Congo/DR Congo and Dominica/Dominican Republic |
| Treat `country_code` as country identity | it is a numbering plan; `1` is 22 countries |
| Approve or block individual technical prefixes | commercial decisions belong to the commercial node; prefixes inherit |

---

## Path from here

1. **059** — merge `global_destinations` into `destinations`, id map. *(written)*
2. **060** — commercial reset, before the cutover. *(next)*
3. **061** — cutover: translate assignments, repoint FKs, move write sites.
4. **062** — retire `global_destinations`.
Steps 1–4 are the recovery. What follows is v2 proper, and it is ordered by **structure before
status** — identity first, hierarchy second, commercial decisions last.

### Phase 1 owns exactly four things

Destination Master Data. Nothing below it owns data; every lower layer projects.

```
Hierarchy           Country -> Type -> Operator
Destination Codes   the technical prefixes beneath a commercial destination
Product Assignment  which products may sell it
Approval            the ONLY place a destination is approved or blocked
```

**Approval exists in one place.** No approve control on Product Rates, on a rate sheet, or
anywhere a price is entered — that is how five screens came to own the same decision.

### Codes get their own page, and the charging prefix is not one of them

Codes are a routing concern; the hierarchy is a commercial identity concern. Separate pages,
per Rule 2.

The distinction that must survive that split:

```
Pakistan Mobile Jazz        commercial entity
  charging prefix   9230    ATTRIBUTE of the entity. One. Produces the tariff row.
  technical codes   92301   CHILDREN. Many. Inbound resolution only.
                    92302
                    92303
```

If the Codes page lists `9230` as a peer of `92301`, the outbound value becomes
indistinguishable from the inbound ones and *resolution is one-way* quietly stops holding —
someone will then "expand" a commercial destination into its codes at export, which is the
thing 053 exists to prevent.

The charging prefix belongs on the commercial destination, edited where the destination is
edited. The Codes page manages what sits beneath it.

---

### 063A — Country identity

Reference-driven, not catalogue-driven. For every row in the seeded `countries` table, look for
what the catalogue has and reconcile. Three cases, all measured:

```
found ISO root AND dial root      142   merge into one node, keep both as attributes
found dial-code root only          62   attach the ISO identity from reference
found ISO root only                 6   create the dial identity (Russia, United States)
```

Plus **11 operator rows sitting at level 1** (`Congo Mobile MTN`, `Gabon Mobile Airtel`) —
demoted to their country, or to `Country → Unclassified` if the name does not resolve
confidently. A non-country must never remain a root.

Refuses if a root would be removed while it still has children. Cheap today: 48 parented rows
in the whole catalogue.

> **Scope note — 059 changed the volumetrics, not the design.** The "11 operator rows at
> level 1" above was measured before 059 ran. On the workspace after 059 there are **1,145**
> level-1 rows with no `country_code`; the original 11 are among 16 with pre-059 ids and the
> rest arrived in one id block above 370,000. The three reconciliation cases still measure
> 62 and 6 exactly. Rules unchanged, execution set ~100× larger, and at that size the run
> must emit a summary and persist exceptions rather than complete silently. Measurements,
> projected placement counts and the reporting requirement:
> `DESTINATION-HIERARCHY-REPAIR-063.md`.

### 063B — Deterministic type layer

`Country → Mobile | Fixed | Services | Unclassified`, on whole-word matching only. Classifies
92.75% without a guess. Everything else goes to `Unclassified` under its country.

**The asymmetry is the whole argument for `Unclassified`:** a misclassified row terminates
traffic on service numbers and nobody notices for weeks; `Slovenia → Unclassified → Slovenia
Mobility Services` is obviously incomplete and nobody sells it by accident. A guess that is 95%
right is worse than a gap that is 100% visible, because the 5% bills silently.

### 063C — Operator enrichment, country by country

Populate `operator_name` — currently NULL on all 150,422 rows, so nothing is overwritten. The
commercial identity is already in the names (`Russia Mobile Megafon`, `Sweden Mobile Telenor`,
`Bosnia And Herzegovina BH Telecom`); it is unstructured, not absent.

Driven by a **classification dictionary with provenance**, not hardcoded regexes:

```
destination_classification (destination_id, rule_id, classification, confidence, classified_at)
  confidence: deterministic | dictionary | manual
```

Without provenance a mutable dictionary makes the tree's shape depend on table state at run
time, and a bad rule can only be undone by re-deriving everything. With it, a bad rule is a
targeted rollback. Same reasoning as `destination_id_map`: the correspondence is worth more
than the operation that produced it.

Done per country, prioritised by what is actually sold — not swept across 150k rows in one
pass.

> **Enrichment only, and the measurement says so.** Operator tokens resolved against the 264
> operator entries in `server/country-codes.json`: of 627 rows carrying one, 6 match exactly,
> 43 as a prefix, 578 not at all. Nowhere near the confidence to derive structure, which is
> why it does not have to — 063A/B establish parentage from tokens 1 and 2 alone, and the
> operator token stays the node's own name. `MOVIST` / `MOVISTAR` / `MOBLIN` / `MOBILINK`
> never become a parsing problem for the structural repair.

### 063D — Commercial decisions

Only now: approvals at commercial nodes, product assignments, company markets, Rate Manager.
This is where NANP gets frozen or sold **by node**, which is not possible before 063A.

### 063E — Inheritance and visibility

Prefixes inherit commercial state from their parent; the catalogue UI defaults to the
commercial layer with a toggle for NOC and engineering; the generator switches to
assignment-driven once assignments are populated.

### Two sequencing constraints that are easy to drop

**The commercial reset stays its own step, before the cutover.** It is tempting to fold it
away on the grounds that assignment-driven generation makes it unnecessary — and it would,
if both landed in the same migration. They cannot reliably: assignment-driven generation
depends on `product_destination_assignments` being populated, which is separate work with 52
rows done. If the cutover lands first with everything approved, the generator visits 601,632
cells before the assignment change is anywhere near it. The reset makes the cutover safe
whether or not the generator change is ready.

**`destination_id_map` is retained, not dropped.** It looks like a translation layer, which
v2 forbids, and the distinction is what "translation layer" means: **nothing reads it at
runtime.** After 061 no query resolves an id through it. It survives as the only answer to
"which destination was legacy id 1500?" — a question asked by old provisioning records, CDR
exports and any audit of what 053 assigned. Dropping it makes those permanently unanswerable
to save one small table.
