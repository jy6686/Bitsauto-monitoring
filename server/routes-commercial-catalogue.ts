/**
 * routes-commercial-catalogue.ts — the review console's API.
 *
 * Serves the VERSIONED commercial catalogue created by migration 500. Reads the tables
 * directly rather than v_catalogue_sellable, because the console's whole job is reviewing a
 * DRAFT — and that view deliberately shows only the active version's approved rows, so it
 * would return nothing for a catalogue that has not been activated yet.
 *
 *   console / admin      -> these endpoints, version-scoped, drafts visible
 *   commercial pickers   -> v_catalogue_sellable, active + approved only
 *
 * Two rules the endpoints enforce by omission rather than by validation:
 *
 *   1. No endpoint accepts a destination name, prefix, rate, billing increment or effective
 *      date. Supplier data is immutable (migration 500's triggers refuse it), so there is
 *      nothing to expose. A correction means importing a new version.
 *   2. No endpoint takes a product. Products belong to the pricing layer; the trunk digit is
 *      derived at push time from the selected product.
 *
 * Distinct from the LEGACY `/api/commercial-destinations` (routes.ts:28419), which joins
 * product_destination_assignments to global_destinations and belongs to the old catalogue.
 * That one retires when Rate Manager stops calling it.
 */
import type { Express } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';

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
const actor = (req: any) =>
  req.user?.firstName && req.user?.lastName ? `${req.user.firstName} ${req.user.lastName}`
  : req.user?.email ?? req.user?.claims?.sub ?? 'operator';

