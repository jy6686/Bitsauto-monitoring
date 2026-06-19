/**
 * routes-product-templates.ts — Routing Templates, Pricing Templates, Auto-Provisioning
 *
 * Endpoints:
 *   GET    /api/product-registry/routing-templates              — list (with vendors)
 *   POST   /api/product-registry/routing-templates              — create template
 *   PUT    /api/product-registry/routing-templates/:id          — update template
 *   DELETE /api/product-registry/routing-templates/:id          — delete template + vendors
 *   POST   /api/product-registry/routing-templates/:id/vendors  — add vendor
 *   PUT    /api/product-registry/routing-templates/:id/vendors/:vid — update vendor
 *   DELETE /api/product-registry/routing-templates/:id/vendors/:vid — remove vendor
 *
 *   GET    /api/product-registry/pricing-templates              — list (with rates)
 *   POST   /api/product-registry/pricing-templates              — create template
 *   PUT    /api/product-registry/pricing-templates/:id          — update template
 *   DELETE /api/product-registry/pricing-templates/:id          — delete template + rates
 *   POST   /api/product-registry/pricing-templates/:id/rates    — add rate row
 *   PUT    /api/product-registry/pricing-templates/:id/rates/:rid — update rate row
 *   DELETE /api/product-registry/pricing-templates/:id/rates/:rid — delete rate row
 *
 *   POST   /api/product-registry/provision/preview              — dry-run provisioning plan
 *   POST   /api/product-registry/provision/execute              — run provisioning against Sippy
 *   GET    /api/product-registry/provision/jobs                 — job history
 */

import type { Express } from 'express';
import { db } from './db';
import { eq, asc } from 'drizzle-orm';
import {
  routingTemplates, routingTemplateVendors,
  pricingTemplates, pricingTemplateRates,
  provisioningJobs, productRegistry, customerProductAssignments,
} from '@shared/schema';
import { storage } from './storage';
import * as sippy from './sippy';

async function getSippyCreds() {
  const settings = await storage.getSettings();
  const s = settings as any;
  return {
    username: s.apiAdminUsername || s.portalUsername || '',
    password: s.apiAdminPassword || s.portalPassword || '',
    portalUrl: s.portalUrl || '',
  };
}

