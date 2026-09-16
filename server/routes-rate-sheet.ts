/**
 * routes-rate-sheet.ts — the customer rate sheet, on demand and without side effects.
 *
 * Registered by server/routes.ts via registerRateSheetRoutes(app).
 *
 *   GET  /api/companies/:id/rate-sheet?product=FC      admin · download the sheet as .xlsx
 *   POST /api/companies/:id/rate-notifications/resend  admin · send the rate notification emails
 *
 * WHY THESE EXIST (2026-09-15). The rebuilt customer sheet was reachable only through a
 * provisioning run, whose account-details step first emails the customer's credentials
 * again. Accepting a spreadsheet's formatting is not a reason to resend credentials, and
 * the other two "send rate" surfaces (push-batch, the notifications tab) build different
 * documents on different paths. So:
 *
 *   - Download derives the sheet from the same assembly the sender uses and returns the
 *     bytes. No email, no switch write, no database mutation. This is the acceptance test.
 *   - Resend calls the rebuilt sender and nothing else: no account details, no switch
 *     write, the same recipients, body and attachment a provisioning run would deliver.
 *
 * Both are admin-only. Dependencies are injectable so the routes are tested with fakes
 * and neither the database nor the mail transport is touched by a test.
 */
import type { Express } from 'express';
import { pool } from './db';
import { storage } from './storage';
import {
  assembleRateSheets, sendRateNotificationEmails, RATE_SHEET_PRODUCT_CODES,
} from './services/provisioning/rate-notification-email';
import { planIdentityBackfill, parseStepResult } from './services/provisioning/identity-backfill';
import { buildIdentityInventory } from './services/provisioning/identity-inventory';
import { renderIdentityInventoryText } from './services/provisioning/identity-inventory-text';

export interface RateSheetRouteDeps {
  assemble:    typeof assembleRateSheets;
  send:        typeof sendRateNotificationEmails;
  requireRole: (roles: string[], req: any, res: any, next: any) => any;
}

