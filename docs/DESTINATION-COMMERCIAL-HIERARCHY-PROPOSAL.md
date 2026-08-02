# Proposal — commercial destination hierarchy, prefixes as attributes

Status: **FROZEN 2026-08-02. Not approved, nothing built.** Written against
`DESTINATION-CATALOGUE-V2.md`, whose non-goals table this must answer to. Contains one
proposed amendment to a frozen principle (Q1) requiring sign-off.

**No further architectural additions.** Next sessions are implementation only: Catalogue V2,
commercial UI migration, publisher service, resolver migration, re-certification, retirement of
`global_destinations`. If implementation raises a question that requires changing one of the
four governing principles, that is an **exception requiring explicit review** — not something
adjusted while coding.

One item is deliberately left open rather than frozen wrong: the Reference/History role of
`rate_notification_template_destinations`. It is a lifecycle question, answerable by looking at
how the rows are used, and it must be answered before that table is touched.

Proposes that `destinations` carry one **commercial** tree — Country → Service → Operator —
with routing prefixes as multi-valued attributes of the operator node rather than nodes in
their own right.

**This is a consolidation, not a mapping.** Nothing is being mapped between systems. The
catalogue already holds four representations of the same commercial reality, and the work is
to reduce them to one hierarchy from which everything else is a projection. A mapping layer
would preserve the duplication and add a translation table on top of it; consolidation
removes the duplication. The distinction matters because it changes the success condition —
afterwards there is one editable master and no correspondence to maintain.

The rate engine is out of scope and untouched: `product_rates`, the matrix generator, the
workbook builder, the Sippy upload, push history, verification, notifications and
provisioning all stay exactly as they are. This changes only what feeds them.

---

## Three premises corrected first

**There is no `commercial_destinations` table.** Not in `shared/schema.ts`, and neither 052
nor 053 creates one. The "commercial layer" today is `commercial_status = 'approved'` on a
destination row plus `product_destination_assignments`. Any diagram showing Product Rates
reading from `global_destinations` / `destinations` / `commercial_destinations` is naming a
table that does not exist.

**`global_destinations` is not the routing vocabulary going forward.** 059 merges it into
`destinations`, 062 retires it. After 059 both granularities live in one table. This is not
catalogue-vs-legacy; it is two granularities in one place.

**`/api/commercial-destinations` currently reads `FROM global_destinations`**
([routes.ts:28264](../server/routes.ts)). The commercial projection is sourced from the table
being retired, and it joins `product_destination_assignments.destination_id` against
`global_destinations` ids — which `destination_id_map` translates to *different* ids in
`destinations`. **This endpoint breaks at 062 independently of this proposal** and needs its
own fix.

---

## The routing tree that 053 protects does not exist

This is the load-bearing measurement, and it reverses the reason 053 refused to re-parent.

053 declines to re-parent operator entries because "their parent_id and level belong to the
routing and analytics tree, and rewriting that to satisfy pricing would be pricing reaching
into a model it does not own."

Measured on the workspace snapshot:

| | |
|---|---|
| level-2 rows | 150,038 |
| level-2 rows carrying a `dial_prefix` | 150,028 |
| level-2 rows **with a parent** | **27** |
| nodes anywhere with any child | 159 |
| **most children on any one node** | **4** |

There is no routing tree. There are 150,011 flat prefix rows asserting level 2 with nothing
above them. 053's objection describes a model that was never populated, so re-parenting
cannot damage it. That does not make 053 wrong — it was right that pricing must not seize a
model it does not own — but the model it was protecting is empty, and the objection should be
retired on evidence rather than inherited.

---

## The proposed hierarchy already exists as data

Pakistan, as actually stored today. Four overlapping representations of the same operators:

**1 — a correct small tree, exactly the proposed shape** (root `Pakistan`, id 1, `PK`):

```
Pakistan (PK)
├── Mobile          → Jazz 92300 · Zong 92310 · Ufone 92333 · Telenor 92345
├── Fixed           → Pakistan Karachi 9221
└── UFONE           → Pakistan MOBILE 9233        (stray, mis-levelled)
```

**2 — flat, commercially named, unparented** — the operator-to-prefix grouping the target
model calls for, already present in the table:

```
Pakistan Mobile Jazz     9230     parent=None
Pakistan Mobile Jazz     9232     parent=None
Pakistan Mobile Zong     9231     parent=None
Pakistan Mobile Ufone    9233     parent=None
Pakistan Mobile Telenor  9234     parent=None
Pakistan Mobile SCO      9235     parent=None
```

