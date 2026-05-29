/**
 * BhaooSMS / REVE SMS V5 — Type definitions
 * API Version: 5.3.0
 */

export interface BhaooConfig {
  baseUrl:   string;
  apiKey:    string;
  secretKey: string;
}

export interface SmsSendRequest {
  to:             string;
  from:           string;
  text:           string;
  type?:          'text' | 'unicode' | 'flash';
  transactionId?: string;
  dlrUrl?:        string;
}

export interface SmsSendResponse {
  status:      number;
  text:        string;
  messageId:   string;
  internalId?: string;
  error?:      string;
}

export type DlrStatus = 'DELIVRD' | 'REJECTD' | 'PENDING' | 'SENT' | 'UNKNOWN';

export interface DlrQueryResponse {
  status:    number;
  text:      DlrStatus;
  messageId: string;
  error?:    string;
}

export interface DlrPushPayload {
  messageId:   string;
  clientRef?:  string;
  status:      number;
  statusText?: string;
  msisdn?:     string;
  operator?:   string;
  country?:    string;
  errorCode?:  string;
  timestamp?:  string;
}

export interface BhaooBalanceResponse {
  balance:      number;
  creditLimit?: number;
  currency?:    string;
  status:       number;
  error?:       string;
}

export const BHAOO_SUBMIT_ERRORS: Record<string, string> = {
  '-1':  'Org Client Not Found',
  '-3':  'Invalid Destination Number',
  '-4':  'Insufficient Balance',
  '-5':  'Org Rate Not Found',
  '-6':  'Org Blocked',
  '-7':  'Invalid Sender ID',
  '-36': 'Invalid Request Type',
  '-42': 'Authorization Failed',
  '-44': 'ContactNo Blocked',
  '-45': 'ContactNo Blocked by Admin',
  '-46': 'Dipping Failed',
  '-47': 'Content not Whitelisted',
  '-48': 'URL Blocked',
  '-49': 'Content is Blocked',
  '-52': 'License Limit Exceeded',
  '-54': 'Sender ID Empty',
  '-55': 'Destination ID Empty',
  '-56': 'Message Content Empty',
  '-58': 'HLR Request Failed',
  '-59': 'IP Not Allowed',
  '-60': 'Invalid Hash Value',
  '-61': 'Invalid Parameter',
  '-62': 'Internal Server Error',
  '-63': 'Invalid Transaction ID',
  '-64': 'Sender ID Blocked',
  '-65': 'Bulk Limit Exceeded',
  '-66': 'Invalid API Key',
  '-67': 'Invalid Secret Key',
  '-68': 'Duplicate Transaction ID',
};

export const BHAOO_DLR_CODES: Record<number, string> = {
  0:   'DELIVRD',
  1:   'REJECTD',
  2:   'PENDING',
  4:   'SENT',
  101: 'Internal Server Error',
  108: 'Invalid Password',
  109: 'Invalid User',
  114: 'Invalid Parameter',
};
