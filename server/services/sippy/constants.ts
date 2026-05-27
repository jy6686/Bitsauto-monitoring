/**
 * Shared constants for the Sippy Service Layer.
 * Centralizes all timeouts, retry counts, cache TTLs, and limits.
 */

// ── Timeouts (ms) ─────────────────────────────────────────────────────────────

export const RPC_TIMEOUT_DEFAULT_MS  = 12_000;
export const RPC_TIMEOUT_FAST_MS     =  4_000; // Used when noNewLogin is set
export const RPC_TIMEOUT_UPLOAD_MS   = 60_000; // Rate uploads can be slow
export const PORTAL_LOGIN_TIMEOUT_MS = 15_000;
export const CDR_FETCH_TIMEOUT_MS    = 30_000;
export const REPORTING_TIMEOUT_MS    = 20_000;
export const HEALTH_CHECK_TIMEOUT_MS =  5_000;

// ── Retry policy ──────────────────────────────────────────────────────────────

export const RETRY_MAX_ATTEMPTS       = 3;
export const RETRY_INITIAL_DELAY_MS   = 500;
export const RETRY_MAX_DELAY_MS       = 8_000;
export const RETRY_BACKOFF_FACTOR     = 2;

// ── Session caching ───────────────────────────────────────────────────────────

export const PORTAL_SESSION_TTL_MS    = 5 * 60 * 1000;   // 5 minutes
export const NEG_CACHE_TTL_MS        = 5 * 60 * 1000;   // 5 minutes
export const AUTH_PROBE_INTERVAL_MS  = 30 * 1000;        // 30 seconds

// ── Rate limits ───────────────────────────────────────────────────────────────

export const DISPATCH_INTER_CALL_MS  = 120;    // ms between sends in dispatch loops
export const MAX_CDR_FETCH_ROWS      = 5_000;
export const MAX_BULK_RATE_ROWS      = 10_000;

// ── CDR / reporting windows ───────────────────────────────────────────────────

export const CDR_DEFAULT_WINDOW_HOURS = 24;
export const CDR_MAX_WINDOW_DAYS      = 30;
export const REPORTING_DEFAULT_DAYS   = 7;

// ── Sippy API paths ───────────────────────────────────────────────────────────

export const SIPPY_XMLRPC_PATH   = '/xmlapi/xmlapi';
export const SIPPY_SIMPLE_PATH   = '/simpleapi/callback.php';
export const SIPPY_PORTAL_LOGIN  = '/main.php';

// ── Operation categories for audit logging ────────────────────────────────────

export const AUDIT_CATEGORIES = {
  TARIFF:   'tariff',
  ROUTING:  'routing',
  ACCOUNT:  'account',
  FINANCE:  'finance',
  CDR:      'cdr',
  AUTH:     'auth',
  SYSTEM:   'system',
} as const;
