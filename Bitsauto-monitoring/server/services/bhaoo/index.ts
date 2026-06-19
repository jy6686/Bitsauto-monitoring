/**
 * BhaooSMS Service Layer — barrel export
 *
 * Architecture:
 *   Route → server/services/bhaoo/index.ts → client.ts → BhaooSMS API
 *
 * NEVER call bhaooRequest() directly from routes.ts.
 */

export * from './types';
export { getConfig, isConfigured }    from './client';
export { sendSms, sendSmsBulk }       from './sms';
export { queryDlr, parseDlrPush }     from './dlr';
export { checkBalance, rechargeAccount } from './balance';
