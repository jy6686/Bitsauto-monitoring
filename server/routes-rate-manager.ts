/**
 * routes-rate-manager.ts — Product Rate Repository + Rate Notifications
 *
 * Endpoints:
 *   GET    /api/product-rates            — list (filter: productId)
 *   POST   /api/product-rates            — create rate
 *   PUT    /api/product-rates/:id        — update rate
 *   DELETE /api/product-rates/:id        — delete rate
 *   POST   /api/product-rates/:id/push-to-sippy  — T003: push rate to Sippy tariffs
 *
 *   GET    /api/rate-notifications        — list (filter: status, productId, tariffId, days)
 *   POST   /api/rate-notifications        — create + compute affected accounts
 *   PATCH  /api/rate-notifications/:id   — update status (sent/cancelled)
 *   GET    /api/rate-notifications/accounts-on-tariff/:tariffId — find impacted accounts
 *
 *   POST   /api/carrier-reconciliations/row-analysis — per-row T1·ID CDR match
 *
 *   GET    /api/pricing-intelligence     — T006: margin recommendations with CDR cost data
 */

import type { Express } from 'express';
import { db } from './db';
import { eq, desc, and, gte } from 'drizzle-orm';
import { productRates, rateNotifications, companies, customerProductAssignments, productRegistry, ratePushJobs } from '@shared/schema';
import { reconcilePerRow } from './services/sippy/sippy-reconciliation.service';
import { storage } from './storage';
import * as sippy from './sippy';

// ── T006: CDR pool provider (injected from routes.ts after cdrCache is warm) ──
// Used by pricing-intelligence to compute avg vendor cost from live CDR data.
type CdrPoolFn = () => any[];
let _rateMgrCdrFn: CdrPoolFn | null = null;
export function setRateMgrCdrProvider(fn: CdrPoolFn) { _rateMgrCdrFn = fn; }

