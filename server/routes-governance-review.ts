/**
 * routes-governance-review.ts
 *
 * #338A Governance Review — formal sign-off for the config + validation rule stack.
 * Singleton record (only one active governance_reviews row).
 *
 * GET  /api/governance-review            → current review record
 * PATCH /api/governance-review           → update comments / reviewedBy / status=approved
 * POST  /api/governance-review/lock      → advance status to locked (management only)
 * POST  /api/governance-review/reset     → reset to draft (admin only, for re-review)
 */

import type { Express } from 'express';
import { db }            from './db';
import { eq, asc, and } from 'drizzle-orm';
import { governanceReviews, configurationValues, validationRules } from '@shared/schema';

type Role = 'admin' | 'super_admin' | 'management' | 'support' | 'viewer' |
  'kam' | 'destination_manager' | 'routing_admin' | 'finance';

function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const ALL_ROLES: Role[] = ['admin','super_admin','management','support','viewer',
  'kam','destination_manager','routing_admin','finance'];

async function ensureSingleton() {
  const existing = await db.select().from(governanceReviews).limit(1);
  if (existing.length === 0) {
    await db.insert(governanceReviews).values({ status: 'draft' });
  }
  return (await db.select().from(governanceReviews).limit(1))[0];
}

export function registerGovernanceReviewRoutes(app: Express) {
  // GET current review + summary data
  app.get('/api/governance-review',
    (req: any, res, next) => requireRole(ALL_ROLES, req, res, next),
    async (_req: any, res) => {
      try {
        const review = await ensureSingleton();

        // Config summary: group by category, count rows, sample key values
        const configs = await db.select().from(configurationValues)
          .where(eq(configurationValues.isActive, true))
          .orderBy(asc(configurationValues.category), asc(configurationValues.sortOrder));

        // Rules summary
        const rules = await db.select().from(validationRules)
          .where(eq(validationRules.isActive, true))
          .orderBy(asc(validationRules.scope), asc(validationRules.sortOrder));

        // Enrich rules with threshold values
        const enrichedRules = await Promise.all(rules.map(async rule => {
          let threshold: string | null = null;
          let thresholdUnit: string | null = null;
          if (rule.configCategory && rule.configKey) {
            const [cv] = await db.select().from(configurationValues)
              .where(and(
                eq(configurationValues.category, rule.configCategory),
                eq(configurationValues.configKey, rule.configKey),
                eq(configurationValues.isActive, true),
              )).limit(1);
            if (cv) { threshold = cv.value ?? cv.defaultValue ?? null; thresholdUnit = cv.unit ?? null; }
          }
          return { ...rule, threshold, thresholdUnit };
        }));

        res.json({ review, configs, rules: enrichedRules });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // PATCH — update comments, reviewedBy, or advance to approved
  app.patch('/api/governance-review',
    (req: any, res, next) => requireRole(['admin','management'], req, res, next),
    async (req: any, res) => {
      try {
        const review = await ensureSingleton();
        if (review.status === 'locked')
          return res.status(400).json({ error: 'Governance is locked — reset to draft first.' });

        const { comments, reviewedBy, approve } = req.body as {
          comments?: string;
          reviewedBy?: string;
          approve?: boolean;
        };

        const patch: Partial<typeof review> & { updatedAt: Date } = { updatedAt: new Date() };
        if (comments !== undefined) patch.comments = comments;
        if (reviewedBy !== undefined) patch.reviewedBy = reviewedBy;
        if (approve) {
          patch.status = 'approved';
          patch.reviewedBy = reviewedBy ?? req.user?.username ?? review.reviewedBy ?? null;
          patch.reviewedAt = new Date();
        }

        await db.update(governanceReviews).set(patch).where(eq(governanceReviews.id, review.id));
        const updated = await ensureSingleton();
        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /lock — advance approved → locked (management only)
  app.post('/api/governance-review/lock',
    (req: any, res, next) => requireRole(['admin','management'], req, res, next),
    async (req: any, res) => {
      try {
        const review = await ensureSingleton();
        if (review.status === 'locked')
          return res.status(400).json({ error: 'Already locked.' });
        if (review.status !== 'approved')
          return res.status(400).json({ error: 'Governance must be approved before locking.' });

        await db.update(governanceReviews).set({
          status: 'locked',
          lockedBy: req.user?.username ?? null,
          lockedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(governanceReviews.id, review.id));

        res.json({ ok: true, status: 'locked' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /reset — revert to draft (admin only)
  app.post('/api/governance-review/reset',
    (req: any, res, next) => requireRole(['admin'], req, res, next),
    async (req: any, res) => {
      try {
        const review = await ensureSingleton();
        await db.update(governanceReviews).set({
          status: 'draft',
          reviewedBy: null,
          reviewedAt: null,
          lockedBy: null,
          lockedAt: null,
          comments: null,
          updatedAt: new Date(),
        }).where(eq(governanceReviews.id, review.id));
        res.json({ ok: true, status: 'draft' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