**3 — generic duplicates** — six rows all named `Pakistan MOBILE`, prefixes 923, 9230, 9231,
9232, 9233, 9234, describing the same operators under a name that identifies none of them.

**4 — legacy IBIS rows** at level 1 from the 059 merge: `PAK Mobile MOBLIN`,
`PAK Mobile UFONE`, `PAK Mobile TELNOR`, `PAK Mobile SCOGSM`, `PAK Mobile PAKTEL`.

**The consequence for this proposal:** Jazz = 9230 + 9232 and Zong = 9231 + 9237 are not a
taxonomy to invent. They are in the table, as two rows each, differing only by prefix. The
work is collapsing representations 2, 3 and 4 onto representation 1 — consolidation, not
design. That is a much smaller and much more verifiable change than a new taxonomy, and it is
the strongest argument for adopting the model.

---

## Measured 2026-08-03 — three prefixes compete for the same traffic, all approved

On `heliumdb`, Pakistan mobile is priced at three levels of specificity simultaneously:

| id | name | prefix | level | parent | status |
|---|---|---|---|---|---|
| 375991 | `PAKISTAN MOBILE` | `923` | 2 | 374639 | approved |
| 374641 | `Pakistan Mobile Jazz` | `9230` | 2 | **NULL** | approved |
| 374643 | `Pakistan Mobile Jazz` | `9232` | 2 | **NULL** | approved |
| 9 | `Jazz` | `92300` | 3 | 8 | approved |

Sippy matches longest prefix, so `923001234567` prices against **`92300`** — the routing-series
row — and never reaches the commercial Jazz destination. Publishing all three gives one
operator three prices and lets the most specific silently win.

Two consequences for this proposal:

- **`destination_prefixes` alone does not finish the job.** Attaching `{9230, 9232}` to a Jazz
  node leaves `92300` and `923` still approved and still winning. Consolidation must decide
  which rows are absorbed and which survive — Q4, with a measurable cost for getting it wrong.
- **The commercial rows are orphans.** Every `9230`–`92391` row has `parent_id = NULL`. The
  `Pakistan → PAKISTAN MOBILE → Jazz` tree does not exist in the data; only
  `374639 → 375991` is parented. 063A/B is what creates it.

Before any consolidation, an overlap report is needed per country: which prefixes are wholly
covered by a shorter one, which destinations become redundant, and which longer prefixes carry
a deliberately different rate and must survive.

## The schema change

One table. Prefixes stop being an attribute *of* a node and become a set *belonging to* a
node:

```
destination_prefixes (
  destination_id  INTEGER NOT NULL,     -- the operator (or service) node
  prefix          VARCHAR NOT NULL,
  source          VARCHAR,              -- provenance, per destination_id_map precedent
  PRIMARY KEY (destination_id, prefix)
)
```

`Pakistan Mobile Jazz` becomes **one** node owning `{9230, 9232}`, replacing two rows. Adding
9239 tomorrow is one insert: assignments, rates, rate sheets and notifications are all
unchanged, and the next publish includes it.

This is an attribute set over existing entities. It adds no second destination identity, so
"one entity, one row, one id" is preserved — the principle prohibits a second table of
*identities*, which is what 058–062 is undoing, not a table of *properties*.

Approval then lands only on commercial nodes. `9230` is never approved, because it is no
longer a thing that can be.

---

## Open questions this proposal must answer before it is approvable

**Q1 — CLOSED 2026-08-03 by a business rule, not a principle rewrite.**

Prefix-level rows are a **commercial** requirement, not a transport format. `Pakistan Mobile
Jazz` owns `9230` and `9232`; `9232` was Warid before Jazz acquired it, and the customer's rate
notification must show both ranges under the Jazz name so they can see their coverage:

```
Pakistan Mobile Jazz    9230    0.0400
Pakistan Mobile Jazz    9232    0.0400
```

So the thing that stays singular is the **identity**, not the row count. Product Rates edits one
destination; notifications, price lists and the publisher each emit one row per prefix. The
amendment below still stands for Sippy, but Q1's tension dissolves: expansion was never
purely a transport concern, and V2 Principle 3's "one tariff row per commercial destination"
was over-general. Its real target is expansion to *operator series* (`92300`), not to the
commercial ranges an operator owns (`9230`, `9232`).

