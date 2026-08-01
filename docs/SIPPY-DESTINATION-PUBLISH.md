# Publishing the Destination Catalogue to Sippy — established facts

**Date:** 2026-08-02
**Status:** research frozen. Everything below was measured against the live switch, not inferred.
**Builder:** `server/services/destinations/destination-workbook.ts` (written, 9 tests passing)
**Probes:** `scripts/sippy-destination-probe.ts`, `scripts/sippy-destination-form-probe.ts`

---

## The one-line answer

**Yes, BitsAuto can publish destinations to Sippy** — not over XML-RPC, but through the
authenticated portal the platform already drives for rates and CDRs.

---

## Transport

| Question | Answer | How it was established |
|---|---|---|
| XML-RPC destination API? | **No** | `getDictionary('upload_types')` returns only `1 = Routes`, `2 = Rates` |
| Upload page | `/c1/destinations.php` | portal GET |
| Method | `POST`, `multipart/form-data` | form markup |
| Trigger field | `action=import` | hidden input |
| File field | **`destinations_file`** | file input |
| Pass-through fields | `prefix_clause`, `prefix_pattern`, `country_clause`, `country_pattern`, `description_clause`, `description_pattern` | hidden inputs, all filter state |
| Form name | `upload_form` | referenced by the handler |
| Portal login | **works** — `ssp-root` | `portalLogin: success via 302→/c1/` |

**`system.listMethods` returned 4 methods.** That is the standard XML-RPC introspection
quartet, not Sippy's API — the switch plainly exposes dozens more. That result is
**inconclusive** about destination methods, not negative. The `upload_types` dictionary is the
part that decides, and it decided.

---

## Workbook format

From a *Download Destinations* export — taken verbatim, never inferred. The importer is
**positional**: a shifted column writes the country into the description and the switch
accepts it.

```
Action [A|D|U|S|SA] | Id | Prefix | Country ISO | Description | Area Name | Min. Length | Max. Length
```

Real rows, including one that carries neither ISO nor length bounds — proving blank is a value
the importer accepts:

```
      1924  11      —     North America          —    —   —
      2676  11201   USA   New Jersey             NJ   11  11
      2791  11202   USA   District of Columbia   DC   11  11
```

---

## The publish strategy, and why it does not depend on an unresolved question

**There is no replace/merge control anywhere in the form.** No select, no radio, no hidden
mode field. So the behaviour is Sippy's alone, and it remains unknown.

That does not block anything, because the strategy is correct under either:

```
every row Sippy currently holds  ->  Action = U, carrying its existing Id
every new destination            ->  Action = A, Id blank
```

- **merge** — `U` updates in place, `A` adds. Nothing touched that should not be.
- **replace** — the file *is* the table, and the whole table is in the file.

Sending only new rows would be correct under merge and would **delete 2,923 live routing
rows** under replace, including every NANP prefix and the Min/Max length bounds the switch uses
to reject misdialled numbers.

This mirrors the rate path, which resolves the same ambiguity the same way:
`buildFullTariffXlsx` includes every current row because *"Sippy portal upload can operate in
REPLACE mode (wipes rows not in the file)."*

---

## What the builder refuses to invent

`Country ISO` and `Min/Max Length` are emitted only when supplied, counted when absent, never
guessed. Sippy's own export leaves both blank on prefix `11`, so blank is accepted — and a
fabricated `11/11` on a Pakistani mobile series would make the switch reject valid traffic.

**Consequence worth planning for:** the catalogue's `country_code` is a mix of dial codes and
ISO-2, while Sippy wants ISO-3 (`USA`, `PAK`). Until the countries reference table exists
(063A in [CATALOGUE-V2](DESTINATION-CATALOGUE-V2.md)), that column ships blank.

---

## Still unread

`import_destinations()` — the Upload control is
`<input type="button" onClick="import_destinations()">`, not a submit, so the handler builds
the request. The probe printed only its guard clause; a non-greedy regex stopped at the
`alert()`'s closing brace.

Likely `document.upload_form.submit()`, since the form is named `upload_form` and carries
everything needed. **Not confirmed.** Resolve it when the upload step is built, not before —
the workbook generator and the download button do not depend on it.

---

## Lesson from the probes themselves

Three probes, three findings that were about the probe rather than the switch:

| Reported | Actually |
|---|---|
| "gd-only 0 — nothing depends on the old ids" | the query could only ever return 0 |
| "portal login failed on every pair" | the two credentials that work were never tried |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Node's `fetch` validates a self-signed cert; production uses `lenientHttpsAgent` |

Each looked like a result. **A probe that does not take production's exact path measures a
different system** — same credentials, same HTTP helper, same order. That is why
`getAnyPortalSession`, `sippyBase` and `portalGet` are exported for diagnostics.

---

## Drift detection — report, never adopt

Rule 4 of [CATALOGUE-V2](DESTINATION-CATALOGUE-V2.md) says outputs are never sources. Sippy's
destination table is a publish target, so it needs a way to notice when someone has edited it
in place — and a hard rule about what happens next.

**Record a signature at publish time**, then compare against a fresh download:

```
publish  ->  store row count, prefix count, and a content hash of the workbook
check    ->  download current destinations, recompute, compare

  match     Sippy holds what we published
  differ    "Destination database differs from the last published version.
             Manual changes may have been made directly in Sippy."
```

`rate_notification_jobs.generated_attachment_hash` already does exactly this for notification
workbooks — the pattern exists and should be reused rather than reinvented.

**The check must NEVER sync Sippy back into the catalogue.** That will look like an obvious
improvement to someone later: drift is detected, the switch has newer data, adopting it is one
query. It is the thing Rule 4 exists to forbid.

The moment Sippy's edits flow back, Sippy is a source. Two writers, no declared canonical, and
the reconciliation is invisible because both sides look authoritative — the exact shape of
`destinations` / `global_destinations`, relocated to a boundary no migration can inspect.

Drift is a **defect report**: someone bypassed the catalogue. The fix is to make the change in
the catalogue and republish, never to import the switch's opinion.

---

## What is left to build

```
✅ workbook format          measured
✅ safe U/A strategy        implemented, 9 tests
✅ transport + field names  measured
✅ portal login             confirmed
⬜ download current rows    to populate `existing` — copy getPortalTariffXlsx's shape
⬜ POST + poll              needs the rest of import_destinations()
⬜ job + history            reuse rate_push_jobs' shape
```

Ship `Generate Sippy Workbook → Download` first. It needs none of the unfinished rows, and the
same button gains `→ Publish → Verify` later without the operator's workflow changing.
