---
name: Sippy date format for rate activation
description: How to format activation/expiration dates for Sippy rate push — pure string manipulation, NO timezone conversion.
---

## Rule
**Never use `new Date()` for datetime-local values sent to Sippy.** Use pure string manipulation only.

## Why
HTML `datetime-local` inputs produce `"YYYY-MM-DDTHH:MM"` which is LOCAL time with no timezone marker. Passing it to `new Date()` treats it as local time, then `.toISOString()` converts to UTC. On a PKT (+5) server, `16:30 local` becomes `11:30 UTC` — the rate activates 5 hours too early with no error message.

The legacy BitsAuto system (confirmed working against the same Sippy instance) sends dates as `"YYYY-MM-DD HH:MM"` — exactly as typed, no conversion.

## Correct format
```
YYYY-MM-DD HH:MM
```
Examples: `2026-06-17 13:30`, `2026-06-17 00:00`

## How to apply
```typescript
function normDate(raw?: string): string {
  if (!raw) return '';
  const s = raw.trim().replace('T', ' ').replace(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}.*$/, '$1');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return `${raw.trim()} 00:00`;
  return '';
}
```

Applied to:
- `normaliseSippyDate()` in `setSippyRateEntry()` — for XML-RPC `activation_date`/`expiration_date` params
- `normDate()` inside `pushRateViaPortalUpload()` — for CSV `ActivationDate`/`ExpirationDate` columns

`fmtSippyDate(d: Date)` itself is correct for timestamps already in UTC (e.g. `new Date()` for "now"), just not for user-typed local times.
