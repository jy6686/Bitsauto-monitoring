/**
 * routes-product-eligibility.ts
 *
 * Declaring which catalogue destinations a product is sold on.
 *
 * This is a separate module from `routes-commercial-catalogue.ts` on purpose. That module's header
 * states its second rule: "No endpoint takes a product. Products belong to the pricing layer." The
 * catalogue stays product-neutral, so the product dimension lives here and joins to it.
 *
 * It is also separate from the LEGACY `/api/commercial-destinations` (routes.ts ~28569), which joins
 * `product_destination_assignments` to `global_destinations`. Both of those are non-authoritative as
 * of migration 514, and nothing here reads either.
 *
 * TWO THINGS THESE ENDPOINTS WILL NOT DO.
 *
 *   - **Infer.** There is no "grant all", no seeding from the legacy thirteen, and no endpoint that
 *     makes every catalogue destination eligible for a product. A product sells what somebody said
 *     it sells, and an undeclared product sells nothing — which is returned as an empty list, not an
 *     error, because empty is the truthful answer and NOT a synonym for "everything".
 *   - **Resolve a destination outside the catalogue.** A destination id is a
 *     `commercial_destinations.id` in a catalogue version. Legacy tree ids are refused, not
 *     translated; there is no mapping between those id spaces and inventing one by name or prefix is
 *     what produced the residue this layer exists to escape.
 *
 * Every write is attributable and audited: eligibility is a commercial claim, and the record has to
 * say who made it.
 */
import type { Express } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { writeAudit } from './audit';
import {
  grantEligibility, withdrawEligibility, listEligibleDestinations, describeVersionRollover,
} from './services/products/eligibility-store';

async function requireRole(roles: string[], req: any, res: any, next: any) {
  const userId = req.user?.claims?.sub;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rows = await db.execute(sql`SELECT role FROM user_roles WHERE user_id = ${userId} LIMIT 1`);
    const userRole = (rows as any).rows?.[0]?.role ?? null;
    if (!userRole) return res.status(403).json({ error: 'No role assigned' });
    if (userRole === 'super_admin' || roles.includes(userRole)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  } catch { return next(); }
}

const READ  = ['admin', 'management', 'destination_manager'];
const WRITE = ['admin', 'management'];
const rows  = (r: any) => (r as any).rows ?? [];
const actorId = (req: any) => req.user?.claims?.sub ?? req.user?.id ?? null;

