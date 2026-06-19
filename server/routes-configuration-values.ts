/**
 * routes-configuration-values.ts
 *
 * Central operational parameter store — configuration_values table.
 * GET  /api/configuration-values?category=<vendor|client|commercial|global|az|bsr>
 * GET  /api/configuration-values  (all, for search/filter)
 * PATCH /api/configuration-values  [{ id, value }]  — bulk update, admin/management only
 */

import type { Express } from 'express';
import { db }           from './db';
import { eq, and, asc } from 'drizzle-orm';
import { configurationValues, governanceReviews } from '@shared/schema';

async function isGovernanceLocked(): Promise<boolean> {
  const [row] = await db.select({ status: governanceReviews.status })
    .from(governanceReviews).limit(1);
  return row?.status === 'locked';
}

type Role = 'admin' | 'super_admin' | 'management' | 'support' | 'viewer' |
  'kam' | 'destination_manager' | 'routing_admin' | 'finance';

function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

export function registerConfigurationValueRoutes(app: Express) {
  // GET all or filtered by category
  app.get('/api/configuration-values',
    (req: any, res, next) => requireRole(['admin', 'super_admin', 'management', 'support', 'viewer',
      'kam', 'destination_manager', 'routing_admin', 'finance'], req, res, next),
    async (req: any, res) => {
      try {
        const { category } = req.query as { category?: string };
        let rows;
        if (category) {
          rows = await db.select().from(configurationValues)
            .where(and(eq(configurationValues.category, category), eq(configurationValues.isActive, true)))
            .orderBy(asc(configurationValues.sortOrder));
        } else {
          rows = await db.select().from(configurationValues)
            .where(eq(configurationValues.isActive, true))
            .orderBy(asc(configurationValues.category), asc(configurationValues.sortOrder));
        }
        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // PATCH bulk update — admin/management only; ignores is_editable=false rows
  app.patch('/api/configuration-values',
    (req: any, res, next) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res) => {
      try {
        if (await isGovernanceLocked())
          return res.status(423).json({ error: 'Governance is locked — reset to draft before making changes.' });

        const updates = req.body as { id: number; value: string | null }[];
        if (!Array.isArray(updates) || updates.length === 0)
          return res.status(400).json({ error: 'Expected non-empty array of { id, value }' });

        const results: { id: number; ok: boolean; reason?: string }[] = [];
        for (const { id, value } of updates) {
          const [existing] = await db.select().from(configurationValues)
            .where(eq(configurationValues.id, id)).limit(1);
          if (!existing) { results.push({ id, ok: false, reason: 'Not found' }); continue; }
          if (!existing.isEditable) { results.push({ id, ok: false, reason: 'Read-only' }); continue; }
          await db.update(configurationValues)
            .set({ value: value ?? null, updatedAt: new Date() })
            .where(eq(configurationValues.id, id));
          results.push({ id, ok: true });
        }
        res.json({ updated: results.filter(r => r.ok).length, results });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET single value by category + key — useful for runtime config reads
  app.get('/api/configuration-values/:category/:key',
    (req: any, res, next) => requireRole(['admin', 'super_admin', 'management', 'support', 'viewer',
      'kam', 'destination_manager', 'routing_admin', 'finance'], req, res, next),
    async (req: any, res) => {
      try {
        const { category, key } = req.params;
        const [row] = await db.select().from(configurationValues)
          .where(and(
            eq(configurationValues.category, category),
            eq(configurationValues.configKey, key),
            eq(configurationValues.isActive, true),
          )).limit(1);
        if (!row) return res.status(404).json({ error: 'Configuration key not found' });
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
