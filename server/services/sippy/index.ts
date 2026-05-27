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

// ── DMR Engine ───────────────────────────────────────────────────────────────
export * as dmr from './sippy-dmr.service';
export {
  generateDMR,
  recalculateDMR,
  getDMRTrend,
} from './sippy-dmr.service';

// ── Margin Intelligence Engine ────────────────────────────────────────────────
export * as margin from './sippy-margin.service';
export {
  materializeMargin,
  getMarginTrend,
  getTopClients,
  getTopVendors,
} from './sippy-margin.service';

// ── Dispute Defense Engine ────────────────────────────────────────────────────
export * as disputeDefense from './sippy-dispute-defense.service';
export { assembleDisputePackage } from './sippy-dispute-defense.service';

// ── Client Revenue Reconciliation Engine ─────────────────────────────────────
export * as clientRecon from './sippy-client-recon.service';
export {
  importAndReconcile,
  recalculateReconciliation,
  getReconciliationSummary,
} from './sippy-client-recon.service';

// ── Communication Policies Engine ────────────────────────────────────────────
export * as commPolicy from './sippy-comm-policy.service';
export {
  dispatchPoliciesForEvent,
  dispatchPoliciesForChangeEvents,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
} from './sippy-comm-policy.service';

// ── Executive reports (Layer 5A) ─────────────────────────────────────────────
export * as executiveReport from './sippy-executive-report.service';
export {
  buildMonthPeriod,
  buildCurrentMonthPeriod,
  generateMonthlyReport,
  listReportJobs,
  generateReportHtml,
} from './sippy-executive-report.service';

// ── Invoice engine (Layer 5B) ─────────────────────────────────────────────────
export * as invoice from './sippy-invoice.service';
export {
  generateInvoice,
  approveInvoice,
  voidInvoice,
  getInvoiceWithLineItems,
  generateInvoiceHtml,
} from './sippy-invoice.service';

// ── Carrier reconciliation (Layer 5C) ─────────────────────────────────────────
export * as reconciliation from './sippy-reconciliation.service';
export {
  runReconciliation,
  updateReconciliationStatus,
  listReconciliations,
} from './sippy-reconciliation.service';

// ── Immutable rating snapshots (Layer 4C) ────────────────────────────────────
export * as ratingSnapshot from './sippy-rating-snapshot.service';
export {
  computeSnapshotHash,
  verifySnapshotIntegrity,
  createSnapshot,
  lockBatch,
  getSnapshotSummary,
  runIntegrityAudit,
} from './sippy-rating-snapshot.service';

// ── Rating verification (Layer 4B) ───────────────────────────────────────────
export * as ratingVerification from './sippy-rating-verification.service';
export {
  resolveTariffVersion,
  resolveRate,
  reproduceCost,
  classifyDiscrepancy,
  verifyCdr,
  verifyBatch,
  getDiscrepancySummary,
} from './sippy-rating-verification.service';

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
