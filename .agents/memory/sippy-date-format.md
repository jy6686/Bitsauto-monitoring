---
name: Sippy date format for rate activation
description: How to format activation/expiration dates for Sippy rate push — pure string manipulation, NO timezone conversion. normSippyDate() is the canonical helper.
---

## Rule
**NEVER use `new Date()` or `.toISOString()` for datetime-local inputs going to Sippy rate push.**

Sippy treats `ActivationDate`/`ExpirationDate` in CSV as wall-clock time (no timezone).
Any UTC conversion silently shifts the rate effective time by the server's UTC offset.

## Canonical helper: `normSippyDate(raw?: string | Date): string`
Defined in `server/sippy.ts` (just above `pushRateToSippy`).

- `undefined` → current local wall-clock time (`YYYY-MM-DD HH:MM:00`)
- `string` → pure `T`→space replace + clip millis/Z (no Date(), no UTC)
- `Date` → use local time components (`.getFullYear()` etc., not `.toISOString()`)

Used by `pushRateToSippy` for `effectiveFrom`/`effectiveTo`.
The `pushRateViaPortalUpload` CSV builder uses its own inline `normDate(raw)` — same principle.

## Client-side rules
- Default value for datetime-local inputs: build string from `new Date()` local components
  (`getFullYear`, `getMonth`, `getDate`, `getHours`, `getMinutes`) — NOT `.toISOString()`
- Send datetime-local value as raw string to server — no `new Date(val).toISOString()` conversion

## What NOT to fix
- DB timestamp columns (`rateEffectiveFrom`, tariff snapshot `effectiveFrom`) — these are
  real UTC timestamps from PostgreSQL; `new Date()` on them is correct.

## Why
A server/browser in UTC+5 would shift "17:30" → "12:30" through toISOString(),
resulting in rates activating 5 hours earlier than intended with no visible error.
