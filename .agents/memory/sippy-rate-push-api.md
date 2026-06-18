---
name: Sippy Rate Push API
description: How to push/update rates in a Sippy tariff — the ONLY working write path is action=change GET (individual rate edit form). Confirmed 2026-06-18.
---

## Rule
**Sippy has NO XML-RPC methods to add or update rates.**

The XML-RPC Tariff Rates API (Sippy 2025) is read-only:
- `getTariffRatesList(i_tariff, offset, limit)` — read
- `deleteAllRatesInTariff(i_tariff)` — delete all

There is no addRate, setRate, updateRate, or equivalent write method.

## CONFIRMED WORKING: action=change GET (individual rate edit)

The ONLY reliable write path is Sippy's single-rate edit form submitted as a GET request:

```
GET /c1/rates_tariff.php?action=change&i_tariff=N&i_rate=M&prefix=P&
    interval_1=1&interval_n=1&price_1=NEW&price_n=NEW&
    grace_period_enable=1&activation_date=YYYY-MM-DD+HH:MM:SS&
    filter_clause[0]=&save_and_close=Save+%26+Close
```

**Why:** This submits the same edit form the Sippy portal UI uses for inline rate editing. HTTP 200 + full rates HTML page (>5KB) = success.

**Verified test (2026-06-18):** tariff 33 prefix 19230 changed 0.0274→0.0270, confirmed in both XLSX re-download and HTML rates table, then restored.

## Failed approaches (do NOT revisit)

| Approach | Result | Reason |
|---|---|---|
| Resumable.js multipart upload | HTTP 500 | Server-side PHP temp dir crash; cannot be fixed client-side |
| Plain `action=import` POST | HTTP 200 silently ignored | Sippy only processes imports submitted via Resumable.js chunks |
| XLSX round-trip (aoa_to_sheet) | No-op import | aoa_to_sheet inflates file 3×, loses date cell styles; Sippy accepts but ignores |

## Algorithm in pushRateViaPortalUpload()

1. **Login**: `findRatesCapableSession()` (admin) or `provisioningLogin()` (prov creds)
2. **Download XLSX**: `downloadTariffXlsxFromPortal()` → find target prefix row
3. **Parse XLSX**: `parseXlsxForRateEdit()` → extract iRate + interval1/N, forbidden, gracePeriodEnable, activationDate
4. **Fallback**: if XLSX parse fails → scrape HTML rates table for `action=edit&i_rate=N` link
5. **Submit**: GET `rates_tariff.php?action=change&...&price_1=NEW&price_n=NEW`
6. **Verify**: HTTP 200 + body.length > 5KB + no login page + no `.err` class

## Excel serial → date conversion (for XLSX parse)

```typescript
function excelSerialToDateStr(serial: number): string {
  // Epoch: Dec 30, 1899 (accounts for spurious 1900 leap year bug)
  const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
// Example: 46182.550138889 → "2026-06-09 13:12:12"
```

## Portal credentials

- Login URL: `/main.php` (POST username/password/acct_type=customer)
- Username: `portal_username` from settings (ssp-root)
- Password: `admin_web_password` from settings (NOT api_admin_password)
- Rate admin (if ACL-restricted): separate `rateAdminUser/Pass` in settings

## XLSX column layout (Sippy tariff export)

```
[0] Action  [1] Id  [2] Prefix  [3] Country  [4] Interval1  [5] IntervalN
[6] Price1  [7] PriceN  [8] Forbidden  [9] GracePeriod  [10] ActivationDate  [11] ExpirationDate
```

Dates in column 10/11 are stored as Excel serial floats (raw:true mode), not strings.

## Implementation location

`server/sippy.ts`:
- `excelSerialToDateStr()` — Excel serial float → "YYYY-MM-DD HH:MM:SS"
- `parseXlsxForRateEdit()` — extract iRate + field values from tariff XLSX
- `pushRateViaPortalUpload()` — called as final fallback in `setSippyRateEntry()`