/** Same check every other route module makes; copied rather than shared because none exports it. */
async function defaultRequireRole(roles: string[], req: any, res: any, next: any) {
  const userId = req.user?.claims?.sub;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const role = await storage.getUserRole(userId);
  if (!role || !roles.includes(role)) {
    return res.status(403).json({ message: 'Forbidden — insufficient permissions' });
  }
  next();
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** provisioning_steps.detail is a JSON array of lines. One malformed row must not fail a report. */
function parseStepDetail(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map(String);
  try { const v = JSON.parse(String(raw)); return Array.isArray(v) ? v.map(String) : null; } catch { return null; }
}

function companyIdOf(req: any): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerRateSheetRoutes(app: Express, overrides: Partial<RateSheetRouteDeps> = {}): void {
  const deps: RateSheetRouteDeps = {
    assemble: assembleRateSheets, send: sendRateNotificationEmails, requireRole: defaultRequireRole, ...overrides,
  };
  const adminOnly = (req: any, res: any, next: any) => deps.requireRole(['admin'], req, res, next);

  // ── Download ──────────────────────────────────────────────────────────────
  app.get('/api/companies/:id/rate-sheet', adminOnly, async (req: any, res: any) => {
    try {
      const companyId = companyIdOf(req);
      if (companyId === null) return res.status(400).json({ error: 'Company id must be a positive integer.' });

      const product = String(req.query?.product ?? '').trim().toUpperCase();
      if (!RATE_SHEET_PRODUCT_CODES.includes(product)) {
        return res.status(400).json({ error: `product must be one of ${RATE_SHEET_PRODUCT_CODES.join(', ')}.` });
      }

      const assembly = await deps.assemble(companyId, { productCode: product });
      if (!assembly.company) return res.status(404).json({ error: `Company ${companyId} not found.` });

      const sheet = assembly.products[0];
      if (!sheet) {
        const blocked = assembly.unsendable[0];
        return res.status(404).json({
          error: blocked
            ? `No ${blocked.productLabel} sheet can be produced for ${assembly.company.name}: every effective price was refused.`
            : `${assembly.company.name} has no effective ${product} prices today — nothing to put on a sheet.`,
          details: [...(blocked?.reasons ?? []), ...assembly.details],
        });
      }

      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${sheet.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Rate-Sheet-Rows', String(sheet.rows.length));
      res.setHeader('X-Rate-Sheet-Excluded', String(sheet.excluded.length));
      return res.send(sheet.xlsx);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // ── Platform repair: record the Sippy identity provisioning already proved ──
  // GET reports what would change; POST {apply:true} writes it. Reads the same plan either
  // way, so the report an operator approves is computed by the code that performs it.
  //
  // Why this exists (2026-09-15): the runner only began recording the account and tariff ids
  // today, so every customer provisioned before that still has them missing — 14 companies
  // with a tariff and no account id, 21 the other way. Each one refuses every Rate Manager
  // push as `no_stored_tariff`. The repair reads each company's OWN provisioning runs and
  // never matches a Sippy account to a customer by name.
  const identityPlan = async () => {
    const { rows: companies } = await pool.query<any>(
      `SELECT id, name, sippy_i_account, sippy_i_tariff FROM companies ORDER BY name`);
    const { rows: steps } = await pool.query<any>(
      `SELECT r.company_id, s.step_key, s.status, s.result, s.completed_at
         FROM provisioning_steps s
         JOIN provisioning_runs r ON r.id = s.run_id
        WHERE s.step_key IN ('account', 'tariff') AND s.status = 'success' AND s.result IS NOT NULL`);
    return planIdentityBackfill(
      companies.map((c: any) => ({ id: Number(c.id), name: String(c.name), sippyIAccount: c.sippy_i_account, sippyITariff: c.sippy_i_tariff })),
      steps.map((s: any) => ({ companyId: Number(s.company_id), stepKey: String(s.step_key), status: String(s.status), result: parseStepResult(s.result), completedAt: s.completed_at })),
    );
  };

  app.get('/api/provisioning/identity-backfill', adminOnly, async (_req: any, res: any) => {
    try {
      const plan = await identityPlan();
      res.json({ dryRun: true, wouldRepair: plan.patches.length, ...plan });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
  });

  app.post('/api/provisioning/identity-backfill', adminOnly, async (req: any, res: any) => {
    try {
      if (req.body?.apply !== true) {
        const plan = await identityPlan();
        return res.status(400).json({ error: 'Pass {"apply": true} to write. Nothing was changed.', wouldRepair: plan.patches.length, ...plan });
      }
      const plan = await identityPlan();
      const repaired: string[] = [];
      const failed: string[] = [];
      for (const p of plan.patches) {
        const sets: string[] = []; const vals: any[] = [p.companyId];
        // Guarded by `IS NULL`: a value written between the plan and this statement wins.
        if (p.sippyIAccount !== undefined) { vals.push(p.sippyIAccount); sets.push(`sippy_i_account = COALESCE(sippy_i_account, $${vals.length})`); }
        if (p.sippyITariff !== undefined)  { vals.push(p.sippyITariff);  sets.push(`sippy_i_tariff  = COALESCE(sippy_i_tariff,  $${vals.length})`); }
        if (!sets.length) continue;
        try {
          await pool.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $1`, vals);
          repaired.push(`${p.companyName}: ${p.because.join('; ')}`);
        } catch (e: any) { failed.push(`${p.companyName}: ${e?.message ?? e}`); }
      }
      res.json({ applied: true, repaired: repaired.length, failed: failed.length, details: repaired, failures: failed, conflicts: plan.conflicts, noEvidence: plan.noEvidence });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
  });

  // ── Platform reconciliation: who is who on the switch, and what is configured ──
  // GET only. No write of any kind, no Sippy call. Answers, for every company: what
  // identity the platform records, what that company's own runs proved, which products
  // were bought, which are configured under the account, and what remains to be done.
  //
  // Product-agnostic on purpose: it reads product_registry, so a product added tomorrow
  // appears in the rollup with no code change and no second reconciliation project.
  app.get('/api/provisioning/identity-inventory', adminOnly, async (req: any, res: any) => {
    try {
      const [companies, steps, products, bought, assigned, priced] = await Promise.all([
        pool.query<any>(`SELECT id, name, sippy_i_account, sippy_i_tariff, provisioning_status FROM companies ORDER BY name`),
        pool.query<any>(
          // result, detail and metrics are three generations of the same evidence: which
          // BILLING PLAN Sippy read back for the account. Runs 1-8 predate the detail and
          // metrics columns and recorded it only in result, so all three are selected.
          `SELECT r.company_id, s.step_key, s.status, s.result, s.detail, s.metrics, s.completed_at
             FROM provisioning_steps s
             JOIN provisioning_runs r ON r.id = s.run_id
            WHERE s.step_key IN ('account','tariff') AND s.status = 'success' AND s.result IS NOT NULL`),
        pool.query<any>(`SELECT id, code, name, trunk_prefix FROM product_registry ORDER BY sort_order, code`),
        pool.query<any>(`SELECT company_id, product_id FROM company_products`),
        pool.query<any>(`SELECT i_account, product_id FROM customer_product_assignments WHERE status = 'active'`),
        // Platform-wide: product_rates carries no company id — it IS the default matrix.
        pool.query<any>(
          `SELECT DISTINCT p.code
             FROM product_rates pr JOIN product_registry p ON p.id = pr.product_id
            WHERE pr.effective_from <= CURRENT_DATE
              AND (pr.effective_to IS NULL OR pr.effective_to >= CURRENT_DATE)`),
      ]);

      // Live billing plans, each carrying the tariff it bills on. Undefined (not empty)
      // when the switch cannot be reached, so the report says the link is unresolvable
      // instead of silently reporting every account as having no billing evidence.
      let livePlans: Array<{ id: number; name: string; iTariff: number | null }> | undefined;
      try {
        const { listSippyBillingPlans } = await import('./sippy');
        const s: any = await storage.getSettings();
        const portalUrl: string = s?.portalUrl || '';
        // Same pair order the billing-plans route uses: admin first, portal second, then
        // the web password combos. Only one of them can read getServicePlanInfo.
        const pairs = [
          [s?.apiAdminUsername, s?.apiAdminPassword],
          [s?.portalUsername,   s?.portalPassword],
          [s?.apiAdminUsername, s?.adminWebPassword],
          [s?.portalUsername,   s?.adminWebPassword],
        ].filter(([u, p]) => u && p) as Array<[string, string]>;
        for (const [u, p] of pairs) {
          const r = await listSippyBillingPlans(u, p, portalUrl);
          if (r?.plans?.length) {
            livePlans = r.plans.map((x: any) => ({
              id: Number(x.id), name: String(x.name ?? ''),
              iTariff: x.iTariff === null || x.iTariff === undefined ? null : Number(x.iTariff),
            }));
            break;
          }
        }
      } catch { livePlans = undefined; }

      const report = buildIdentityInventory({
        companies: companies.rows.map((c: any) => ({
          id: Number(c.id), name: String(c.name),
          sippyIAccount: c.sippy_i_account === null ? null : Number(c.sippy_i_account),
          sippyITariff:  c.sippy_i_tariff  === null ? null : Number(c.sippy_i_tariff),
          provisioningStatus: c.provisioning_status ?? null,
        })),
        evidence: steps.rows.map((s: any) => ({
          companyId: Number(s.company_id), stepKey: String(s.step_key), status: String(s.status),
          result: parseStepResult(s.result), metrics: parseStepResult(s.metrics),
          detail: parseStepDetail(s.detail), completedAt: s.completed_at,
        })),
        products: products.rows.map((p: any) => ({ id: Number(p.id), code: String(p.code), name: String(p.name), trunkPrefix: p.trunk_prefix ?? null })),
        bought:   bought.rows.map((b: any) => ({ companyId: Number(b.company_id), productId: Number(b.product_id) })),
        assigned: assigned.rows.map((a: any) => ({ iAccount: Number(a.i_account), productId: Number(a.product_id) })),
        pricedProductCodes: priced.rows.map((r: any) => String(r.code)),
        // The billing hop. On this switch the tariff hangs off the BILLING PLAN, not the
        // account, so without this list every company reports NO_EVIDENCE. Read-only, and
        // a failure is reported as "could not be read" rather than as a clean bill.
        plans: livePlans,
      });

      const generatedAt = new Date().toISOString();
      // ?format=text renders the same object as the matrix it is meant to be read as —
      // openable in a browser tab and pasteable into a message, without a JSON viewer.
      if (String(req.query?.format ?? '').toLowerCase() === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(renderIdentityInventoryText({ ...report, generatedAt }));
      }
      res.json({ readOnly: true, generatedAt, ...report });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
  });

  // ── Resend ────────────────────────────────────────────────────────────────
  app.post('/api/companies/:id/rate-notifications/resend', adminOnly, async (req: any, res: any) => {
    try {
      const companyId = companyIdOf(req);
      if (companyId === null) return res.status(400).json({ error: 'Company id must be a positive integer.' });
      const result = await deps.send(companyId);
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? String(e) });
    }
  });
}
