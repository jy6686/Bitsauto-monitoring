---
name: On-demand CDR endpoint portal fallback
description: /api/sippy/cdr must mirror refreshCdrCache credential strategy or it returns empty in production
---

## The Rule

The on-demand `/api/sippy/cdr` route must use `scrapePortalCDRsAll` (not `scrapePortalCDRs` or `scrapeAdminPortalCDRs`) for its XML-RPC fallback, with the same credential attempt order as `refreshCdrCache`.

**Why:** In production, RTST1 portal login fails. `scrapeAdminPortalCDRs` uses `apiAdminPassword` (wrong for ssp-root). Only `scrapePortalCDRsAll` with `apiUser + adminWebPassword` (ssp-root) succeeds. The background job gets it right; the on-demand route did not.

**How to apply:** Credential attempt list in the on-demand fallback:
1. `portUser + portPass` (RTST1) with `fallbackUsername: apiUser, fallbackPassword: webPass || apiPass`
2. `apiUser + webPass` (ssp-root with adminWebPassword)
3. `apiUser + apiPass` (ssp-root with apiAdminPassword)

**Gotcha:** `startDate` and `endDate` must be defined at the top of the `if (cdrs.length === 0 && settings)` block — the CDR cache filter below also uses them.

**Timing issue:** At fresh deployment startup, the CDR cache is empty. Without this fix the Products page loads before `refreshCdrCache` finishes its first run and returns zeros. With this fix the on-demand route does its own `scrapePortalCDRsAll` call and gets live data immediately.
