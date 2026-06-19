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

## Layer 5A — Executive Report Engine (COMPLETE)
- Table: `report_jobs` (migration: `migrations/007_layer5.sql`)
- Service: `sippy-executive-report.service.ts`
  - generateMonthlyReport(opts) — pulls CDR cache stats + verification summary + tariff change count, renders to HTML, stores in report_jobs
  - generateReportHtml(opts) — produces full standalone HTML document (inline styles, printable)
  - listReportJobs() — thin wrapper around storage
- API: POST /api/executive-reports/generate, GET /api/executive-reports, GET /api/executive-reports/:id
- UI: /executive-reports — month/year picker, generate button, stats, report list, iframe preview dialog, "Open Full Page" button
- Safe to deploy immediately — intelligence layer only, no financial truth

## Layer 5B — Invoice Engine (COMPLETE)
- Tables: `invoices`, `invoice_line_items` (migration: `migrations/007_layer5.sql`)
- CRITICAL CONSTRAINT: generateInvoice() sources ONLY from invoice_cdr_snapshots — never live tariffs
- Draft flow: draft → review → approved → sent. NO auto-send. Human approval required.
- Service: `sippy-invoice.service.ts`
  - generateInvoice(opts) — queries snapshots for period+iTariff, batches 500 line items, generates HTML, stores all
  - approveInvoice(id) — transitions status, sets approvedAt
  - voidInvoice(id) — marks void
  - generateInvoiceHtml(opts) — full B2B invoice HTML with DRAFT/REVIEW/FINAL watermark
  - countInvoices() — used for sequential invoice number generation (INV-YYYYMM-NNNN)
- API: POST /api/invoices/generate, GET /api/invoices, GET /api/invoices/:id, POST /api/invoices/:id/approve, POST /api/invoices/:id/void
- UI: /invoices — amber warning banner, generate dialog, list with approval button, iframe preview

## Layer 5C — Carrier Reconciliation (COMPLETE)
- Table: `carrier_reconciliations` (migration: `migrations/007_layer5.sql`)
- DEPLOYMENT MODE: shadow only. Status always starts as 'shadow'. NO auto-accounting.
- Compares: Carrier Invoice Total vs Sippy Actual vs BitsAuto Reproduced vs Snapshot Total
- Service: `sippy-reconciliation.service.ts`
  - runReconciliation(opts) — queries snapshots, computes 4 deltas, classifies discrepancy type + severity (none/minor/major/critical at $0.50/$5/$50 thresholds), generates recommendations, persists
  - Discrepancy types: exact_match, overbilled_by_carrier, underbilled_by_carrier, sippy_vs_reproduced_drift, large_discrepancy, missing_snapshots
  - updateReconciliationStatus(id, status, notes) — manual lifecycle: shadow→pending→reviewed→resolved→disputed
- API: POST /api/carrier-reconciliations/run, GET /api/carrier-reconciliations, GET /api/carrier-reconciliations/:id, PATCH /api/carrier-reconciliations/:id/status
- UI: /carrier-reconciliation — shadow mode banner, run form with tariff picker, delta-colored table, last result analysis card with recommendations

## Layer 4C — Immutable Rating Snapshots (COMPLETE)
- Table: `invoice_cdr_snapshots` (migration: `migrations/006_rating_snapshots.sql`)
- 7 indexes: UNIQUE on cdr_id (idempotency), i_tariff, rating_verification_id, tariff_version_id, verification_status, locked_at DESC, partial on delta WHERE ABS(delta) > 0.0001
- Both FK refs use SET NULL on delete — financial snapshots survive cleanup
- Service: `sippy-rating-snapshot.service.ts`
  - computeSnapshotHash() — SHA-256 of canonical JSON of immutable economic fields (deterministic, no operational fields)
  - createSnapshot(verificationId) — idempotent: checks existing by cdrId before inserting; parses rate_snapshot JSON from 4B record
  - lockBatch(opts) — batch crystallization of verified CDRs; skips unique conflicts (code 23505)
  - verifySnapshotIntegrity(id) — re-computes hash and compares to stored value
  - runIntegrityAudit(opts) — bulk hash audit, returns failures list
  - getSnapshotSummary(opts) — totals for reproduced, actual, delta, exact vs withDelta counts
- API: GET /api/rating-snapshots (filters), GET /api/rating-snapshots/summary, GET /api/rating-snapshots/:id, POST /api/rating-snapshots/lock-batch, POST /api/rating-snapshots/integrity-audit
- UI: /rating-snapshots — summary cards, accuracy bar, lock/audit buttons, batch result card, integrity audit card, snapshot table, detail dialog (crystallized economics + rate params + tamper-evident hash display)
- Sidebar: "Rating Snapshots" with Lock icon

## Layer 4B — Rating Verification Engine (COMPLETE)
- Table: `rating_verifications` (migration: `migrations/005_rating_verification.sql`)
- Also adds 4A enhancements: version_hash + change_source on tariff_versions; notification_sent + acknowledged + impact_score on tariff_change_events
- Service: `sippy-rating-verification.service.ts`
  - resolveTariffVersion(iTariff, connectTime) — point-in-time tariff lookup using created_at <= connectTime
  - resolveRate(callee, snapshotJson) — longest-prefix match against rate list
  - reproduceCost(durationSecs, rate) — standard Sippy billing formula with grace, free_seconds, interval1/n, surcharge
  - classifyDiscrepancy() — 9 types: exact_match, overbilled, underbilled, interval_mismatch, connect_fee_mismatch, grace_period_mismatch, surcharge_mismatch, missing_rate, unrated
  - verifyCdr(input) — full pipeline: resolve → match → reproduce → compare → persist
  - verifyBatch(cdrs, opts) — chunked parallel (concurrency=5), returns summary
  - getDiscrepancySummary(opts) — aggregated stats by type + severity
- CRITICAL: This service is read-only. It NEVER modifies Sippy ratings — only reproduces and validates.
- Storage: createRatingVerification(), getRatingVerification(), listRatingVerifications(), updateRatingVerificationStatus()
- API: GET /api/rating-verifications (with filters), GET /api/rating-verifications/summary, GET /api/rating-verifications/:id, POST /api/rating-verifications/run-batch, PATCH /api/rating-verifications/:id/status
- Batch source: globalThis.__sippyCdrCache (the live CDR cache populated by refreshCdrCache)
- UI: /rating-verification — summary cards, match-rate progress bar, batch result card, filterable verification table, detail dialog with rate snapshot

## Layer 4A — Tariff Versioning (COMPLETE)
- Tables: `tariff_versions`, `tariff_change_events` (migration: `migrations/004_tariff_versioning.sql`)
- Service: `sippy-tariff-versioning.service.ts` — snapshotTariff(), detectAndRecordChanges(), runIntervalChangeWorkflow(), getTariffHistory(), getVersionDetail(), diffVersions()
- Storage: createTariffVersion(), getTariffVersion(), listTariffVersions(), getLatestTariffVersion(), listTariffChangeEvents(), bulkCreateTariffChangeEvents()
- API: GET/POST /api/tariff-versions, POST /api/tariff-versions/snapshot, POST /api/tariff-versions/detect-changes, GET /api/tariff-versions/:a/diff/:b
- UI: /tariff-versions page with tariff selector, snapshot/detect-changes buttons, version list, detail dialog (rates + change events tabs)
- Sidebar: "Tariff Versions" entry under admin/management section

## Why
Prerequisite for tariff versioning, invoice automation, reconciliation, and AI analytics.
Without clean service boundaries, all those layers become fragile and duplicated.