export function registerProductTemplatesRoutes(app: Express) {

  // ── Routing Templates ─────────────────────────────────────────────────────

  app.get('/api/product-registry/routing-templates', async (_req, res) => {
    try {
      const templates = await db.select().from(routingTemplates).orderBy(asc(routingTemplates.productId), asc(routingTemplates.name));
      const vendors   = await db.select().from(routingTemplateVendors).orderBy(asc(routingTemplateVendors.priority));
      const result = templates.map(t => ({
        ...t,
        vendors: vendors.filter(v => v.templateId === t.id),
      }));
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/product-registry/routing-templates', async (req, res) => {
    try {
      const { name, productId, description, isDefault } = req.body;
      const [t] = await db.insert(routingTemplates).values({ name, productId, description, isDefault: isDefault ?? false }).returning();
      res.json(t);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/product-registry/routing-templates/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description, isDefault } = req.body;
      const [t] = await db.update(routingTemplates).set({ name, description, isDefault }).where(eq(routingTemplates.id, id)).returning();
      res.json(t);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/product-registry/routing-templates/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(routingTemplateVendors).where(eq(routingTemplateVendors.templateId, id));
      await db.delete(routingTemplates).where(eq(routingTemplates.id, id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/product-registry/routing-templates/:id/vendors', async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      const { vendorName, iConnection, iDestinationSet, priority, weight, active, note } = req.body;
      const [v] = await db.insert(routingTemplateVendors).values({
        templateId, vendorName,
        iConnection: iConnection ? parseInt(iConnection) : null,
        iDestinationSet: iDestinationSet ? parseInt(iDestinationSet) : null,
        priority: priority ?? 0, weight: weight ?? 1, active: active ?? true, note,
      }).returning();
      res.json(v);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/product-registry/routing-templates/:id/vendors/:vid', async (req, res) => {
    try {
      const vid = parseInt(req.params.vid);
      const { vendorName, iConnection, iDestinationSet, priority, weight, active, note } = req.body;
      const [v] = await db.update(routingTemplateVendors).set({
        vendorName,
        iConnection: iConnection ? parseInt(iConnection) : null,
        iDestinationSet: iDestinationSet ? parseInt(iDestinationSet) : null,
        priority, weight, active, note,
      }).where(eq(routingTemplateVendors.id, vid)).returning();
      res.json(v);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/product-registry/routing-templates/:id/vendors/:vid', async (req, res) => {
    try {
      const vid = parseInt(req.params.vid);
      await db.delete(routingTemplateVendors).where(eq(routingTemplateVendors.id, vid));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Pricing Templates ─────────────────────────────────────────────────────

  app.get('/api/product-registry/pricing-templates', async (_req, res) => {
    try {
      const templates = await db.select().from(pricingTemplates).orderBy(asc(pricingTemplates.productId), asc(pricingTemplates.name));
      const rates     = await db.select().from(pricingTemplateRates).orderBy(asc(pricingTemplateRates.dialPrefix));
      const result = templates.map(t => ({
        ...t,
        rates: rates.filter(r => r.templateId === t.id),
      }));
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/product-registry/pricing-templates', async (req, res) => {
    try {
      const { name, productId, description, isDefault } = req.body;
      const [t] = await db.insert(pricingTemplates).values({ name, productId, description, isDefault: isDefault ?? false }).returning();
      res.json(t);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/product-registry/pricing-templates/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description, isDefault } = req.body;
      const [t] = await db.update(pricingTemplates).set({ name, description, isDefault }).where(eq(pricingTemplates.id, id)).returning();
      res.json(t);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/product-registry/pricing-templates/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(pricingTemplateRates).where(eq(pricingTemplateRates.templateId, id));
      await db.delete(pricingTemplates).where(eq(pricingTemplates.id, id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/product-registry/pricing-templates/:id/rates', async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      const { dialPrefix, countryName, operatorName, buyRate, marginPct, notes } = req.body;
      const buy  = parseFloat(buyRate);
      const mPct = parseFloat(marginPct);
      const sell = (buy * (1 + mPct / 100)).toFixed(6);
      const [r] = await db.insert(pricingTemplateRates).values({
        templateId, dialPrefix, countryName, operatorName,
        buyRate: String(buy), marginPct: String(mPct), sellRate: sell, notes,
      }).returning();
      res.json(r);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/product-registry/pricing-templates/:id/rates/:rid', async (req, res) => {
    try {
      const rid = parseInt(req.params.rid);
      const { dialPrefix, countryName, operatorName, buyRate, marginPct, notes } = req.body;
      const buy  = parseFloat(buyRate);
      const mPct = parseFloat(marginPct);
      const sell = (buy * (1 + mPct / 100)).toFixed(6);
      const [r] = await db.update(pricingTemplateRates).set({
        dialPrefix, countryName, operatorName,
        buyRate: String(buy), marginPct: String(mPct), sellRate: sell, notes,
      }).where(eq(pricingTemplateRates.id, rid)).returning();
      res.json(r);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/product-registry/pricing-templates/:id/rates/:rid', async (req, res) => {
    try {
      const rid = parseInt(req.params.rid);
      await db.delete(pricingTemplateRates).where(eq(pricingTemplateRates.id, rid));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Provisioning ──────────────────────────────────────────────────────────

  async function getProvisioningPlan(iAccount: number, productId: number) {
    const products = await db.select().from(productRegistry).where(eq(productRegistry.id, productId));
    if (!products.length) throw new Error('Product not found');
    const product = products[0];

    const rtList  = await db.select().from(routingTemplates).where(eq(routingTemplates.productId, productId)).orderBy(asc(routingTemplates.createdAt));
    const defaultRT = rtList.find(t => t.isDefault) ?? rtList[0] ?? null;
    const vendors   = defaultRT
      ? await db.select().from(routingTemplateVendors).where(eq(routingTemplateVendors.templateId, defaultRT.id)).orderBy(asc(routingTemplateVendors.priority))
      : [];

    const ptList   = await db.select().from(pricingTemplates).where(eq(pricingTemplates.productId, productId)).orderBy(asc(pricingTemplates.createdAt));
    const defaultPT = ptList.find(t => t.isDefault) ?? ptList[0] ?? null;
    const rates     = defaultPT
      ? await db.select().from(pricingTemplateRates).where(eq(pricingTemplateRates.templateId, defaultPT.id)).orderBy(asc(pricingTemplateRates.dialPrefix))
      : [];

    const steps: { step: string; description: string; warning?: string }[] = [];
    if (defaultPT) {
      steps.push({ step: 'create_tariff', description: `Create Sippy tariff "${product.code} — ${defaultPT.name}" with ${rates.length} rate(s)` });
      if (rates.length === 0) steps[steps.length - 1].warning = 'No rates defined in this pricing template';
    } else {
      steps.push({ step: 'skip_tariff', description: 'No pricing template — tariff will not be created', warning: 'Add a pricing template to enable auto-tariff creation' });
    }
    if (defaultRT) {
      const autoVendors = vendors.filter(v => v.iConnection && v.iDestinationSet);
      steps.push({ step: 'create_routing_group', description: `Create routing group "${product.code} — ${defaultRT.name}" with ${vendors.length} vendor(s) (${autoVendors.length} fully configured for auto-add)` });
      if (autoVendors.length < vendors.length) steps[steps.length - 1].warning = 'Some vendors missing i_connection or i_destination_set — will be listed but not auto-added';
    } else {
      steps.push({ step: 'skip_routing_group', description: 'No routing template — routing group will not be created', warning: 'Add a routing template to enable auto-group creation' });
    }
    steps.push({ step: 'assign_account', description: `Assign tariff + routing group to Sippy account #${iAccount}` });
    steps.push({ step: 'record_assignment', description: `Record customer ↔ product assignment in platform` });

    return { product, routingTemplate: defaultRT ? { ...defaultRT, vendors } : null, pricingTemplate: defaultPT ? { ...defaultPT, rates } : null, steps };
  }

  app.post('/api/product-registry/provision/preview', async (req, res) => {
    try {
      const { iAccount, productId } = req.body;
      const plan = await getProvisioningPlan(parseInt(iAccount), parseInt(productId));
      res.json(plan);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/product-registry/provision/execute', async (req: any, res) => {
    const { iAccount, productId } = req.body;
    const iAcc = parseInt(iAccount);
    const iProd = parseInt(productId);
    const log: { step: string; status: 'ok' | 'error' | 'skipped'; detail?: string }[] = [];

    try {
      const { username, password, portalUrl } = await getSippyCreds();
      if (!username) return res.status(503).json({ error: 'Sippy not configured' });

      const plan = await getProvisioningPlan(iAcc, iProd);
      const { product, routingTemplate, pricingTemplate } = plan;

      let iTariff: number | undefined;
      let iRoutingGroup: number | undefined;

      // Step 1 — Create tariff + push rates
      if (pricingTemplate && pricingTemplate.rates.length > 0) {
        try {
          const tariffName = `${product.code} — ${pricingTemplate.name}`;
          const res2 = await sippy.createTariff(username, password, { name: tariffName, currency: 'USD' });
          iTariff = res2.iTariff;
          log.push({ step: 'create_tariff', status: 'ok', detail: `Created tariff "${tariffName}" (ID: ${iTariff})` });

          if (iTariff && product.trunkPrefix) {
            let pushed = 0;
            for (const rate of pricingTemplate.rates) {
              try {
                await sippy.pushRateToSippy({
                  iTariff,
                  prefix: product.trunkPrefix + rate.dialPrefix,
                  destination: [rate.countryName, rate.operatorName].filter(Boolean).join(' ') || rate.dialPrefix,
                  rate: parseFloat(rate.sellRate),
                  accountName: `Tariff ${tariffName}`,
                }, { username, password }, portalUrl);
                pushed++;
              } catch (e: any) {
                log.push({ step: 'push_rate', status: 'error', detail: `${rate.dialPrefix}: ${e.message}` });
              }
            }
            log.push({ step: 'push_rates', status: 'ok', detail: `Pushed ${pushed}/${pricingTemplate.rates.length} rates` });
          } else if (!product.trunkPrefix) {
            log.push({ step: 'push_rates', status: 'skipped', detail: 'Product has no trunk prefix — rates not pushed' });
          }
        } catch (e: any) {
          log.push({ step: 'create_tariff', status: 'error', detail: e.message });
        }
      } else {
        log.push({ step: 'create_tariff', status: 'skipped', detail: 'No pricing template or no rates defined' });
      }

      // Step 2 — Create routing group + add vendors
      if (routingTemplate) {
        try {
          const rgName = `${product.code} — ${routingTemplate.name}`;
          const rgRes = await sippy.addRoutingGroup(username, password, rgName, 'Priority', { portalUrl });
          if (rgRes.success && rgRes.iRoutingGroup) {
            iRoutingGroup = rgRes.iRoutingGroup;
            log.push({ step: 'create_routing_group', status: 'ok', detail: `Created routing group "${rgName}" (ID: ${iRoutingGroup})` });
            const autoVendors = routingTemplate.vendors.filter(v => v.iConnection && v.iDestinationSet);
            for (const vendor of autoVendors) {
              try {
                await sippy.addRoutingGroupMember(username, password, iRoutingGroup!, vendor.iDestinationSet!, vendor.priority, { iConnection: vendor.iConnection!, weight: vendor.weight, portalUrl });
              } catch (e: any) {
                log.push({ step: 'add_vendor', status: 'error', detail: `${vendor.vendorName}: ${e.message}` });
              }
            }
            if (autoVendors.length > 0) log.push({ step: 'add_vendors', status: 'ok', detail: `Added ${autoVendors.length} vendor(s) to routing group` });
          } else {
            log.push({ step: 'create_routing_group', status: 'error', detail: rgRes.message });
          }
        } catch (e: any) {
          log.push({ step: 'create_routing_group', status: 'error', detail: e.message });
        }
      } else {
        log.push({ step: 'create_routing_group', status: 'skipped', detail: 'No routing template defined' });
      }

      // Step 3 — Assign tariff + routing group to account
      if (iTariff || iRoutingGroup) {
        try {
          const r = await sippy.updateAccountSettings(username, password, portalUrl, iAcc, {
            ...(iTariff       ? { } : {}),
            ...(iRoutingGroup ? { iRoutingGroup } : {}),
          });
          // Also update i_tariff if we got one (updateAccountSettings doesn't have iTariff param — use updateAccount directly)
          if (iTariff) {
            const { sippyPost, xmlRpcCall } = sippy as any;
            if (sippyPost && xmlRpcCall) {
              const base = portalUrl.replace(/\/?$/, '');
              const apiUrl = `${base}/xmlapi/xmlapi`;
              const body = (xmlRpcCall as Function)('customer.updateAccount', { i_account: iAcc, i_tariff: iTariff });
              await (sippyPost as Function)(apiUrl, body, username, password);
            }
          }
          log.push({ step: 'assign_account', status: r.success ? 'ok' : 'error', detail: r.message });
        } catch (e: any) {
          log.push({ step: 'assign_account', status: 'error', detail: e.message });
        }
      } else {
        log.push({ step: 'assign_account', status: 'skipped', detail: 'Nothing to assign (no tariff or routing group created)' });
      }

      // Step 4 — Record assignment in platform
      try {
        const existing = await db.select().from(customerProductAssignments).where(eq(customerProductAssignments.iAccount, iAcc));
        if (!existing.find(a => a.productId === iProd)) {
          await db.insert(customerProductAssignments).values({ productId: iProd, iAccount: iAcc, status: 'active' });
        }
        log.push({ step: 'record_assignment', status: 'ok', detail: 'Customer–product assignment recorded' });
      } catch (e: any) {
        log.push({ step: 'record_assignment', status: 'error', detail: e.message });
      }

      const overallStatus = log.some(s => s.status === 'error') ? 'partial' : 'completed';
      await db.insert(provisioningJobs).values({
        iAccount: iAcc, productId: iProd,
        routingTemplateId: routingTemplate?.id ?? null,
        pricingTemplateId: pricingTemplate?.id ?? null,
        status: overallStatus, steps: JSON.stringify(log),
        iTariff: iTariff ?? null, iRoutingGroup: iRoutingGroup ?? null,
        createdBy: (req as any).user?.username ?? 'operator',
        completedAt: new Date(),
      });

      res.json({ success: true, status: overallStatus, steps: log, iTariff, iRoutingGroup });
    } catch (e: any) {
      res.status(500).json({ error: e.message, steps: log });
    }
  });

  app.get('/api/product-registry/provision/jobs', async (_req, res) => {
    try {
      const jobs = await db.select().from(provisioningJobs).orderBy(asc(provisioningJobs.createdAt));
      const result = jobs.map(j => ({ ...j, steps: j.steps ? JSON.parse(j.steps) : [] }));
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
