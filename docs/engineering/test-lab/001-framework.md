# Test Lab Framework — Specification (v1.0, FROZEN)

| Field | Value |
|-------|-------|
| Subsystem | Platform → Test Lab (operational verification) |
| Status | **FROZEN v1.0** (2026-07-11) |
| Verification | Verified in code (`server/dev/`, 16/16 vitest) |
| Repository commit | `12d694ab` (branch `feature/vendor-test-lab`) |

> Goal: anyone can add a self-test without reading the implementation. From v1.0,
> additions are **consumers** (new tests/fixtures), not framework edits — evolve the
> framework only on a genuine architectural limitation, with a version bump.

## Architecture
```
registerSelfTest({...})  →  Registry  →  Runner (filter · deps · execute)  →  Results (JSON)
                                              ↑                                   ↓
                                      Fixture Library                     Reporter / UI / CI
```
Files: `server/dev/self-test-registry.ts` (registry+runner), `fixtures.ts` (fixture
engine), `<domain>-self-tests.ts` (registrations), `server/routes-dev.ts`
(`GET /api/dev/self-test`). **Stateless** — no persistence (History is a later,
separate subsystem).

## Registry lifecycle
- `registerSelfTest(def)` — idempotent per `(module,name)`; re-registration replaces.
- `def`: `module`, `name`, `type`, optional `id` (default `module::name`),
  `dependsOn` (ids), `tags`, `run?()`.
- `listModules()`, `_resetRegistry()` (tests only).

## Runner lifecycle
`runSelfTests(filter?)` → `{ framework_version, runner_version, overall, exit_code, ran, results[] }`.
1. Filter by `module` / `type` / `tag` / `deterministicOnly`.
2. For each (in registration order): if any `dependsOn` id is not `PASS` → **SKIPPED**;
   else if no `run()` → `MANUAL` (manual) or `NOT_RUN` (env not runnable here);
   else execute (throw → `FAIL`), timing each.
3. `overall` = worst **executed** status (MANUAL/NOT_RUN/SKIPPED never fail the suite).

## Status definitions
| Status | Meaning |
|--------|---------|
| 🟢 PASS | working |
| 🟡 WARNING | functional, needs attention |
| 🔴 FAIL | broken (or threw) |
| ⚪ NOT_RUN | not auto-runnable here (needs DB/external), no impl |
| 🔵 MANUAL | requires human verification |
| ⏭ SKIPPED | a `dependsOn` dependency did not PASS |

## Exit codes (CI)
`0` = PASS (nothing failed) · `1` = WARNING · `2` = FAIL. Same framework runs in the
Developer UI and in GitHub Actions with no redesign.

## Dependency rules
`dependsOn: ['vr.dup-headers']` — a broken upstream **skips** the dependent so it can
never produce a misleading PASS. Reference by `id`. Keep chains shallow and acyclic
(v1.0 does a single registration-order pass; no cycle detection — don't create cycles).

## Tag conventions
Free-form, lower-case: `vendor`, `commercial`, `parser`, `critical`, `database`,
`sippy`, `ui`, `regression`, `performance`. Run subsets: `?tag=critical`.

## Deterministic vs environment
- **Deterministic** = `type: 'unit'` — pure, always identical, **CI-safe**
  (`?deterministic=true`). Parser, mapping, calculations, resolver.
- **Environment** = `integration` (DB) / `external` (Sippy/portal) / `manual` — run
  in Dev/Staging only; declared with `dependsOn` so they SKIP if deterministic
  stages fail.

## Fixture Library (platform resource)
```
server/dev/fixtures/
  synthetic/    hand-made deterministic inputs      (committed)
  regression/   a workbook that once triggered a bug (committed, anonymized)
  expected/     versioned baselines (schema-tagged)  (committed)
  production/   anonymization guide ONLY — never customer files
```
- `.gitignore` exception `!server/dev/fixtures/**` lets synthetic/regression xlsx live in-repo.
- `loadFixtureBase64(kind,name)`, `listFixtures(kind)`.
- **Baselines compare normalized models, not raw JSON** — `normalizeRateSheet()`
  sorts rows (order-independent); `diffBaseline()` returns human-readable diffs;
  baselines carry `"schema": N` so the parser can evolve without breaking old ones.

## Extension guide — add a test in 3 steps
1. In `server/dev/<domain>-self-tests.ts` (create if new):
   ```ts
   registerSelfTest({ module: 'Margin', id: 'mg.negative', name: 'Negative margin detection',
     type: 'unit', tags: ['commercial','critical'], run: () => (/* … */ { status: 'PASS', detail: '' }) });
   ```
2. Import that module for its side-effect in `server/routes-dev.ts`.
3. (Optional) drop a fixture in `fixtures/synthetic|regression/` + a baseline in
   `fixtures/expected/` and load it via `loadFixtureBase64`.
Run: `GET /api/dev/self-test?module=Margin` (or `&tag=critical`, `&deterministic=true`).

## Roadmap after freeze
Framework/Registry/Runner/Fixtures/Baselines = **frozen**. Next: **add tests** across
Vendor Rates → Repository → Margin → Impact → Approval → Push → Product Registry →
Destination Catalog → Routing → Sippy. Then (later, separate): Reporter, Developer
UI (thin consumer), History (persistence), CI. Evolve the framework only if real
usage (50-100 tests) exposes a genuine limitation.

## Open Questions
- [ ] Developer UI (render `/api/dev/self-test`) — **Pending** (thin consumer, after tests grow)
- [ ] History persistence (`test_history`) — **Deferred** (separate subsystem)
- [ ] CI integration (exit codes already ready) — **Deferred**
