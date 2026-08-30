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
| Send Rate on the catalogue | *needs a script* | ✅ | ⏳ real push |
| **Reverse prefix resolver** | `verify-rate-analysis.mjs` | ✅ **11/11** | ⏳ live Sippy |
| Rate Analysis UI | — | ❌ | ❌ |
| Product Rates | — | ❌ | ❌ |
| Vendor Rates | — | ❌ | ❌ |
| Deal Management | — | ❌ | ❌ |
| Notifications | — | ❌ | ❌ |

## Running them

```
DATABASE_URL='…' node  scripts/verify-catalogue.mjs --expect-sellable 1344
DATABASE_URL='…' npx tsx scripts/verify-rate-analysis.mjs
                 node  scripts/verify-deployment.mjs http://localhost:5000
```

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

## The migration KPI

Not an orphan count. `legacy_only` is nearly unreachable, because country-level prefixes like
`923` catch almost everything by longest match — it would report ~0 on day one and measure
nothing.

**The measure is the proportion of live Sippy rates resolving `exact`.** A rate resolving only
by `longest_match` exists at a finer granularity than the catalogue sells — `192300` inside
Mobilink's `9230` is precisely that, and it is the shape of every pre-cutover leftover. When
every live rate resolves `exact`, each one corresponds to exactly one approved commercial
prefix and the cutover is done.