The row-count measurement is still wanted for capacity, but it no longer gates the design.

**Q1 (original framing) — the export-expansion conflict.**

V2 Principle 3 reads: *"never expand a commercial destination into prefixes at export. That
undoes 053: one tariff row per commercial destination, not thousands."* The publisher
described here does expand — `Pakistan Jazz → 9230, 9232`.

The principle is not wrong, its wording is too broad: some expansion must happen, because
Sippy does not understand `Pakistan Jazz`. It understands `9230`. The certified rate engine
already expands today. Proposed amendment to V2 — **requires sign-off; V2 is frozen**:

> Commercial destinations remain one logical entity inside BitsAuto. Expansion into routing
> prefixes is permitted only as a transport transformation for external systems (Sippy,
> workbook generation). The expanded rows must never become a source of truth, and nothing
> read back from an external system is authoritative.

This preserves Rule 4 exactly, and it is the pattern already proven by the rate engine:
`Product Rate → Workbook → Sippy Tariff`. Nobody treats the workbook as canonical; nobody
edits the tariff. Destination expansion is the same shape —
`Destination Catalogue → Publisher → expanded prefix workbook → Sippy` — and the expanded
workbook is a transport artifact, not a second catalogue.

**What the amendment does not settle: tariff size.** Legitimising expansion does not bound
it. 053's number was operational, not philosophical — thousands of rows per customer against
128 — and that limit survives the rewording untouched. Operator-granularity expansion looks
like ~5 rows per country rather than thousands, but **this is unmeasured**: it needs
rows-per-customer counted at commercial, operator and series granularity against real
assignments. Not derivable from the catalogue snapshot; it needs `product_rates` and
`product_destination_assignments`. Phase 5 should not start before that number exists.

**Q2 — is the operator→prefix relation many-to-one or many-to-many?** One prefix belonging to
two operators is a routing contradiction; the PK is written above assuming a prefix appears
once. Confirm against real data before freezing it, because `Pakistan MOBILE` currently holds
9230 while `Pakistan Mobile Jazz` also holds 9230.

**Q3 — operator rows with no commercial parent.** 063B's answer already exists and should be
reused rather than reinvented: `Country → Unclassified`, on the asymmetry that a gap is
visible and a wrong guess bills silently.

**Q4 — which representation survives consolidation?** Representation 1 has correct structure
and the *finer* prefixes (92300); representation 2 has correct commercial names and the
*coarser*, priced prefixes (9230). Neither is a superset. Merging them is where destination
ids change, so `product_destination_assignments` and anything holding an id must be
translated — the 059 lesson, and the reason `destination_id_map` is permanent.

---

## Sequencing

063A/B first, unconditionally. Today `PAK Mobile MOBLIN` is a root; grouping edges over roots
does not stop them being roots, and every consumer reading `level == 1` still sees a country.
Then:

1. **Build the catalogue.** Consolidate representations 1–4, add `destination_prefixes`. The
   catalogue becomes the single editable master. Nothing else changes.
2. **Commercial screens consume it** — Product Assignment, Product Rates, Send Rate,
   Notifications, Customer Rate Sheets. This is where the five client destination sources
   collapse to one.
3. **Implement `DestinationPublisherService`.** Three independent provisioning dependencies
   become one.
4. **Re-point both translators at the catalogue** — publisher and the existing resolver.
5. **Re-certify provisioning.** The rate engine is functionally identical, so the existing
   certification is the test: same workbook, same upload, same tariff, same notification. A
   dependency swap that cannot be re-certified is not a dependency swap.
6. **Retire `global_destinations`** (062) — last, once nothing reads it.

**Phase 4 is not a table-name swap, and budgeting it as one is the 059 trap.** The resolver
joins `JOIN global_destinations gd ON gd.id = dpr.destination_id`, so
`destination_product_rates.destination_id` holds *legacy* ids. Re-pointing at `destinations`
means translating every one through `destination_id_map` — the same hazard that made that map
permanent, where an id valid in both tables names a different destination in each.
`product_destination_assignments` has the identical problem and 060 exists to translate it.
Any table holding a `destination_id` needs auditing for this before Phase 4, not during it.

Sippy Publisher generation from the catalogue is **gated on Q1** and does not enter the
sequence before that number exists.

