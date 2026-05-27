---
name: Sippy service layer architecture
description: Layer 2 middleware governance — server/services/sippy/ module map, design rules, and migration status.
---

## The hard rule
Route → BitsAuto Service Layer → Sippy Module → XML-RPC
NEVER: Route → server/sippy.ts directly (existing routes grandfathered, new routes must use services)

## Directory: server/services/sippy/

### Shared infrastructure
- `types.ts` — SippyConfig, SippyCDR, SippyTariff, SippyBalance, RetryOptions, ServiceResult, etc.
- `errors.ts` — SippyAuthError, SippyTimeoutError, SippyConnectionError, SippyValidationError, SippyRateUploadError, SippyFinanceError, SippyRoutingError, SippyCdrError + normalizeSippyError()
- `constants.ts` — all timeouts (RPC_TIMEOUT_DEFAULT_MS=12000, CDR_FETCH_TIMEOUT_MS=30000, etc.), retry counts, cache TTLs
- `utils.ts` — withRetry(), withTimeout(), normalizePrefix(), toSippyDateStr(), parseSippyDateStr(), assertSippyOk()
- `index.ts` — barrel export; canonical import point for all Sippy operations

### Service modules (all accept SippyConfig, all queue-safe)
- `sippy-auth.service.ts` — checkConnection(), connect(), executeRpcCall(), executeRpcWithRetry(), configFromSettings(), clearSession()
- `sippy-audit.service.ts` — auditLog(), getRecentAuditLogs(), getAuditSummary() — in-memory ring buffer (500 entries), non-throwing
- `sippy-client.service.ts` — listAccounts(), getAccount(), createAccount(), suspendAccount(), suspendCustomer(), listVendors(), listVendorConnections()
- `sippy-tariff.service.ts` — getTariffsList(), getTariffInfo(), getTariffRatesList(), pushRate(), updateBillingInterval(), createTariff(), clearTariffRates(), detectTariffChanges()
- `sippy-routing.service.ts` — listRoutingGroups(), listRoutingGroupMembers(), addRoutingGroup(), updateRoutingGroup(), deleteRoutingGroup(), addRoutingGroupMember(), removeRoutingGroupMember(), assignVendorRoute(), validateRoutingConfig(), syncRoutingGroups()
- `sippy-reporting.service.ts` — getAsrAcdReport(), getClientSummary(), getVendorSummary(), getSalesReport(), getProfitLossReport(), getMonitoringData(), getDashboardMetrics()
- `sippy-cdr.service.ts` — syncCdrs() (XML-RPC + portal fallback), syncVendorCdrs(), normalizeCdr(), aggregateCdrsByPrefix(), getCdrsByPrefix()
- `sippy-finance.service.ts` — getBalances(), getBalanceTotals(), setCreditLimit(), getPaymentsList(), recordPayment(), previewInvoice(), generateInvoice(), syncFinanceState()

## Key design decisions
- Services wrap server/sippy.ts — they don't move code out of it (non-breaking migration)
- configFromSettings() extracts {portalUrl, username=apiAdminUsername, password=apiAdminPassword} from settings
- All write operations emit auditLog() entries (non-blocking, never throws)
- Finance service: NO finance logic in routes, crons, or UI handlers
- Tariff service: updateBillingInterval() is the canonical Morocco-type interval change entry point
- CDR service: syncCdrs() always tries XML-RPC first, falls back to portal scraping
- server/sippy.ts (16,712 lines, 350 exports) remains the low-level execution layer

## Why
Prerequisite for tariff versioning, invoice automation, reconciliation, and AI analytics.
Without clean service boundaries, all those layers become fragile and duplicated.
