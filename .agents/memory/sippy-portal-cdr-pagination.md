---
name: Sippy portal CDR pagination
description: How to paginate CDRs from the Sippy customer portal without infinite loops or repeated logins.
---

## Rule
Use `sippy.scrapePortalCDRsAll()` for any paginated CDR fetch from the customer portal. Never loop over `scrapePortalCDRs()` — each call does a full portal login, making N-page fetches take N × login_time.

**Why:** The Sippy customer portal caps each response at 50 rows regardless of the `limit=` param. The `n=` offset parameter works, but on a live system new calls complete during scraping, causing later pages to partially overlap earlier ones. Repeated logins are extremely slow (400–600s for 200 pages vs ~15s with session reuse).

**How to apply:**
- `scrapePortalCDRsAll` logs in once, then paginates using the same session cookies.
- Dedup fingerprint: `${startTime}:${caller}:${callee}` — tracks new-vs-duplicate per page.
- Stop conditions: `pageCdrs.length === 0` OR `newOnPage === 0` (portal ignoring offset). No early-exit on low new-count — on a live system calls complete between pages and occasional low-new pages are normal. Let it run until genuinely `new=0`.
- No fixed date window on the background scrape — Sippy portal default is used. User selects their own time range in the report UI.
- Result: 690 CDRs across 32 pages per cycle vs the old 50. Cycle time ~104s (login once + 32 pages).

## Background
The portal at `/c1/cdrs_customer.php` uses a Sippy session. RTST1 credentials fail portal login (redirect loop); ssp-root succeeds via 302→/c1/. Primary credentials always try first, ssp-root fallback kicks in automatically.