Each phase is a source swap behind a stable interface. The rate engine's behaviour is never
altered — and step 4 is what makes that a verified claim rather than an intention.

## The governing rule, and the measured distance from it

> Every commercial module obtains destinations exclusively from the Destination Catalogue.
> No module reads `global_destinations` directly. No module maintains its own destination
> hierarchy. No module invents commercial destination names.

Adopting it is cheap; conforming to it is the work. Measured against the current tree —
`.bak` files excluded, live code only:

**Nine files read `global_destinations` directly.**

| File | Module the rule names |
|---|---|
| `server/routes.ts` (11 references) | many |
| `server/routes-rate-manager.ts` | Product Rates / Send Rate |
| `server/routes-product-mapping.ts` | Product Assignment |
| `server/services/commercial/product-mapping-resolver.ts` | Product Assignment |
| `server/services/provisioning/rate-notification-email.ts` | Notifications |
| `server/services/provisioning/preflight.ts` | Rate Provisioning |
| `server/services/provisioning/steps/rates.step.ts` | Rate Provisioning |
| `server/services/destination/destination-resolver.service.ts` | — |
| `server/services/destination/destination-alias.service.ts` | — |

Plus `scripts/rate-template.ts`, `scripts/commercial-coverage.ts`, and one test.

**Four of the seven modules the rule names are currently in breach**, and the client holds at
least five distinct destination sources: `/api/product-registry/destinations`,
`/api/destination-catalog/*`, `/api/commercial-destinations`, `/api/global-destinations/export`,
and `/api/rate-notification-template-destinations/`. That fragmentation is the duplicate
destination lists and inconsistent naming this proposal exists to end.

### The two rules collide, and 062 forces it

*"Leave the rate engine exactly as it is"* and *"no module reads `global_destinations`
directly"* cannot both hold, because the certified provisioning path reads
`global_destinations` in at least three places — `preflight.ts`, `rates.step.ts`,
`rate-notification-email.ts`.

This is not an argument against either rule. It is a sequencing constraint, and it is not
optional: **062 retires `global_destinations`, so those three files break whether or not this
proposal proceeds.** They need re-pointing at `destinations` through `destination_id_map`,
which is a source swap behind unchanged logic — the same shape as Phases 2–5, and the
narrowest possible change to a certified path. "Unchanged" has to mean unchanged *behaviour*,
verified by the existing certification, not untouched text.

`/api/commercial-destinations` is in the same position and is listed above under `routes.ts`.

## Phase 3 — the provisioning seam, and the half of it that already exists

Rather than re-point `preflight.ts`, `rates.step.ts` and `rate-notification-email.ts` at the
new hierarchy individually — which reproduces the fragmentation this proposal removes — they
depend on one service:

```
Rate Engine → DestinationPublisherService → Destination Catalogue
```

with a single responsibility, `getProvisioningDestinations(productId)`: read the catalogue,
expand prefixes, return provisioning rows. Three independent destination dependencies become
one. "The rate engine is unchanged" then means what it should mean — behaviour, flow and
certification unchanged, one dependency swapped — and 062 stops being a risk to the certified
path, because nothing inside the provisioning flow knows `global_destinations` existed.

**This is not a new pattern. It is the mirror of one already working in the tree.**

`server/services/destination/destination-resolver.service.ts` is the same seam in the inbound
direction. `resolveDestination(vendorName, normalizedPrefix)` resolves a vendor rate row to a
destination via alias → canonical name → longest prefix, and returns
`{ destinationId, method, reason, confidence }` — provenance on every answer, the same
discipline as `destination_id_map` and 063C's `destination_classification`.

The two are symmetric, and naming that symmetry is what makes the pair coherent:

| | Direction | Transform |
|---|---|---|
| `destination-resolver.service` | inbound | prefix / vendor name **resolves up** to a commercial destination |
| `DestinationPublisherService` | outbound | commercial destination **expands down** to prefixes, for transport only |

The resolver is the working implementation of V2 Principle 3's "resolution is one-way." The
publisher is the sanctioned downward transform the amended principle permits — expansion as
transport, never written back. Together they are the only two places where the commercial and
technical vocabularies meet, which is exactly the property the governing rule asks for.

### Only two translators

```
                    Destination Catalogue (MASTER)
                               │
                ┌──────────────┴──────────────┐
      DestinationResolverService     DestinationPublisherService
           (inbound)                       (outbound)
                │                             │
        vendor rate import              product rates
        vendor mapping                  customer workbooks
        alias resolution                Sippy publisher
        prefix resolution               notifications
```

