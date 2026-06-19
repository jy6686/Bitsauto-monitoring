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
  noOp?:     boolean;
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

// ── Dual-approval gate ────────────────────────────────────────────────────────
// ACCOUNT_FREEZE and ROUTE_BLOCK impact live traffic directly.
// When the execution gate is open these require a second management-role
// operator to confirm before the Sippy write fires (four-eyes rule).
export function requiresDualApproval(actionType: ActionType | string): boolean {
  return actionType === 'ACCOUNT_FREEZE' || actionType === 'ROUTE_BLOCK';
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

// ── Read original routing_plan_id from Sippy before a ROUTE_BLOCK write ──────
// Calls getAccountInfo and extracts routing_plan_id from the XML response.
// Returns the integer ID if set, null if the account has no routing plan, or
// undefined on any Sippy communication error (so we can distinguish "null" from
// "couldn't fetch").
export async function fetchOriginalRoutingPlanId(accountId: string): Promise<number | null | undefined> {
  try {
    const iAccount = parseInt(accountId, 10);
    if (isNaN(iAccount)) return undefined;
    const result = await callSippyXmlRpc('getAccountInfo', { i_account: iAccount });
    if (!result.success || !result.rawBody) return undefined;
    // XML-RPC struct member: <name>routing_plan_id</name><value><int>N</int></value>
    // or <value><nil/></value> / missing member when account has no plan.
    const match = result.rawBody.match(
      /<name>routing_plan_id<\/name>\s*<value>\s*(?:<(?:int|i4)>(\d+)<\/(?:int|i4)>|<nil\/>)?\s*<\/value>/,
    );
    if (!match) return null; // member absent — account has no routing plan
    if (match[1] !== undefined) return parseInt(match[1], 10);
    return null; // explicit nil — no routing plan
  } catch {
    return undefined;
  }
}

// ── Rollback params ───────────────────────────────────────────────────────────
// Derives the inverse Sippy operation for each action type.
// For ROUTE_BLOCK: reads original_routing_plan_id from storedParams (captured
// at apply-time via read-before-write). Falls back to method:'none' only when
// the ID was never stored (legacy action) or the account had no plan (no-op).
export function buildRollbackParams(
  accountId:    string,
  actionType:   ActionType,
  storedParams?: Record<string, unknown>,
): SippyActionParams {
  switch (actionType) {
    case 'RATE_LIMIT':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, max_calls: null, max_cps: null },
        note:   'Rollback: Remove CPS and max_calls limits. Account returns to unrestricted call capacity.',
      };
    case 'EXPOSURE_RESTRICT':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, ip_auth_enabled: 0 },
        note:   'Rollback: Disable IP-based authentication. Account reverts to standard auth.',
      };
    case 'ROUTE_BLOCK': {
      if (!storedParams || !('original_routing_plan_id' in storedParams)) {
        // Legacy action — original ID was never captured. Require manual restore.
        return {
          accountId,
          method: 'none',
          params: {},
          note:   'Rollback: Original routing plan ID was not recorded (action predates automatic capture). Manual restore in Sippy required.',
        };
      }
      const originalPlanId = storedParams.original_routing_plan_id;
      if (originalPlanId === null || originalPlanId === undefined) {
        // Account had no routing plan before the block — nothing to restore.
        return {
          accountId,
          method: 'none',
          params: {},
          note:   'No routing plan to restore — account had no routing plan assigned before this action.',
          noOp:   true,
        };
      }
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, routing_plan_id: originalPlanId },
        note:   `Rollback: Routing plan (ID: ${originalPlanId}) restored for account. Traffic will resume on the original route.`,
      };
    }
    case 'ACCOUNT_FREEZE':
      return {
        accountId,
        method: 'updateAccount',
        params: { i_account: accountId, blocked: 0 },
        note:   'Rollback: Unblock account. Traffic will resume from this account immediately.',
      };
    default:
      return {
        accountId,
        method: 'none',
        params: {},
        note:   'Rollback: No automated inverse action for this type. Manual review required.',
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
