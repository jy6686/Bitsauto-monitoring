/**
 * AI Ops Signal Mapper
 *
 * Pure, deterministic function that converts a normalized execResult
 * (from approvals.ts) into structured AI Ops signal rows.
 *
 * Rules:
 *   ROUTING_FAILURE          — any failed execution
 *   EXECUTION_LATENCY_HIGH   — durationMs > 6 000ms
 *   VENDOR_DEGRADATION_SIGNAL — routing_group_member failure specifically
 *
 * No ML, no side effects, no external calls.
 */

export interface AiOpsSignal {
  type:         string;
  severity:     'high' | 'medium' | 'low';
  message:      string;
  entity:       string | null;
  value:        string | null;
  linkedExecId: string | null;
  source:       string;
}

export function mapExecToSignals(
  execResult: {
    success:    boolean;
    message:    string;
    durationMs: number;
    method:     string;
    raw?:       any;
  },
  operationType: string,
  approvalId:    number,
): AiOpsSignal[] {
  const signals: AiOpsSignal[] = [];
  const linkedExecId = String(approvalId);

  // 1. Failure signal — any execution that returned success:false
  if (!execResult.success) {
    signals.push({
      type:         'ROUTING_FAILURE',
      severity:     'high',
      message:      execResult.message || 'Execution failed',
      entity:       operationType,
      value:        null,
      linkedExecId,
      source:       'execution',
    });
  }

  // 2. Latency signal — Sippy call took more than 6 seconds
  if (execResult.durationMs > 6_000) {
    signals.push({
      type:         'EXECUTION_LATENCY_HIGH',
      severity:     'medium',
      message:      `Slow execution: ${execResult.durationMs}ms (${operationType})`,
      entity:       operationType,
      value:        String(execResult.durationMs),
      linkedExecId,
      source:       'execution',
    });
  }

  // 3. Vendor degradation hint — routing member failure implies vendor-side issue
  if (!execResult.success && operationType.includes('routing_group_member')) {
    signals.push({
      type:         'VENDOR_DEGRADATION_SIGNAL',
      severity:     'high',
      message:      'Routing member operation failed — possible vendor degradation',
      entity:       operationType,
      value:        null,
      linkedExecId,
      source:       'execution',
    });
  }

  return signals;
}
