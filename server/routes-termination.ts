/**
 * Termination Chains — API Routes
 * Full end-to-end entity mapping: REVE → BitsAuto → Asterisk → Sippy → Vendor
 */
import type { Express } from 'express';
import { db } from './db';
import { terminationChains, bhaooProfiles } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  listSippyVendors,
  listVendorConnections,
  listSippyAccounts,
  listRoutingGroups,
} from './sippy';

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function sippyCreds() {
  return {
    username: process.env.SIPPY_PROV_USERNAME || process.env.PORTAL_USERNAME || '',
    password: process.env.SIPPY_PROV_PASSWORD || process.env.PORTAL_PASSWORD || '',
  };
}

export function registerTerminationRoutes(app: Express) {

  // ── List chains ───────────────────────────────────────────────────────────
  app.get('/api/termination/chains', requireAuth, async (_req: any, res: any) => {
    try {
      const chains  = await db.select().from(terminationChains).orderBy(terminationChains.createdAt);
      const profiles = await db.select({ id: bhaooProfiles.id, name: bhaooProfiles.name, baseUrl: bhaooProfiles.baseUrl }).from(bhaooProfiles);
      res.json({ chains, profiles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create chain ──────────────────────────────────────────────────────────
  app.post('/api/termination/chains', requireAuth, async (req: any, res: any) => {
    const {
      name, description, reveProfileId,
      asteriskTrunk, asteriskHost,
      sippyClientAccountId, sippyVendorId, sippyConnectionId, sippyRoutingGroupId,
      sippyClientName, sippyVendorName, sippyConnectionName,
      notes,
    } = req.body ?? {};

    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
      const [row] = await db.insert(terminationChains).values({
        name,
        description:           description     || null,
        reveProfileId:         reveProfileId   ? Number(reveProfileId)   : null,
        asteriskTrunk:         asteriskTrunk   || 'Sippy',
        asteriskHost:          asteriskHost    || '159.223.32.59',
        sippyClientAccountId:  sippyClientAccountId  ? Number(sippyClientAccountId)  : null,
        sippyVendorId:         sippyVendorId         ? Number(sippyVendorId)          : null,
        sippyConnectionId:     sippyConnectionId     ? Number(sippyConnectionId)      : null,
        sippyRoutingGroupId:   sippyRoutingGroupId   ? Number(sippyRoutingGroupId)    : null,
        sippyClientName:       sippyClientName    || null,
        sippyVendorName:       sippyVendorName    || null,
        sippyConnectionName:   sippyConnectionName|| null,
        notes:                 notes              || null,
      }).returning();
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update chain ──────────────────────────────────────────────────────────
  app.patch('/api/termination/chains/:id', requireAuth, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const updates: Record<string, any> = { updatedAt: new Date() };
    const fields = [
      'name','description','reveProfileId','asteriskTrunk','asteriskHost',
      'sippyClientAccountId','sippyVendorId','sippyConnectionId','sippyRoutingGroupId',
      'sippyClientName','sippyVendorName','sippyConnectionName','isActive','notes',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    try {
      const [row] = await db.update(terminationChains).set(updates).where(eq(terminationChains.id, id)).returning();
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Delete chain ──────────────────────────────────────────────────────────
  app.delete('/api/termination/chains/:id', requireAuth, async (req: any, res: any) => {
    try {
      await db.delete(terminationChains).where(eq(terminationChains.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sippy entity lookups ──────────────────────────────────────────────────

  app.get('/api/termination/sippy/vendors', requireAuth, async (_req: any, res: any) => {
    try {
      const { username, password } = sippyCreds();
      const result = await listSippyVendors(username, password, { limit: 200 });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/termination/sippy/vendors/:id/connections', requireAuth, async (req: any, res: any) => {
    try {
      const { username, password } = sippyCreds();
      const result = await listVendorConnections(username, password, Number(req.params.id));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/termination/sippy/accounts', requireAuth, async (req: any, res: any) => {
    try {
      const { username, password } = sippyCreds();
      const limit  = Number(req.query.limit  ?? 100);
      const offset = Number(req.query.offset ?? 0);
      const result = await listSippyAccounts(username, password, { limit, offset });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/termination/sippy/routing-groups', requireAuth, async (_req: any, res: any) => {
    try {
      const { username, password } = sippyCreds();
      const result = await listRoutingGroups(username, password);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Validate chain — probe each hop ──────────────────────────────────────
  app.post('/api/termination/chains/:id/validate', requireAuth, async (req: any, res: any) => {
    const id = Number(req.params.id);
    try {
      const [chain] = await db.select().from(terminationChains).where(eq(terminationChains.id, id));
      if (!chain) return res.status(404).json({ error: 'Chain not found' });

      const hops: { hop: string; status: 'ok' | 'warn' | 'error'; detail: string }[] = [];

      // Hop 1: REVE profile
      if (chain.reveProfileId) {
        const [p] = await db.select().from(bhaooProfiles).where(eq(bhaooProfiles.id, chain.reveProfileId));
        hops.push({ hop: 'REVE', status: p ? 'ok' : 'error', detail: p ? `Profile: ${p.name} (${p.baseUrl})` : 'Profile not found' });
      } else {
        hops.push({ hop: 'REVE', status: 'warn', detail: 'No REVE profile linked' });
      }

      // Hop 2: Asterisk
      const net = await import('net');
      const asteriskOk = await new Promise<boolean>((resolve) => {
        const s = new net.Socket();
        s.setTimeout(3000);
        s.connect(5038, chain.asteriskHost, () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
        s.on('timeout', () => { s.destroy(); resolve(false); });
      });
      hops.push({
        hop: 'Asterisk',
        status: asteriskOk ? 'ok' : 'error',
        detail: asteriskOk
          ? `AMI reachable at ${chain.asteriskHost}:5038, trunk=${chain.asteriskTrunk}`
          : `Cannot reach AMI at ${chain.asteriskHost}:5038`,
      });

      // Hop 3: Sippy vendor
      if (chain.sippyVendorId) {
        const { username, password } = sippyCreds();
        const { vendors } = await listSippyVendors(username, password, { limit: 200 });
        const vendor = vendors.find(v => v.iVendor === chain.sippyVendorId);
        hops.push({ hop: 'Sippy Vendor', status: vendor ? 'ok' : 'error', detail: vendor ? `${vendor.name} (i_vendor=${vendor.iVendor})` : 'Vendor not found in Sippy' });
      } else {
        hops.push({ hop: 'Sippy Vendor', status: 'warn', detail: 'No Sippy vendor linked' });
      }

      // Hop 4: Sippy connection
      if (chain.sippyVendorId && chain.sippyConnectionId) {
        const { username, password } = sippyCreds();
        const { connections } = await listVendorConnections(username, password, chain.sippyVendorId);
        const conn = connections.find(c => c.iConnection === chain.sippyConnectionId);
        hops.push({ hop: 'Sippy Connection', status: conn ? 'ok' : 'error', detail: conn ? `${conn.name} (i_connection=${conn.iConnection})` : 'Connection not found' });
      } else {
        hops.push({ hop: 'Sippy Connection', status: 'warn', detail: 'No Sippy connection linked' });
      }

      const allOk   = hops.every(h => h.status === 'ok');
      const hasError = hops.some(h => h.status === 'error');
      res.json({ chainId: id, overall: allOk ? 'ok' : hasError ? 'error' : 'warn', hops });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[termination] Chain routes registered');
}
