/**
 * sippy-client.service.ts
 *
 * Account and vendor management service.
 * Owns: create/update/suspend accounts, vendor management, SIP profile sync.
 *
 * All methods accept SippyConfig — no global state, queue-safe.
 */

import * as sippy from '../../sippy';
import { SippyConfig, SippyAccount, SippyVendor, ServiceResult } from './types';
import { normalizeSippyError, SippyNotFoundError } from './errors';
import { auditLog } from './sippy-audit.service';
import { withRetry } from './utils';

// ── Accounts ──────────────────────────────────────────────────────────────────

/**
 * List all Sippy accounts for the configured switch.
 * Includes balances, tariffs, and status.
 */
export async function listAccounts(
  config: SippyConfig,
  filters: Record<string, string | number | boolean> = {},
): Promise<SippyAccount[]> {
  try {
    return await sippy.listSippyAccounts(
      config.username, config.password, filters, config.portalUrl,
    ) as SippyAccount[];
  } catch (err) {
    throw normalizeSippyError(err, 'listAccounts');
  }
}

/**
 * Get a single account's details by account ID.
 */
export async function getAccount(
  config: SippyConfig,
  iAccount: string | number,
): Promise<SippyAccount> {
  try {
    const result = await sippy.getAccountInfo(
      config.username, config.password, iAccount, config.portalUrl,
    );
    if (!result) throw new SippyNotFoundError('Account', iAccount);
    return result as SippyAccount;
  } catch (err) {
    throw normalizeSippyError(err, 'getAccount');
  }
}

/**
 * Create or sync a client account in Sippy.
 * Handles tariff assignment, billing plan negotiation, and retry on
 * common Sippy rejection patterns (wrong billing plan, routing group conflicts).
 */
export async function createAccount(
  config: SippyConfig,
  accountData: Record<string, unknown>,
): Promise<{ ok: boolean; iAccount?: string | number; error?: string }> {
  const t0 = Date.now();
  try {
    const result = await withRetry(
      () => sippy.pushAccountToSippy(accountData as any, {
        username: config.username,
        password: config.password,
      }, config.portalUrl),
      { maxAttempts: 2 },
    );
    await auditLog({
      operationType: 'account_create',
      portalUrl: config.portalUrl,
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true, iAccount: (result as any)?.iAccount };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'createAccount');
    await auditLog({
      operationType: 'account_create',
      portalUrl: config.portalUrl,
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

/**
 * Suspend a Sippy account by iAccount ID.
 */
export async function suspendAccount(
  config: SippyConfig,
  iAccount: string | number,
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.disconnectSippyAccount(iAccount, config.username, config.password, config.portalUrl);
    await auditLog({
      operationType: 'account_suspend',
      portalUrl: config.portalUrl,
      params: { iAccount },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'suspendAccount');
    await auditLog({
      operationType: 'account_suspend',
      portalUrl: config.portalUrl,
      params: { iAccount },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message, durationMs: Date.now() - t0 };
  }
}

/**
 * Suspend all accounts belonging to a Sippy customer.
 */
export async function suspendCustomer(
  config: SippyConfig,
  iCustomer: string | number,
  opts?: { i_environment?: number; type?: string },
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.disconnectSippyCustomer(iCustomer, config.username, config.password, opts);
    await auditLog({
      operationType: 'account_suspend',
      portalUrl: config.portalUrl,
      params: { iCustomer },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'suspendCustomer');
    await auditLog({
      operationType: 'account_suspend',
      portalUrl: config.portalUrl,
      params: { iCustomer },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message, durationMs: Date.now() - t0 };
  }
}

// ── Vendors ───────────────────────────────────────────────────────────────────

/**
 * List all Sippy vendors.
 */
export async function listVendors(
  config: SippyConfig,
  filters: Record<string, string | number | boolean> = {},
): Promise<SippyVendor[]> {
  try {
    const { vendors } = await sippy.listSippyVendors(
      config.username, config.password, filters, config.portalUrl,
    );
    return (vendors ?? []) as SippyVendor[];
  } catch (err) {
    throw normalizeSippyError(err, 'listVendors');
  }
}

/**
 * List vendor connections (trunks) for a given vendor.
 */
export async function listVendorConnections(
  config: SippyConfig,
  iVendor: string | number,
): Promise<unknown[]> {
  try {
    const { connections } = await sippy.listVendorConnections(
      config.username, config.password, iVendor, config.portalUrl,
    );
    return connections ?? [];
  } catch (err) {
    throw normalizeSippyError(err, 'listVendorConnections');
  }
}

/**
 * Get call stats for the system or a specific account.
 */
export async function getCallStats(
  config: SippyConfig,
): Promise<unknown> {
  try {
    return await sippy.getSippyCallStats(config.username, config.password, config.portalUrl);
  } catch (err) {
    throw normalizeSippyError(err, 'getCallStats');
  }
}
