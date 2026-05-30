/**
 * BhaooSMS — Balance check + recharge
 */

import { bhaooRequest } from './client';
import { BhaooBalanceResponse } from './types';

// REVE SMS V5 — try GET first (correct method), POST as fallback
const BALANCE_CANDIDATES: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET',  path: '/api/balance'         },
  { method: 'GET',  path: '/api/balance/'        },
  { method: 'GET',  path: '/api/user'            },
  { method: 'GET',  path: '/api/account/balance' },
  { method: 'POST', path: '/api/balance'         },
  { method: 'POST', path: '/api/'                },
];

function extractBalance(raw: any): BhaooBalanceResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const status  = Number(raw?.status ?? raw?.Status ?? 0);
  const balance = parseFloat(String(raw?.balance ?? raw?.Balance ?? raw?.credit ?? raw?.Credit ?? '0')) || 0;
  // Reject clearly error-only responses with no balance field at all
  if (status !== 0 && balance === 0 && !('balance' in raw) && !('Balance' in raw) && !('credit' in raw)) return null;
  const credit   = raw?.credit_limit ? parseFloat(String(raw.credit_limit)) : undefined;
  const currency = String(raw?.currency ?? raw?.Currency ?? 'USD');
  return { status, balance, creditLimit: credit, currency };
}

export async function checkBalance(profile?: { baseUrl: string; apiKey: string; secretKey: string }): Promise<BhaooBalanceResponse> {
  let lastErr: Error | undefined;
  for (const { method, path } of BALANCE_CANDIDATES) {
    try {
      const raw: any = await bhaooRequest({ method, path, ...(profile ? { profile } : {}) });
      const result = extractBalance(raw);
      if (result) return result;
    } catch (err: any) {
      lastErr = err;
      // Only keep trying on 404 — any other error means wrong creds or server issue
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