**These two services are the only code permitted to translate between commercial destinations
and routing prefixes.** Everything else consumes their output. That is the enforceable form of
the governing rule — a rule about two files rather than a policy about every module.

The catalogue owns hierarchy, names, operator grouping, prefixes, approval and assignments.
Nothing else owns destination data.

### Publisher provenance

Mirroring the resolver's `{ method, reason, confidence }`:

```json
{
  "destinationId":   4812,
  "destinationName": "Pakistan Jazz",
  "prefixes":        ["9230", "9232"],
  "rule":            "operator-prefix-group",
  "generatedRows":   2,
  "source":          "destination_catalogue"
}
```

Which commercial destination produced a prefix, which rule expanded it, and how many routing
rows resulted — answerable from the output rather than by re-deriving the expansion. It is
also what makes Q1 measurable in production rather than only in advance: `generatedRows`
summed per customer *is* the capacity number.

Two consequences worth stating:

- **The resolver is itself in breach.** Both its queries read `global_destinations`
  (lines 20 and 37, the second joining `destination_product_rates`), so it needs the same
  source swap. It is on the checklist, not exempt from it.
- **Copy its shape, including the provenance fields.** A publisher that returns rows without
  recording which catalogue node and which rule produced them would be a step backwards from
  the resolver that already exists.

## The legacy-id audit — run, not listed

> Every table storing a `destination_id` originating from `global_destinations` must be
> audited before 062. If the ids are legacy ids they are translated through
> `destination_id_map` before the table is re-pointed.

Of 227 tables in `shared/schema.ts`, **nine** carry a destination identifier:

| Table | Column | Files touching it that also touch `global_destinations` |
|---|---|---|
| **`product_rates`** | `destination_id` | **6** |
| `company_markets` | `destination_id` | 3 |
| `destination_product_rates` | `destination_id` | 3 |
| `product_destination_assignments` | `destination_id` | 1 — 060 already translates it |
| `vendor_rate_normalized_prefixes` | `destination_id` | 1 |
| `deal_destinations` | `destination_id` | 0 |
| `product_history` | `destination_id` | 0 |
| `vendor_product_mappings` | `destination_set_id` | — different concept, sets not destinations |
| `vendor_rate_sheets` | `destination_set_id` | — as above |

**`product_rates` is the exposed one.** It holds a `destination_id` and appears in six files
that also reference `global_destinations`. The legacy-id translation therefore reaches into
the certified rate engine's own storage — so "the rate engine is unchanged" has a *data*
dimension as well as a code one. The behaviour and the flow stay identical; the ids inside its
table may not. That belongs in Phase 4 scope and in the Phase 5 re-certification.

The right-hand column is a co-occurrence signal, not proof: it says these files know about
both, not that the stored ids are legacy. **Only a query settles which id space each table
actually holds**, and that query cannot be run from here. It is the first task of Phase 4.

### A second category the id audit does not catch

`rate_notification_template_destinations` was expected on this list and is not on it — it has
no `destination_id` at all. It stores `destination_name` and `dial_prefix` as text.

That makes it immune to the id trap and exposed to a different one: it holds a **copy of the
commercial name**. Rename `Pakistan Mobile Jazz` in the catalogue and this table silently keeps
the old string — a direct instance of "no module invents commercial destination names," and
invisible to any id-based audit. Any table holding a destination *name* or *prefix* as text
needs the same sweep, judged against a different rule.

### The invariant both classes violate

> **No persistent table outside the Destination Catalogue may own commercial destination
> identity.** It may reference it by canonical id, or record it as immutable historical
> evidence, but it must never become an editable copy.

This separates the two legitimate cases from the illegitimate one:

| | Legitimate | Test |
|---|---|---|
| **Reference** — current state | yes | holds a canonical id, resolves through it, owns nothing |
| **History** — what was true at an event | yes | immutable; a later rename must *not* change it |
| **Editable copy** | **no** | mutable text or ids that drift from the catalogue |

The two audit classes are the two ways the invariant fails. **Class A — identity by id**
(`product_rates`, `product_destination_assignments`, and the rest of the seven) fails by
pointing into the wrong id space. **Class B — identity by copied text**
(`rate_notification_template_destinations`, and anything else storing `destination_name` or
`dial_prefix` as text) fails by drifting semantically. Same rule, different failure mode, and
only Class A is visible to an id audit.

