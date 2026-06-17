---
name: Sippy Rate Push API
description: How to push/update rates in a Sippy tariff — XML-RPC has NO write methods, portal CSV upload is the only way.
---

## Rule
**Sippy has NO XML-RPC methods to add or update rates.**

The XML-RPC Tariff's Rates Management API (as of Sippy 2025) only exposes:
- `getTariffRatesList(i_tariff, offset, limit)` — read (since Sippy 2022)
- `deleteAllRatesInTariff(i_tariff)` — delete all (since Sippy 2024)

There is no addRate, setRate, updateRate, insertRate, or any equivalent write method.

**Why:** Sippy's design is that rates are managed via portal UI or CSV file upload. XML-RPC is read-only for rates.

## How to apply
The only valid approach is portal CSV upload via multipart/form-data POST:
1. Login via provisioningLogin() (SIPPY_PROV_USERNAME/PASSWORD)
2. GET /c1/rates.php?i_tariff={id} — extract hidden form fields (CSRF tokens), file input name, form action URL
3. Build CSV with Sippy's format (see below)
4. POST as multipart/form-data to the form action URL with updated session cookies (getResp.cookies not login cookies)

## CSV format
```
Action,i_rate,Prefix,Price1,PriceN,Interval1,IntervalN,ForbiddenFlag,GracePeriodEnable,ActivationDate,ExpirationDate
AS,,192,0.0345,0.0345,1,1,,,2026-06-17 15:00:00,
```

Actions:
- A  = add new rate (fails if prefix exists)
- D  = delete by i_rate id
- U  = update by i_rate id
- S  = update by prefix (fails if not found)
- AS = add-or-update by prefix ← USE THIS for "Change Client Rates"

Dates: "YYYY-MM-DD HH:MM:SS" UTC (same as fmtSippyDate output).
Empty ActivationDate = active immediately. Empty ExpirationDate = never expires.

## Portal upload endpoint
Scraped from the rates page: look for a <form enctype="multipart/form-data"> on /c1/rates.php?i_tariff={id}
File input field name is dynamic — scrape from <input type="file">.
Hidden fields include CSRF tokens — scrape from the same form.

## Implementation location
server/sippy.ts: pushRateViaPortalUpload() called as final fallback in setSippyRateEntry() after all XML-RPC method probes fail.