export function registerProductEligibilityRoutes(app: Express) {
  /**
   * GET /api/products/:productId/eligibility — READ-ONLY.
   *
   * What this product is sold on, in the ACTIVE catalogue version unless `?versionId=` says
   * otherwise. Each destination carries every prefix the catalogue holds for it, because a
   * destination is a SET of prefixes: AWCC is 9370 and 9371, not one of them.
   *
   * An empty list means no eligibility has been declared. It does NOT mean every destination.
   */
  app.get('/api/products/:productId/eligibility',
    (req: any, res: any, next: any) => requireRole(READ, req, res, next),
    async (req: any, res: any) => {
      try {
        const productId = Number(req.params.productId);
        if (!Number.isInteger(productId)) return res.status(400).json({ error: 'productId must be an integer' });

        const [product] = rows(await db.execute(sql`
          SELECT id, code, name, segment, trunk_prefix, status FROM product_registry WHERE id = ${productId}`));
        if (!product) return res.status(404).json({ error: `No product ${productId}` });

        const versionId = req.query.versionId !== undefined ? Number(req.query.versionId) : undefined;
        const destinations = await listEligibleDestinations(db as any, productId, { versionId });

        res.json({
          product: {
            id: Number(product.id), code: product.code, name: product.name,
            segment: product.segment ?? null, trunkPrefix: product.trunk_prefix ?? null,
            status: product.status,
          },
          destinations,
          count: destinations.length,
          // Said explicitly so a caller cannot read an empty list as "unrestricted".
          declared: destinations.length > 0,
          note: destinations.length === 0
            ? 'No eligibility has been declared for this product. That is not the same as every destination being eligible.'
            : undefined,
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

  /**
   * POST /api/products/:productId/eligibility — declare that this product is sold on a destination.
   * Idempotent; re-granting a withdrawn pairing reactivates the same row.
   */
  app.post('/api/products/:productId/eligibility',
    (req: any, res: any, next: any) => requireRole(WRITE, req, res, next),
    async (req: any, res: any) => {
      try {
        const productId = Number(req.params.productId);
        const destinationId = Number(req.body?.destinationId);
        if (!Number.isInteger(productId) || !Number.isInteger(destinationId)) {
          return res.status(400).json({ error: 'productId and destinationId must be integers' });
        }
        const actor = actorId(req);
        if (!actor) return res.status(401).json({ error: 'Eligibility must be attributable to a person.' });

        const outcome = await grantEligibility(db as any, {
          productId, destinationId, grantedBy: String(actor), notes: req.body?.notes ?? null,
        });
        if (!outcome.ok) {
          return res.status(outcome.code === 'unknown_destination' ? 404 : 400)
                    .json({ error: outcome.message, code: outcome.code });
        }

        await writeAudit({
          category: 'operational',
          action: outcome.reactivated ? 'PRODUCT_ELIGIBILITY_REGRANTED' : 'PRODUCT_ELIGIBILITY_GRANTED',
          actor: String(actor), actorType: 'user',
          targetType: 'product_destination_eligibility',
          targetId: `${productId}/${destinationId}`,
          targetName: `product ${productId} → destination ${destinationId}`,
          severity: 'info',
          metadata: { productId, destinationId, versionId: outcome.row.versionId, notes: outcome.row.notes },
          ip: req.ip,
        });

        res.json({ eligibility: outcome.row, reactivated: outcome.reactivated });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

  /**
   * POST /api/products/:productId/eligibility/:destinationId/withdraw
   *
   * A POST rather than a DELETE, because nothing is deleted. "No longer sold here" is a claim
   * someone made, and the row keeps who made it and when.
   */
  app.post('/api/products/:productId/eligibility/:destinationId/withdraw',
    (req: any, res: any, next: any) => requireRole(WRITE, req, res, next),
    async (req: any, res: any) => {
      try {
        const productId = Number(req.params.productId);
        const destinationId = Number(req.params.destinationId);
        if (!Number.isInteger(productId) || !Number.isInteger(destinationId)) {
          return res.status(400).json({ error: 'productId and destinationId must be integers' });
        }
        const actor = actorId(req);
        if (!actor) return res.status(401).json({ error: 'Withdrawing eligibility must be attributable to a person.' });

        const outcome = await withdrawEligibility(db as any, {
          productId, destinationId, withdrawnBy: String(actor), notes: req.body?.notes ?? null,
        });
        if (!outcome.ok) {
          return res.status(outcome.code === 'not_found' ? 404 : 409)
                    .json({ error: outcome.message, code: outcome.code });
        }

        await writeAudit({
          category: 'operational', action: 'PRODUCT_ELIGIBILITY_WITHDRAWN',
          actor: String(actor), actorType: 'user',
          targetType: 'product_destination_eligibility',
          targetId: `${productId}/${destinationId}`,
          targetName: `product ${productId} → destination ${destinationId}`,
          // Withdrawing is the direction that removes a destination from what a product sells, and
          // downstream that removes it from what can be priced and pushed.
          severity: 'warning',
          metadata: { productId, destinationId, notes: outcome.row.notes },
          ip: req.ip,
        });

        res.json({ eligibility: outcome.row });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

  /**
   * GET /api/products/eligibility/rollover — READ-ONLY.
   *
   * What a catalogue version change would do to existing eligibility: what has a same-named
   * destination in the target version, and what does not. It carries nothing across. A name
   * surviving a re-import is not a commercial decision that eligibility survives with it, and a
   * destination can keep its name while changing what it covers.
   */
  app.get('/api/products/eligibility/rollover',
    (req: any, res: any, next: any) => requireRole(READ, req, res, next),
    async (req: any, res: any) => {
      try {
        const from = Number(req.query.from);
        const to   = Number(req.query.to);
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
          return res.status(400).json({ error: 'from and to must be catalogue version ids' });
        }
        const report = await describeVersionRollover(db as any, from, to);
        res.json({
          ...report,
          carriableCount: report.carriable.length,
          orphanedCount: report.orphaned.length,
          note: 'Reported only. Nothing is carried across: whether last version\'s eligibility still applies is a commercial judgement, not a join.',
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });
}