function requireRole(roles: string[], req: any, res: any, next: any) {
  const userRole = req.user?.role;
  if (!userRole || !roles.includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

// ── Helper: extract Sippy credentials from settings ────────────────────────────
async function getSippyCreds() {
  const settings = await storage.getSettings();
  const s = settings as any;
  return {
    username: s.apiAdminUsername || s.portalUsername || '',
    password: s.apiAdminPassword || s.portalPassword || '',
    portalUrl: s.portalUrl || '',
  };
}

export function registerRateManagerRoutes(app: Express) {

  // ── Debug: generate & download the exact XLSX BitsAuto would upload ─────────
  // GET /api/rate-manager/download-test-xlsx?tariffId=33&prefix=19230&rate=0.027&from=2026-06-18+01:30
  //
  // Strategy (mirrors pushRateViaPortalUpload):
  //   P1 (preferred): Download real tariff XLSX from Sippy portal → patch in-place
  //       Filename suffix: _download-patch
  //   P2 (fallback):  Reconstruct from XML-RPC rates → buildFullTariffXlsx
  //       Filename suffix: _xmlrpc-reconstruct  (Country=null — may fail on Sippy)
  //
  // Open BOTH files beside manual internal-ptcl_Rates.xlsx to spot mismatches.
  app.get('/api/rate-manager/download-test-xlsx', async (req: any, res) => {
    try {
      const { tariffId, prefix, rate, from: effectiveFrom, till: effectiveTill } = req.query as Record<string, string>;
      if (!prefix || !rate || !tariffId) return res.status(400).json({ error: 'tariffId, prefix and rate are required' });
      const rateNum = parseFloat(rate);
      if (isNaN(rateNum)) return res.status(400).json({ error: 'rate must be a number' });

      function normDate(raw?: string): string {
        if (!raw) return '';
        const s = raw.trim().replace('T', ' ').replace(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}.*$/, '$1');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return `${raw.trim()} 00:00:00`;
        return '';
      }

      const session = sippy.getActiveSession?.();
      const base    = session?.portalUrl ?? '';

      let xlsxBuf: Buffer;
      let method = 'xmlrpc-reconstruct';

      // ── P1: Download from Sippy portal → patch in-place ─────────────────
      if (base && session) {
        try {
          // Get a portal session with the same credentials used for uploads
          const { findRatesCapableSession } = sippy as any;
          let downloadCookies: any = null;
          if (typeof findRatesCapableSession === 'function') {
            const rSess = await findRatesCapableSession(base, Number(tariffId), undefined);
            downloadCookies = rSess?.cookies;
          }
          if (!downloadCookies) {
            // Fall back to current portal session cookies if available
            const { getPortalCookies } = sippy as any;
            if (typeof getPortalCookies === 'function') downloadCookies = await getPortalCookies(base);
          }
          if (downloadCookies) {
            const downloaded = await sippy.downloadTariffXlsxFromPortal(base, Number(tariffId), downloadCookies);
            if (downloaded) {
              const { buf, patchedRows, log } = sippy.patchDownloadedTariffXlsx(
                downloaded, prefix, rateNum, normDate(effectiveFrom), normDate(effectiveTill),
              );
              xlsxBuf = buf;
              method  = 'download-patch';
              console.log(`[RateManager] download-test-xlsx: P1 success — tariff=${tariffId} patchedRows=${patchedRows}`);
              for (const line of log) console.log(`[RateManager] ${line}`);
            } else {
              console.log(`[RateManager] download-test-xlsx: P1 download returned null — check logs for probed URLs`);
            }
          } else {
            console.log(`[RateManager] download-test-xlsx: P1 skip — no portal cookies available`);
          }
        } catch (p1e: any) {
          console.log(`[RateManager] download-test-xlsx: P1 error: ${p1e?.message}`);
        }
      }

      // ── P2: XML-RPC reconstruct (fallback) ──────────────────────────────
      if (!xlsxBuf!) {
        const u = session?.xmlRpcUsername ?? '';
        const p = session?.xmlRpcPassword ?? '';
        let allRates: any[] = [];
        if (u && p && base) {
          allRates = await sippy.getTariffRatesListFull(u, p, Number(tariffId), undefined, 1000);
          console.log(`[RateManager] download-test-xlsx: P2 XML-RPC — ${allRates.length} rates fetched`);
        }
        if (allRates.length > 0) {
          xlsxBuf = sippy.buildFullTariffXlsx(allRates, prefix, rateNum, normDate(effectiveFrom), normDate(effectiveTill));
        } else {
          xlsxBuf = sippy.buildRateXlsx('A', null, prefix, '', rateNum, normDate(effectiveFrom), normDate(effectiveTill));
          method  = 'single-row-fallback';
        }
      }

      const filename = `sippy_tariff${tariffId}_${prefix}_${method}_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Upload-Method', method);
      res.send(xlsxBuf!);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Debug: list and download auto-saved rate-push XLSX files ─────────────
  // GET /api/rate-manager/push-xlsx-list   → lists files in /tmp/rate-push-*.xlsx
  // GET /api/rate-manager/push-xlsx-download?file=<name>  → downloads one file
  app.get('/api/rate-manager/push-xlsx-list', async (_req: any, res) => {
    try {
      const { readdirSync, statSync } = await import('fs');
      const files = readdirSync('/tmp')
        .filter(f => f.startsWith('rate-push-') && f.endsWith('.xlsx'))
        .map(f => ({
          name: f,
          size: statSync(`/tmp/${f}`).size,
          mtime: statSync(`/tmp/${f}`).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      res.json(files);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/rate-manager/push-xlsx-download', async (req: any, res) => {
    try {
      const { readFileSync } = await import('fs');
      const name = String(req.query.file ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!name.startsWith('rate-push-') || !name.endsWith('.xlsx')) return res.status(400).json({ error: 'invalid filename' });
      const buf = readFileSync(`/tmp/${name}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Product Rates ──────────────────────────────────────────────────────────

  app.get('/api/product-rates', async (req: any, res) => {
    try {
      const productId = req.query.productId ? Number(req.query.productId) : undefined;
      const rows = await db.select().from(productRates)
        .where(productId !== undefined ? eq(productRates.productId, productId) : undefined as any)
        .orderBy(desc(productRates.createdAt));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/product-rates', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const { productId, destinationId, prefix, rate, currency, effectiveFrom, effectiveTo, notes } = req.body ?? {};
      if (!productId || rate === undefined || !effectiveFrom) {
        return res.status(400).json({ error: 'productId, rate, effectiveFrom required' });
      }
      const [row] = await db.insert(productRates).values({
        productId:     Number(productId),
        destinationId: destinationId ? Number(destinationId) : null,
        prefix:        prefix || null,
        rate:          String(rate),
        currency:      currency || 'USD',
        effectiveFrom,
        effectiveTo:   effectiveTo || null,
        notes:         notes || null,
        createdBy:     req.user?.username || 'operator',
      }).returning();
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/product-rates/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const { prefix, rate, currency, effectiveFrom, effectiveTo, notes, destinationId } = req.body ?? {};
      const [row] = await db.update(productRates)
        .set({
          prefix:        prefix ?? undefined,
          rate:          rate !== undefined ? String(rate) : undefined,
          currency:      currency ?? undefined,
          effectiveFrom: effectiveFrom ?? undefined,
          effectiveTo:   effectiveTo ?? undefined,
          notes:         notes ?? undefined,
          destinationId: destinationId ? Number(destinationId) : undefined,
          updatedAt:     new Date(),
        })
        .where(eq(productRates.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: 'Rate not found' });
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/product-rates/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(productRates).where(eq(productRates.id, id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── T003: Push product rate to Sippy tariffs ──────────────────────────────
  // Auto-discovers affected accounts from customerProductAssignments if
  // accountNames not provided. Logs each push attempt to rate_push_jobs.
  //
  // Body (all optional except covered by auto-discovery):
  //   accountNames?: string[]   — override auto-discovery
  //   format?:       'full' | 'partial' | 'default'

  app.post('/api/product-rates/:id/push-to-sippy',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        const rateId = Number(req.params.id);
        if (isNaN(rateId)) return res.status(400).json({ error: 'Invalid rate id' });

        const [rateRow] = await db.select().from(productRates).where(eq(productRates.id, rateId)).limit(1);
        if (!rateRow) return res.status(404).json({ error: 'Rate not found' });

        const prefix    = rateRow.prefix;
        const ratePerMin = Number(rateRow.rate);
        if (!prefix) return res.status(400).json({ error: 'Rate has no prefix — cannot push to Sippy without a destination prefix' });

        // Get product info for trunk prefix
        const [product] = await db.select().from(productRegistry).where(eq(productRegistry.id, rateRow.productId)).limit(1);
        const trunkPrefix = (product as any)?.trunkPrefix ?? '';
        const fullPrefix  = trunkPrefix + prefix;   // BitsAuto catalogue identifier — audit only, never sent to Sippy
        const dialPrefix  = sippy.resolveSippyPrefix(prefix, trunkPrefix);  // bare prefix Sippy uses for routing

        // Auto-discover account names from product customer assignments
        let { accountNames, format } = req.body ?? {};
        if (!Array.isArray(accountNames) || accountNames.length === 0) {
          const assignments = await db.select().from(customerProductAssignments)
            .where(and(
              eq(customerProductAssignments.productId, rateRow.productId),
              eq(customerProductAssignments.status, 'active'),
            ));
          const iAccounts = assignments.map(a => a.iAccount).filter(Boolean);
          if (iAccounts.length === 0) {
            return res.status(400).json({ error: 'No active customer assignments for this product — provide accountNames or assign customers first' });
          }
          const allCompanies = await storage.listCompanies();
          accountNames = iAccounts
            .map(ia => allCompanies.find(c => c.sippyIAccount === ia)?.name)
            .filter((n): n is string => Boolean(n));
          // Also build iAccount→sippyIAccount map for direct tariff lookup
          const accountIAccountMap: Record<string, string> = {};
          for (const ia of iAccounts) {
            const c = allCompanies.find(co => co.sippyIAccount === ia);
            if (c?.name) accountIAccountMap[c.name] = String(ia);
          }
        }

        if (accountNames.length === 0) {
          return res.status(400).json({ error: 'Could not resolve any Sippy account names for the product assignments' });
        }

        const { username, password, portalUrl } = await getSippyCreds();
        if (!username) return res.status(503).json({ error: 'Sippy not configured' });

        const results: Array<{ accountName: string; success: boolean; message: string; method?: string }> = [];

        for (const accountName of accountNames) {
          try {
            const r = await sippy.pushRateToSippy(
              {
                accountName,
                iAccount:    accountIAccountMap[accountName],
                prefix:      fullPrefix,   // fullPrefix = trunkPrefix + dialPrefix — Sippy tariffs store full prefixes (e.g. 29233 for Business Class)
                ratePerMin,
                effectiveFrom: rateRow.effectiveFrom ? new Date(rateRow.effectiveFrom) : undefined,
                effectiveTo:   rateRow.effectiveTo   ? new Date(rateRow.effectiveTo)   : undefined,
                format: format ?? 'full',
              },
              { username, password },
              portalUrl,
            );
            results.push({ accountName, success: r.success ?? false, message: r.message ?? '', method: (r as any).method });
          } catch (err: any) {
            results.push({ accountName, success: false, message: err.message });
          }
        }

        // Log to rate_push_jobs for audit trail
        const successCount = results.filter(r => r.success).length;
        try {
          const jobId = `push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await db.insert(ratePushJobs).values({
            jobId,
            productName:   product?.name ?? `product-${rateRow.productId}`,
            trunkPrefix:   trunkPrefix || null,
            format:        (format as any) || 'full',
            rateType:      'current',
            totalClients:  accountNames.length,
            pushedClients: successCount,
            failedClients: accountNames.length - successCount,
            status:        successCount === accountNames.length ? 'completed' : successCount > 0 ? 'partial' : 'failed',
            notes:         results.map(r => `${r.accountName}:${r.success ? 'ok' : r.message}`).join(' | '),
            createdBy:     req.user?.username || 'operator',
          }).catch((e: any) => { console.error('[rate_push_jobs] product-rates insert failed:', e?.message || e); });
        } catch (e: any) { console.error('[rate_push_jobs] product-rates outer catch:', e?.message || e); }

        res.json({
          prefix:       fullPrefix,
          ratePerMin,
          accountCount: accountNames.length,
          successCount,
          results,
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    },
  );

  // ── Accounts on Tariff (helper for notifications) ──────────────────────────

  app.get('/api/rate-notifications/accounts-on-tariff/:tariffId', async (req: any, res) => {
    try {
      const tariffId = req.params.tariffId;
      const allCompanies = await storage.listCompanies();
      const affected = allCompanies
        .filter(c => c.sippyITariff && String(c.sippyITariff) === tariffId)
        .map(c => ({ iAccount: c.sippyIAccount, name: c.name, tariff: c.sippyITariff }));
      res.json({ tariffId, count: affected.length, accounts: affected });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Rate Notifications ─────────────────────────────────────────────────────

  // T004: GET supports ?days=7 to return only the rolling 7-day queue.
  // Use ?days=0 (or omit) to return full history (last 200 rows).
  app.get('/api/rate-notifications', async (req: any, res) => {
    try {
      const days = req.query.days ? Number(req.query.days) : 0;
      let query = db.select().from(rateNotifications);
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 86400 * 1000);
        query = query.where(gte(rateNotifications.createdAt, cutoff)) as any;
      }
      const rows = await (query as any).orderBy(desc(rateNotifications.createdAt)).limit(days > 0 ? 500 : 200);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/rate-notifications', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const { tariffId, productId, notificationType, subject, message, scheduledFor } = req.body ?? {};
      if (!notificationType || !subject) {
        return res.status(400).json({ error: 'notificationType, subject required' });
      }

      // Auto-compute affected accounts from tariffId
      let affectedAccounts: number[] = [];
      let affectedCount = 0;
      if (tariffId) {
        const allCompanies = await storage.listCompanies();
        const matched = allCompanies.filter(c => c.sippyITariff && String(c.sippyITariff) === tariffId);
        affectedAccounts = matched.map(c => c.sippyIAccount).filter((x): x is number => x !== null && x !== undefined);
        affectedCount = affectedAccounts.length;
      }

      const [row] = await db.insert(rateNotifications).values({
        tariffId:         tariffId || null,
        productId:        productId ? Number(productId) : null,
        notificationType: notificationType || 'rate_change',
        subject,
        message:          message || null,
        affectedAccounts: affectedAccounts.length > 0 ? affectedAccounts : null,
        affectedCount,
        scheduledFor:     scheduledFor ? new Date(scheduledFor) : null,
        status:           'pending',
        createdBy:        req.user?.username || 'operator',
      }).returning();
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/rate-notifications/:id', (req: any, res, next) => requireRole(['admin', 'management'], req, res, next), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body ?? {};
      const update: any = { status };
      if (status === 'sent') update.sentAt = new Date();
      const [row] = await db.update(rateNotifications).set(update).where(eq(rateNotifications.id, id)).returning();
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Carrier Reconciliation — Per-row CDR analysis ─────────────────────────

  app.post('/api/carrier-reconciliations/row-analysis', async (req: any, res) => {
    try {
      const { iTariff, periodStart, periodEnd, cdrPool } = req.body ?? {};
      if (!iTariff || !periodStart || !periodEnd) {
        return res.status(400).json({ error: 'iTariff, periodStart, periodEnd required' });
      }

      const snapshots = await storage.listInvoiceCdrSnapshots({ iTariff, limit: 10000 });
      const inPeriod = snapshots.filter(s => {
        if (!s.cdrStartTime) return false;
        const d = String(s.cdrStartTime).slice(0, 10);
        return d >= periodStart && d <= periodEnd;
      });

      const pool = Array.isArray(cdrPool) ? cdrPool : [];
      const results = reconcilePerRow(inPeriod as any, pool);

      const summary = {
        total:       results.length,
        matched:     results.filter(r => r.matched).length,
        unmatched:   results.filter(r => r.status === 'unmatched').length,
        costDrift:   results.filter(r => r.status === 'cost_drift').length,
        missingCdr:  results.filter(r => r.status === 'missing_cdr').length,
        tier1:       results.filter(r => r.tier === 1).length,
        tier2:       results.filter(r => r.tier === 2).length,
        tier3:       results.filter(r => r.tier === 3).length,
        totalCostDelta: results.reduce((s, r) => s + Math.abs(r.costDelta ?? 0), 0),
      };

      res.json({ summary, results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── T006: Pricing Intelligence — margin recommendations with CDR cost ──────
  // Analyses product rates vs CDR-derived vendor cost to recommend adjustments.
  // When the CDR pool is available (setRateMgrCdrProvider wired), computes avg
  // vendor cost per minute per product and flags margin squeeze risk.

  app.get('/api/pricing-intelligence', async (req: any, res) => {
    try {
      const productId = req.query.productId ? Number(req.query.productId) : null;

      const rates = await db.select().from(productRates)
        .where(productId !== null ? eq(productRates.productId, productId) : undefined as any);

      const products = await db.select().from(productRegistry).where(eq(productRegistry.status, 'commercial'));

      const assignments = await db.select().from(customerProductAssignments)
        .where(eq(customerProductAssignments.status, 'active'));

      // T006: Build per-product CDR vendor cost from live cdrCache.
      // Groups CDRs by iAccount → product assignment → compute avg vendorCost/min.
      const cdrVendorCostByProduct = new Map<number, { totalCost: number; totalMin: number; sampleSize: number }>();
      if (_rateMgrCdrFn) {
        try {
          const pool = _rateMgrCdrFn();
          for (const c of pool) {
            const iAccount = (c as any).iAccount;
            if (!iAccount) continue;
            const vendorCostPerCall = (c as any).vendorCost ?? (c as any).cost ?? null;
            if (vendorCostPerCall == null) continue;
            const durationMin = Number((c as any).duration ?? 0) / 60;
            if (durationMin <= 0) continue;
            // Find product assigned to this account
            const assignment = assignments.find(a => a.iAccount === iAccount || String(a.iAccount) === String(iAccount));
            if (!assignment) continue;
            const pId = assignment.productId;
            if (!cdrVendorCostByProduct.has(pId)) cdrVendorCostByProduct.set(pId, { totalCost: 0, totalMin: 0, sampleSize: 0 });
            const entry = cdrVendorCostByProduct.get(pId)!;
            entry.totalCost  += Number(vendorCostPerCall);
            entry.totalMin   += durationMin;
            entry.sampleSize += 1;
          }
        } catch { /* non-fatal */ }
      }

      const recommendations: Array<{
        productId:          number;
        productName:        string;
        rateCount:          number;
        customerCount:      number;
        avgRate:            number | null;
        avgVendorCostPerMin: number | null;
        marginSpreadPct:    number | null;
        cdrSampleSize:      number;
        recommendation:     string;
        priority:           'high' | 'medium' | 'low';
        riskFlag:           'margin_squeeze' | 'no_rates' | 'no_customers' | 'healthy' | 'unknown';
      }> = [];

      for (const prod of products) {
        const prodRates   = rates.filter(r => r.productId === prod.id);
        const customers   = assignments.filter(a => a.productId === prod.id);
        const avgRate     = prodRates.length > 0
          ? prodRates.reduce((s, r) => s + Number(r.rate), 0) / prodRates.length
          : null;

        // T006: CDR-derived vendor cost for this product
        const cdrStats = cdrVendorCostByProduct.get(prod.id);
        const avgVendorCostPerMin = cdrStats && cdrStats.totalMin > 0
          ? cdrStats.totalCost / cdrStats.totalMin
          : null;
        const cdrSampleSize = cdrStats?.sampleSize ?? 0;

        // Margin spread: (avgRate - avgVendorCost) / avgRate × 100
        const marginSpreadPct = avgRate && avgVendorCostPerMin != null && avgRate > 0
          ? ((avgRate - avgVendorCostPerMin) / avgRate) * 100
          : null;

        let recommendation = '';
        let priority: 'high' | 'medium' | 'low' = 'low';
        let riskFlag: 'margin_squeeze' | 'no_rates' | 'no_customers' | 'healthy' | 'unknown' = 'unknown';

        if (prodRates.length === 0 && customers.length > 0) {
          recommendation = `${customers.length} customer(s) assigned but no product rates configured — set rates to enable automated billing`;
          priority = 'high';
          riskFlag = 'no_rates';
        } else if (prodRates.length > 0 && customers.length === 0) {
          recommendation = 'Rates configured but no customers assigned — add customer assignments to activate commercial flow';
          priority = 'medium';
          riskFlag = 'no_customers';
        } else if (marginSpreadPct != null && marginSpreadPct < 10) {
          recommendation = `Margin squeeze detected: avg spread ${marginSpreadPct.toFixed(1)}% (avg rate ${avgRate?.toFixed(4)}/min vs avg vendor cost ${avgVendorCostPerMin?.toFixed(4)}/min from ${cdrSampleSize} CDRs). Review pricing urgently.`;
          priority = 'high';
          riskFlag = 'margin_squeeze';
        } else if (marginSpreadPct != null && marginSpreadPct < 20) {
          recommendation = `Margin at risk: ${marginSpreadPct.toFixed(1)}% spread — below 20% threshold. Consider rate review (${cdrSampleSize} CDR sample).`;
          priority = 'medium';
          riskFlag = 'margin_squeeze';
        } else if (prodRates.length > 0 && customers.length > 0) {
          const spreadNote = marginSpreadPct != null ? ` Margin spread: ${marginSpreadPct.toFixed(1)}%.` : '';
          recommendation = `Active: ${prodRates.length} rate(s), ${customers.length} customer(s).${spreadNote} Review rates quarterly for margin protection.`;
          priority = 'low';
          riskFlag = 'healthy';
        } else {
          recommendation = 'No rates or customers — product is not commercially active';
          priority = 'low';
          riskFlag = 'unknown';
        }

        recommendations.push({
          productId:          prod.id,
          productName:        prod.name,
          rateCount:          prodRates.length,
          customerCount:      customers.length,
          avgRate:            avgRate !== null ? +avgRate.toFixed(6) : null,
          avgVendorCostPerMin: avgVendorCostPerMin !== null ? +avgVendorCostPerMin.toFixed(6) : null,
          marginSpreadPct:    marginSpreadPct !== null ? +marginSpreadPct.toFixed(2) : null,
          cdrSampleSize,
          recommendation,
          priority,
          riskFlag,
        });
      }

      recommendations.sort((a, b) => {
        const p = { high: 0, medium: 1, low: 2 };
        return p[a.priority] - p[b.priority];
      });

      res.json({
        recommendations,
        cdrPoolAvailable: _rateMgrCdrFn !== null,
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
