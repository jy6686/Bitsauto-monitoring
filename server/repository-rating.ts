/**
 * repository-rating.ts — rate what the repository already holds.
 *
 * WHY THIS EXISTS. Production, 2026-09-07, asterisk #315 for 2 September:
 *
 *   repository   2,941 calls   559.8 min   $13.29
 *   verified       635 calls   147.0 min   $ 3.72
 *   snapshotted      0 calls     0.0 min   $ 0.00
 *
 * The nightly job fetched all 48 slices, wrote every CDR to raw_sippy_cdrs,
 * was marked `done` — and then died 635 calls into verification. Snapshots
 * are what invoices are built from, so the day produced nothing, and the only
 * way the seed knows to rate a call is from the in-memory array it just
 * fetched. Recovering meant fetching all 48 slices from Sippy again, during
 * business hours, on a four-attempt credential path.
 *
 * This is the same failure class as the collector's slice timing a week ago,
 * one stage further down: progress that lives only in memory, so a death
 * loses everything after it. The fix is the same shape. The repository is
 * durable and complete; rate from it.
 *
 * This module is the PURE part: turning a stored row into the exact input
 * the rating engine already consumes. It is deliberately the same mapping
 * the fetch path applies to a live CDR (routes.ts, "Batch dedup"), so a call
 * rated from the repository is rated identically to one rated on arrival.
 * Anything the row cannot supply is REPORTED, never defaulted into a zero
 * that would price the call as free.
 */

import type { CdrVerificationInput } from './services/sippy/sippy-rating-verification.service';

/** The columns this path reads. Everything else on the row is ignored. */
export interface RepositoryCdrRow {
  i_cdr:       string | null;
  cdr_call_id: string | null;
  callee:      string | null;
  started_at:  Date | string | null;
  billed_secs: number | string | null;
  cost:        number | string | null;
  /** The switch's own record, kept verbatim at ingestion. Fallback source. */
  payload:     Record<string, unknown> | null;
}

export type UnusableReason = 'no-identity' | 'no-callee' | 'no-start';

export interface MappedRow {
  input:  CdrVerificationInput | null;
  reason: UnusableReason | null;
  /** True when cost was absent and had to be read as 0. Counted, not hidden. */
  costMissing: boolean;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Read a payload field by any of several names the switch has used. */
function fromPayload(p: Record<string, unknown> | null, keys: string[]): string {
  if (!p) return '';
  for (const k of keys) {
    const v = p[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function toIso(v: Date | string | null): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * One stored row → one rating-engine input.
 *
 * Identity is the switch's call id first, falling back to i_cdr — the same
 * precedence the fetch path uses, so dedup against existing snapshots agrees
 * across both paths. The dialled number is required: without it no rate can
 * be matched, and pricing a call against an empty prefix would silently pick
 * whatever sorts first.
 */
export function repositoryRowToVerification(row: RepositoryCdrRow, iTariff: string): MappedRow {
  const callId = str(row.cdr_call_id) || str(row.i_cdr) || fromPayload(row.payload, ['callId', 'i_cdr', 'call_id']);
  if (!callId) return { input: null, reason: 'no-identity', costMissing: false };

  const callee = str(row.callee) || fromPayload(row.payload, ['callee', 'cld', 'CLD']);
  if (!callee) return { input: null, reason: 'no-callee', costMissing: false };

  const startTime = toIso(row.started_at)
    || toIso(fromPayload(row.payload, ['startTime', 'connectTime', 'connect_time']) || null);
  if (!startTime) return { input: null, reason: 'no-start', costMissing: false };

  const durationSecs = Number(row.billed_secs ?? fromPayload(row.payload, ['billedDuration', 'duration']) ?? 0) || 0;

  const costRaw = row.cost ?? (fromPayload(row.payload, ['cost', 'price1', 'charged_amount']) || null);
  const costMissing = costRaw == null || costRaw === '';
  const sippyActualCost = costMissing ? 0 : (Number(costRaw) || 0);

  return {
    input: { callId, startTime, callee, durationSecs, sippyActualCost, iTariff },
    reason: null,
    costMissing,
  };
}

export interface MappingSummary {
  rows: number;
  usable: number;
  unusable: Record<UnusableReason, number>;
  costMissing: number;
  inputs: CdrVerificationInput[];
}

/** Map a whole period's rows and account for every one of them. */
export function mapRepositoryRows(rows: readonly RepositoryCdrRow[], iTariff: string): MappingSummary {
  const unusable: Record<UnusableReason, number> = { 'no-identity': 0, 'no-callee': 0, 'no-start': 0 };
  const inputs: CdrVerificationInput[] = [];
  let costMissing = 0;
  for (const row of rows) {
    const m = repositoryRowToVerification(row, iTariff);
    if (m.costMissing) costMissing++;
    if (m.input) inputs.push(m.input);
    else if (m.reason) unusable[m.reason]++;
  }
  return { rows: rows.length, usable: inputs.length, unusable, costMissing, inputs };
}
