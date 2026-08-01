# Technical Debt Register

Items found during other work, recorded so they are not rediscovered. Each entry states what
the code does today, what it costs now, what it will cost later, and the intended fix.

Entries are removed when fixed, not marked done — git history is the record of what was.

---

## TD-001 · Rate matrix generator materialises one object per skipped cell

**Found:** 2026-08-01, reading `matrix-generator.ts` to decide whether the commercial reset
must precede the destination cutover.

**Current behaviour.** [`generateRateMatrix`](../server/services/rates/matrix-generator.ts)
iterates every destination × every product and pushes a `GeneratorSkip` object for each cell
it does not emit. The `no-rate` branch builds a fresh interpolated string per cell:

```ts
detail: `No price for ${d.name} on ${p.name}. A customer would carry this destination unpriced.`
```

Both `rows` and `skipped` are fully materialised arrays. In the empty case the only value
consumed downstream is `matrix.summary.rowsSkipped` — a count. The array is built in full to
produce a number.

**Impact today: negligible.** The deployment resolves 17 destinations × 4 products = 68
cells. `company_markets` is empty, so the step falls through to
`approved AND dial_prefix IS NOT NULL` against `global_destinations`, which is a 2,697-row
table with 35 approved rows.

**Impact after the cutover: high.** Migration 061 points the same query at `destinations`,
where 150,408 rows are approved:

```
150,408 × 4 = 601,632 skip objects, each with a ~70-character interpolated string
```

Order of 150–200 MB before V8 object overhead, allocated inside the provisioning rate step,
on a run that uploads zero rates. Memory growth, not CPU.

**Mitigation in place.** Migration 060 resets approvals to `unapproved` *before* 061 moves
the write path, so the destination set never reaches that size unreviewed. That is a safety
margin, not a fix — a deliberate approval of a few thousand destinations would reach the same
condition legitimately.

**Intended fix — the cause, not the ledger.** `product_destination_assignments` exists, 053
populated it, and the rate path consults it nowhere:

```
grep productDestinationAssignments server/services/rates/ server/services/provisioning/
-> no matches
```

The generator loops destination x every product the COMPANY bought, rather than destination x
the products that DESTINATION is sold on. That is where the Cartesian product comes from. The
storage format is already correct — `dial_prefix` holds the base code and the product digit is
composed at export (`trunkPrefix + dialPrefix`, "computed here, stored nowhere"), so there are
no per-product duplicate rows to remove.

Driving generation from the assignments removes the cells instead of counting them: the loop
never visits a destination/product pair nobody sells, so the skip ledger cannot grow large.

**Sequencing catch.** Only 52 assignments exist today. Switching the generator to treat them
as authoritative before they are populated would silently narrow what gets sold — the same
failure mode as the `2b8c7c71` fallback in the opposite direction. Populate first, switch
second.

**Interim fix, if the assignment work lands later.** Count exactly, retain a bounded sample:

```ts
rowsSkipped++;
skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
if (skipSamples.length < 100) skipSamples.push({ …, detail });
```

Counts by reason rather than a flat total, so `no-rate 601632, blocked 54, no-dial-prefix 12`
stays readable. This matches the shape already frozen for step metrics —
`failures: [{ cause, count }]` in [PROVISIONING-STEP-METRICS.md](PROVISIONING-STEP-METRICS.md)
— so the generator and the step report agree on how a category of problem is expressed.

**Sequencing.** Not before the provisioning certification. It touches the exact path being
certified, and at 68 cells the current version is correct. Scheduled with 061.

**Related:** [DESTINATION-MIGRATION-REPORT.md](DESTINATION-MIGRATION-REPORT.md) — the reset
ordering depends on this item.

---

## TD-002 · `company_markets` cannot be populated, so every customer falls through to "all approved"

**Found:** 2026-08-01, tracing why a provisioning run resolved 17 destinations.

`company_markets.destination_id REFERENCES global_destinations(id)` (migration 054), but the
wizard sends ids from the catalogue UI, which reads `destinations`. Every insert violates the
FK and is swallowed by a non-fatal handler at [routes.ts:27937](../server/routes.ts:27937),
so the company is created with zero markets and `intent.error` set.

`rates.step` then falls through to "all approved destinations". **No customer on the
deployment has a market recorded**, which means per-customer commercial scope does not
currently constrain anything.

**Fix:** migration 061 repoints the FK. The table is empty, so the repoint itself is free.

**Watch for:** the fallback added in commit `2b8c7c71` widens scope further by looking
unresolved prefixes up across *all* approved destinations. It was written to paper over this
symptom. Remove it once markets record properly — priced-but-out-of-scope is information for
an operator, not a licence to sell.

---

## TD-003 · Vendor rate normalisation never resolves to a destination

**Found:** 2026-08-01, in migration 058's dependency inventory.

```
vendor_rate_normalized_prefixes : 46,154 rows, every destination_id NULL
```

46k normalised vendor prefixes exist and not one is linked to a catalogue destination. The
vendor sheet pipeline runs to normalisation and stops there, so vendor pricing cannot inform
commercial approval or cost comparison.

**Related:** Vendor Sheets Sprint 2, which also owns the Bulk Import parser that put 1,135
IBIS codes into `dial_prefix` (cleaned by migration 052).
