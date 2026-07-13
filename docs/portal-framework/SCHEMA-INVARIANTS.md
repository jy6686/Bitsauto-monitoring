# Portal Schema Invariants

These are part of the **canonical schema** and are **required by the idempotent portal seed
migrations** (`029_seed_portal_assignments.sql` and any future portal seeds that upsert). Do not
remove them during a schema cleanup — dropping either one makes `ON CONFLICT` upserts fail and the
seed **rolls back silently → an empty portal** (0 modules), which is hard to diagnose.

| Table | Required unique index | Declared in | Repaired by |
|-------|-----------------------|-------------|-------------|
| `portal_module_assignments` | `uq_portal_module` on `(portal_id, module_id)` | `shared/schema.ts` (drizzle) + migration `020` | `029` step 0 (`CREATE UNIQUE INDEX IF NOT EXISTS`) |
| `portal_sections` | `uq_portal_section` on `(portal_id, section_key)` | `shared/schema.ts` (drizzle) + migration `021` | `029` step 0 |

## Why both a schema declaration and a seed guard
- **`shared/schema.ts`** declares the indexes so **`drizzle-kit push`** creates them natively —
  every *new* environment (dev, CI, new deployment) is correct from the start.
- **`029` step 0** creates them idempotently (same names) so an environment built by a `db:push`
  *before* the schema declaration existed (e.g. an older deployment) is **repaired** when the seed
  runs. `ON CONFLICT` tolerates multiple arbiter indexes, so a DB that also has the migration-020/021
  constraint is unaffected.

## History
Root cause of the NOC portal "0 modules" incident (2026-07): `shared/schema.ts` originally omitted
these indexes, so `db:push`-created databases lacked them and `029`'s `ON CONFLICT` rolled the whole
seed back. Reproduced on a clean local Postgres, fixed at both layers, validated across schema-fixed
/ bare / constraint databases. See `docs/portal-framework/NOC-VALIDATION.md`.
