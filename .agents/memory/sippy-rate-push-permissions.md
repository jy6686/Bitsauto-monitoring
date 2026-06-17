---
name: Sippy Rate Push Permissions
description: How to get portal sessions that can access /admin/tariffs.php for rate editing — all root causes found and fixed.
---

## Root Cause (original)
`ssp-root` is a Sippy **reseller** — Sippy's portal ACL denies `/c1/rates.php?i_tariff=N` to resellers. Session IS valid; it's a permission-level block.

## Key Facts
- Sippy has **zero XML-RPC rate write methods** — portal CSV upload (Action=AS multipart POST) is the only mechanism
- ssp-root session works for CDRs, ASR/ACD, service_plans, active calls — NOT `/c1/rates.php`
- BUT: `/admin/tariffs.php?action=edit_rates&i_tariff=N` IS accessible to ssp-root (different ACL path)
- SIPPY_PROV_USERNAME env var = same user as ssp-root (deduplicated)

## Three Bugs Fixed to Reach `ok:true` on Probe

### Bug 1 — getAdminPortalSession positive-cache short-circuits credential trials
5-min positive session cache returned ssp-root's cookies immediately; new rate-admin creds were never tried.
**Fix**: bust cache when `rateAdminUser` is provided.

### Bug 2 — portalLogin only accepted /c1/ redirects
Hardcoded `locHeader.includes('/c1/')` as only valid success. System admin accounts redirect to `/admin/` — silently treated as failed login.
**Fix**: accept any non-failure redirect. Failures = `/index.php`, `/main.php`, `/`, empty. All others attempt verification.
Verify URL: `/admin/` → `admin/tariffs.php`; `/c1/` → `c1/service_plans.php`.

### Bug 3 — Only /c1/ rate URL variants were tried
`probePortalRatesPage` never tried `/admin/tariffs.php?action=edit_rates&i_tariff=N`.
**Fix**: add admin URL variants as first candidates in `findRatesCapableSession`.

## Solved Architecture

### findRatesCapableSession (sippy.ts, after getAdminPortalSession)
Tries each credential pair **individually against the rates page** (not just portal login):
- Order: `rateAdminUser/Pass` → SIPPY_PROV env → ssp-root pairs
- Admin-portal URLs tried first: `/admin/tariffs.php?action=edit_rates&i_tariff=N`, `/admin/rates.php`
- Returns `{ cookies, ratesPageUrl, ratesBody, rateCookies, user }` for the first pair that succeeds on BOTH login AND rates-page access
- Both `probePortalRatesPage` and `pushRateViaPortalUpload` use this instead of `getAdminPortalSession`

## Working State
- Probe: `GET /api/sippy/rates/portal-probe?tariffId=33` → `ok:true, ratesPageOk:true`
- Working URL: `https://191.101.30.107/admin/tariffs.php?action=edit_rates&i_tariff=33`
- Session: ssp-root (admin acct_type) — RTST1/abcd@1234 stored as priority rate-admin fallback in settings
- `formFound:false` (ExtJS page, no `enctype=multipart/form-data` tag) — upload uses defaults: fileField=`rate_file`, POST to formAction

## Probe Endpoint
`GET /api/sippy/rates/portal-probe?tariffId=N` — returns `{ ok, loginOk, ratesPageOk, error }`.
Used by ChangeClientRateModal for proactive amber warning banner.

## Settings
`settings.sippy_rate_admin_user` / `sippy_rate_admin_pass` — stored as RTST1/abcd@1234.
All 5 `adminCreds` construction sites in `routes.ts` inject these fields.
