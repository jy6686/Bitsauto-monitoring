/**
 * sippy-audit.service.ts
 *
 * Centralized audit logging for all Sippy operations.
 * Every tariff update, routing change, finance operation, and failed XML-RPC
 * call is recorded here. Non-blocking — audit failures never surface to callers.
 */

import { SippyAuditEntry, SippyOperationType } from './types';

// In-memory ring buffer for recent operations (capped at 500 entries)
const MAX_RING_BUFFER = 500;
const _auditRing: SippyAuditEntry[] = [];
let _entryId = 0;

/**
 * Record a Sippy operation to the audit ring buffer.
 * Also emits to console in development for observability.
 * Non-throwing — any internal error is silently swallowed.
 */
export async function auditLog(entry: Omit<SippyAuditEntry, 'id' | 'createdAt'>): Promise<void> {
  try {
    const record: SippyAuditEntry = {
      ...entry,
      id: ++_entryId,
      createdAt: new Date(),
    };

    _auditRing.push(record);
    if (_auditRing.length > MAX_RING_BUFFER) _auditRing.shift();

    const icon =
      record.result === 'success' ? '✓' :
      record.result === 'retry'   ? '↺' :
      record.result === 'timeout' ? '⏱' : '✗';

    const parts = [
      `[sippy-audit]`,
      icon,
      record.operationType,
      record.method ? `(${record.method})` : '',
      record.durationMs != null ? `${record.durationMs}ms` : '',
      record.result === 'failure' && record.errorMessage ? `— ${record.errorMessage}` : '',
    ].filter(Boolean);

    if (record.result === 'failure') {
      console.error(parts.join(' '));
    } else if (record.result !== 'rpc_call' as any) {
      console.log(parts.join(' '));
    }
  } catch {
    // Audit must never crash the calling code
  }
}

/**
 * Retrieve recent audit entries, optionally filtered by operation type.
 */
export function getRecentAuditLogs(opts?: {
  operationType?: SippyOperationType;
  limit?: number;
  since?: Date;
}): SippyAuditEntry[] {
  let entries = [..._auditRing];

  if (opts?.operationType) {
    entries = entries.filter(e => e.operationType === opts.operationType);
  }
  if (opts?.since) {
    entries = entries.filter(e => e.createdAt && e.createdAt >= opts.since!);
  }

  return entries
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
    .slice(0, opts?.limit ?? 100);
}

/**
 * Retrieve a summary of recent operation outcomes.
 * Useful for the Fix Button system and health dashboards.
 */
export function getAuditSummary(): {
  total: number;
  success: number;
  failures: number;
  retries: number;
  timeouts: number;
  lastFailureAt?: Date;
  lastSuccessAt?: Date;
} {
  const total    = _auditRing.length;
  const success  = _auditRing.filter(e => e.result === 'success').length;
  const failures = _auditRing.filter(e => e.result === 'failure').length;
  const retries  = _auditRing.filter(e => e.result === 'retry').length;
  const timeouts = _auditRing.filter(e => e.result === 'timeout').length;

  const lastFailure = _auditRing.filter(e => e.result === 'failure').at(-1);
  const lastSuccess = _auditRing.filter(e => e.result === 'success').at(-1);

  return {
    total, success, failures, retries, timeouts,
    lastFailureAt: lastFailure?.createdAt,
    lastSuccessAt: lastSuccess?.createdAt,
  };
}
