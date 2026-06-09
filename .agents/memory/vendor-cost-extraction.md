---
name: Vendor Cost Extraction — Sippy P&L
description: Decision to NOT estimate vendor cost; Sippy already has it via profit_loss_report.php
---

# Vendor Cost — Do NOT Estimate

## The Rule
Never implement estimated/calculated vendor cost (Rate × Duration proxy). Sippy already knows the actual cost.

**Why:** Sippy's `profit_loss_report.php` proves it: every call row has Revenue, Cost, and Margin columns already computed. Estimating would build a shadow engine for data that already exists.

## What Sippy Has (confirmed via screenshot 9 Jun 2026)
- `/c1/profit_loss_report.php` — 1649 rows, shows: Caller, Vendor/Connection, CLI, CLD, Country, Setup Time, Selling Duration, Buying Duration, Revenue USD, Cost USD, Margin USD
- Example: PUSHTOTALK / asterisk(SKY)/asterisk(PTCL) / Pakistan Mobile → Revenue=0.0239, Cost=0.0007, Margin=0.0232

## Investigation Path (not yet done — carry forward)
Priority 0.2 is now: **find how to extract P&L data**, not invent it.

1. Check if the P&L CSV download includes Call-ID / CLI / CLD / Setup Time (needed to match governed_calls)
2. Check for XML-RPC methods: `getProfitLoss`, `getPLReport`, `getTrafficReport`
3. If no API: scrape `/c1/profit_loss_report.php` the same way CDRs are scraped via portal session

## How to Apply
- Billing Check tab in Call Governance: match by CLI+CLD±10min against P&L report instead of cdr_vendor_cost
- Deal Workspace: actual margin from P&L, not estimated
- Do NOT add any "estimate from tariff" code path — reject it if proposed
