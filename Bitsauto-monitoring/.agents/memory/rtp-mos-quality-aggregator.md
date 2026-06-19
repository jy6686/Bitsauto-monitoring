---
name: RTP MOS Quality Aggregator
description: Durable architectural rules for the per-vendor/prefix MOS quality engine fed from Sippy CDRs.
---

## Initialization rule
`initRtpQualityAggregator()` must be called after the CDR cache is warm, registered via `setRtpCdrProvider()` from routes.ts. Same pattern as carrier-scoring-engine.

## VQ field name bridging
`SippyCDR` uses camelCase (`iVqTermMos`, `iVqOrigMos`, `jitter`, `pktLoss`). The aggregator's internal `RtpCdrRecord` type uses snake_case (`i_vq_term_mos`, `i_vq_orig_mos`, `jitter`, `pkt_loss`). The provider lambda in routes.ts bridges them with camelCase-first, any-cast snake_case fallback.

**Why:** `SippyCDR` follows TypeScript camelCase conventions; the aggregator's internal type mirrors Sippy XML-RPC field names for clarity. Both must be tried to support fresh XML-RPC CDRs and legacy portal-scraped entries.

## Stale row expiry
After each `aggregateWindow()` upsert loop, a `DELETE WHERE window_minutes = $w AND computed_at < $runStart` purges rows not touched in this run (vendors/prefixes that lost traffic). Read paths also apply a 15-min recency filter (`ROW_MAX_AGE_MS`) so stale DB rows don't generate false alerts between aggregation cycles.

**Why:** Without this, old vendor/prefix rows persist and trigger false MOS_CRITICAL Fix Button alerts and misleading Copilot context after traffic shifts.

## MOS thresholds (ITU-T E.Model)
- `≥ 3.5` — good (green)
- `3.0–3.5` — degraded (amber)
- `< 3.0` — critical (red, Fix Button MOS_CRITICAL issue)

## VQ availability
VQ fields (`i_vq_term_mos`, `i_vq_orig_mos`) are only populated when Sippy VQ reporting is enabled on the switch. When absent, aggregator produces no MOS rows; the UI shows an empty-state "enable VQ reporting" guide. Fix Button shows a warning (not an error) when no data is present.

## Fix Button / AI Copilot integration
- Fix Button reads via `getRtpQualitySummary()` which has the recency filter built in.
- Copilot prompt uses `buildVoiceQualityDigest()` (1h vendor-level window only, also recency-filtered).
- Fix Button suppresses MOS alerts when AI Copilot issued a routing recommendation in the last 30 min (checked via `routingSuggestions` table).
