---
name: ASR/ACD metric governance
description: Rules for NER/FAS null vs zero, dual-layer telemetry architecture, and enrichment overlay plan for the ASR/ACD report page.
---

## Core rule: absence of evidence ≠ evidence of zero

When a metric cannot be derived from the current data source, send `null` — never a fabricated zero. A zero FAS rate tells an operator "routes are clean." A null tells them "we don't know yet." These are operationally different statements.

**Why:** The portal's `/asr_acd.php` returns SQL-aggregated totals only — no per-call durations (FAS) or per-call result codes (NER). Previous code set `nerPct: r.asr` (copy of ASR as NER proxy) and `fasRate: 0` (hardcoded). Both were removed and replaced with `null`.

**How to apply:** Any time a metric is produced from an aggregated source rather than per-call records, check whether the aggregation provides the required input data. If not, emit `null`, not a fallback value.

## Dual-layer telemetry architecture

| Layer | Source | Authoritative for | Cannot provide |
|---|---|---|---|
| Layer 1 | `/asr_acd.php` (Sippy portal SQL) | Calls, ASR, ACD, Revenue, Vendor totals | FAS, true NER, per-call behavior |
| Layer 2 | CDR cache (per-call portal scrape) | FAS, NER, duration patterns, fraud heuristics | Authoritative totals (pagination ceiling ~250 CDRs) |

The two layers must be combined as **overlay** (portal totals + CDR enrichment), NOT as **either/or fallback**. Layer 1 supplies authoritative accounting; Layer 2 supplies behavioral intelligence.

## Metric provenance in the UI

- `nerPct` and `fasRate` are typed `number | null` in `ReportRow` interface.
- Column headers carry a subtle italic "derived" label to signal enrichment-only metrics.
- `!= null` guards on all rendering paths — null renders as "—", never "0.0%".
- KPI NER card shows "—" with explanation text when null, not a zeroed quality bar.
- Critical-alert row highlighting skips NER check entirely when `nerPct` is null.
- CSV export emits empty cell for null NER/FAS rather than "0.00".

## P2-C / P2-D plan (not yet implemented)

After native aggregation loads (Layer 1), run a second pass using the CDR cache window for the same time range to compute enrichment overlays (FAS, NER). Attach confidence scoring based on coverage ratio:

- >60% coverage → High confidence
- 25–60% → Medium
- <25% → Low
- <5% → Suppress overlay entirely

Enrichment must never overwrite Layer 1 totals (calls, ASR, ACD, revenue) — additive only.

## Important constraint

The CDR cache path (`/c1/cdrs_customer.php`) has a ~250-CDR window ceiling due to portal pagination limits. For large windows (e.g., 20,232 calls), a 250-CDR enrichment sample is only ~1.2% coverage — flag as low-confidence rather than silently overlaying.
