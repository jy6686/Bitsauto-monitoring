/**
 * routes-validation-rules.ts
 *
 * Validation Rules Engine — Layer 2 of the configuration governance stack.
 * Reads: configuration_values (for threshold display alongside each rule)
 * Writes: validation_rules (selected_action per rule per scope)
 *
 * GET  /api/validation-rules?scope=<vendor|client|commercial|global>
 *      Returns grouped rules with resolved threshold value from configuration_values.
 * PATCH /api/validation-rules   [{ id, selectedAction }]  — admin/management only
 */

import type { Express }   from 'express';
import { db }              from './db';
import { eq, and, asc }   from 'drizzle-orm';
import { validationRules, configurationValues, governanceReviews } from '@shared/schema';

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

const ALL_ROLES: Role[] = ['admin','super_admin','management','support','viewer',
  'kam','destination_manager','routing_admin','finance'];

export function registerValidationRuleRoutes(app: Express) {
  // GET rules for a scope, grouped, with resolved threshold value
  app.get('/api/validation-rules',
    (req: any, res, next) => requireRole(ALL_ROLES, req, res, next),
    async (req: any, res) => {
      try {
        const scope = (req.query.scope as string) || 'client';

        const rules = await db.select().from(validationRules)
          .where(and(eq(validationRules.scope, scope), eq(validationRules.isActive, true)))
          .orderBy(asc(validationRules.sortOrder));

        // Enrich each rule with the threshold value from configuration_values
        const enriched = await Promise.all(rules.map(async rule => {
          let threshold: string | null = null;
          let thresholdUnit: string | null = null;
          let thresholdLabel: string | null = null;
          if (rule.configCategory && rule.configKey) {
            const [cv] = await db.select().from(configurationValues)
              .where(and(
                eq(configurationValues.category, rule.configCategory),
                eq(configurationValues.configKey, rule.configKey),
                eq(configurationValues.isActive, true),
              )).limit(1);
            if (cv) {
              threshold = cv.value ?? cv.defaultValue ?? null;
              thresholdUnit = cv.unit ?? null;
              thresholdLabel = cv.label;
            }
          }
          return { ...rule, threshold, thresholdUnit, thresholdLabel };
        }));

        // Group by group_name preserving sort order
        const grouped: Record<string, typeof enriched> = {};
        for (const rule of enriched) {
          if (!grouped[rule.groupName]) grouped[rule.groupName] = [];
          grouped[rule.groupName].push(rule);
        }

        res.json({ scope, groups: Object.entries(grouped).map(([name, rules]) => ({ name, rules })) });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET all scopes summary (for future consumption layer)
  app.get('/api/validation-rules/all',
    (req: any, res, next) => requireRole(ALL_ROLES, req, res, next),
    async (_req: any, res) => {
      try {
        const rules = await db.select().from(validationRules)
          .where(eq(validationRules.isActive, true))
          .orderBy(asc(validationRules.scope), asc(validationRules.sortOrder));
        res.json(rules);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // PATCH bulk update selected_action — admin/management only
  app.patch('/api/validation-rules',
    (req: any, res, next) => requireRole(['admin','management'], req, res, next),
    async (req: any, res) => {
      try {
        if (await isGovernanceLocked())
          return res.status(423).json({ error: 'Governance is locked — reset to draft before making changes.' });

        const updates = req.body as { id: number; selectedAction: string }[];
        if (!Array.isArray(updates) || updates.length === 0)
          return res.status(400).json({ error: 'Expected non-empty array of { id, selectedAction }' });

        const VALID_ACTIONS = new Set([
          'ignore','reject_rate_sheet','reject_country',
          'reject_destination','approval_reqd','auto_adjust_effective_date',
        ]);

        const results: { id: number; ok: boolean; reason?: string }[] = [];
        for (const { id, selectedAction } of updates) {
          if (!VALID_ACTIONS.has(selectedAction)) {
            results.push({ id, ok: false, reason: `Invalid action: ${selectedAction}` }); continue;
          }
          const [existing] = await db.select().from(validationRules)
            .where(eq(validationRules.id, id)).limit(1);
          if (!existing) { results.push({ id, ok: false, reason: 'Not found' }); continue; }
          await db.update(validationRules)
            .set({ selectedAction, updatedAt: new Date() })
            .where(eq(validationRules.id, id));
          results.push({ id, ok: true });
        }
        res.json({ updated: results.filter(r => r.ok).length, results });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
