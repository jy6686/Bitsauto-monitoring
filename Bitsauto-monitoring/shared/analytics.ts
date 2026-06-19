import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Contract v1
//
// Single source of truth for the /api/analytics/dashboard contract.
// Both server (routes.ts) and client (bitseye.tsx) import from here.
// No interface may be defined in either layer — only imported.
// ─────────────────────────────────────────────────────────────────────────────

// ── Layer 1: Filter Contract ──────────────────────────────────────────────────

export const ANALYTICS_WINDOWS = ['1h', '6h', '24h', '7d', '30d', '90d'] as const;
export type  AnalyticsWindow   = typeof ANALYTICS_WINDOWS[number];

export const analyticsWindowMs: Record<AnalyticsWindow, number> = {
  '1h':  1  * 3_600_000,
  '6h':  6  * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d':  7  * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
};

export const ANALYTICS_GRANULARITIES = ['hourly', '6h', 'daily'] as const;
export type  AnalyticsGranularity    = typeof ANALYTICS_GRANULARITIES[number];

// Granularity is always derived server-side from window — never sent by client
export function windowToGranularity(windowMs: number): AnalyticsGranularity {
  if (windowMs <= 86_400_000)     return 'hourly';
  if (windowMs <= 7 * 86_400_000) return '6h';
  return 'daily';
}

export const analyticsFilterSchema = z.object({
  c_company_name: z.string().default(''),
  v_company_name: z.string().default(''),
  country:        z.string().default(''),
  // switch_name: single-switch system — no-op, reserved
  // gb_external_description: not in CDR cache — reserved Phase 2
});
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;

export const analyticsDashboardRequestSchema = z.object({
  version: z.literal('v1'),
  filters: analyticsFilterSchema,
  time: z.object({
    window: z.enum(ANALYTICS_WINDOWS),
  }),
});
export type AnalyticsDashboardRequest = z.infer<typeof analyticsDashboardRequestSchema>;

// ── Layer 2: KPI Schema ───────────────────────────────────────────────────────

export const analyticsKpisSchema = z.object({
  totalCalls:    z.number().int().nonnegative(),
  answeredCalls: z.number().int().nonnegative(),
  asr:           z.number().nonnegative(),        // 0–100 %
  acd:           z.number().nonnegative(),        // seconds
  pdd:           z.number().nonnegative(),        // seconds
  mos:           z.number().nullable(),           // null when no answered calls
  mosGrade:      z.string().nullable(),           // null when mos is null
  ner:           z.number().nullable(),           // null when totalCalls === 0
  totalMinutes:  z.number().nonnegative(),
  totalCost:     z.number().nonnegative(),
});
export type AnalyticsKpis = z.infer<typeof analyticsKpisSchema>;

export const analyticsDispositionSchema = z.object({
  answered:    z.number().int().nonnegative(),
  failed:      z.number().int().nonnegative(),
  rna:         z.number().int().nonnegative(),
  networkFail: z.number().int().nonnegative(),
  otherFailed: z.number().int().nonnegative(),
});
export type AnalyticsDisposition = z.infer<typeof analyticsDispositionSchema>;

// ── Layer 3: Response Schema (Dashboard) ──────────────────────────────────────

export const analyticsTimeBucketSchema = z.object({
  bucket:   z.string(),    // ISO timestamp — bucket start
  calls:    z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  asr:      z.number().nonnegative(),
  minutes:  z.number().nonnegative(),
  cost:     z.number().nonnegative(),
});
export type AnalyticsTimeBucket = z.infer<typeof analyticsTimeBucketSchema>;

export const analyticsVendorRowSchema = z.object({
  vendor:   z.string(),
  calls:    z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  asr:      z.number().nonnegative(),
  minutes:  z.number().nonnegative(),
  cost:     z.number().nonnegative(),
});
export type AnalyticsVendorRow = z.infer<typeof analyticsVendorRowSchema>;

export const analyticsClientRowSchema = z.object({
  client:   z.string(),
  calls:    z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  asr:      z.number().nonnegative(),
  minutes:  z.number().nonnegative(),
  cost:     z.number().nonnegative(),
});
export type AnalyticsClientRow = z.infer<typeof analyticsClientRowSchema>;

export const analyticsDestRowSchema = z.object({
  country:  z.string(),
  calls:    z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  asr:      z.number().nonnegative(),
  minutes:  z.number().nonnegative(),
  pct:      z.number().nonnegative(),
});
export type AnalyticsDestRow = z.infer<typeof analyticsDestRowSchema>;

export const analyticsMetaSchema = z.object({
  version:        z.literal('v1'),
  window:         z.enum(ANALYTICS_WINDOWS),
  granularity:    z.enum(ANALYTICS_GRANULARITIES),
  cdrCount:       z.number().int().nonnegative(),
  cacheSize:      z.number().int().nonnegative(),
  updatedAt:      z.string().nullable(),
  filtersApplied: z.object({
    c_company_name: z.string().nullable(),
    v_company_name: z.string().nullable(),
    country:        z.string().nullable(),
  }),
});
export type AnalyticsMeta = z.infer<typeof analyticsMetaSchema>;

export const analyticsDashboardResponseSchema = z.object({
  kpis:            analyticsKpisSchema,
  timeSeries:      z.array(analyticsTimeBucketSchema),
  topVendors:      z.array(analyticsVendorRowSchema),
  topClients:      z.array(analyticsClientRowSchema),
  topDestinations: z.array(analyticsDestRowSchema),
  breakout:        analyticsDispositionSchema,
  meta:            analyticsMetaSchema,
});
export type AnalyticsDashboardResponse = z.infer<typeof analyticsDashboardResponseSchema>;
