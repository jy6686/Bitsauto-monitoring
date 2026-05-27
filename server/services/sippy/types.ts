/**
 * Centralized type definitions for the Sippy Service Layer.
 * All Sippy-related types flow through here — no inline typing of XML-RPC responses.
 */

// ── Core config ───────────────────────────────────────────────────────────────

export interface SippyConfig {
  portalUrl:  string;
  username:   string;
  password:   string;
  adminWebPassword?: string;
}

export interface SippyMultiConfig {
  primary:   SippyConfig;
  fallbacks?: SippyConfig[];
}

// ── Connection / health ───────────────────────────────────────────────────────

export type ConnectionMode = 'xmlrpc' | 'portal';

export interface SippyConnectionResult {
  reachable:       boolean;
  authenticated:   boolean;
  message:         string;
  latencyMs?:      number;
  mode?:           ConnectionMode;
}

// ── Active calls ──────────────────────────────────────────────────────────────

export interface SippyActiveCall {
  id:            string;
  caller?:       string;
  callee?:       string;
  startTime?:    string;
  duration?:     number;
  state?:        string;
  codec?:        string;
  remoteIp?:     string;
  localIp?:      string;
  pdd?:          number;
  mos?:          number;
  jitter?:       number;
  packetLoss?:   number;
  latency?:      number;
  iAccount?:     string;
  iCustomer?:    string;
  accountName?:  string;
  routingGroup?: string;
  [key: string]: unknown;
}

// ── CDR ───────────────────────────────────────────────────────────────────────

export interface SippyCDR {
  callId?:          string;
  caller?:          string;
  callee?:          string;
  startTime?:       string;
  connectTime?:     string;
  endTime?:         string;
  duration?:        number;
  totalDuration?:   number;
  billDuration?:    number;
  cost?:            number;
  price?:           number;
  result?:          string;
  codec?:           string;
  remoteIp?:        string;
  iAccount?:        string;
  iCustomer?:       string;
  iVendor?:         string;
  clientName?:      string;
  vendorName?:      string;
  pdd?:             number;
  mos?:             number;
  jitter?:          number;
  packetLoss?:      number;
  dispositionSource?: string;
  [key: string]: unknown;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export interface SippyAccount {
  iAccount?:       string | number;
  iCustomer?:      string | number;
  id?:             string;
  username?:       string;
  balance?:        number;
  creditLimit?:    number;
  tariff?:         string;
  iTariff?:        string | number;
  status?:         string;
  name?:           string;
  [key: string]: unknown;
}

export interface SippyVendor {
  iVendor?:        string | number;
  name?:           string;
  status?:         string;
  balance?:        number;
  [key: string]: unknown;
}

// ── Tariffs / Rates ───────────────────────────────────────────────────────────

export interface SippyTariff {
  iTariff?:        string | number;
  name?:           string;
  currency?:       string;
  type?:           string;
  [key: string]: unknown;
}

export interface SippyTariffRate {
  prefix?:         string;
  destination?:    string;
  price1?:         number;
  priceN?:         number;
  interval1?:      number;
  intervalN?:      number;
  freeSeconds?:    number;
  gracePeriod?:    number;
  connectFee?:     number;
  postCallSurcharge?: number;
  [key: string]: unknown;
}

export interface RateUploadResult {
  ok:              boolean;
  uploadToken?:    string;
  statusMessage?:  string;
  errors?:         string[];
  warnings?:       string[];
}

// ── Routing ───────────────────────────────────────────────────────────────────

export interface SippyRoutingGroup {
  iRoutingGroup?:  string | number;
  name?:           string;
  type?:           string;
  status?:         string;
  [key: string]: unknown;
}

export interface SippyRoutingGroupMember {
  iRoutingGroupMember?: string | number;
  iVendor?:        string | number;
  priority?:       number;
  weight?:         number;
  [key: string]: unknown;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

export interface SippyAsrAcdStats {
  asr:             number;
  acd:             number;
  totalCalls:      number;
  answeredCalls:   number;
  failedCalls:     number;
  avgPdd?:         number;
  period?:         string;
}

export interface SippyAccountStatRow {
  accountId?:      string;
  name?:           string;
  calls?:          number;
  minutes?:        number;
  revenue?:        number;
  cost?:           number;
  asr?:            number;
  acd?:            number;
  [key: string]: unknown;
}

export interface PnlRow {
  entity?:         string;
  revenue?:        number;
  cost?:           number;
  margin?:         number;
  marginPct?:      number;
  calls?:          number;
  minutes?:        number;
  [key: string]: unknown;
}

export interface PnlReport {
  rows?:           PnlRow[];
  totals?:         PnlRow;
  period?:         string;
  generatedAt?:    string;
}

// ── Finance ───────────────────────────────────────────────────────────────────

export interface SippyBalance {
  iBalance?:       string | number;
  balance?:        number;
  creditLimit?:    number;
  iAccount?:       string | number;
  iCustomer?:      string | number;
  [key: string]: unknown;
}

export interface SippyPayment {
  iPayment?:       string | number;
  amount?:         number;
  date?:           string;
  type?:           string;
  note?:           string;
  [key: string]: unknown;
}

export interface SippyInvoice {
  iInvoice?:       string | number;
  amount?:         number;
  dueDate?:        string;
  status?:         string;
  html?:           string;
  [key: string]: unknown;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export type SippyOperationType =
  | 'tariff_update'
  | 'routing_change'
  | 'account_create'
  | 'account_update'
  | 'account_suspend'
  | 'balance_update'
  | 'payment_recorded'
  | 'invoice_generated'
  | 'cdr_sync'
  | 'rate_upload'
  | 'connection_check'
  | 'rpc_call'
  | 'rpc_error';

export interface SippyAuditEntry {
  id?:             number;
  operationType:   SippyOperationType;
  portalUrl?:      string;
  method?:         string;
  params?:         Record<string, unknown>;
  result?:         'success' | 'failure' | 'retry' | 'timeout';
  errorMessage?:   string;
  durationMs?:     number;
  retryCount?:     number;
  performedBy?:    string;
  createdAt?:      Date;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?:    number;
  initialDelayMs?: number;
  maxDelayMs?:     number;
  backoffFactor?:  number;
  retryOn?:        (error: unknown) => boolean;
}

// ── Service result wrapper ────────────────────────────────────────────────────

export interface ServiceResult<T> {
  ok:              boolean;
  data?:           T;
  error?:          string;
  errorCode?:      string;
  durationMs?:     number;
  retryCount?:     number;
}
