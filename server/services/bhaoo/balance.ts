/**
 * BhaooSMS — Balance check + recharge
 */

import { bhaooRequest } from './client';
import { BhaooBalanceResponse } from './types';

export async function checkBalance(): Promise<BhaooBalanceResponse> {
  try {
    const raw: any = await bhaooRequest({ method: 'POST', path: '/api/balance/' });
    const status   = Number(raw?.status ?? 0);
    const balance  = parseFloat(String(raw?.balance ?? raw?.Balance ?? raw?.credit ?? '0')) || 0;
    const credit   = raw?.credit_limit ? parseFloat(String(raw.credit_limit)) : undefined;
    const currency = String(raw?.currency ?? 'USD');
    return { status, balance, creditLimit: credit, currency };
  } catch (err: any) {
    return { status: -1, balance: 0, error: err.message };
  }
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
