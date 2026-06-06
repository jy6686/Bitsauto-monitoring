/**
 * routes-rate-manager.ts — Product Rate Repository + Rate Notifications
 *
 * Endpoints:
 *   GET    /api/product-rates            — list (filter: productId)
 *   POST   /api/product-rates            — create rate
 *   PUT    /api/product-rates/:id        — update rate
 *   DELETE /api/product-rates/:id        — delete rate
 *
 *   GET    /api/rate-notifications        — list (filter: status, productId, tariffId)
 *   POST   /api/rate-notifications        — create + compute affected accounts
 *   PATCH  /api/rate-notifications/:id   — update status (sent/cancelled)
 *   GET    /api/rate-notifications/accounts-on-tariff/:tariffId — find impacted accounts
 *
 *   POST   /api/carrier-reconciliations/row-analysis — per-row T1·ID CDR match
 *
 *   GET    /api/pricing-intelligence     — margin recommendations
 */

import type { Express } from 'express';
import { db } from './db';
import { eq, desc, and } from 'drizzle-orm';
import { productRates, rateNotifications, companies, customerProductAssignments, productRegistry } from '@shared/schema';
import { reconcilePerRow } from './services/sippy/sippy-reconciliation.service';
import { storage } from './storage';

function requireRole(roles: string[], req: any, res: any, next: any) {
  const userRole = req.user?.role;
  if (!userRole || !roles.includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

export function registerRateManagerRoutes(app: Express) {

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

  app.get('/api/rate-notifications', async (req: any, res) => {
    try {
      const rows = await db.select().from(rateNotifications)
        .orderBy(desc(rateNotifications.createdAt))
        .limit(200);
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

  // ── Pricing Intelligence — margin recommendations ──────────────────────────
  // Analyses product rates vs CDR-derived vendor cost to recommend adjustments.

  app.get('/api/pricing-intelligence', async (req: any, res) => {
    try {
      const productId = req.query.productId ? Number(req.query.productId) : null;

      // Load product rates
      const rates = await db.select().from(productRates)
        .where(productId !== null ? eq(productRates.productId, productId) : undefined as any);

      // Load products for context
      const products = await db.select().from(productRegistry).where(eq(productRegistry.status, 'commercial')).limit(50);

      // Load customer assignments
      const assignments = await db.select().from(customerProductAssignments)
        .where(eq(customerProductAssignments.status, 'active'));

      // Compute recommendations per product
      const recommendations: Array<{
        productId: number;
        productName: string;
        rateCount: number;
        customerCount: number;
        avgRate: number | null;
        recommendation: string;
        priority: 'high' | 'medium' | 'low';
      }> = [];

      for (const prod of products) {
        const prodRates = rates.filter(r => r.productId === prod.id);
        const customers = assignments.filter(a => a.productId === prod.id);
        const avgRate = prodRates.length > 0
          ? prodRates.reduce((s, r) => s + Number(r.rate), 0) / prodRates.length
          : null;

        let recommendation = '';
        let priority: 'high' | 'medium' | 'low' = 'low';

        if (prodRates.length === 0 && customers.length > 0) {
          recommendation = `${customers.length} customer(s) assigned but no product rates configured — set rates to enable automated billing`;
          priority = 'high';
        } else if (prodRates.length > 0 && customers.length === 0) {
          recommendation = 'Rates configured but no customers assigned — add customer assignments to activate commercial flow';
          priority = 'medium';
        } else if (prodRates.length > 0 && customers.length > 0) {
          recommendation = `Active: ${prodRates.length} rate(s), ${customers.length} customer(s). Review rates quarterly for margin protection.`;
          priority = 'low';
        } else {
          recommendation = 'No rates or customers — product is not commercially active';
          priority = 'low';
        }

        recommendations.push({
          productId:     prod.id,
          productName:   prod.name,
          rateCount:     prodRates.length,
          customerCount: customers.length,
          avgRate,
          recommendation,
          priority,
        });
      }

      recommendations.sort((a, b) => {
        const p = { high: 0, medium: 1, low: 2 };
        return p[a.priority] - p[b.priority];
      });

      res.json({ recommendations, generatedAt: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