export function registerCommercialCatalogueRoutes(app: Express) {

  // ── GET /api/commercial/catalogues — the version dashboard ──────────────────────────
  // Counts come from the tables, never from a stored total: a cached count is a second
  // source of truth that can disagree with the rows it describes.
  app.get('/api/commercial/catalogues',
    (req: any, res, next) => requireRole(READ, req, res, next), async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT v.id, v.label, v.status, v.source_file, v.created_at, v.activated_at, v.activated_by,
               count(DISTINCT d.id)                                                     AS destinations,
               count(p.id)                                                              AS prefixes,
               count(DISTINCT d.id) FILTER (WHERE d.approval_status = 'approved')       AS approved,
               count(DISTINCT d.id) FILTER (WHERE d.approval_status = 'unapproved')     AS pending,
               count(DISTINCT d.id) FILTER (WHERE d.approval_status = 'blocked')        AS blocked,
               (SELECT b.file_sha256 FROM catalogue_import_batches b
                 WHERE b.version_id = v.id ORDER BY b.id DESC LIMIT 1)                   AS file_sha256,
               (SELECT b.imported_at FROM catalogue_import_batches b
                 WHERE b.version_id = v.id ORDER BY b.id DESC LIMIT 1)                   AS imported_at
          FROM catalogue_versions v
          LEFT JOIN commercial_destinations d          ON d.version_id = v.id
          LEFT JOIN commercial_destination_prefixes p  ON p.destination_id = d.id
         GROUP BY v.id
         ORDER BY v.id DESC`);
      res.json({ catalogues: rows(r) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/commercial/catalogues/:versionId/destinations ──────────────────────────
  // q matches the identity name OR any prefix behind it — an operator who knows only the
  // code still finds the destination, without prefixes being a browsable dimension.
  // prefix_preview exists so a reviewer approving ARGENTINA - MOBILE can see it carries
  // 1,757 codes before deciding, rather than after.
  app.get('/api/commercial/catalogues/:versionId/destinations',
    (req: any, res, next) => requireRole(READ, req, res, next), async (req: any, res) => {
    try {
      const versionId = Number(req.params.versionId);
      if (!Number.isFinite(versionId)) return res.status(400).json({ error: 'versionId must be numeric' });
      const q      = String(req.query.q ?? '').trim();
      const status = String(req.query.status ?? '').trim();
      const limit  = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      if (status && !['approved', 'unapproved', 'blocked'].includes(status))
        return res.status(400).json({ error: `unknown status "${status}"` });

      const r = await db.execute(sql`
        WITH agg AS (
          SELECT d.id, d.name, d.commercial_name,
                 COALESCE(d.commercial_name, d.name) AS display_name,
                 d.approval_status, d.approved_by, d.approved_at,
                 count(p.id)                                                   AS prefix_count,
                 (array_agg(p.prefix ORDER BY p.prefix))[1:4]                  AS prefix_preview,
                 max(p.supplier_rate)                                          AS supplier_rate,
                 max(p.billing_increment)                                      AS billing_increment,
                 max(p.effective_date_raw)                                     AS effective_date
            FROM commercial_destinations d
            LEFT JOIN commercial_destination_prefixes p ON p.destination_id = d.id
           WHERE d.version_id = ${versionId}
             AND (${status} = '' OR d.approval_status = ${status})
             AND (${q} = '' OR (
                   -- Token AND, not a substring match on the whole phrase. Supplier names
                   -- carry a separator -- PAKISTAN - MOBILE MOBILINK -- so ILIKE
                   -- '%pakistan mobile%' matches NOTHING and an operator typing the obvious
                   -- thing finds an empty list. Every token must appear somewhere in the
                   -- name; order and punctuation between them are irrelevant.
                   NOT EXISTS (
                     SELECT 1 FROM unnest(string_to_array(lower(${q}), ' ')) AS t(tok)
                      WHERE tok <> ''
                        AND lower(d.name || ' ' || coalesce(d.commercial_name, ''))
                            NOT LIKE '%' || tok || '%')
                   OR EXISTS (
                     SELECT 1 FROM commercial_destination_prefixes px
                      WHERE px.destination_id = d.id AND px.prefix LIKE ${q + '%'})))
           GROUP BY d.id
        )
        SELECT *, count(*) OVER () AS total_matching FROM agg
         ORDER BY name LIMIT ${limit} OFFSET ${offset}`);
      const list = rows(r);
      res.json({
        versionId, limit, offset,
        total: list.length ? Number(list[0].total_matching) : 0,
        destinations: list.map((d: any) => ({ ...d, total_matching: undefined })),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /api/commercial/destinations/:id — every prefix, and the approval history ────
  app.get('/api/commercial/destinations/:id',
    (req: any, res, next) => requireRole(READ, req, res, next), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be numeric' });
      const d = rows(await db.execute(sql`
        SELECT d.*, v.label AS version_label, v.status AS version_status
          FROM commercial_destinations d
          JOIN catalogue_versions v ON v.id = d.version_id
         WHERE d.id = ${id}`))[0];
      if (!d) return res.status(404).json({ error: 'destination not found' });
      const prefixes = rows(await db.execute(sql`
        SELECT prefix, supplier_rate, billing_increment, effective_date_raw, source_row
          FROM commercial_destination_prefixes WHERE destination_id = ${id} ORDER BY prefix`));
      const history = rows(await db.execute(sql`
        SELECT from_status, to_status, actor, reason, changed_at
          FROM commercial_destination_approvals WHERE destination_id = ${id}
         ORDER BY changed_at DESC`));
      res.json({ destination: d, prefixes, history });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/commercial/destinations/:id/approval — approve | block | unapprove ─────
  // approved_at is set here rather than left to the trigger. Migration 501 moves it into
  // the trigger so no caller can omit it; until then this is the only writer.
  app.post('/api/commercial/destinations/:id/approval',
    (req: any, res, next) => requireRole(WRITE, req, res, next), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body?.status ?? '');
      const reason = req.body?.reason ? String(req.body.reason) : null;
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be numeric' });
      if (!['approved', 'unapproved', 'blocked'].includes(status))
        return res.status(400).json({ error: 'status must be approved | unapproved | blocked' });
      if (status === 'blocked' && !reason)
        return res.status(400).json({ error: 'blocking requires a reason — an unexplained block is indistinguishable from a mistake' });

      const who = actor(req);
      const r = await db.execute(sql`
        UPDATE commercial_destinations
           SET approval_status = ${status},
               approved_by = CASE WHEN ${status} = 'approved' THEN ${who} ELSE NULL END,
               approved_at = CASE WHEN ${status} = 'approved' THEN NOW() ELSE NULL END
         WHERE id = ${id} RETURNING id, name, approval_status`);
      const row = rows(r)[0];
      if (!row) return res.status(404).json({ error: 'destination not found' });
      if (reason) await db.execute(sql`
        UPDATE commercial_destination_approvals SET reason = ${reason}
         WHERE id = (SELECT id FROM commercial_destination_approvals
                      WHERE destination_id = ${id} ORDER BY changed_at DESC LIMIT 1)`);
      res.json({ ok: true, destination: row });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── PATCH /api/commercial/destinations/:id/name — the BUSINESS name ──────────────────
  // Sets commercial_name only. `name` is the supplier's and the database refuses it, so there
  // is no path here that could rewrite supplier data even by mistake. null/empty clears the
  // rename and the destination falls back to displaying the supplier name.
  app.patch('/api/commercial/destinations/:id/name',
    (req: any, res, next) => requireRole(WRITE, req, res, next), async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be numeric' });
      const raw = req.body?.commercialName;
      const commercialName = raw === null || raw === undefined || String(raw).trim() === ''
        ? null : String(raw).trim();
      if (commercialName && commercialName.length > 200)
        return res.status(400).json({ error: 'commercial name is limited to 200 characters' });

      const r = await db.execute(sql`
        UPDATE commercial_destinations
           SET commercial_name = ${commercialName}, renamed_by = ${commercialName ? actor(req) : null}
         WHERE id = ${id}
         RETURNING id, name, commercial_name, renamed_by, renamed_at`);
      const row = rows(r)[0];
      if (!row) return res.status(404).json({ error: 'destination not found' });
      res.json({ ok: true, destination: row });
    } catch (e: any) {
      // The partial unique index is the guard; translate it into something an operator can act on.
      if (String(e.message).includes('cd_commercial_name_unique'))
        return res.status(409).json({ error: 'another destination in this version already uses that commercial name — one commercial name means one identity' });
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/commercial/catalogues/:versionId/approvals/bulk ────────────────────────
  // Country-at-a-time review, which is the unit the pricing team actually works in.
  // namePrefix is REQUIRED and non-empty: an empty prefix would match all 1,344 identities,
  // and "approve everything" must never be reachable by omitting a field.
  app.post('/api/commercial/catalogues/:versionId/approvals/bulk',
    (req: any, res, next) => requireRole(WRITE, req, res, next), async (req: any, res) => {
    try {
      const versionId  = Number(req.params.versionId);
      const namePrefix = String(req.body?.namePrefix ?? '').trim();
      const status     = String(req.body?.status ?? '');
      const reason     = req.body?.reason ? String(req.body.reason) : null;
      if (!Number.isFinite(versionId)) return res.status(400).json({ error: 'versionId must be numeric' });
      if (!namePrefix) return res.status(400).json({ error: 'namePrefix is required — an empty value would match the whole catalogue' });
      if (!['approved', 'unapproved', 'blocked'].includes(status))
        return res.status(400).json({ error: 'status must be approved | unapproved | blocked' });
      if (status === 'blocked' && !reason) return res.status(400).json({ error: 'blocking requires a reason' });

      const who = actor(req);
      const r = await db.execute(sql`
        UPDATE commercial_destinations
           SET approval_status = ${status},
               approved_by = CASE WHEN ${status} = 'approved' THEN ${who} ELSE NULL END,
               approved_at = CASE WHEN ${status} = 'approved' THEN NOW() ELSE NULL END
         WHERE version_id = ${versionId}
           AND name ILIKE ${namePrefix + '%'}
           AND approval_status IS DISTINCT FROM ${status}
         RETURNING id, name`);
      const changed = rows(r);
      if (reason && changed.length) await db.execute(sql`
        UPDATE commercial_destination_approvals SET reason = ${reason}
         WHERE destination_id = ANY(${sql.raw(`ARRAY[${changed.map((c: any) => c.id).join(',')}]`)})
           AND reason IS NULL`);
      res.json({ ok: true, matched: changed.length, status, names: changed.map((c: any) => c.name) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── POST /api/commercial/catalogues/:versionId/activate — the cutover ────────────────
  // Delegates to the DB function so archive-old + activate-new happen in one transaction and
  // there is never a moment with zero active versions. Rollback is this call naming the
  // previous label. Reports what is still unapproved rather than refusing: those rows stay
  // hidden from commercial modules, so activating with pending rows is legitimate.
  app.post('/api/commercial/catalogues/:versionId/activate',
    (req: any, res, next) => requireRole(WRITE, req, res, next), async (req: any, res) => {
    try {
      const versionId = Number(req.params.versionId);
      if (!Number.isFinite(versionId)) return res.status(400).json({ error: 'versionId must be numeric' });
      const v = rows(await db.execute(sql`SELECT label FROM catalogue_versions WHERE id = ${versionId}`))[0];
      if (!v) return res.status(404).json({ error: 'catalogue version not found' });
      const approved = rows(await db.execute(sql`
        SELECT count(*) FILTER (WHERE approval_status = 'approved')   AS approved,
               count(*) FILTER (WHERE approval_status = 'unapproved') AS pending
          FROM commercial_destinations WHERE version_id = ${versionId}`))[0];
      const out = rows(await db.execute(
        sql`SELECT activate_catalogue_version(${v.label}, ${actor(req)}) AS result`))[0];
      const sellable = rows(await db.execute(sql`SELECT count(*) AS n FROM v_catalogue_sellable`))[0];
      res.json({ ok: true, result: out?.result, approved: Number(approved?.approved ?? 0),
                 stillPending: Number(approved?.pending ?? 0), sellable: Number(sellable?.n ?? 0) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
