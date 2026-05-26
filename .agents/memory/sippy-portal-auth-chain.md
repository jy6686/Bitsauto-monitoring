---
name: Sippy portal auth chain for /asr_acd.php
description: Why the ASR/ACD report fell back to CDR cache and how the credential chain was fixed to restore native Sippy aggregation
---

## The rule
`getSippyPerAccountStats` (which POSTs to `/asr_acd.php` for full aggregation) requires the **portal web login password** for ssp-root, not the XML-RPC API password. These are stored separately in Settings as `admin_web_password` vs `api_admin_password`.

**Why:** ssp-root's XML-RPC password and portal web login password differ on this Sippy deployment. The original credential chain passed only `api_admin_password`, which was rejected by the portal login form. The negative-auth cache then blocked all retries for 5 minutes, making every report fall back to the CDR list HTML scrape (~250 CDRs vs 20,232 actual).

**How to apply:** When `getSippyPerAccountStats` fails portal login, check whether `admin_web_password` is the missing piece. The fix: set `portal_username = 'ssp-root'` and `portal_password = admin_web_password` in the Settings table. `getAdminPortalSession` now receives `adminWebPassword` as a parameter and tries `ssp-root + adminWebPassword` as a credential pair, which succeeds (ssp-root/customer login via 302→/c1/).

## CDR list page vs /asr_acd.php — structural difference
- `/c1/cdrs_customer.php` (CDR list page): paginated HTML table, ~50 rows/page, max ~250 unique CDRs for a time window — **browsing layer, not reporting layer**
- `/asr_acd.php` (ASR/ACD report): direct SQL COUNT/SUM/GROUP BY across full CDR database — **same source as Sippy native report**

Falling back to the CDR list page produces ~1.2% of actual traffic. The fallback must always be treated as degraded/incomplete.

## Credential chain order (after fix)
1. `ssp-root + api_admin_password` (admin/reseller/customer types)
2. `ssp-root + admin_web_password` ← **this one succeeds**
3. `RTST1 + portal_password` (fails — RTST1 rejected by portal login)
4. SIPPY_PROV_USERNAME/PASSWORD env vars (tertiary fallback, bypasses neg-cache)

## Degradation visibility
When the primary path fails, the response now includes `degraded: true` and the frontend shows an amber warning banner. The banner disappears automatically when auth succeeds. This prevents fallback data from silently appearing authoritative.

## Validation result
After fix: `source: sippy-portal`, `cdrCount: 20232`, `vendor: Callntalk/CallnTalk-PR-PR` — exact parity with Sippy native report for the same 8:30–09:30 window.
