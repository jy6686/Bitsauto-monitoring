/**
 * sippy-finance.service.ts
 *
 * Finance isolation layer — invoices, balances, payments, finance state sync.
 *
 * CRITICAL RULE: Finance logic MUST NOT exist in routes, cron jobs, or UI handlers.
 * All finance interactions flow exclusively through this service.
 *
 * This service is the prerequisite for:
 *   - Invoice automation
 *   - Reconciliation engine
 *   - QuickBooks sync
 *
 * Design: All methods accept SippyConfig — queue-safe, no global state.
 * All write operations (payments, credit limit changes) are audited.
 */

import * as sippy from '../../sippy';
import {
  SippyConfig, SippyBalance, SippyPayment, SippyInvoice, ServiceResult,
} from './types';
import { normalizeSippyError, SippyFinanceError } from './errors';
import { auditLog } from './sippy-audit.service';

// ── Balances ──────────────────────────────────────────────────────────────────

/**
 * Get all balances for a Sippy switch (accounts + vendors).
 */
export async function getBalances(config: SippyConfig): Promise<SippyBalance[]> {
  try {
    const result = await sippy.getSippyBalances(
      config.username, config.password, config.portalUrl,
    );
    return (result ?? []) as SippyBalance[];
  } catch (err) {
    throw normalizeSippyError(err, 'getBalances');
  }
}

/**
 * Get aggregated balance totals across all accounts.
 */
export async function getBalanceTotals(
  config: SippyConfig,
): Promise<{ totalBalance: number; totalCreditLimit: number; currency?: string }> {
  try {
    const result = await sippy.getSippyBalanceTotals(
      config.username, config.password, config.portalUrl,
    );
    return {
      totalBalance:     Number((result as any)?.totalBalance     ?? 0),
      totalCreditLimit: Number((result as any)?.totalCreditLimit ?? 0),
      currency:         String((result as any)?.currency         ?? 'USD'),
    };
  } catch (err) {
    throw normalizeSippyError(err, 'getBalanceTotals');
  }
}

/**
 * Update the credit limit for an account balance record.
 * Audited — all credit limit changes are logged.
 */
export async function setCreditLimit(
  config: SippyConfig,
  iBalance: string | number,
  creditLimit: number,
): Promise<ServiceResult<void>> {
  const t0 = Date.now();
  try {
    await sippy.setSippyBalanceCreditLimit(
      config.username, config.password, iBalance, creditLimit, config.portalUrl,
    );
    await auditLog({
      operationType: 'balance_update',
      portalUrl: config.portalUrl,
      params: { iBalance, creditLimit },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'setCreditLimit');
    await auditLog({
      operationType: 'balance_update',
      portalUrl: config.portalUrl,
      params: { iBalance, creditLimit },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Payments ──────────────────────────────────────────────────────────────────

/**
 * Get the payment history for an account.
 */
export async function getPaymentsList(
  config: SippyConfig,
  opts: {
    iAccount?:  string | number;
    iCustomer?: string | number;
    dateStart?: Date;
    dateEnd?:   Date;
    limit?:     number;
  } = {},
): Promise<SippyPayment[]> {
  try {
    const result = await sippy.getPaymentsList(
      config.username, config.password, opts as any, config.portalUrl,
    );
    return (result ?? []) as SippyPayment[];
  } catch (err) {
    throw normalizeSippyError(err, 'getPaymentsList');
  }
}

/**
 * Record a manual payment against an account.
 * Audited — all payment records are logged.
 */
export async function recordPayment(
  config: SippyConfig,
  opts: {
    iAccount:  string | number;
    amount:    number;
    note?:     string;
    type?:     string;
  },
): Promise<ServiceResult<{ iPayment: string | number }>> {
  const t0 = Date.now();

  if (!opts.amount || opts.amount <= 0) {
    throw new SippyFinanceError('Payment amount must be positive', 'recordPayment');
  }

  try {
    const result = await sippy.makePayment(
      config.username, config.password,
      {
        i_account: String(opts.iAccount),
        amount:    opts.amount,
        payment_notes: opts.note ?? '',
      },
      config.portalUrl,
    );
    await auditLog({
      operationType: 'payment_recorded',
      portalUrl: config.portalUrl,
      params: { iAccount: opts.iAccount, amount: opts.amount },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return {
      ok: true,
      data: { iPayment: (result as any)?.i_payment ?? (result as any)?.iPayment ?? 0 },
    };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'recordPayment');
    await auditLog({
      operationType: 'payment_recorded',
      portalUrl: config.portalUrl,
      params: { iAccount: opts.iAccount, amount: opts.amount },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Invoices ──────────────────────────────────────────────────────────────────

/**
 * Generate an invoice preview (HTML) for a given account and period.
 * Read-only — does not commit the invoice.
 */
export async function previewInvoice(
  config: SippyConfig,
  opts: {
    iAccount:   string | number;
    dateStart:  Date;
    dateEnd:    Date;
    template?:  string;
  },
): Promise<{ html: string; ok: boolean; error?: string }> {
  try {
    const result = await sippy.generateInvoicePreview(
      config.username, config.password, opts as any, config.portalUrl,
    );
    return { ok: true, html: String((result as any)?.html ?? result ?? '') };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'previewInvoice');
    return { ok: false, html: '', error: sippyErr.message };
  }
}

/**
 * Generate and commit an invoice for a given account and period.
 * Audited — all invoice generation is logged.
 */
export async function generateInvoice(
  config: SippyConfig,
  opts: {
    iAccount:   string | number;
    dateStart:  Date;
    dateEnd:    Date;
    template?:  string;
    currency?:  string;
  },
): Promise<ServiceResult<SippyInvoice>> {
  const t0 = Date.now();
  try {
    const result = await sippy.generateInvoice(
      config.username, config.password, opts as any, config.portalUrl,
    );
    await auditLog({
      operationType: 'invoice_generated',
      portalUrl: config.portalUrl,
      params: { iAccount: opts.iAccount },
      result: 'success',
      durationMs: Date.now() - t0,
    });
    return { ok: true, data: result as SippyInvoice };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'generateInvoice');
    await auditLog({
      operationType: 'invoice_generated',
      portalUrl: config.portalUrl,
      params: { iAccount: opts.iAccount },
      result: 'failure',
      errorMessage: sippyErr.message,
      durationMs: Date.now() - t0,
    });
    return { ok: false, error: sippyErr.message };
  }
}

// ── Finance state sync ────────────────────────────────────────────────────────

/**
 * Sync the full finance state: balances + recent payments for all accounts.
 * Designed for queue-safe periodic execution (cron/background job).
 * Returns a snapshot suitable for caching.
 */
export async function syncFinanceState(
  config: SippyConfig,
): Promise<{
  balances:    SippyBalance[];
  totals:      { totalBalance: number; totalCreditLimit: number };
  syncedAt:    Date;
  ok:          boolean;
  error?:      string;
}> {
  try {
    const [balances, totals] = await Promise.all([
      getBalances(config),
      getBalanceTotals(config),
    ]);
    return {
      balances,
      totals: { totalBalance: totals.totalBalance, totalCreditLimit: totals.totalCreditLimit },
      syncedAt: new Date(),
      ok: true,
    };
  } catch (err) {
    const sippyErr = normalizeSippyError(err, 'syncFinanceState');
    return {
      balances:  [],
      totals:    { totalBalance: 0, totalCreditLimit: 0 },
      syncedAt:  new Date(),
      ok:        false,
      error:     sippyErr.message,
    };
  }
}
