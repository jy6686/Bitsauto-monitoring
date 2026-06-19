/**
 * BhaooSMS HTTP client — auth, retry, timeout.
 * All API calls flow through bhaooRequest().
 */

import { BhaooConfig } from './types';

const BASE_URL   = process.env.BHAOO_BASE_URL   || 'http://149.20.185.6/BhaooSMSV5';
const API_KEY    = process.env.BHAOO_API_KEY    || '';
const SECRET_KEY = process.env.BHAOO_SECRET_KEY || '';

export function getConfig(): BhaooConfig {
  return { baseUrl: BASE_URL, apiKey: API_KEY, secretKey: SECRET_KEY };
}

export function isConfigured(): boolean {
  return !!(API_KEY && SECRET_KEY);
}

interface RequestOptions {
  method?:    'GET' | 'POST';
  path:       string;
  params?:    Record<string, string>;
  body?:      Record<string, unknown>;
  timeoutMs?: number;
  profile?:   { baseUrl: string; apiKey: string; secretKey: string };
}

export async function bhaooRequest<T = unknown>(opts: RequestOptions): Promise<T> {
  const profile = opts.profile;

  if (!profile && !isConfigured()) {
    throw new Error('BhaooSMS credentials not configured (BHAOO_API_KEY / BHAOO_SECRET_KEY missing)');
  }

  const baseUrl   = profile?.baseUrl   ?? BASE_URL;
  const apiKey    = profile?.apiKey    ?? API_KEY;
  const secretKey = profile?.secretKey ?? SECRET_KEY;

  const method    = opts.method ?? 'POST';
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let url = `${baseUrl}${opts.path}`;

  if (method === 'GET') {
    // REVE SMS V5 uses lowercase apikey/secretkey as query params
    const qs = new URLSearchParams({
      ...(opts.params ?? {}),
      apikey:    apiKey,
      secretkey: secretKey,
    });
    url = `${url}?${qs.toString()}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOpts: RequestInit = {
      method,
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    };

    if (method === 'POST') {
      fetchOpts.body = JSON.stringify({ key: apiKey, secret: secretKey, ...opts.body });
    }

    const res = await fetch(url, fetchOpts);
    if (!res.ok) throw new Error(`BhaooSMS HTTP ${res.status}: ${res.statusText}`);

    const text = await res.text();
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  } finally {
    clearTimeout(timer);
  }
}

export async function bhaooRequestWithRetry<T = unknown>(
  opts: RequestOptions,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await bhaooRequest<T>(opts); }
    catch (err: any) {
      lastErr = err;
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr;
}
