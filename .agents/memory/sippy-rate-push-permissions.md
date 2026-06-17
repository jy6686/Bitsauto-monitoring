---
name: Sippy Rate Push Permissions
description: Why rate push fails for ssp-root and the fix architecture
---

## Root Cause
`ssp-root` is a Sippy **reseller** account — Sippy's portal ACL denies `/c1/rates.php?i_tariff=N` to resellers. The portal returns a full login-page HTML (2099B, `value="Login"` at byte 1998) instead of redirecting. This is NOT a session problem (session IS valid, proven by other pages working); it's a permission-level block.

## Key Facts
- Sippy has **zero XML-RPC rate write methods** (`system.listMethods` confirmed on this instance)
- Portal CSV upload (Action=AS multipart POST) is the only rate-push mechanism
- All 4 URL variants return login page for ssp-root: `/c1/rates.php`, `/rates.php`, `/tariff_rates.php`, `/c1/tariffs.php?action=edit_rates`
- `ssp-root` session works for: CDRs, ASR/ACD, service_plans, active calls — but NOT rate management
- SIPPY_PROV_USERNAME env var = same user as ssp-root (deduplicated via Set)

## Fix Architecture
`settings` table has two new columns: `sippy_rate_admin_user` / `sippy_rate_admin_pass`  
`RateAdminCreds` type extended with optional `rateAdminUser?` / `rateAdminPass?`  
`getAdminPortalSession` accepts these as additional credential pairs tried last  
All 5 `adminCreds` construction sites in `routes.ts` inject the new fields from settings

**Why:** `getAdminPortalSession` builds a deduplicated list of (username, password) pairs and tries each with admin/reseller/customer acct_types. By appending the rate admin pair, a true system admin account (separate from ssp-root) can be used for rate management without touching any other credential flow.

## Fix Instructions for User
Either:
1. Sippy Admin Panel → grant `ssp-root` "Edit Tariff Rates" permission, OR
2. Settings → Sippy → Rate Admin Credentials → enter a Sippy system admin account

## Probe Endpoint
`GET /api/sippy/rates/portal-probe?tariffId=N` — probes 4 URL variants, skips 404/too-small responses, returns `{ ok, loginOk, ratesPageOk, error }`. Used by ChangeClientRateModal to show a proactive warning banner.
