/**
 * group-readback.ts
 *
 * One upload, N verdicts — the preservation rule, in code.
 *
 * A group is a transport optimisation. The audit and reconciliation granularity stays per prefix:
 * five rows uploaded together and read back as four confirmed and one mismatch are five results,
 * four `success` and one `failure`. Nothing here ever returns fewer results than rows.
 *
 * The BOUNDARY, by contrast, belongs to the upload. Either the file left this process or it did
 * not, and every row in it shares that fact:
 *
 *   token_failed          nothing was sent            → every row failure, refusedBeforeWrite TRUE
 *   upload_rejected       the file WAS sent           → every row indeterminate
 *   readback_unavailable  sent, tariff could not be read → every row indeterminate
 *   readback              sent, tariff read           → each row judged on its own from the ONE read
 *
 * A prefix missing from a read-back is a mismatch only when the read was COMPLETE. The list call
 * is capped; on a tariff at the cap "not in the list" means "not seen", and calling that a failure
 * would license a retry of a write that may have landed.
 *
 * Pure: the phase is data, the verdicts are data. The Sippy client assembles the phase; this
 * decides nothing about transport.
 */
import { selectVerificationRow } from '../../sippy';
import type { PushPrimitiveResult } from './verdict';

export interface GroupRow {
  operationKey: string;
  prefix: string;
  rate: number;
  /** "YYYY-MM-DD HH:MM:SS" or absent — selects which read-back row is judged (see selectVerificationRow). */
  effectiveFrom?: string;
}

export interface ReadbackRate { prefix: string; rate: number; effectiveFrom?: string }

export type GroupPhase =
  | { kind: 'token_failed'; message: string }
  | { kind: 'upload_rejected'; message: string; uploadToken: string }
  | { kind: 'readback_unavailable'; message: string; uploadToken: string; uploadStatus: string }
  | { kind: 'readback'; rates: ReadbackRate[]; complete: boolean; uploadToken: string; uploadStatus: string };

/** The primitive's result plus the upload facts the job row records. */
export interface GroupPushResult extends PushPrimitiveResult {
  operationKey: string;
  uploadToken?: string;
  uploadStatus?: string;
}

const RATE_TOLERANCE = 0.000001;

export function groupVerdicts(rows: ReadonlyArray<GroupRow>, phase: GroupPhase, trace?: string[]): GroupPushResult[] {
  const carried = { method: 'upload_token' as const, trace };

  switch (phase.kind) {
    case 'token_failed':
      return rows.map(r => ({
        operationKey: r.operationKey, success: false, verificationResult: 'skip', refusedBeforeWrite: true, ...carried,
        message: `getUploadToken failed before anything was sent (${phase.message}); tariff unchanged for ${r.prefix}.`,
      }));

    case 'upload_rejected':
      return rows.map(r => ({
        operationKey: r.operationKey, success: false, verificationResult: 'skip', refusedBeforeWrite: false, ...carried,
        uploadToken: phase.uploadToken,
        message: `The workbook was SENT and the far end rejected it (${phase.message}) — a rejection is not proof it was discarded, so what the tariff holds for ${r.prefix} is UNKNOWN.`,
      }));

    case 'readback_unavailable':
      return rows.map(r => ({
        operationKey: r.operationKey, success: false, verificationResult: 'skip', refusedBeforeWrite: false, ...carried,
        uploadToken: phase.uploadToken, uploadStatus: phase.uploadStatus,
        message: `Upload status ${phase.uploadStatus}, but the tariff could not be read back (${phase.message}) — what it holds for ${r.prefix} is UNKNOWN.`,
      }));

    case 'readback': {
      const size = `tariff holds ${phase.rates.length} rate(s)${phase.complete ? '' : ' — list CAPPED, read is partial'}`;
      return rows.map(r => {
        const { row: match, reason } = selectVerificationRow(phase.rates, r.prefix, r.effectiveFrom);
        const base = { operationKey: r.operationKey, uploadToken: phase.uploadToken, uploadStatus: phase.uploadStatus, ...carried };
        if (!match) {
          if (!phase.complete) {
            return { ...base, success: false, verificationResult: 'skip', refusedBeforeWrite: false,
              message: `Upload status ${phase.uploadStatus}; ${r.prefix} not seen in a PARTIAL read-back (${size}) — cannot tell absent from unseen, outcome UNKNOWN.` };
          }
          return { ...base, success: false, verificationResult: 'mismatch', refusedBeforeWrite: false,
            message: `Upload status ${phase.uploadStatus}; ${r.prefix} not found after the upload (${size}) — nothing was applied for this row.` };
        }
        const ok = Math.abs(match.rate - r.rate) < RATE_TOLERANCE;
        const when = match.effectiveFrom ? ` activation=${match.effectiveFrom}` : '';
        return ok
          ? { ...base, success: true, verificationResult: 'confirmed', refusedBeforeWrite: false,
              message: `Upload status ${phase.uploadStatus}; verified ${r.prefix} rate=${match.rate}${when} (${reason}; ${size}).` }
          : { ...base, success: false, verificationResult: 'mismatch', refusedBeforeWrite: false,
              message: `Upload status ${phase.uploadStatus}; ${r.prefix} found=${match.rate}${when} expected=${r.rate} (${reason}; ${size}).` };
      });
    }
  }
}
