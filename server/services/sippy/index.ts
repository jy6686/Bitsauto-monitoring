/**
 * Sippy Service Layer — barrel export
 *
 * This is the canonical import point for all Sippy operations.
 * Future routes and services MUST import from here, never from ../../sippy directly.
 *
 * ARCHITECTURAL RULE:
 *   Route → BitsAuto Service Layer (this file) → Sippy Module → XML-RPC
 *   NEVER: Route → server/sippy.ts directly
 *
 * Layer 2 of the BitsAuto maturity stack:
 *   Layer 1: Sippy execution infrastructure (server/sippy.ts)
 *   Layer 2: THIS — Sippy service layer middleware (server/services/sippy/)
 *   Layer 3: Communication & workflow governance
 *   Layer 4: Revenue assurance
 *   Layer 5: Finance automation
 *   Layer 6: Partner ecosystem
 *   Layer 7: AI intelligence
 */

// ── Shared infrastructure ─────────────────────────────────────────────────────
export * from './types';
export * from './errors';
export * from './constants';
export * from './utils';

// ── Auth & connection management ──────────────────────────────────────────────
export * as auth from './sippy-auth.service';
export {
  checkConnection,
  connect,
  clearSession,
  getSessionStatus,
  getActivePortalUrl,
  listAvailableMethods,
  executeRpcCall,
  executeRpcWithRetry,
  configFromSettings,
} from './sippy-auth.service';

// ── Audit logging ─────────────────────────────────────────────────────────────
export * as audit from './sippy-audit.service';
export {
  auditLog,
  getRecentAuditLogs,
  getAuditSummary,
} from './sippy-audit.service';

// ── Client / account management ───────────────────────────────────────────────
export * as client from './sippy-client.service';
export {
  listAccounts,
  getAccount,
  createAccount,
  suspendAccount,
  suspendCustomer,
  listVendors,
  listVendorConnections,
  getCallStats,
} from './sippy-client.service';

// ── Tariff / rate management (Telecom Economics Middleware) ───────────────────
export * as tariff from './sippy-tariff.service';
export {
  getTariffsList,
  getTariffInfo,
  getTariffRatesList,
  getRateAnalysis,
  createTariff,
  pushRate,
  updateBillingInterval,
  clearTariffRates,
  detectTariffChanges,
} from './sippy-tariff.service';

// ── Routing management ────────────────────────────────────────────────────────
export * as routing from './sippy-routing.service';
export {
  listRoutingGroups,
  listRoutingGroupMembers,
  listExtendedRouting,
  addRoutingGroup,
  updateRoutingGroup,
  deleteRoutingGroup,
  addRoutingGroupMember,
  removeRoutingGroupMember,
  validateRoutingConfig,
  syncRoutingGroups,
  assignVendorRoute,
} from './sippy-routing.service';

// ── Reporting & analytics ─────────────────────────────────────────────────────
export * as reporting from './sippy-reporting.service';
export {
  getAsrAcdReport,
  getClientSummary,
  getVendorSummary,
  getSalesReport,
  getProfitLossReport,
  getMonitoringData,
  getMonitoringGraph,
  getDashboardMetrics,
} from './sippy-reporting.service';

// ── CDR sync & analytics ──────────────────────────────────────────────────────
export * as cdr from './sippy-cdr.service';
export {
  syncCdrs,
  syncVendorCdrs,
  normalizeCdr,
  aggregateCdrsByPrefix,
  getCdrsByPrefix,
} from './sippy-cdr.service';

// ── Tariff versioning (Layer 4A) ──────────────────────────────────────────────
export * as versioning from './sippy-tariff-versioning.service';
export {
  snapshotTariff,
  detectAndRecordChanges,
  runIntervalChangeWorkflow,
  getTariffHistory,
  getVersionDetail,
  diffVersions,
} from './sippy-tariff-versioning.service';

// ── Finance isolation layer ───────────────────────────────────────────────────
export * as finance from './sippy-finance.service';
export {
  getBalances,
  getBalanceTotals,
  setCreditLimit,
  getPaymentsList,
  recordPayment,
  previewInvoice,
  generateInvoice,
  syncFinanceState,
} from './sippy-finance.service';
