# 060 — RESERVED

**The gap between 059 and 061 is intentional. No migration is missing.**

`060_destination_id_map_translation.sql` is reserved for translating the 52
`product_destination_assignments` rows through `destination_id_map`, as promised in the
header of `059_merge_global_destinations_into_destinations.sql`:

> `no FK is re-pointed, no view is changed, no application code is affected. That is 060.`

It belongs to the Destination Catalogue stream and has not been written yet.
`061_cli_verification_evidence.sql` took the next free number rather than claim 060, so
that the destination work keeps the number its own documentation already cites.

---

## Why this file is `.md` and not `.sql`

**A `.sql` placeholder here would silently break the real 060.**

`runFileMigrations()` matches `/^(\d{3})_[A-Za-z0-9_.-]+\.sql$/` and records every applied
file by **filename** in `schema_migrations`, which is the primary key. A comment-only
`060_….sql` would therefore:

1. execute (harmlessly — comments),
2. be recorded as applied,
3. and when the real migration is later written into that same filename, the runner sees
   the name already recorded, detects the checksum change, and logs:

   ```
   [migrate] DRIFT: 060_….sql changed on disk since it was applied. Not re-run.
   ```

   — then **skips it**.

The destination translation would never run, and the only trace would be one warning line
at boot. That converts a visible, harmless gap in the numbering into an invisible, harmful
skip.

This file ends in `.md`, so `MIGRATION_FILE` does not match it. The runner and the
diagnostics both ignore it entirely; it exists only for the person reading `ls`.

**When the real migration is written**, create `060_destination_id_map_translation.sql`
alongside this note and delete this file.
