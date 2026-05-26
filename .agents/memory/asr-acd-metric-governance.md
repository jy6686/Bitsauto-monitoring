---
name: ASR/ACD metric governance
description: Rules for NER/FAS null vs zero, dual-layer telemetry architecture, and enrichment overlay implementation for the ASR/ACD report page.
---

## Core rule: absence of evidence ≠ evidence of zero

When a metric cannot be derived from the current data source, send `null` — never a fabricated zero. A zero FAS rate tells an operator "routes are clean." A null tells them "we don't know yet." These are operationally different statements.

**Why:** The portal's `/asr_acd.php` returns SQL-aggregated totals only — no per-call durations (FAS) or per-call result codes (NER). Previous code set `nerPct: r.asr` (copy of ASR as NER proxy) and `fasRate: 0` (hardcoded). Both were removed and replaced with `null`.

**How to apply:** Any time a metric is produced from an aggregated source rather than per-call records, check whether the aggregation provides the required input data. If not, emit `null`, not a fallback value. This rule applies platform-wide: carrier scoring, fraud indicators, recommendations, automation readiness.

## Dual-layer telemetry architecture (implemented)

| Layer | Source | Authoritative for | Cannot provide |
|---|---|---|---|
| Layer 1 | `/asr_acd.php` (Sippy portal SQL) | Calls, ASR, ACD, Revenue, Vendor totals | FAS, true NER, per-call behavior |
| Layer 2 | CDR cache (per-call portal scrape) | FAS, NER, duration patterns, fraud heuristics | Authoritative totals (pagination ceiling) |

The two layers are combined as **overlay** (portal totals + CDR enrichment), NOT as either/or fallback. Layer 1 supplies authoritative accounting; Layer 2 supplies behavioral intelligence.

## P2-C/D: Enrichment overlay (implemented)

After portal aggregation loads, the server filters `cdrCache` by the query time window (`c.startTime`) and computes FAS/NER from per-call records. The overlay is applied only to `origTotal`/`termTotal` — individual rows remain null (per-row matching would be statistically unreliable at low coverage).

**Confidence scoring (P2-D):**
- ≥60% coverage → `high` (green panel)
- 25–60% → `medium` (blue panel)
- 5–25% → `low` (amber panel)
- <5% → `suppressed` (overlay not applied; "—" shown)

**Additive-only invariant:** Calls, ASR, ACD, revenue from Layer 1 are NEVER overwritten by the overlay.

**`enrichmentMeta` in API response:**
```json
{ sampleSize, nativeTotalCalls, coverageRatio, coveragePct, confidence }
```

## Metric provenance in the UI

- `nerPct` and `fasRate` typed as `number | null` in `ReportRow`.
- Column headers carry italic "derived" label.
- `!= null` guards on all rendering paths — null renders as "—".
- Enrichment info panel shown below degraded warning banner (color-coded by confidence).
- NER KPI card sub-label shows quality + confidence level + "(derived)" when overlay active.
- Critical-alert strip skips NER check entirely when `nerPct` is null.
- CSV export emits empty cell for null NER/FAS.

## Important constraint

CDR cache pagination ceiling means coverage is often low for large windows (e.g., 20,232 native calls vs ~4,000 cache records = ~20% → low confidence). Confidence scoring correctly reflects this. XML-RPC CDRs (getAccountCDRs) can supplement the cache when available.
