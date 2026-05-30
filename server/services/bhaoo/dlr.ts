/**
 * BhaooSMS — DLR query + push payload parser
 */

import { bhaooRequest } from './client';
import { DlrQueryResponse, DlrPushPayload, BHAOO_DLR_CODES } from './types';

export async function queryDlr(messageId: string): Promise<DlrQueryResponse> {
  const raw: any = await bhaooRequest({
    method: 'POST',
    path:   '/api/dlr/',
    body:   { message_id: messageId },
  });

  const status = Number(raw?.status ?? raw?.Status ?? 1);
  const text   = (BHAOO_DLR_CODES[status] ?? 'UNKNOWN') as DlrQueryResponse['text'];
  return { status, text, messageId };
}

export function parseDlrPush(body: Record<string, unknown>): DlrPushPayload {
  return {
    messageId:  String(
      body.message_id  ?? body.messageId  ?? body.MessageId  ??
      body.Message_Id  ?? body.message_ID ?? body.msg_id     ?? ''
    ),
    clientRef:  body.client_ref  ? String(body.client_ref)  : undefined,
    status:     Number(body.status ?? body.Status ?? body.STATUS ?? 1),
    statusText: body.status_text ? String(body.status_text) : (body.Text ? String(body.Text) : undefined),
    msisdn:     body.msisdn      ? String(body.msisdn)      : (body.Msisdn ? String(body.Msisdn) : undefined),
    operator:   body.operator    ? String(body.operator)    : undefined,
    country:    body.country     ? String(body.country)     : undefined,
    errorCode:  body.error_code  ? String(body.error_code)  : undefined,
    timestamp:  body.timestamp   ? String(body.timestamp)   : (body['Delivery Time'] ? String(body['Delivery Time']) : new Date().toISOString()),
  };
}
