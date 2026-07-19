/**
 * routes-business-partners.ts
 *
 * Master-data CRUD for the business_partners table (AP Foundation — CAP-003 Phase 3).
 * Intentionally generic: type field distinguishes vendor | client | carrier.
 *
 * GET    /api/business-partners          — list active (optional ?type= ?search=)
 * POST   /api/business-partners          — create
 * GET    /api/business-partners/:id      — single record
 * PATCH  /api/business-partners/:id      — update fields
 * DELETE /api/business-partners/:id      — soft delete (sets deleted_at)
 */

import type { Express } from 'express';
import { db }           from './db';
import {
  eq, and, isNull, ilike, or, desc,
} from 'drizzle-orm';
import { businessPartners, insertBusinessPartnerSchema, type Role } from '@shared/schema';

function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const MGMT = ['admin', 'management'] as Role[];
const READ  = ['admin', 'management', 'super_admin', 'viewer', 'noc_operator',
               'destination_manager', 'routing_admin'] as Role[];

export function registerBusinessPartnerRoutes(app: Express) {

  // ── LIST ─────────────────────────────────────────────────────────────────────
  app.get('/api/business-partners',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { type, status, search } = req.query as Record<string, string | undefined>;

        const conditions: any[] = [isNull(businessPartners.deletedAt)];

        if (type)   conditions.push(eq(businessPartners.type, type));
        if (status) conditions.push(eq(businessPartners.status, status));
        if (search) {
          const pattern = `%${search}%`;
          conditions.push(
            or(
              ilike(businessPartners.name,         pattern),
              ilike(businessPartners.contactEmail,  pattern),
              ilike(businessPartners.contactName,   pattern),
            ),
          );
        }

        const rows = await db.select().from(businessPartners)
          .where(and(...conditions))
          .orderBy(desc(businessPartners.createdAt));

        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── CREATE ────────────────────────────────────────────────────────────────────
  app.post('/api/business-partners',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const parsed = insertBusinessPartnerSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(422).json({ error: 'Validation failed', issues: parsed.error.flatten() });
        }

        const payload = {
          ...parsed.data,
          createdBy: req.user?.username ?? req.user?.email ?? 'system',
        };

        const [created] = await db.insert(businessPartners).values(payload).returning();
        res.status(201).json(created);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET SINGLE ────────────────────────────────────────────────────────────────
  app.get('/api/business-partners/:id',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [row] = await db.select().from(businessPartners)
          .where(and(eq(businessPartners.id, id), isNull(businessPartners.deletedAt)))
          .limit(1);

        if (!row) return res.status(404).json({ error: 'Business partner not found' });
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── UPDATE ────────────────────────────────────────────────────────────────────
  app.patch('/api/business-partners/:id',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        // Disallow patching audit/pk fields
        const {
          id: _id, createdAt: _ca, createdBy: _cb, deletedAt: _da, ...rest
        } = req.body;

        const [updated] = await db.update(businessPartners)
          .set({ ...rest, updatedAt: new Date() })
          .where(and(eq(businessPartners.id, id), isNull(businessPartners.deletedAt)))
          .returning();

        if (!updated) return res.status(404).json({ error: 'Business partner not found' });
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── SOFT DELETE ───────────────────────────────────────────────────────────────
  app.delete('/api/business-partners/:id',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [deleted] = await db.update(businessPartners)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(businessPartners.id, id), isNull(businessPartners.deletedAt)))
          .returning({ id: businessPartners.id });

        if (!deleted) return res.status(404).json({ error: 'Business partner not found' });
        res.json({ ok: true, id: deleted.id });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
