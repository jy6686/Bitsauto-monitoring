---
name: Vendor Cost Extraction — Sippy P&L
description: Decision to NOT estimate vendor cost; Sippy already has it via profit_loss_report.php; CSV export schema confirmed
---

# Vendor Cost — Do NOT Estimate

## The Rule
Never implement estimated/calculated vendor cost (Rate × Duration proxy). Sippy already knows the actual cost.

**Why:** Sippy's `profit_loss_report.php` and its CSV/XLSX export already contain Revenue, Cost, and Margin per call — calculated by Sippy itself. Building a shadow costing engine would duplicate real data and introduce drift.

## Confirmed Export Schema (9 Jun 2026 — 4,347 rows)
Downloaded from the "Download" button on `/c1/profit_loss_report.php`. Columns confirmed:

| Column | Notes |
|---|---|
| Caller | Sippy account name |
| Vendor Name | Vendor identity |
| Connection Name | Specific vendor connection |
| CLI | Originating number |
| CLD | Destination number |
| Country | Country resolved by Sippy |
| Description | Destination description |
| Setup Time | Call timestamp — **match key** |
| Selling Duration | Customer-facing duration (mm:ss) |
| Selling Billed Duration | Customer-billed duration |
| Buying Duration | Vendor-facing duration |
| Buying Billed Duration | Vendor-billed duration |
| Revenue | Customer revenue in USD |
| Cost | Vendor cost in USD |
| Margin | Revenue − Cost (can be negative) |
| Currency | USD or configured currency |

**Match key for correlation with governed_calls:** `CLI + CLD + Setup Time` (appears to uniquely identify a call).

## Example Rows
- PUSHTOTALK / asterisk(SKY)/asterisk(PTCL) / Pakistan Mobile → Revenue=0.0239, Cost=0.0007, Margin=0.0232
- Loss-making calls also present: Revenue=0, Cost=0.000017, Margin=-0.000017

## Priority 0.2 Roadmap (carry forward — nothing built yet)

**Step 1 (highest):** Automate the Download. The report is generated via portal session — replicate the same HTTP request (with date params + format=csv/xlsx) as the portal scraper does for CDRs. Endpoint is likely a POST to `profit_loss_report.php` with `start_date`, `end_date`, `action=download` params.

**Step 2:** Confirm CLI+CLD+Setup Time uniqueness across a full day export. If any collisions exist, add Selling Duration as a tiebreaker.

**Step 3:** Build a P&L cache/feed in the backend (like cdrCache) and expose it as `/api/sippy/pnl` with the same date-window params the portal uses.

**Step 4:** Wire Billing Check tab in Call Governance to match governed_calls against the P&L feed → show Revenue, Cost, Margin inline.

**Step 5:** Wire Deal Workspace margin intelligence to the same P&L feed.

## What to Check for XML-RPC (lower priority than scrape path)
Methods to probe: `getProfitLoss`, `getPLReport`, `getTrafficReport`. If they exist, prefer XML-RPC over portal scrape for reliability.

## How to Apply in Code
- Billing Check tab: match by CLI+CLD+Setup Time (±seconds) against P&L, not cdr_vendor_cost
- Deal Workspace: actual Margin from P&L, not estimated from tariff
- NEVER add any "estimate from tariff × duration" code path — reject it if proposed in any future session
