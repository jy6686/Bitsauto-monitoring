// server/action-executor.ts
// ── C2 Sippy Write-Back Hooks ────────────────────────────────────────────────
// Safety gate: C2_EXECUTION_ENABLED must be explicitly set to true before any
// Sippy writes fire.  Default is false — all actions run in dry-run mode.

import { createHash } from 'crypto';

const C2_EXECUTION_ENABLED = false;

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
  _actionId:    number,
  _sippyParams: Record<string, unknown>,
): Promise<ExecutionResult> {
  if (!C2_EXECUTION_ENABLED) {
    return {
      success:           true,
      mode:              'dry_run',
      verificationState: 'NOT_APPLICABLE',
      result: {
        message:   'Execution gate is closed (C2_EXECUTION_ENABLED=false). Action recorded in audit ledger only.',
        wouldCall: _sippyParams,
      },
    };
  }

  // Live execution path — only reached when C2_EXECUTION_ENABLED=true
  // All live executions start as UNKNOWN_PENDING until verified by reconciliation.
  try {
    // TODO: wire to sippyXmlRpc(method, params) here, then verify by re-reading state
    return {
      success:           false,
      mode:              'executed',
      verificationState: 'UNKNOWN_PENDING',
      error:   'Live Sippy write-back not yet wired. Configure the XML-RPC handler first.',
    };
  } catch (e: any) {
    return {
      success:           false,
      mode:              'executed',
      verificationState: 'FAILED_CONFIRMED',
      error:             e.message,
    };
  }
}
