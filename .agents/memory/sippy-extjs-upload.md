---
name: Sippy ExtJS upload page
description: /c1/rates_tariff.php renders its upload button via ExtJS client-side; static HTML GET never contains <input type="file">
---

## Rule
Do NOT require `<input type="file">` in the static HTML of `/c1/rates_tariff.php`.
The page IS the correct upload endpoint even though the button is rendered by ExtJS.

**Why:** Deployment logs confirmed: ssp-root/customer GETs `/c1/rates_tariff.php?i_tariff=33`,
receives 40KB body, but `fileInputs=0` — because ExtJS injects the button after page load.
The /admin/tariffs.php page is a different ExtJS viewer (52KB) that truly has no upload capability.

**How to apply:**
- `findRatesCapableSession`: accept /c1/ paths even with fileInput=false; only reject /admin/ paths with no file input
- `pushRateViaPortalUpload`: proceed with default `fileFieldName='rate_file'` for /c1/ pages; only abort for /admin/ paths
- POST destination: `/c1/rates_tariff.php?i_tariff=N` (confirmed from Sippy portal screenshot)
- Field name to try: `rate_file` (Sippy default), then `rates_file`, `file`, `import_file` if rejected
