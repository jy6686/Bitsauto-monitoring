/**
 * finance-contracts.ts — the shapes the Finance dashboards actually receive.
 *
 * WHY THIS FILE EXISTS. Three separate field-name mismatches shipped on the
 * Finance Cockpit alone, and every one rendered as a business fact rather than
 * an error:
 *
 *   read                              endpoint returns
 *   snapSummary.totalRevenue          totalSell        → "Current Billing $0"
 *   dispute.amount                    discrepancy      → "no open disputes"
 *   alert.marginDeltaUsd              amountUsd        → "no active alerts"
 *   alert.resolvedAt                  acknowledgedAt   → every alert active
 *
 * In JavaScript a missing field is `undefined`, `?? 0` makes it zero, and zero
 * renders as money. Nothing throws, nothing logs, and the dashboard states a
 * number that was never computed. With `useQuery<any>` the type system cannot
 * see any of it — which is how the same defect recurred three times on one
 * page, twice after being fixed and documented in a comment directly above.
 *
 * EVERY FIELD BELOW WAS READ FROM THE LIVE API, not from the schema and not
 * from the code that produces it. A contract copied from the writer describes
 * what the writer INTENDS; only the response describes what the reader GETS,
 * and the gap between those two is exactly this bug class. Where a field was
 * not present in the observed response it is absent here, even if the table
 * has a column for it.
 *
 * Verified 2026-09-02 against vo-ip-watcher--junaid70.replit.app.
 */

/** GET /api/finance/snapshot/summary */
export interface SnapshotSummary {
  latestDate:     string;
  /** Revenue. NOT `totalRevenue`, NOT `revenue` — both were read for months. */
  totalSell:      number;
  totalBuy:       number;
  totalMargin:    number;
  /** Fraction, not a percentage: -0.1613 is -16.13%. */
  marginPercent:  number;
  totalCalls:     number;
  clientCount:    number;
  vendorCount:    number;
  lastRunId:      number;
  lastRunAt:      string;
  lastRunStatus:  string;
}

/** GET /api/margin/alerts — bare array. */
export interface MarginAlert {
  id:             number;
  alertType:      'negative_margin' | 'threshold_breach' | 'margin_drop' | 'vendor_cost_spike' | string;
  dimensionType:  'aggregate' | 'client' | 'vendor' | string;
  dimensionName:  string;
  date:           string;
  thresholdPct:   number | null;
  actualPct:      number | null;
  deltaPct:       number | null;
  /** The money. NOT `amount`, NOT `marginDeltaUsd`. */
  amountUsd:      number | null;
  severity:       'critical' | 'high' | 'medium' | 'low' | string;
  message:        string;
  /** Acknowledgement, NOT resolution — there is no `resolvedAt`. */
  acknowledged:   boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  triggeredAt:    string;
}

/** GET /api/disputes — bare array. A dispute is vendor-side. */
export interface VendorDispute {
  id:           number;
  vendorName:   string;
  periodStart:  string;
  periodEnd:    string;
  ourAmount:    number | null;
  vendorAmount: number | null;
  /** The gap. There is no `amount` field on a dispute. */
  discrepancy:  number | null;
  currency:     string | null;
  status:       'open' | 'escalated' | 'resolved' | string;
  resolution:   string | null;
  notes:        string | null;
  createdAt:    string;
  updatedAt:    string;
}

/**
 * GET /api/invoices — bare array.
 *
 * The two money columns are the reason the register warns about them:
 * `totalReproduced` is BitsAuto's own rating, `totalActual` is the switch's
 * charge, and the customer is billed `totalActual`. A KPI that sums the wrong
 * one is not a rounding difference — on invoice C-2608-0007 they were $16.52
 * and $0.28.
 */
export interface InvoiceRow {
  id:              number;
  invoiceNumber:   string;
  customerName:    string | null;
  periodStart:     string;
  periodEnd:       string;
  status:          'draft' | 'generated' | 'review' | 'approved' | 'sent' | 'paid' | 'void' | 'cancelled' | 'overdue' | string;
  totalReproduced: number | null;
  totalActual:     number | null;
  dueDate:         string | null;
  createdAt:       string | null;
  issueDate:       string | null;
}

/**
 * Bare-array responses are the OTHER half of this defect class: /api/invoices,
 * /api/disputes and /api/margin/alerts all return arrays, while several
 * consumers reached for `.invoices` / `.data` first and silently got []. Use
 * this rather than re-deriving the fallback chain at each call site.
 */
export function asList<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (key && Array.isArray(o[key])) return o[key] as T[];
    if (Array.isArray(o.data)) return o.data as T[];
  }
  return [];
}
