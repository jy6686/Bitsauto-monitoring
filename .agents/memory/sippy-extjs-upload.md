---
name: Sippy rate upload — confirmed working approach
description: Exact upload mechanics proven by manual browser test on 2026-06-18
---

## Rule
Full-tariff upload with Action=U + existing i_rate ID is the ONLY reliable approach.

**Why:**
Manual test on 2026-06-18 (tariff #33, prefix 19230) confirmed:
- Action=A → Sippy silently ignores the row for existing prefixes
- Action=U + existing i_rate ID → works perfectly
- Single-row upload → risk of wiping other rows (Sippy REPLACE mode)
- /c1/rates_tariff.php?i_tariff=N → correct upload URL (ExtJS page, no static <input type="file">)
- Field name: rate_file (default, Sippy accepts it)

**How to apply:**
1. Fetch all current rates via getTariffRatesListFull() (XML-RPC)
2. Build XLSX with ALL rows: Action=U + existing iRate for every row
3. Only the target prefix gets new price/dates; unchanged rows get same values
4. New prefix (not found in current rates): Action=A, no ID
5. POST to /c1/rates_tariff.php?i_tariff=N with field name rate_file
6. Include i_tariff=N as explicit multipart form field (may be required in body)
7. Session: ssp-root/customer login path (302→/c1/) — works
8. The page is ExtJS — no static file input in HTML, proceed anyway

Column order (confirmed from Sippy's own downloaded XLSX):
  Action [A|D|U|S|SA] | Id | Prefix | Country | Interval 1 | Interval N | Price 1 | Price N | Forbidden | Grace Period | Activation Date | Expiration Date