Applied to the tables found, the invariant classifies them immediately — and forces one real
question. `product_history` is history: immutable evidence, legitimate, leave it.
`product_rates` is reference: must hold canonical ids. `rate_notification_template_destinations`
is **ambiguous and must be decided, not assumed** — if those rows are a *template* awaiting
send, they are an editable copy and a violation; if they are the record of a notification
already sent, the quoted text is exactly the immutable evidence the invariant protects and
must not be "corrected" to match a later rename. The column names say template; the behaviour
decides. Getting this backwards either leaves a shadow catalogue in place or rewrites history
customers were quoted from.

### Governing sentence

> **Reference data is allowed to change. Historical evidence is allowed to disagree. Neither
> should ever be silently converted into the other.**

This is why Sippy is an output and not a source, why workbooks are transport artifacts, why
history keeps old names and templates do not, why destination ids migrate and notification
records do not — and it is what Rule 4 was reaching for.

### Checkpoint: classify by lifecycle, not by columns

Before any destination-bearing table is touched, classify it **Reference** or **History** — and
do it by what the row is *for*, not by what columns it has. `rate_notification_template_destinations`
is the proof that columns cannot decide it: the same `destination_name` / `dial_prefix` text is
a shadow catalogue in a template and protected evidence in a sent record.

Measured tables, classified:

| Table | Role | Action |
|---|---|---|
| `product_rates` | Reference | canonical `destination_id` — verify id space first |
| `product_destination_assignments` | Reference | canonical `destination_id` (060 translates) |
| `company_markets` | Reference | canonical `destination_id` |
| `destination_product_rates` | Reference | canonical `destination_id` |
| `vendor_rate_normalized_prefixes` | Reference | canonical `destination_id` |
| `deal_destinations` | Reference | canonical `destination_id` |
| `product_history` | History | preserve text, never re-point |
| `rate_notification_template_destinations` | **undecided** | template → Reference; sent record → History |

Push history, upload verification records and any resolver cache belong in the same sweep;
they were not part of the `destination_id` audit and have not been classified here. Their roles
are predictable — history, history, reference — but predicted is not classified, and the one
table where the answer looked obvious is the one that turned out ambiguous.

### Pre-Phase-4 verification task

Before the publisher consumes it:

> Verify every `product_rates.destination_id` belongs to the expected id space.

`product_rates` sits at the intersection of certified provisioning, workbook generation,
notifications and destination identity — the highest-exposure table on the list. Proving its
identities are correct is separable from, and must precede, swapping what reads it. That keeps
the certified workflow intact while establishing that what it was certified against was right.

## Persisted expansion metrics

The publisher knows exactly what it generated, so provisioning history records it:

```
Provision Job
  ├── commercial destinations : 13
  ├── generated routing rows  : 41
  ├── uploaded rows           : 41
  ├── verified rows           : 41
  └── expansion factor        : 3.15
```

Not a source of truth — an audit record, alongside push history and upload verification, which
already follow this pattern. It answers "why did this customer upload 41 rows", "which
commercial destination generated 9232", and "how much did operator granularity grow the
workbook" without regenerating anything.

It also closes Q1 by observation. `generated routing rows` per customer **is** the capacity
number, so operator-granularity sizing stops being an assumption to validate before building
and becomes a metric read after the first run.

## Acceptance criteria

Objective finish lines, each measurable against something already counted in this document:

| Workstream | Done when |
|---|---|
| Catalogue V2 | the four Pakistan representations are one hierarchy |
| Commercial UI | the five client destination sources are one |
| Publisher / Resolver | certified provisioning passes unchanged after the dependency swap |
| Retirement (062) | no runtime dependency on `global_destinations` remains — currently 9 files |

## The position this settles on

- The Destination Catalogue is the **only editable master** for destination identity.
- The rate engine is unchanged. The provisioning engine is unchanged.
- The publisher performs the expansion Sippy requires, as transport.
- Nothing read back from Sippy — or any external system — is ever authoritative.

Everything else is a projection of the one hierarchy.

## What this does not do

It does not touch `product_rates`, the matrix generator, the workbook builder, the upload
path, push history, verification, notifications or provisioning. The workbook still emits
`19230` / `19232`, because that is what Sippy expects. The certified path stays certified.
