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
import { storage } from './storage';
import {
  assembleRateSheets, sendRateNotificationEmails, RATE_SHEET_PRODUCT_CODES,
} from './services/provisioning/rate-notification-email';

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
