/**
 * Normalized error classes for the Sippy Service Layer.
 * All telecom errors are typed — no raw string error propagation.
 */

export class SippyError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = 'SippyError';
    this.code = code;
    this.retryable = retryable;
  }
}

export class SippyAuthError extends SippyError {
  constructor(message: string, public readonly url?: string) {
    super(message, 'SIPPY_AUTH_ERROR', false);
    this.name = 'SippyAuthError';
  }
}

export class SippyTimeoutError extends SippyError {
  constructor(message: string, public readonly timeoutMs?: number) {
    super(message, 'SIPPY_TIMEOUT', true);
    this.name = 'SippyTimeoutError';
  }
}

export class SippyConnectionError extends SippyError {
  constructor(message: string, public readonly url?: string) {
    super(message, 'SIPPY_CONNECTION_ERROR', true);
    this.name = 'SippyConnectionError';
  }
}

export class SippyValidationError extends SippyError {
  constructor(message: string, public readonly field?: string) {
    super(message, 'SIPPY_VALIDATION_ERROR', false);
    this.name = 'SippyValidationError';
  }
}

export class SippyRateUploadError extends SippyError {
  constructor(message: string, public readonly details?: string[]) {
    super(message, 'SIPPY_RATE_UPLOAD_ERROR', false);
    this.name = 'SippyRateUploadError';
  }
}

export class SippyFinanceError extends SippyError {
  constructor(message: string, public readonly operation?: string) {
    super(message, 'SIPPY_FINANCE_ERROR', false);
    this.name = 'SippyFinanceError';
  }
}

export class SippyRoutingError extends SippyError {
  constructor(message: string) {
    super(message, 'SIPPY_ROUTING_ERROR', false);
    this.name = 'SippyRoutingError';
  }
}

export class SippyCdrError extends SippyError {
  constructor(message: string, retryable = true) {
    super(message, 'SIPPY_CDR_ERROR', retryable);
    this.name = 'SippyCdrError';
  }
}

export class SippyNotFoundError extends SippyError {
  constructor(resource: string, id?: string | number) {
    super(`${resource}${id != null ? ` (id=${id})` : ''} not found in Sippy`, 'SIPPY_NOT_FOUND', false);
    this.name = 'SippyNotFoundError';
  }
}

/**
 * Normalize any thrown value into a typed SippyError.
 * Always use this at service boundaries — never let raw errors propagate.
 */
export function normalizeSippyError(err: unknown, context?: string): SippyError {
  if (err instanceof SippyError) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const ctx = context ? `[${context}] ` : '';

  if (/auth|401|unauthorized|credentials|password/i.test(msg)) {
    return new SippyAuthError(`${ctx}${msg}`);
  }
  if (/timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) {
    return new SippyTimeoutError(`${ctx}${msg}`);
  }
  if (/connect|ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
    return new SippyConnectionError(`${ctx}${msg}`);
  }

  return new SippyError(`${ctx}${msg}`, 'SIPPY_UNKNOWN_ERROR', false);
}

/**
 * Returns true if the error should trigger a retry attempt.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof SippyError) return err.retryable;
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(msg);
}
