/**
 * sippy-auth.service.ts
 *
 * Core infrastructure service — connection lifecycle, credential management,
 * retry governance, timeout handling, and centralized XML-RPC dispatch.
 *
 * ARCHITECTURAL RULE: All Sippy XML-RPC communication flows through this module.
 * No other service may create XML-RPC transports directly.
 */

import * as sippy from '../../sippy';
import {
  SippyConfig, RetryOptions, SippyConnectionResult,
} from './types';
import {
  SippyAuthError, SippyConnectionError,
  normalizeSippyError,
} from './errors';
import {
  RPC_TIMEOUT_DEFAULT_MS, RETRY_MAX_ATTEMPTS,
  RETRY_INITIAL_DELAY_MS, RETRY_MAX_DELAY_MS, RETRY_BACKOFF_FACTOR,
} from './constants';
import { withRetry, withTimeout } from './utils';
import { auditLog } from './sippy-audit.service';

// ── Session state ─────────────────────────────────────────────────────────────

export function getSessionStatus(): ReturnType<typeof sippy.getSippySessionStatus> {
  return sippy.getSippySessionStatus();
}

export function clearSession(): void {
  sippy.clearSippySession();
}

export function getActivePortalUrl(): string | undefined {
  return sippy.getActivePortalUrl();
}

// ── Connection / health ───────────────────────────────────────────────────────

/**
 * Test connectivity and authentication for a given Sippy instance.
 * Returns a structured result — never throws.
 */
export async function checkConnection(config: SippyConfig): Promise<SippyConnectionResult> {
  const t0 = Date.now();
  try {
    const result = await sippy.testSippyConnection(
      config.portalUrl,
      config.username,
      config.password,
    );
    await auditLog({
      operationType: 'connection_check',
      portalUrl: config.portalUrl,
      result: result.authenticated ? 'success' : 'failure',
      durationMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'checkConnection');
    await auditLog({
      operationType: 'connection_check',
      portalUrl: config.portalUrl,
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return {
      reachable: false,
      authenticated: false,
      message: sippyErr.message,
    };
  }
}

/**
 * Establish and cache a Sippy session. Tries admin credentials first, then
 * falls back through available credential pairs.
 */
export async function connect(config: SippyConfig): Promise<SippyConnectionResult> {
  const t0 = Date.now();
  try {
    const result = await sippy.connectSippy(
      config.portalUrl,
      config.username,
      config.password,
      config.adminWebPassword,
    );
    await auditLog({
      operationType: 'connection_check',
      portalUrl: config.portalUrl,
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'connect');
    if (sippyErr instanceof SippyAuthError) throw sippyErr;
    throw new SippyConnectionError(`Could not connect to ${config.portalUrl}: ${sippyErr.message}`, config.portalUrl);
  }
}

/**
 * List available XML-RPC methods — used for capability probing.
 */
export async function listAvailableMethods(config: SippyConfig): Promise<string[]> {
  try {
    const result = await sippy.listAvailableMethods(
      config.username,
      config.password,
      config.portalUrl,
    );
    return Array.isArray(result) ? result : [];
  } catch (err) {
    throw normalizeSippyError(err, 'listAvailableMethods');
  }
}

// ── Core RPC dispatch ─────────────────────────────────────────────────────────

/**
 * Execute a single Sippy XML-RPC call via the active session.
 * Handles credential selection, timeout, and error normalization.
 *
 * This is the canonical entry point for all telecom operations.
 * Routes and services should use this rather than calling sippy.ts helpers directly.
 *
 * Currently delegates to the appropriate sippy.ts function based on method name.
 * In future: will call a raw XML-RPC transport directly as sippy.ts is decomposed.
 */
export async function executeRpcCall<T = unknown>(
  config: SippyConfig,
  method: string,
  params: Record<string, string | number | boolean | null> = {},
  timeoutMs = RPC_TIMEOUT_DEFAULT_MS,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await withTimeout<T>(
      () => (sippy as any)[method]?.(config.username, config.password, params, config.portalUrl)
        ?? Promise.reject(new Error(`No handler for method: ${method}`)),
      timeoutMs,
    );
    await auditLog({
      operationType: 'rpc_call',
      portalUrl: config.portalUrl,
      method,
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    const sippyErr = normalizeSippyError(err, `executeRpcCall(${method})`);
    await auditLog({
      operationType: 'rpc_error',
      portalUrl: config.portalUrl,
      method,
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    throw sippyErr;
  }
}

// ── Retry & timeout governance (exported for service use) ─────────────────────

/**
 * withRetry — execute fn with exponential backoff retry.
 * Re-exported here so services import retry logic from auth, not utils directly.
 */
export { withRetry, withTimeout } from './utils';

/**
 * Convenience wrapper: executeRpcCall with retry.
 */
export async function executeRpcWithRetry<T = unknown>(
  config: SippyConfig,
  method: string,
  params: Record<string, string | number | boolean | null> = {},
  retryOpts: RetryOptions = {},
  timeoutMs = RPC_TIMEOUT_DEFAULT_MS,
): Promise<T> {
  return withRetry(
    () => executeRpcCall<T>(config, method, params, timeoutMs),
    {
      maxAttempts:    retryOpts.maxAttempts   ?? RETRY_MAX_ATTEMPTS,
      initialDelayMs: retryOpts.initialDelayMs ?? RETRY_INITIAL_DELAY_MS,
      maxDelayMs:     retryOpts.maxDelayMs     ?? RETRY_MAX_DELAY_MS,
      backoffFactor:  retryOpts.backoffFactor  ?? RETRY_BACKOFF_FACTOR,
      ...retryOpts,
    },
  );
}

/**
 * Build a SippyConfig from settings retrieved from storage.
 * Centralizes the credential extraction pattern so routes don't do it inline.
 */
export function configFromSettings(settings: {
  portalUrl?:         string | null;
  apiAdminUsername?:  string | null;
  apiAdminPassword?:  string | null;
  adminWebPassword?:  string | null;
}): SippyConfig {
  if (!settings.portalUrl) {
    throw new SippyConnectionError('portalUrl is not configured in settings');
  }
  return {
    portalUrl:        settings.portalUrl,
    username:         settings.apiAdminUsername ?? '',
    password:         settings.apiAdminPassword ?? '',
    adminWebPassword: settings.adminWebPassword ?? undefined,
  };
}
