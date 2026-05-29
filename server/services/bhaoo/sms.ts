/**
 * BhaooSMS — SMS sending service (single + bulk)
 */

import { bhaooRequestWithRetry } from './client';
import { SmsSendRequest, SmsSendResponse, BHAOO_SUBMIT_ERRORS } from './types';

function normalizeResponse(raw: any, internalId?: string): SmsSendResponse {
  const status    = Number(raw?.status   ?? raw?.Status   ?? -62);
  const text      = String(raw?.text     ?? raw?.Text     ?? (status === 0 ? 'ACCEPTD' : 'REJECTD'));
  const messageId = String(raw?.message_id ?? raw?.messageId ?? raw?.MessageId ?? (status === 0 ? '' : '-1'));
  const error     = status !== 0 ? (BHAOO_SUBMIT_ERRORS[String(status)] ?? text) : undefined;
  return { status, text, messageId, internalId, error };
}

export async function sendSms(req: SmsSendRequest): Promise<SmsSendResponse> {
  const internalId = `bts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const raw = await bhaooRequestWithRetry({
    method: 'POST',
    path:   '/api/',
    body: {
      type:          req.type ?? 'text',
      from:          req.from,
      to:            req.to,
      text:          req.text,
      transactionId: req.transactionId ?? internalId,
      ...(req.dlrUrl ? { dlrUrl: req.dlrUrl } : {}),
    },
  });

  return normalizeResponse(raw, internalId);
}

export async function sendSmsBulk(messages: SmsSendRequest[]): Promise<SmsSendResponse[]> {
  return Promise.all(messages.map(m => sendSms(m)));
}
