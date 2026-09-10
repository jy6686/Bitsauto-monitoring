/**
 * routes-increment-changes.ts — scheduling a billing-increment change.
 *
 * A billing increment is a commercial term: changing 60/1 to 30/6 changes what every call on a
 * destination costs. So it is scheduled for a date, clients are told that date, and the switch is
 * changed on that same date.
 *
 * TWO THINGS THESE ENDPOINTS WILL NOT DO.
 *
 *   - **Edit the catalogue.** `commercial_destination_prefixes.billing_increment` is supplier
 *     data, replaced on every re-import. A commercial commitment written there would be silently
 *     reverted by the next vendor file — after clients had been emailed about it. Nothing here
 *     writes to that table, and there is a test asserting it.
 *   - **Send anything, or touch a switch.** Accepting a change commits the change and the
 *     notification rows it owes, in one transaction. Delivery is a separate worker and the Sippy
 *     mutation is a separate, effective-dated operation. Neither is reachable from here.
 */
import type { Express } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { writeAudit } from './audit';
import { acceptIncrementChange } from './services/rates/increment-change-store';
import { resolveEffectiveIncrement, type IncrementChange } from './services/rates/increment-change';

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
const rows  = (r: any) => (r as any).rows ?? [];
const actorId = (req: any) => req.user?.claims?.sub ?? req.user?.id ?? null;
const todayUtc = () => new Date().toISOString().slice(0, 10);

