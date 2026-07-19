/**
 * routes-vendor-adjustments.ts
 *
 * Vendor Adjustments CRUD — CAP-003 Phase 3 Sprint A3.
 *
 * GET  /api/vendor-adjustments              — list (filters: partnerId, type, status)
 * POST /api/vendor-adjustments              — create draft adjustment
 * GET  /api/vendor-adjustments/:id          — single adjustment
 * PATCH /api/vendor-adjustments/:id         — update draft
 * POST /api/vendor-adjustments/:id/post     — draft → posted (assigns VA-YYYY-NNNN)
 * POST /api/vendor-adjustments/:id/reverse  — posted → reversed
 * DELETE /api/vendor-adjustments/:id        — soft delete (draft only)
 */

import type { Express } from 'express';
import { db }           from './db';
import {
  eq, and, isNull, desc, like, ilike, or,
} from 'drizzle-orm';
import {
  vendorAdjustments, vendorBills, businessPartners, type Role,
} from '@shared/schema';

function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const MGMT = ['admin', 'management'] as Role[];
const READ  = ['admin', 'management', 'super_admin', 'viewer', 'noc_operator',
               'destination_manager', 'routing_admin'] as Role[];

// ── adjustment number sequence ────────────────────────────────────────────────
async function nextAdjustmentNumber(): Promise<string> {
  const year   = new Date().getFullYear().toString();
  const prefix = `VA-${year}-`;

  const [row] = await db
    .select({ n: vendorAdjustments.adjustmentNumber })
    .from(vendorAdjustments)
    .where(like(vendorAdjustments.adjustmentNumber, `${prefix}%`))
    .orderBy(desc(vendorAdjustments.adjustmentNumber))
    .limit(1);

  let seq = 1;
  if (row) {
    const parts = row.n.split('-');
    const last  = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function registerVendorAdjustmentRoutes(app: Express) {

  // ── LIST ───────────────────────────────────────────────────────────────────
  app.get('/api/vendor-adjustments',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { partnerId, type, status, search } = req.query as Record<string, string | undefined>;

        const conds: any[] = [isNull(vendorAdjustments.deletedAt)];
        if (partnerId) conds.push(eq(vendorAdjustments.businessPartnerId, parseInt(partnerId, 10)));
        if (type)      conds.push(eq(vendorAdjustments.type, type));
        if (status)    conds.push(eq(vendorAdjustments.status, status));
        if (search) {
          const p = `%${search}%`;
          conds.push(or(
            ilike(vendorAdjustments.adjustmentNumber, p),
            ilike(vendorAdjustments.reason, p),
          ));
        }

        const rows = await db
          .select({
            adj:     vendorAdjustments,
            partner: { id: businessPartners.id, name: businessPartners.name },
            bill:    { billNumber: vendorBills.billNumber },
          })
          .from(vendorAdjustments)
          .leftJoin(businessPartners, eq(vendorAdjustments.businessPartnerId, businessPartners.id))
          .leftJoin(vendorBills,      eq(vendorAdjustments.vendorBillId, vendorBills.id))
          .where(and(...conds))
          .orderBy(desc(vendorAdjustments.createdAt));

        res.json(rows.map(r => ({
          ...r.adj,
          partnerName: r.partner?.name,
          billNumber:  r.bill?.billNumber,
        })));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── CREATE DRAFT ──────────────────────────────────────────────────────────
  app.post('/api/vendor-adjustments',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const {
          businessPartnerId, vendorBillId, type = 'credit_note',
          adjustmentDate, currency = 'USD', amount,
          reason, description,
        } = req.body;

        if (!businessPartnerId)           return res.status(422).json({ error: 'businessPartnerId required' });
        if (!adjustmentDate)              return res.status(422).json({ error: 'adjustmentDate required' });
        if (!amount || parseFloat(amount) <= 0)
                                          return res.status(422).json({ error: 'amount must be positive' });
        if (!reason?.trim())              return res.status(422).json({ error: 'reason required' });
        if (!['credit_note','debit_note','write_off'].includes(type))
                                          return res.status(422).json({ error: 'Invalid type' });

        // Draft uses a placeholder number — permanent VA-YYYY-NNNN assigned on post
        const draftNum = `DRAFT-ADJ-${Date.now().toString(36).toUpperCase()}`;
        const actor    = req.user?.username ?? req.user?.email ?? 'system';

        const [adj] = await db.insert(vendorAdjustments).values({
          adjustmentNumber:  draftNum,
          businessPartnerId: parseInt(businessPartnerId, 10),
          vendorBillId:      vendorBillId ? parseInt(vendorBillId, 10) : null,
          type,
          adjustmentDate,
          currency,
          amount:            String(parseFloat(amount).toFixed(4)),
          reason:            reason.trim(),
          description:       description || null,
          status:            'draft',
          createdBy:         actor,
        }).returning();

        res.status(201).json(adj);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET SINGLE ────────────────────────────────────────────────────────────
  app.get('/api/vendor-adjustments/:id',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [row] = await db
          .select({
            adj:     vendorAdjustments,
            partner: { id: businessPartners.id, name: businessPartners.name },
            bill:    { billNumber: vendorBills.billNumber, status: vendorBills.status },
          })
          .from(vendorAdjustments)
          .leftJoin(businessPartners, eq(vendorAdjustments.businessPartnerId, businessPartners.id))
          .leftJoin(vendorBills,      eq(vendorAdjustments.vendorBillId, vendorBills.id))
          .where(and(eq(vendorAdjustments.id, id), isNull(vendorAdjustments.deletedAt)))
          .limit(1);

        if (!row) return res.status(404).json({ error: 'Adjustment not found' });

        res.json({ ...row.adj, partner: row.partner, bill: row.bill });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── UPDATE DRAFT ──────────────────────────────────────────────────────────
  app.patch('/api/vendor-adjustments/:id',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorAdjustments)
          .where(and(eq(vendorAdjustments.id, id), isNull(vendorAdjustments.deletedAt))).limit(1);

        if (!existing) return res.status(404).json({ error: 'Adjustment not found' });
        if (existing.status !== 'draft')
          return res.status(409).json({ error: `Cannot edit a ${existing.status} adjustment` });

        const { id: _id, adjustmentNumber: _an, status: _st, createdAt: _ca,
                createdBy: _cb, deletedAt: _da, postedAt: _pa, ...rest } = req.body;

        const [updated] = await db.update(vendorAdjustments)
          .set({ ...rest, updatedAt: new Date() })
          .where(eq(vendorAdjustments.id, id))
          .returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST (draft → posted, assigns VA-YYYY-NNNN) ───────────────────────────
  app.post('/api/vendor-adjustments/:id/post',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorAdjustments)
          .where(and(eq(vendorAdjustments.id, id), isNull(vendorAdjustments.deletedAt))).limit(1);

        if (!existing) return res.status(404).json({ error: 'Adjustment not found' });
        if (existing.status !== 'draft')
          return res.status(409).json({ error: `Adjustment is already ${existing.status}` });

        const adjNumber = await nextAdjustmentNumber();
        const actor     = req.user?.username ?? req.user?.email ?? 'system';
        const now       = new Date();

        const [posted] = await db.update(vendorAdjustments)
          .set({
            adjustmentNumber: adjNumber,
            status:           'posted',
            postedAt:         now,
            postedBy:         actor,
            updatedAt:        now,
          })
          .where(eq(vendorAdjustments.id, id))
          .returning();

        res.json(posted);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── REVERSE (posted → reversed) ───────────────────────────────────────────
  app.post('/api/vendor-adjustments/:id/reverse',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorAdjustments)
          .where(and(eq(vendorAdjustments.id, id), isNull(vendorAdjustments.deletedAt))).limit(1);

        if (!existing) return res.status(404).json({ error: 'Adjustment not found' });
        if (existing.status !== 'posted')
          return res.status(409).json({ error: `Only posted adjustments can be reversed (current: ${existing.status})` });

        const actor = req.user?.username ?? req.user?.email ?? 'system';
        const now   = new Date();

        const [reversed] = await db.update(vendorAdjustments)
          .set({ status: 'reversed', reversedAt: now, reversedBy: actor, updatedAt: now })
          .where(eq(vendorAdjustments.id, id))
          .returning();

        res.json(reversed);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── SOFT DELETE (draft only) ──────────────────────────────────────────────
  app.delete('/api/vendor-adjustments/:id',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorAdjustments)
          .where(and(eq(vendorAdjustments.id, id), isNull(vendorAdjustments.deletedAt))).limit(1);

        if (!existing) return res.status(404).json({ error: 'Adjustment not found' });
        if (existing.status !== 'draft')
          return res.status(409).json({ error: 'Only draft adjustments can be deleted' });

        await db.update(vendorAdjustments)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(vendorAdjustments.id, id));

        res.json({ ok: true, id });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
