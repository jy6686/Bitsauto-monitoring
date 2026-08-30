# Commercial migration — status

**A feature is implemented when its verification script passes, and complete when a human has
exercised it against real data. Not before, and not on anyone's opinion.**

Adopted 2026-08-30, after a migration reached twenty commits before anyone discovered the
production catalogue had never been imported. Every fact needed to see it had been available
for hours.

| Feature | Verify with | Implemented | Complete |
|---|---|---|---|
| Commercial catalogue (500–503) | `verify-catalogue.mjs` | ✅ | ⏳ production |
| Workbook importer | `verify-catalogue.mjs` | ✅ | ✅ workspace |
| Approval + activation | `verify-catalogue.mjs` | ✅ | ✅ workspace |
| Review console | — *(manual)* | ✅ | ⏳ |
| Diagnostics + readiness | `verify-deployment.mjs` | ✅ | ✅ |
| Send Rate on the catalogue | `verify-send-rate.mjs` | ✅ | ⏳ **one real push, then re-run** |
| **Reverse prefix resolver** | `verify-rate-analysis.mjs` | ✅ **20/20** | ⏳ live Sippy |
| Rate Analysis UI | — | ❌ | ❌ |
| Product Rates | — | ❌ | ❌ |
| Vendor Rates | — | ❌ | ❌ |
| Deal Management | — | ❌ | ❌ |
| Notifications | — | ❌ | ❌ |

## Running them

```
DATABASE_URL='…' node  scripts/verify-catalogue.mjs --expect-sellable 1344
DATABASE_URL='…' node  scripts/verify-send-rate.mjs
DATABASE_URL='…' npx tsx scripts/verify-rate-analysis.mjs
                 node  scripts/verify-deployment.mjs http://localhost:5000
```

`verify-all.mjs` runs the first three as a **release gate** and exits non-zero if any fails.
Run it against the database a deployment is about to serve:

```
DATABASE_URL='<the target database>' node scripts/verify-all.mjs
```

It refuses the exact situation of 2026-08-30 — a clean build shipped onto a database with no
catalogue, replacing a working picker with an empty one — and names the reason before anyone
opens a browser. Verified both ways: exit 1 against an empty database, exit 0 against a working
one.

It deliberately does **not** require that a human has performed a push. That is an acceptance
criterion for Send Rate, not a precondition for deploying code, and demanding it would block
every release onto a fresh database. So the gate runs `verify-send-rate --readiness-only`, and
the push evidence stays a manual step.

They share `scripts/lib/verify.mjs` — the same report format, the same exit contract, and the
database named before anything else. Extracted at the third consumer, not the first: two
scripts sharing an abstraction is a guess about what they have in common, three is evidence.

`verify-catalogue` runs first. A resolver answering "unknown" for everything against an empty
database is not a resolver failure, and a script that reports it as one wastes the next hour.

## What the scripts are for, and what they are not

They assert **meaning**, not response shape — that `19231` reaches Zong, not that some JSON key
exists. A test that breaks when a field is renamed teaches people to ignore failures; one that
breaks when the answer becomes wrong is worth stopping for.

They do not replace using the thing. `verify-rate-analysis` passing means the resolver is
correct about the ten questions it was asked. Whether Rate Analysis is *usable* is a judgement
only a person looking at the screen can make, which is why **Implemented** and **Complete** are
separate columns and only the first can be automated.

## What a script cannot prove about Send Rate

Two links in `picker → selection → expansion → queue → request → rate_push_jobs → Sippy` are
not script-verifiable, and pretending otherwise would be worse than leaving them out:

- the **queue** lives in React state, reachable only from a browser;
- the **Sippy write** changes a live switch, and a script that performs one to prove it works
  has altered a customer's tariff to make a test pass.

So `verify-send-rate.mjs` proves everything up to the request, then **inspects the most recent
real push** to confirm the expansion survived into the database. Do one push by hand; the
script tells you whether it landed. The parts a machine can check without consequences, and
one deliberate human action it can then audit.

It fails when the last push has fewer prefixes than the destination owns — the exact regression
where expansion stops at the queue and only one of Zong's two prefixes reaches Sippy.

## Rate Analysis must show WHY, not just what

A destination name alone is not troubleshootable. The resolver returns `match` and
`matchedPrefix` precisely so the screen can say which:

| Prefix | Resolution | Destination |
|---|---|---|
| `9231` | Exact | PAKISTAN - MOBILE ZONG |
| `923123456` | Longest match (9231) | PAKISTAN - MOBILE ZONG |
| `92300` | Longest match (9230) | PAKISTAN - MOBILE MOBILINK |
| `881` | Legacy only | *(Sippy has it; the catalogue does not)* |
| `88` | Unknown | — |

`legacy_only` is kept as a diagnostic even though it is not the KPI. It is the honest answer
when a supplier drops a destination, when a prefix was created by hand in Sippy, or when an old
tariff outlives a catalogue cleanup — and an operator seeing it knows immediately that the rate
exists in the switch and nowhere else.

## The migration KPI

Not an orphan count. `legacy_only` is nearly unreachable, because country-level prefixes like
`923` catch almost everything by longest match — it would report ~0 on day one and measure
nothing.

**The measure is the proportion of live Sippy rates resolving `exact`.** A rate resolving only
by `longest_match` exists at a finer granularity than the catalogue sells — `192300` inside
Mobilink's `9230` is precisely that, and it is the shape of every pre-cutover leftover. When
every live rate resolves `exact`, each one corresponds to exactly one approved commercial
prefix and the cutover is done.
