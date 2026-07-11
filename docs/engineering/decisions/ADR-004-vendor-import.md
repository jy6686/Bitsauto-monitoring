# ADR-004 — Vendor Import Pipeline

**Status:** Accepted (VR-003 open on sheet detection)
**Sources:** `[V]` §2 (verified in `server/routes-vendor-rates.ts`)

## Problem
Vendor rate sheets arrive as heterogeneous xlsx files (varying worksheet names,
column layouts, prefix formats) and must become destination-matched, queryable rate
data feeding Compare/Margin/Impact/Send Rate.

## Decision
- Two-step UX: **Preview** (choose worksheet, confirm header, map columns) → **Import**.
- Import responds immediately (`status:'processing'`) and finishes in a **background
  worker** (parsing → normalizing → matching → ready|error).
- Worksheet auto-detection = **name keyword match** (`pricing/rate/tariff/price`),
  else the first sheet; header = the most-filled row. User can override via `sheetIndex`.
- Column mapping is user-driven and saveable as a per-vendor template.

## Alternatives considered
- Strict fixed template only — **rejected** (vendors differ too much).
- Synchronous import — **rejected** (large sheets block the request).

## Consequences
- Async status lifecycle drives the wizard; failures surface as `status='error'`.
- **VR-003:** keyword detection mis-selects when no sheet is keyword-named (the
  "Terms & Conditions detected" symptom) — open product decision (smarter detection
  vs override).
- No DB audit trail for imports (console telemetry only) — flagged if durability
  is required.
- `xlsx` parses untrusted uploads — hardening pending.
