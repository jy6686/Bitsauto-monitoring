/**
 * routes-rate-policy.ts — declaring and reading the per-client rate-change policy.
 *
 * The narrowest writer that lets a policy exist in production. There is deliberately no UI yet:
 * the storage (migration 519), resolution and adapter were proven first, and the first rows are
 * for a controlled test against a disposable client.
 *
 * WHAT THESE ENDPOINTS WILL NOT DO.
 *   - Default an action. `selectedAction: null` is "considered, not decided" — a real declaration
 *     the engine reads as undecided. Omitting the field is a 400, not IGNORE.
 *   - Consult `validation_rules`. That table is a platform-wide singleton with an IGNORE default.
 *   - Enable enforcement. That is platform_feature_flags.rate_policy_enforcement, separately.
 *
 * Every write is attributable and audited, as eligibility declarations are.
 */
import type { Express } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { writeAudit } from './audit';
import { declarePolicyRule, policyRulesInForce } from './services/rates/policy-config-store';
import { resolvePolicyForPush } from './services/rates/policy-resolution';

async function requireRole(roles: string[], req: any, res: any, next: any) {
  const userId = req.user?.claims?.sub;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const r = await db.execute(sql`SELECT role FROM user_roles WHERE user_id = ${userId} LIMIT 1`);
    const role = (r as any).rows?.[0]?.role ?? null;
    if (!role) return res.status(403).json({ error: 'No role assigned' });
    if (role === 'super_admin' || roles.includes(role)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  } catch { return next(); }
}
const READ  = ['admin', 'management', 'destination_manager'];
const WRITE = ['admin', 'management'];
const actorId = (req: any) => req.user?.claims?.sub ?? req.user?.id ?? null;
const RULES = new Set(['rate_increase_notice_violation','suspect_rate_increase','suspect_rate_decrease',
  'pending_increases_exceeded','effective_date_greater_than_limit','effective_date_older_than_limit']);
const ACTIONS = new Set(['IGNORE','REJECT_RATE_SHEET','REJECT_COUNTRY','REJECT_DESTINATION','APPROVAL_REQD','AUTO_ADJUST_EFFECTIVE_DATE']);

export function registerRatePolicyRoutes(app: Express) {
  /**
   * GET /api/rate-policy/rules?clientId=&department=&asOf= — READ-ONLY.
   * The rows in force on `asOf` (default today), plus the same resolution the push route would
   * make of them — so an operator sees `usable` and `unmeasurableRules` before any push.
   */
  app.get('/api/rate-policy/rules',
    (req: any, res: any, next: any) => requireRole(READ, req, res, next),
    async (req: any, res: any) => {
      try {
        const clientId = Number(req.query.clientId);
        const department = String(req.query.department ?? '').trim();
        if (!Number.isInteger(clientId) || !department) {
          return res.status(400).json({ error: 'clientId (integer) and department are required' });
        }
        const asOf = String(req.query.asOf ?? new Date().toISOString().slice(0, 10));
        const [company] = (await db.execute(sql`SELECT id, name, department FROM companies WHERE id = ${clientId}`) as any).rows ?? [];
        if (!company) return res.status(404).json({ error: `No company ${clientId}` });
        const [rules, resolution] = await Promise.all([
          policyRulesInForce(db as any, { clientId, department, asOf }),
          resolvePolicyForPush(db as any, { clientId, clientName: String(company.name), department, asOf, thresholdCategory: 'client' }),
        ]);
        res.json({
          client: { id: Number(company.id), name: company.name, department: company.department ?? null },
          department, asOf, rules,
          resolution: {
            noPolicy: resolution.noPolicy, usable: resolution.usable, summary: resolution.summary,
            undeclaredActions: resolution.undeclaredActions, unmeasurableRules: resolution.unmeasurableRules,
            thresholds: resolution.policy.thresholds,
          },
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

  /**
   * POST /api/rate-policy/rules — declare one rule for one client and department.
   * Body: { clientId, department, ruleKey, selectedAction (one of six, or null — REQUIRED KEY),
   *         effectiveFrom (YYYY-MM-DD), effectiveTo?, reason?, supersedesId? }
   */
  app.post('/api/rate-policy/rules',
    (req: any, res: any, next: any) => requireRole(WRITE, req, res, next),
    async (req: any, res: any) => {
      try {
        const b = req.body ?? {};
        const clientId = Number(b.clientId);
        const department = String(b.department ?? '').trim();
        const ruleKey = String(b.ruleKey ?? '');
        if (!Number.isInteger(clientId) || !department) return res.status(400).json({ error: 'clientId (integer) and department are required' });
        if (!RULES.has(ruleKey)) return res.status(400).json({ error: `ruleKey must be one of: ${[...RULES].join(', ')}` });
        // The key must be PRESENT. An absent action would have to be defaulted to something, and
        // the only honest default is "not decided" — which the caller can say explicitly with null.
        if (!('selectedAction' in b)) return res.status(400).json({ error: 'selectedAction is required: one of the six actions, or null for "considered, not decided"' });
        if (b.selectedAction !== null && !ACTIONS.has(String(b.selectedAction))) {
          return res.status(400).json({ error: `selectedAction must be null or one of: ${[...ACTIONS].join(', ')}` });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveFrom ?? ''))) return res.status(400).json({ error: 'effectiveFrom must be YYYY-MM-DD' });

        const actor = actorId(req);
        if (!actor) return res.status(401).json({ error: 'A policy must be attributable to a person.' });

        const outcome = await declarePolicyRule(db as any, {
          clientId, department, ruleKey: ruleKey as any, selectedAction: b.selectedAction,
          effectiveFrom: String(b.effectiveFrom), effectiveTo: b.effectiveTo ?? null,
          reason: b.reason ?? null, supersedesId: b.supersedesId ?? null, declaredBy: String(actor),
        });
        if (!outcome.ok) {
          const status = outcome.code === 'unknown_client' ? 404 : outcome.code === 'overlap' ? 409 : outcome.code === 'not_attributable' ? 401 : 400;
          return res.status(status).json({ error: outcome.message, code: outcome.code });
        }
        await writeAudit({
          category: 'operational', action: 'RATE_POLICY_DECLARED',
          actor: String(actor), actorType: 'user',
          targetType: 'rate_policy_rules', targetId: String(outcome.row.id),
          targetName: `client ${clientId} / ${department} / ${ruleKey}`,
          severity: 'info',
          metadata: { clientId, department, ruleKey, selectedAction: b.selectedAction, effectiveFrom: b.effectiveFrom, effectiveTo: b.effectiveTo ?? null, reason: b.reason ?? null },
          ip: req.ip,
        });
        res.status(201).json({ rule: outcome.row });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });
}
