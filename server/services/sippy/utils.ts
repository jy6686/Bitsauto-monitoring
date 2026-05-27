/**
 * Shared utilities for the Sippy Service Layer.
 * Prefix normalization, date helpers, XML-RPC response guards, retry primitives.
 */

import { RETRY_INITIAL_DELAY_MS, RETRY_BACKOFF_FACTOR, RETRY_MAX_DELAY_MS } from './constants';
import { RetryOptions } from './types';
import { isRetryableError, SippyTimeoutError } from './errors';

// ── Prefix normalization ──────────────────────────────────────────────────────

/**
 * Normalize a dialing prefix to E.164 digits only (strips +, spaces, dashes).
 */
export function normalizePrefix(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

/**
 * Validate a prefix is numeric and within allowed length (1–15 digits).
 */
export function isValidPrefix(prefix: string): boolean {
  const norm = normalizePrefix(prefix);
  return norm.length >= 1 && norm.length <= 15;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Format a Date for Sippy XML-RPC date parameters.
 * Output: "YYYY-MM-DD HH:MM:SS"
 */
export function toSippyDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Parse a Sippy date string to a JS Date. Returns null on failure.
 */
export function parseSippyDateStr(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const cleaned = raw.replace('T', ' ').replace(/\.\d+Z?$/, '').trim();
  const d = new Date(cleaned.includes(' ') ? cleaned.replace(' ', 'T') + 'Z' : cleaned);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Return a Date N hours before now.
 */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Return a Date N days before now.
 */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ── XML-RPC response guards ───────────────────────────────────────────────────

/**
 * Assert a Sippy result has `result === 'OK'` or an expected success string.
 * Throws a descriptive error with the fault string if not.
 */
export function assertSippyOk(
  result: Record<string, unknown> | null | undefined,
  context: string,
): void {
  if (!result) throw new Error(`${context}: empty response`);
  const r = result.result ?? result.Result;
  if (r !== 'OK' && r !== 'ok' && r !== 'Success' && r !== 1 && r !== '1') {
    const fault = result.faultString ?? result.fault_string ?? result.message ?? JSON.stringify(result);
    throw new Error(`${context}: ${fault}`);
  }
}

/**
 * Safely extract a string value from a Sippy struct response.
 */
export function extractStr(obj: Record<string, unknown>, key: string): string {
  return String(obj[key] ?? '');
}

/**
 * Safely extract a number from a Sippy struct response.
 */
export function extractNum(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (v === undefined || v === null || v === '') return 0;
  return parseFloat(String(v)) || 0;
}

// ── Retry primitive ───────────────────────────────────────────────────────────

/**
 * Execute fn with configurable retry policy + exponential backoff.
 * Propagates the last error after all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T & { _retryCount?: number }> {
  const maxAttempts  = options.maxAttempts   ?? 3;
  const initialDelay = options.initialDelayMs ?? RETRY_INITIAL_DELAY_MS;
  const maxDelay     = options.maxDelayMs     ?? RETRY_MAX_DELAY_MS;
  const factor       = options.backoffFactor  ?? RETRY_BACKOFF_FACTOR;
  const shouldRetry  = options.retryOn        ?? isRetryableError;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return result as T & { _retryCount?: number };
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !shouldRetry(err)) throw err;
      await sleep(Math.min(delay, maxDelay));
      delay = Math.min(delay * factor, maxDelay);
    }
  }
  throw lastError;
}

/**
 * Wrap a promise with a hard timeout. Throws SippyTimeoutError if exceeded.
 */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SippyTimeoutError(`Operation timed out after ${ms}ms`, ms)), ms);
    fn()
      .then(v  => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); reject(e);  });
  });
}

// ── Rate parsing ──────────────────────────────────────────────────────────────

/**
 * Parse duration strings like "1:23" (MM:SS) to seconds.
 */
export function parseMMSS(s: string): number {
  const parts = String(s || '').split(':');
  if (parts.length === 2) return (parseInt(parts[0]!, 10) || 0) * 60 + (parseInt(parts[1]!, 10) || 0);
  return parseInt(s, 10) || 0;
}

/**
 * Round a rate to 6 decimal places (standard telecom precision).
 */
export function roundRate(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
