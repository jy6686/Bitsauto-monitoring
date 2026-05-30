/**
 * BhaooSMS — Balance check + recharge
 */

import { bhaooRequest } from './client';
import { BhaooBalanceResponse } from './types';

const BALANCE_PATHS = ['/api/balance/', '/api/balance', '/api/account/balance/', '/api/'];

export async function checkBalance(profile?: { baseUrl: string; apiKey: string; secretKey: string }): Promise<BhaooBalanceResponse> {
  let lastErr: Error | undefined;
  for (const path of BALANCE_PATHS) {
    try {
      const raw: any = await bhaooRequest({ method: 'POST', path, ...(profile ? { profile } : {}) });
      const status = Number(raw?.status ?? 0);
      if (path === '/api/' && status !== 0 && !raw?.balance && !raw?.Balance && !raw?.credit) {
        continue;
      }
      const balance  = parseFloat(String(raw?.balance ?? raw?.Balance ?? raw?.credit ?? '0')) || 0;
      const credit   = raw?.credit_limit ? parseFloat(String(raw.credit_limit)) : undefined;
      const currency = String(raw?.currency ?? 'USD');
      return { status, balance, creditLimit: credit, currency };
    } catch (err: any) {
      lastErr = err;
      if (!err.message?.includes('404')) break;
    }
  }
  return { status: -1, balance: 0, error: lastErr?.message ?? 'Balance check failed' };
}

export async function rechargeAccount(
  amount: number,
  clientId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const raw: any = await bhaooRequest({
      method: 'POST',
      path:   '/api/recharge/',
      body:   { amount, ...(clientId ? { client_id: clientId } : {}) },
    });
    return { success: Number(raw?.status ?? -1) === 0 };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
