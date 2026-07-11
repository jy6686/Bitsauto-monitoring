# Known Issue — Nested `Bitsauto-monitoring/` repository duplicate

| Field | Value |
|-------|-------|
| Subsystem | Repository / tooling |
| Status | OPEN (tech debt) |
| Verification | Verified in code (Evidence Level 1) |
| Last verified | 2026-07-11 |
| Repository commit | `482babb7` |
| Institutional sections | No |

> **Severity:** Low (not a production blocker).
> **Decision:** Leave untouched during the Commercial sprint; clean up later in a
> dedicated repository-maintenance PR. See Volume 0 governance.

---

## Summary

The repository contains a full, stale copy of itself at the path
`Bitsauto-monitoring/` (i.e. `<repo-root>/Bitsauto-monitoring/...`). It is **2,281
tracked files** committed into the parent repo — not a git submodule and not a
separate repository (it has no nested `.git`).

## When and how it appeared `[verified-in-code]`

- Introduced in commit **`b73d25fa`** — *"Saved progress at the end of the loop"*,
  dated **2026-06-19** (an automated loop/checkpoint commit).
- Confirmed via: `git log --diff-filter=A -- "Bitsauto-monitoring/package.json"`.

## What it is `[verified-in-code]`

A stale snapshot of the whole project from 2026-06-19, accidentally nested one
level deep and committed. Evidence:

- **0 files are unique to the nested copy by path** — every nested path also
  exists in the main repo. (`comm -23` of the two `git ls-files` sets.)
- The main repo is a **superset**: 2,776 tracked files vs the nested 2,281.
- The nested versions are **older** where they differ (e.g. nested
  `shared/schema.ts` is 4,040 lines vs main's 4,349).

## Uniqueness inventory `[verified-in-code]`

Answer to "does the nested copy contain anything not in main?":

| Category | Unique to nested? |
|----------|-------------------|
| Files unique by path | **0** |
| Unique migrations | **0** (one content difference — see below) |
| Unique schema | **0** |
| Unique services | **0** |
| Unique UI pages | **0** |
| Unique config | **0** |
| Unique docs | **0** |

- **74 shared files differ in content** (compared by git blob SHA), across
  `client/` (36), `server/` (27), plus `shared/schema.ts`, `package.json`,
  `tsconfig.json`, `migrations/`, etc. In all sampled cases the nested version is
  the **older** one.
- **The only salvageable artifact:** `migrations/028_product_mapping_catalog.sql`
  — the nested copy is **populated (16,644 bytes)** while the main copy is
  **empty (0 bytes)**. The migration content was emptied in main sometime after
  2026-06-19. This is the single case where the nested copy holds content the main
  repo lost.

> Note: that migration defines `product_mapping_versions`, `product_mapping_files`,
> `product_destination_mappings`, `product_mapping_active_config`,
> `product_mapping_activation_log`. **None of these are in `shared/schema.ts`**, and
> this project syncs the DB only via `drizzle-kit push` (which ignores raw SQL
> migrations). The 028 SQL is therefore **reference only** — restoring the file
> does not create the tables. See the separate product-mapping tables
> investigation for the real fix path (port the tables into `shared/schema.ts`),
> which is gated on production **database evidence** (`to_regclass`).

## Risk assessment

- No unique application code, schema, services, pages, config, or docs would be
  lost by removing the nested directory.
- Only action required before deletion: **salvage the populated 028 SQL** as
  reference (copy its content somewhere durable, e.g. attach to this issue or the
  product-mapping investigation).

## Proposed cleanup plan (deferred — dedicated PR)

1. Salvage `Bitsauto-monitoring/migrations/028_product_mapping_catalog.sql`
   content as reference for the product-mapping table definitions.
2. `git rm -r Bitsauto-monitoring/` in an **isolated PR with no functional code
   changes** (large delete-only diff — keep it reviewable on its own).
3. Verify build + typecheck still pass (nothing in the main tree imports from the
   nested path — confirm with a grep for `Bitsauto-monitoring/` references before
   deleting).
4. Do this **after** the Commercial sprint is stable, per the freeze policy.

## Reproduction / verification commands

```bash
# It is tracked and file-count
git ls-files "Bitsauto-monitoring/" | wc -l          # 2281

# Zero files unique to nested (by path)
git ls-files "Bitsauto-monitoring/" | sed 's#^Bitsauto-monitoring/##' | sort > /tmp/n
git ls-files | grep -v "^Bitsauto-monitoring/" | sort > /tmp/m
comm -23 /tmp/n /tmp/m | wc -l                        # 0

# The one populated-vs-empty migration
wc -c migrations/028_product_mapping_catalog.sql                      # 0
wc -c Bitsauto-monitoring/migrations/028_product_mapping_catalog.sql  # 16644
```

## Open Questions
- [x] Does the nested copy contain unique files? — **Verified**: no (0 unique by path; main is a superset)
- [x] Is any content only in nested? — **Verified**: only the populated `028` migration (reference-only)
- [ ] Any runtime references to the `Bitsauto-monitoring/` path before deletion? — **Pending** (grep before the cleanup PR)
