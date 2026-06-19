---
name: Sippy CDR access constraints
description: Which Sippy API paths return CDR data and which fail for this deployment.
---

## Rule
Only the Sippy customer portal (`/c1/cdrs_customer.php`) returns CDRs for this deployment. XML-RPC and Mera enrichment both return 401.

**Why:** This Sippy build restricts `getCustomerCDRs` / `getAccountCDRs` XML-RPC to admin-level accounts only, but all credentials (ssp-root, RTST1) get HTTP 401. `exportVendorsCDRs_Mera` also returns 401 ("no permissions"). Portal login with ssp-root via customer session type (302→/c1/) is the only working path.

**How to apply:**
- `refreshCdrCache` path A (XML-RPC) always returns 0; path B (portal) is the only source.
- Auth failure cache (`_cdrAuthFailCache`) skips XML-RPC retries for 300s after 401 — this is correct.
- For portal login: primary `portalUsername` (RTST1) fails; fallback `ssp-root` succeeds via `portalLogin(base, 'ssp-root', ..., 'customer')`.
- Vendor/connection: portal CDRs have no `iConnection` field — vendor gets labeled via `vendorBalanceHistory` best-effort (single active vendor = Callntalk → "Callntalk / Unknown Connection").
