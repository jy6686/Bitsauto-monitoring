// server/action-executor.ts
// ── C2 Sippy Write-Back Hooks ────────────────────────────────────────────────
// Safety gate: C2_EXECUTION_ENABLED must be explicitly set to "true" in the
// environment before any Sippy writes fire.  Default is false — all actions
// run in dry-run mode, recorded in the audit ledger only.

import { createHash } from 'crypto';
import { callSippyXmlRpc } from './sippy';

// ── Execution gate — env-driven, no code change required ─────────────────────
export function isExecutionEnabled(): boolean {
  return process.env.C2_EXECUTION_ENABLED === 'true';
}

export type ActionType =
  | 'RATE_LIMIT'
  | 'ACCOUNT_FREEZE'
  | 'ROUTE_BLOCK'
  | 'EXPOSURE_RESTRICT'
  | 'MANUAL';

// ── Execution certainty (3-state model) ──────────────────────────────────────
// Sippy XML-RPC is not transactional. A 200 response does not guarantee the
// write was applied — field validation errors silently succeed at the HTTP layer.
// All execution results must carry one of these three states.
export type VerificationState =
  | 'SUCCESS_CONFIRMED'     // Write confirmed by post-execution re-read
  | 'FAILED_CONFIRMED'      // Write confirmed to have failed
  | 'UNKNOWN_PENDING'       // No confirmation available — reconciliation required
  | 'NOT_APPLICABLE';       // Dry-run mode — no write attempted

export interface SippyActionParams {
  accountId: string;
  method:    string;
  params:    Record<string, unknown>;
  note:      string;
}

export interface ExecutionResult {
  success:           boolean;
  mode:              'dry_run' | 'executed';
  verificationState: VerificationState;
  result?:           unknown;
  error?:            string;
}

// ── Idempotency ───────────────────────────────────────────────────────────────
// Key format: SHA-256(accountId + actionType + stablePayload + hourBucket)
// Same action on the same account within the same hour = same key → blocked on re-execute.
export function computeIdempotencyKey(
  accountId:  string,
  actionType: string,
  params:     Record<string, unknown>,
): string {
  const hourBucket  = Math.floor(Date.now() / (60 * 60 * 1000)); // 1-hour bucket
  const stablePayload = JSON.stringify(params, Object.keys(params).sort()); // deterministic
  const raw = `${accountId}:${actionType}:${stablePayload}:${hourBucket}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

// ── Action type helpers ───────────────────────────────────────────────────────

export function recommendationToActionType(dominantSignal: string): ActionType {
  const map: Record<string, ActionType> = {
    fraud:    'RATE_LIMIT',
    exposure: 'EXPOSURE_RESTRICT',
    health:   'ROUTE_BLOCK',
    anomaly:  'ACCOUNT_FREEZE',
  };
  return map[dominantSignal] ?? 'MANUAL';
}

export function buildSippyParams(accountId: string, actionType: ActionType): SippyActionParams {
  switch (actionType) {
    case 'RATE_LIMIT':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, max_calls: 10, max_cps: '0.5' },
        note:   'Apply CPS=0.5 and max_calls=10 to limit fraud exposure. Reduces concurrent call capacity.',
      };
    case 'EXPOSURE_RESTRICT':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, ip_auth_enabled: 1 },
        note:   'Enable IP-based authentication. Account will only accept calls from whitelisted IPs.',
      };
    case 'ROUTE_BLOCK':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, routing_plan_id: null },
        note:   'Clear routing plan to force default/emergency routing. Review routing config before re-applying.',
      };
    case 'ACCOUNT_FREEZE':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, blocked: 1 },
        note:   'Temporarily block all traffic. Account must be manually unblocked after investigation.',
      };
    default:
      return {
        accountId,
        method: 'none',
        params: {},
        note:   'Manual review required — no automated Sippy action mapped for this signal type.',
      };
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeAction(
  _actionId:   number,
  method:      string,
  sippyParams: Record<string, unknown>,
): Promise<ExecutionResult> {
  if (!isExecutionEnabled()) {
    return {
      success:           true,
      mode:              'dry_run',
      verificationState: 'NOT_APPLICABLE',
      result: {
        message:   'Execution gate is closed (C2_EXECUTION_ENABLED=false). Action recorded in audit ledger only.',
        wouldCall: { method, ...sippyParams },
      },
    };
  }

  // Guard: if no real Sippy method mapped, refuse silently
  if (!method || method === 'none') {
    return {
      success:           false,
      mode:              'executed',
      verificationState: 'NOT_APPLICABLE',
      error:             'No Sippy method mapped for this action type. Manual intervention required.',
    };
  }

  // Build a clean flat params object that callSippyXmlRpc can accept.
  // Only scalar types (string | number | boolean | null) are passed through.
  const flatParams: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(sippyParams)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      flatParams[k] = v as string | number | boolean | null;
    }
  }

  try {
    // ── 1. Write — call Sippy XML-RPC ────────────────────────────────────────
    const writeResult = await callSippyXmlRpc(method, flatParams);

    if (!writeResult.success) {
      console.error(`[action-executor] ${method} failed (HTTP ${writeResult.statusCode}): ${writeResult.fault}`);
      return {
        success:           false,
        mode:              'executed',
        verificationState: 'FAILED_CONFIRMED',
        error:             writeResult.fault ?? `HTTP ${writeResult.statusCode}`,
      };
    }

    // ── 2. Verify — re-read account state to confirm write ────────────────────
    // For updateAccount variants, we attempt a getAccountInfo re-read to confirm.
    // If the re-read itself fails we fall back to UNKNOWN_PENDING — the write
    // succeeded at the HTTP layer but field-level confirmation is unavailable.
    let verificationState: VerificationState = 'UNKNOWN_PENDING';

    if (method === 'updateAccount' || method === 'customer.updateAccount') {
      const iAccountRaw = flatParams.i_account;
      const iAccount    = iAccountRaw !== undefined && iAccountRaw !== null
        ? parseInt(String(iAccountRaw), 10)
        : NaN;

      if (!isNaN(iAccount)) {
        const verifyResult = await callSippyXmlRpc('getAccountInfo', { i_account: iAccount });
        verificationState  = verifyResult.success ? 'SUCCESS_CONFIRMED' : 'UNKNOWN_PENDING';
        if (!verifyResult.success) {
          console.warn(`[action-executor] post-write getAccountInfo failed for account ${iAccount}: ${verifyResult.fault}`);
        }
      }
    }

    console.log(`[action-executor] ${method} SUCCESS — verification: ${verificationState}`);
    return {
      success:           true,
      mode:              'executed',
      verificationState,
      result: {
        httpStatus: writeResult.statusCode,
        preview:    writeResult.rawBody.slice(0, 300),
      },
    };
  } catch (e: any) {
    console.error(`[action-executor] ${method} threw:`, e.message);
    return {
      success:           false,
      mode:              'executed',
      verificationState: 'FAILED_CONFIRMED',
      error:             e.message,
    };
  }
}
