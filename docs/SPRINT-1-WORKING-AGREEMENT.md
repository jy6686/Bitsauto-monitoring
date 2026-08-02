# Sprint 1 — working agreement

Process, not architecture. The design documents answer *what must become true*; this answers
*how you establish whether it is true*. It modifies nothing frozen at `7d26b776`.

---

## The principle

> **A measurement is only evidence if it could have disproved your plan.**

Stronger than "measure first," and it is the one the design phase kept re-learning. Three
confident positions were overturned by a number, each having survived until it met one:

| Position | Falsifying measurement | Result |
|---|---|---|
| The API is flattening the hierarchy | Read the handler | One `SELECT`, no transform. The rows are stored flat. |
| 62 countries would be deleted by the new filter | Id bands against the 059 insert block | One, not 62 |
| The routing tree must not be disturbed | Count level-2 rows with a parent | 27 of 150,038. There is no tree. |

And one that failed the test while looking like it passed:

| Question | Measurement taken | Why it was not evidence |
|---|---|---|
| Does `product_rates.destination_id` hold legacy ids? | Six files reference both `product_rates` and `global_destinations` | Orthogonal. No possible value of that count answers the question. |

That last row is the failure mode this agreement exists to prevent. The measurement was not
*wrong*; it was **non-falsifying**. It had a number, it came from a command, and it would pass
a "did you measure it?" check. A cheap measurement of the wrong quantity is more dangerous
than none, because it produces the feeling of having checked.

---

## Every implementation step opens with four items

### 1. Claim

Exactly one statement being tested.

> `product_rates.destination_id` stores legacy `global_destinations` ids.

### 2. Falsifier

A result that would prove the claim false.

> If those values are already canonical `destinations.id` values requiring no translation
> through `destination_id_map`, the claim is false.

**If you cannot write a falsifier, you do not have a test — you have a suspicion.** Suspicions
are worth investigating and worth writing down. They are not grounds for migrating anything.

### 3. Measurement

The specific query or procedure. Not "audit destination ids", but:

> Compare every distinct `product_rates.destination_id` against `destinations.id` and
> `destination_id_map`; classify each as canonical, legacy, orphaned, or ambiguous.

The test: **can this produce "no"?** If no outcome of the procedure would stop you, it is not
a measurement, it is a formality.

> **The implementation of the measurement must itself be reviewed against its falsifier. A
> measurement that cannot produce every specified outcome is invalid, regardless of the data.**

Measurements contain assumptions exactly as migrations do, and those assumptions are testable
too. The worked example, because it is subtle and it is the first thing Sprint 1 does:

```sql
CASE WHEN EXISTS (SELECT 1 FROM destinations …)        THEN 'Canonical'
     WHEN EXISTS (SELECT 1 FROM destination_id_map …)  THEN 'Legacy'
     ELSE 'Orphaned' END
```

That is a three-bucket classifier wearing four buckets. The `Canonical` branch short-circuits,
so it masks the precise condition being hunted — an id that is valid in `destinations` *and*
mapped to a different destination. `Ambiguous` is unreachable, and the query has decided the
answer before reading a row.

The two facts must be computed independently and compared afterwards:

| in `destinations` | in map | maps to same destination | Classification |
|---|---|---|---|
| no | no | — | Orphaned |
| yes | no | — | Canonical |
| no | yes | — | Legacy |
| yes | yes | yes | Canonical (already translated) |
| **yes** | **yes** | **no** | **Ambiguous — stop immediately** |

The last row is why the measurement exists. Any query structure that cannot emit it is invalid
before the data is considered. Same failure as the co-occurrence count above, one level deeper:
not a wrong answer, but an instrument that cannot register the reading you need.

### 4. Decision rule, written before the result is seen

| Result | Action |
|---|---|
| All canonical | leave unchanged |
| All legacy | translate through `destination_id_map` |
| Mixed | investigate before migrating anything |
| Orphaned ids present | stop; classify before proceeding |

Deciding in advance is what keeps the step mechanical instead of interpretive. A decision rule
written after the numbers arrive is a rationalisation of them.

---

## Standing rules

**One migration at a time.** Change exactly one thing between measurements, or the post-measure
cannot attribute what it sees.

**Acceptance criteria before proceeding.** Each workstream's criterion is a number already
counted at freeze time — four Pakistan representations → one, five client destination sources
→ one, nine `global_destinations` readers → zero, certification passing unchanged. Re-measure
against the same number, not against a fresh judgement of whether it looks right.

**Re-certify before claiming unchanged behaviour.** "Unchanged" means unchanged *behaviour*,
demonstrated by the existing certification: same workbook, same upload, same tariff, same
notification. Files inside the certified path will be edited. Untouched text was never the
promise.

**Reference data originates from the catalogue.** No table outside it owns commercial
destination identity — it references by canonical id, or preserves immutable evidence.

**History is evidence, not reference.** Reference data is allowed to change; historical
evidence is allowed to disagree; neither is ever silently converted into the other. A rename
must not reach backwards into what a customer was quoted.

**An architecture question is an exception, not a coding-time adjustment.** If a step cannot be
completed without changing one of the four governing principles, stop and raise it. That is a
review, not a refactor.

---

## First step of Sprint 1

The four items above, on `product_rates.destination_id` — a query, not a migration. It sits
under the certified path, and the only existing evidence about it is co-occurrence, which
cannot answer the question.