export function registerIncrementChangeRoutes(app: Express) {
  /**
   * GET /api/products/:productId/increment-changes — READ-ONLY.
   *
   * Per eligible destination: the catalogue increment, what is actually in force today, and any
   * scheduled change. Three different facts that a single "increment" field cannot express, and
   * the operator needs all three to decide anything.
   */
  app.get('/api/products/:productId/increment-changes',
    (req: any, res: any, next: any) => requireRole(READ, req, res, next),
    async (req: any, res: any) => {
      try {
        const productId = Number(req.params.productId);
        if (!Number.isInteger(productId)) return res.status(400).json({ error: 'productId must be an integer' });
        const asOf = String(req.query.asOf ?? todayUtc());

        // Eligible destinations and the increments their prefixes carry.
        const dests = rows(await db.execute(sql`
          SELECT d.id, d.name, d.version_id,
                 COALESCE(array_agg(DISTINCT p.billing_increment)
                          FILTER (WHERE p.billing_increment IS NOT NULL), '{}') AS increments,
                 count(p.id)::int AS prefix_count
            FROM product_destination_eligibility e
            JOIN commercial_destinations d ON d.id = e.destination_id
            JOIN catalogue_versions      v ON v.id = d.version_id AND v.status = 'active'
            LEFT JOIN commercial_destination_prefixes p ON p.destination_id = d.id
           WHERE e.product_id = ${productId} AND e.status = 'active'
           GROUP BY d.id, d.name, d.version_id
           ORDER BY d.name`));

        const changes = rows(await db.execute(sql`
          SELECT id, destination_id, catalogue_version_id, previous_increment, new_increment,
                 effective_date, status, applied_at, notified_at
            FROM billing_increment_changes
           WHERE product_id = ${productId}
           ORDER BY effective_date`));

        const byDest = new Map<number, IncrementChange[]>();
        for (const c of changes) {
          const list = byDest.get(Number(c.destination_id)) ?? [];
          list.push({
            id: Number(c.id), productId, destinationId: Number(c.destination_id),
            catalogueVersionId: Number(c.catalogue_version_id),
            previousIncrement: c.previous_increment, newIncrement: c.new_increment,
            effectiveDate: String(c.effective_date).slice(0, 10),
            status: c.status, appliedAt: c.applied_at, notifiedAt: c.notified_at,
          });
          byDest.set(Number(c.destination_id), list);
        }

        res.json({
          productId, asOf,
          destinations: dests.map((d: any) => {
            const list = Array.isArray(d.increments) ? d.increments.map(String).filter(Boolean)
                       : String(d.increments ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
            // A destination whose prefixes disagree is reported rather than averaged: one of
            // them is wrong and an operator must see which before promising anything.
            const catalogueIncrement = list.length === 1 ? list[0] : null;
            const resolved = resolveEffectiveIncrement(catalogueIncrement, byDest.get(Number(d.id)) ?? [], asOf);
            return {
              destinationId: Number(d.id), name: String(d.name), prefixCount: Number(d.prefix_count),
              catalogueIncrement,
              catalogueIncrementsDiffer: list.length > 1 ? list : undefined,
              inForce: resolved.increment ? `${resolved.increment.interval1}/${resolved.increment.intervalN}` : null,
              source: resolved.source,
              awaitingApplication: resolved.awaitingApplication ?? false,
              scheduled: resolved.scheduled ?? null,
            };
          }),
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

  /**
   * POST /api/products/:productId/increment-changes — schedule a change.
   *
   * Commits the change and every notification it owes together, or neither. Sends nothing.
   */
  app.post('/api/products/:productId/increment-changes',
    (req: any, res: any, next: any) => requireRole(WRITE, req, res, next),
    async (req: any, res: any) => {
      try {
        const productId = Number(req.params.productId);
        const destinationId = Number(req.body?.destinationId);
        if (!Number.isInteger(productId) || !Number.isInteger(destinationId)) {
          return res.status(400).json({ error: 'productId and destinationId must be integers' });
        }
        const actor = actorId(req);
        if (!actor) return res.status(401).json({ error: 'A billing increment change must be attributable to a person.' });

        // The destination decides its own version and name; the caller does not get to assert
        // them. Same rule the eligibility layer keeps.
        const [dest] = rows(await db.execute(sql`
          SELECT d.id, d.name, d.version_id,
                 (SELECT DISTINCT p.billing_increment FROM commercial_destination_prefixes p
                   WHERE p.destination_id = d.id AND p.billing_increment IS NOT NULL LIMIT 1) AS increment
            FROM commercial_destinations d WHERE d.id = ${destinationId}`));
        if (!dest) return res.status(404).json({ error: `Destination ${destinationId} is not in the commercial catalogue.` });

        // What is in force TODAY is what the change is measured against — which may already be a
        // previous change rather than the catalogue value.
        const existing = rows(await db.execute(sql`
          SELECT id, new_increment, effective_date, status FROM billing_increment_changes
           WHERE product_id = ${productId} AND destination_id = ${destinationId}`))
          .map((c: any) => ({
            id: Number(c.id), productId, destinationId,
            catalogueVersionId: Number(dest.version_id),
            previousIncrement: null, newIncrement: c.new_increment,
            effectiveDate: String(c.effective_date).slice(0, 10), status: c.status,
          } as IncrementChange));
        const inForce = resolveEffectiveIncrement(dest.increment ?? null, existing, todayUtc());
        const current = inForce.increment ? `${inForce.increment.interval1}/${inForce.increment.intervalN}` : null;

        const outcome = await acceptIncrementChange(db as any, {
          productId, destinationId,
          catalogueVersionId: Number(dest.version_id),
          destinationName: String(dest.name),
          currentIncrement: current,
          newIncrement: String(req.body?.newIncrement ?? ''),
          effectiveDate: String(req.body?.effectiveDate ?? ''),
          today: todayUtc(),
          actor: String(actor),
          notes: req.body?.notes ?? null,
        });

        if (!outcome.ok) {
          const status = outcome.code === 'duplicate_change' ? 409
                       : outcome.code === 'write_failed'     ? 500 : 400;
          return res.status(status).json({ error: outcome.message, code: outcome.code });
        }

        await writeAudit({
          category: 'operational', action: 'BILLING_INCREMENT_CHANGE_SCHEDULED',
          actor: String(actor), actorType: 'user',
          targetType: 'billing_increment_changes', targetId: String(outcome.changeId),
          targetName: `${dest.name} → ${req.body?.newIncrement} on ${req.body?.effectiveDate}`,
          // A change to what every call costs, announced to customers. Not routine.
          severity: 'warning',
          metadata: {
            productId, destinationId, previousIncrement: current,
            newIncrement: req.body?.newIncrement, effectiveDate: req.body?.effectiveDate,
            notificationsOwed: outcome.notified, clientsWithoutContact: outcome.skippedClients,
          },
          ip: req.ip,
        });

        res.json({
          changeId: outcome.changeId,
          previousIncrement: current,
          scheduled: true,
          notificationsOwed: outcome.notified,
          // Named, so a missing rate contact is visible rather than a silent omission.
          clientsWithoutContact: outcome.skippedClients,
          message: outcome.message,
          note: 'Scheduled. Clients will be notified by the delivery worker; the switch is changed on the effective date.',
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

  /**
   * POST /api/products/:productId/increment-changes/:id/cancel
   *
   * A POST rather than a DELETE: the commitment was made and the record of it stays. A cancelled
   * change never takes effect and is excluded from what is in force.
   */
  app.post('/api/products/:productId/increment-changes/:id/cancel',
    (req: any, res: any, next: any) => requireRole(WRITE, req, res, next),
    async (req: any, res: any) => {
      try {
        const id = Number(req.params.id);
        const actor = actorId(req);
        if (!actor) return res.status(401).json({ error: 'Cancelling must be attributable to a person.' });

        const [existing] = rows(await db.execute(sql`
          SELECT id, status, applied_at FROM billing_increment_changes WHERE id = ${id}`));
        if (!existing) return res.status(404).json({ error: `No increment change ${id}.` });
        if (existing.status === 'applied') {
          // The switch already holds it. Cancelling the record would make the platform disagree
          // with the tariff; the way back is another change, not an erasure.
          return res.status(409).json({
            error: 'That change has already been applied to the switch. Schedule a new change rather than cancelling this one.',
          });
        }
        if (existing.status === 'cancelled') return res.status(409).json({ error: 'Already cancelled.' });

        await db.execute(sql`
          UPDATE billing_increment_changes
             SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ${String(actor)}
           WHERE id = ${id}`);
        // Nothing further is owed to anyone about a change that will not happen.
        await db.execute(sql`
          UPDATE billing_increment_notifications
             SET status = 'suppressed'
           WHERE change_id = ${id} AND status IN ('pending', 'failed')`);

        await writeAudit({
          category: 'operational', action: 'BILLING_INCREMENT_CHANGE_CANCELLED',
          actor: String(actor), actorType: 'user',
          targetType: 'billing_increment_changes', targetId: String(id),
          severity: 'warning', ip: req.ip,
        });
        res.json({ cancelled: true, id });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });
}
