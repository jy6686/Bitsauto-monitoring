/**
 * routes-product-mapping.ts  (v2 — architecture-reviewed)
 *
 * Product Destination Mapping — upload, validate, activate, rollback, diff.
 * Registered by calling registerProductMappingRoutes(app) from routes.ts.
 *
 * ENDPOINTS:
 *   POST /api/gcs/product-mappings/upload                    — parse + store + validate
 *   GET  /api/gcs/product-mappings/versions                  — list versions
 *   GET  /api/gcs/product-mappings/versions/:id              — detail + sample
 *   GET  /api/gcs/product-mappings/versions/:id/download     — original file
 *   POST /api/gcs/product-mappings/versions/:id/activate     — activate products
 *   GET  /api/gcs/product-mappings/versions/:id/diff         — diff vs another version
 *   POST /api/gcs/product-mappings/versions/:id/archive      — archive a version
 *   GET  /api/gcs/product-mappings/active                    — active mappings (paginated)
 *   GET  /api/gcs/product-mappings/products                  — products with active version
 *   GET  /api/gcs/product-mappings/active-config             — per-product active version map
 *   POST /api/gcs/product-mappings/refresh                   — force cache reload (admin only)
 *   GET  /api/gcs/product-mappings/health                    — resolver stats for Server Health
 *
 * PRODUCT IDENTITY
 *   product_id is a FK → product_registry.id (NOT the products table — that table does not exist).
 *   Confirmed IDs: First Class=1, Business Class=2, Special Bravo=3, Special Charlie=4.
 */

import type { Express } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';
import * as xlsx from 'xlsx';
import crypto from 'crypto';
import multer from 'multer';
import {
  productMappingResolver,
  normalizeDialPrefix,
  PRODUCT_MAPPING_RESOLVER_VERSION,
} from './services/commercial/product-mapping-resolver';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAPPING_PARSER_VERSION   = '2.0.0';
const MAPPING_RESOLVER_VERSION = PRODUCT_MAPPING_RESOLVER_VERSION ?? '3.0.0';

// ── File upload — in-memory, max 20 MB ───────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
});

// ── Column name aliases (case-insensitive) ────────────────────────────────────

const PRODUCT_ID_COLS = ['product id', 'product_id', 'productid', 'product', 'id'];
const PREFIX_COLS     = ['dial prefix', 'prefix', 'dial_prefix', 'dial code', 'dial_code', 'code'];
const FROM_COLS       = ['effective from', 'effective_from', 'from', 'start', 'start date'];
const TO_COLS         = ['effective to',   'effective_to',   'to',   'end',   'end date'];

function resolveCol(headers: string[], aliases: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const alias of aliases) {
    const i = lower.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
}

// Use the canonical normalizer from product-mapping-resolver so upload parser
// and runtime resolver always apply identical prefix normalization.
const normalizePrefix = normalizeDialPrefix;

// ── Auth helper (mirrors pattern in routes-rate-manager.ts) ──────────────────

async function requireRole(roles: string[], req: any, res: any, next: any) {
  const userId = req.user?.claims?.sub;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rows    = await db.execute(sql`SELECT role FROM user_roles WHERE user_id = ${userId} LIMIT 1`);
    const userRole = (rows as any).rows?.[0]?.role ?? null;
    if (!userRole) return res.status(403).json({ error: 'No role assigned' });
    if (userRole === 'super_admin' || roles.includes(userRole)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  } catch { return next(); }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerProductMappingRoutes(app: Express) {

  // ── POST /api/gcs/product-mappings/upload ───────────────────────────────────
  //
  // Accepts multipart/form-data:
  //   file   — XLSX or CSV
  //   label  — optional version label
  //
  // Parses, validates, stores, and returns a validated version record.
  // The version is immediately usable for activation.

  app.post(
    '/api/gcs/product-mappings/upload',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    upload.single('file'),
    async (req: any, res: any) => {
      try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const fileBuffer  = req.file.buffer;
        const sha256      = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const label       = (req.body.label as string)?.trim()
          || `Import ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
        const performedBy = req.user?.claims?.sub ?? null;

        // ── Parse workbook ──────────────────────────────────────────────────
        const wb   = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) {
          return res.status(422).json({
            error: 'File must have a header row and at least one data row',
          });
        }

        const headers = rows[0].map(String);
        const pidCol  = resolveCol(headers, PRODUCT_ID_COLS);
        const pfxCol  = resolveCol(headers, PREFIX_COLS);
        const fromCol = resolveCol(headers, FROM_COLS);
        const toCol   = resolveCol(headers, TO_COLS);

        if (pidCol < 0) return res.status(422).json({ error: 'Cannot find Product ID column. Expected "Product ID" or "product_id".' });
        if (pfxCol < 0) return res.status(422).json({ error: 'Cannot find Dial Prefix column. Expected "Dial Prefix" or "prefix".' });

        // ── Validate product IDs against product_registry ───────────────────
        const knownProducts = await db.execute(sql`
          SELECT id, name FROM product_registry ORDER BY id
        `).then(r => new Map((r.rows as any[]).map(p => [p.id, p.name])));

        // ── Parse rows ──────────────────────────────────────────────────────
        interface ParsedRow {
          productId:            number;
          dialPrefixOriginal:   string;
          dialPrefixNormalized: string;
          effectiveFrom:        string | null;
          effectiveTo:          string | null;
          sourceRow:            number;
        }

        const errors:   { row: number; productId?: number; prefix?: string; reason: string }[] = [];
        const warnings: { row: number; productId?: number; prefix?: string; reason: string }[] = [];
        const validRows: ParsedRow[] = [];

        // Track duplicates: "productId:prefix" → [row indices]
        const seenMap = new Map<string, number[]>();

        for (let i = 1; i < rows.length; i++) {
          const r       = rows[i];
          const rawPid  = String(r[pidCol]  ?? '').trim();
          const rawPfx  = String(r[pfxCol]  ?? '').trim();

          if (!rawPid && !rawPfx) continue; // blank row — skip silently

          const productId = parseInt(rawPid);

          if (!rawPid || isNaN(productId)) {
            errors.push({ row: i + 1, reason: `Invalid or missing Product ID: "${rawPid}"` });
            continue;
          }
          if (!rawPfx) {
            errors.push({ row: i + 1, productId, reason: 'Missing dial prefix' });
            continue;
          }
          if (!knownProducts.has(productId)) {
            errors.push({ row: i + 1, productId, prefix: rawPfx, reason: `Product ID ${productId} not found in product_registry` });
            continue;
          }

          const normalized = normalizePrefix(rawPfx);
          if (!normalized) {
            errors.push({ row: i + 1, productId, prefix: rawPfx, reason: 'Prefix normalizes to empty string' });
            continue;
          }

          const key      = `${productId}:${normalized}`;
          const existing = seenMap.get(key);
          if (existing) {
            existing.push(i + 1);
          } else {
            seenMap.set(key, [i + 1]);
          }

          const fromVal = fromCol >= 0 ? r[fromCol] : null;
          const toVal   = toCol   >= 0 ? r[toCol]   : null;

          validRows.push({
            productId,
            dialPrefixOriginal:   rawPfx,
            dialPrefixNormalized: normalized,
            effectiveFrom: fromVal ? String(fromVal).slice(0, 10) : null,
            effectiveTo:   toVal   ? String(toVal).slice(0, 10)   : null,
            sourceRow: i + 1,
          });
        }

        if (validRows.length === 0) {
          return res.status(422).json({ error: 'No valid rows found', errors });
        }

        // ── Resolve destination IDs from active catalog ─────────────────────
        const allNormalized = [...new Set(validRows.map(r => r.dialPrefixNormalized))];
        const destLookup    = new Map<string, number>();

        const destResult = await db.execute(sql`
          SELECT LTRIM(dial_prefix, '+') AS norm, id
          FROM   global_destinations
          WHERE  LTRIM(dial_prefix, '+') = ANY(${allNormalized}::text[])
        `);
        for (const row of destResult.rows as any[]) {
          destLookup.set(row.norm, row.id);
        }

        const unknownPrefixes = allNormalized.filter(p => !destLookup.has(p));
        for (const p of unknownPrefixes) {
          warnings.push({ prefix: p, row: -1, reason: `Prefix "${p}" not in active destination catalog — stored with resolution_status='missing_destination'` });
        }

        // ── Orphan products (in active config but absent from this file) ────
        const fileProductIds    = new Set(validRows.map(r => r.productId));
        const activeConfigResult = await db.execute(sql`
          SELECT product_id FROM product_mapping_active_config
        `);
        const orphanProducts = (activeConfigResult.rows as any[])
          .map(r => r.product_id)
          .filter(pid => !fileProductIds.has(pid));

        for (const pid of orphanProducts) {
          warnings.push({ productId: pid, row: -1, reason: `Product ${pid} (${knownProducts.get(pid) ?? 'unknown'}) has an active mapping but is absent from this file` });
        }

        // ── Collect duplicates ──────────────────────────────────────────────
        const duplicates: { productId: number; prefix: string; rows: number[] }[] = [];
        for (const [key, rowNums] of seenMap) {
          if (rowNums.length > 1) {
            const [pidStr, prefix] = key.split(':');
            duplicates.push({ productId: parseInt(pidStr), prefix, rows: rowNums });
            warnings.push({ prefix, reason: `Duplicate: prefix "${prefix}" for product ${pidStr} appears on rows ${rowNums.join(', ')}`, row: rowNums[0] });
          }
        }

        const distinctProducts = fileProductIds;
        const distinctPrefixes = new Set(validRows.map(r => r.dialPrefixNormalized));

        // ── Build validation_report ─────────────────────────────────────────
        const validationReport = {
          summary: {
            total:    rows.length - 1,
            valid:    validRows.length,
            skipped:  (rows.length - 1) - validRows.length,
            warnings: warnings.length,
            errors:   errors.length,
          },
          errors,
          warnings,
          unknownPrefixes,
          unknownProducts: errors.filter(e => e.reason.includes('not found in product_registry')).map(e => e.productId),
          duplicates,
          orphanProducts,
        };

        // ── Active catalog version for version fingerprint ──────────────────
        const activeCatalogRow = await db.execute(sql`
          SELECT id FROM destination_catalog_versions WHERE status = 'active' LIMIT 1
        `).then(r => (r.rows[0] as any)?.id ?? null);

        // ── Insert version record ───────────────────────────────────────────
        const [versionRow] = await db.execute(sql`
          INSERT INTO product_mapping_versions (
            label, source_file, sha256,
            row_count, product_count, prefix_count,
            status, validation_report,
            catalog_version, mapping_engine_version, parser_version, resolver_version,
            uploaded_by, created_at, validated_at
          ) VALUES (
            ${label}, ${req.file.originalname}, ${sha256},
            ${validRows.length}, ${distinctProducts.size}, ${distinctPrefixes.size},
            'validated',
            ${JSON.stringify(validationReport)}::jsonb,
            ${activeCatalogRow ? String(activeCatalogRow) : null},
            ${MAPPING_RESOLVER_VERSION}, ${MAPPING_PARSER_VERSION}, ${MAPPING_RESOLVER_VERSION},
            ${performedBy}, NOW(), NOW()
          )
          RETURNING id
        `).then(r => r.rows as any[]);

        const versionId = versionRow.id;

        // ── Store original file blob ────────────────────────────────────────
        await db.execute(sql`
          INSERT INTO product_mapping_files
            (mapping_version_id, filename, mime_type, size_bytes, sha256, blob, created_at)
          VALUES
            (${versionId}, ${req.file.originalname},
             ${req.file.mimetype ?? 'application/octet-stream'},
             ${req.file.size}, ${sha256}, ${fileBuffer}, NOW())
        `);

        // ── Batch-insert mapping rows via unnest (1 round-trip) ─────────────
        {
          const vIds:    number[]          = [];
          const pIds:    number[]          = [];
          const pNames:  string[]          = [];
          const pfxOrig: string[]          = [];
          const pfxNorm: string[]          = [];
          const dIds:    (number | null)[] = [];
          const rStats:  string[]          = [];
          const effFrom: (string | null)[] = [];
          const effTo:   (string | null)[] = [];
          const srcRows: (number | null)[] = [];

          for (const row of validRows) {
            const destId          = destLookup.get(row.dialPrefixNormalized) ?? null;
            const duplicateKey    = `${row.productId}:${row.dialPrefixNormalized}`;
            const isDuplicate     = (seenMap.get(duplicateKey)?.length ?? 0) > 1;
            const resolutionStatus = isDuplicate
              ? 'duplicate'
              : destId !== null ? 'resolved' : 'missing_destination';

            vIds.push(versionId);
            pIds.push(row.productId);
            pNames.push(knownProducts.get(row.productId) ?? String(row.productId));
            pfxOrig.push(row.dialPrefixOriginal);
            pfxNorm.push(row.dialPrefixNormalized);
            dIds.push(destId);
            rStats.push(resolutionStatus);
            effFrom.push(row.effectiveFrom);
            effTo.push(row.effectiveTo);
            srcRows.push(row.sourceRow);
          }

          await db.execute(sql`
            INSERT INTO product_destination_mappings (
              mapping_version_id, product_id, product_name_snapshot,
              dial_prefix_original, dial_prefix_normalized,
              destination_id, resolution_status,
              effective_from, effective_to, source_row
            )
            SELECT
              unnest(${vIds}::bigint[]),
              unnest(${pIds}::integer[]),
              unnest(${pNames}::text[]),
              unnest(${pfxOrig}::text[]),
              unnest(${pfxNorm}::text[]),
              unnest(${dIds}::integer[]),
              unnest(${rStats}::text[]),
              unnest(${effFrom}::date[]),
              unnest(${effTo}::date[]),
              unnest(${srcRows}::integer[])
          `);
        }

        res.status(201).json({
          versionId,
          label,
          status:          'validated',
          rowCount:        validRows.length,
          productCount:    distinctProducts.size,
          prefixCount:     distinctPrefixes.size,
          validationReport,
          message: errors.length === 0
            ? `Uploaded ${validRows.length} mappings across ${distinctProducts.size} products. Ready to activate.`
            : `Uploaded with ${errors.length} error(s) and ${warnings.length} warning(s). Review before activating.`,
        });
      } catch (err: any) {
        console.error('[product-mapping] upload error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET /api/gcs/product-mappings/versions ──────────────────────────────────

  app.get(
    '/api/gcs/product-mappings/versions',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (_req: any, res: any) => {
      try {
        const rows = await db.execute(sql`
          SELECT
            v.id, v.label, v.source_file, v.sha256,
            v.row_count, v.product_count, v.prefix_count,
            v.status, v.validation_report,
            v.catalog_version, v.mapping_engine_version,
            v.uploaded_by, v.created_at, v.validated_at,
            v.activated_at, v.superseded_at, v.archived_at,
            COUNT(pmac.product_id) AS active_product_count
          FROM product_mapping_versions v
          LEFT JOIN product_mapping_active_config pmac ON pmac.mapping_version_id = v.id
          GROUP BY v.id
          ORDER BY v.created_at DESC
          LIMIT 50
        `);
        res.json(rows.rows);
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── GET /api/gcs/product-mappings/versions/:id ──────────────────────────────

  app.get(
    '/api/gcs/product-mappings/versions/:id',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res: any) => {
      try {
        const id = parseInt(req.params.id);

        const [version] = await db.execute(sql`
          SELECT v.*,
            COUNT(pmac.product_id) AS active_product_count
          FROM product_mapping_versions v
          LEFT JOIN product_mapping_active_config pmac ON pmac.mapping_version_id = v.id
          WHERE v.id = ${id}
          GROUP BY v.id
        `).then(r => r.rows as any[]);

        if (!version) return res.status(404).json({ error: 'Version not found' });

        // Per-product breakdown with product names from product_registry
        const products = await db.execute(sql`
          SELECT
            pdm.product_id,
            p.name AS product_name,
            COUNT(*)                                                           AS prefix_count,
            COUNT(*) FILTER (WHERE pdm.resolution_status = 'resolved')         AS resolved_count,
            COUNT(*) FILTER (WHERE pdm.resolution_status = 'missing_destination') AS missing_count,
            COUNT(*) FILTER (WHERE pdm.resolution_status = 'duplicate')        AS duplicate_count,
            pmac.mapping_version_id IS NOT NULL                                AS is_currently_active
          FROM product_destination_mappings pdm
          JOIN product_registry p ON p.id = pdm.product_id
          LEFT JOIN product_mapping_active_config pmac
            ON pmac.product_id         = pdm.product_id
            AND pmac.mapping_version_id = ${id}
          WHERE pdm.mapping_version_id = ${id}
          GROUP BY pdm.product_id, p.name, pmac.mapping_version_id
          ORDER BY p.name
        `);

        // Sample rows (first 20)
        const sample = await db.execute(sql`
          SELECT
            pdm.product_id, p.name AS product_name,
            pdm.dial_prefix_original, pdm.dial_prefix_normalized,
            pdm.destination_id, pdm.resolution_status,
            gd.name AS destination_name, gd.country_code,
            pdm.effective_from, pdm.effective_to
          FROM product_destination_mappings pdm
          JOIN product_registry p ON p.id = pdm.product_id
          LEFT JOIN global_destinations gd ON gd.id = pdm.destination_id
          WHERE pdm.mapping_version_id = ${id}
          ORDER BY p.name, pdm.dial_prefix_normalized
          LIMIT 20
        `);

        res.json({ version, products: products.rows, sample: sample.rows });
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── GET /api/gcs/product-mappings/versions/:id/download ─────────────────────

  app.get(
    '/api/gcs/product-mappings/versions/:id/download',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res: any) => {
      try {
        const id = parseInt(req.params.id);
        const [file] = await db.execute(sql`
          SELECT filename, mime_type, blob FROM product_mapping_files
          WHERE  mapping_version_id = ${id}
        `).then(r => r.rows as any[]);

        if (!file) return res.status(404).json({ error: 'File not found' });

        res.setHeader('Content-Type', file.mime_type);
        res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
        res.send(file.blob);
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── POST /api/gcs/product-mappings/versions/:id/activate ────────────────────
  //
  // Body (JSON):
  //   { productIds?: number[] }   — if omitted, activates ALL products in the version
  //
  // Per-product UPSERT into product_mapping_active_config.
  // Rollback = call this endpoint with an older versionId.
  // Cache refresh happens AFTER transaction commits.

  app.post(
    '/api/gcs/product-mappings/versions/:id/activate',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res: any) => {
      try {
        const versionId   = parseInt(req.params.id);
        const performedBy = req.user?.claims?.sub  ?? 'unknown';
        const byName      = req.user?.claims?.name ?? null;
        const now         = new Date();

        // Validate version exists and is activatable
        const [version] = await db.execute(sql`
          SELECT id, label, status FROM product_mapping_versions WHERE id = ${versionId}
        `).then(r => r.rows as any[]);

        if (!version) return res.status(404).json({ error: 'Version not found' });
        if (version.status === 'archived') {
          return res.status(409).json({ error: 'Cannot activate an archived version' });
        }

        // Determine which product IDs to activate
        const requestedIds: number[] | undefined = req.body?.productIds;
        let targetProductIds: number[];

        if (requestedIds && requestedIds.length > 0) {
          targetProductIds = requestedIds;
        } else {
          const result = await db.execute(sql`
            SELECT DISTINCT product_id
            FROM   product_destination_mappings
            WHERE  mapping_version_id = ${versionId}
          `);
          targetProductIds = (result.rows as any[]).map(r => r.product_id);
        }

        if (targetProductIds.length === 0) {
          return res.status(422).json({ error: 'No product IDs found in this version' });
        }

        // Resolve product names from product_registry (read-only, before transaction)
        const productNames = await db.execute(sql`
          SELECT id, name FROM product_registry WHERE id = ANY(${targetProductIds}::integer[])
        `).then(r => new Map((r.rows as any[]).map(p => [p.id, p.name])));

        // Read current active versions for all target products (before transaction)
        const currentActives = await db.execute(sql`
          SELECT product_id, mapping_version_id
          FROM   product_mapping_active_config
          WHERE  product_id = ANY(${targetProductIds}::integer[])
        `).then(r => new Map((r.rows as any[]).map(row => [row.product_id, row.mapping_version_id])));

        const activated: { productId: number; productName: string; previousVersionId: number | null }[] = [];

        await db.transaction(async (tx: any) => {
          for (const productId of targetProductIds) {
            const previousVersionId = currentActives.get(productId) ?? null;
            const action            = previousVersionId !== null ? 'rollback' : 'activate';

            await tx.execute(sql`
              INSERT INTO product_mapping_active_config
                (product_id, mapping_version_id, activated_at, activated_by)
              VALUES
                (${productId}, ${versionId}, ${now}, ${performedBy})
              ON CONFLICT (product_id) DO UPDATE
                SET mapping_version_id = ${versionId},
                    activated_at       = ${now},
                    activated_by       = ${performedBy}
            `);

            await tx.execute(sql`
              INSERT INTO product_mapping_activation_log
                (mapping_version_id, product_id, action, from_version_id,
                 performed_by, performed_by_name, created_at)
              VALUES
                (${versionId}, ${productId}, ${action}, ${previousVersionId},
                 ${performedBy}, ${byName}, ${now})
            `);

            activated.push({
              productId,
              productName:      productNames.get(productId) ?? String(productId),
              previousVersionId,
            });
          }

          await tx.execute(sql`
            UPDATE product_mapping_versions
            SET    status = 'active', activated_at = COALESCE(activated_at, ${now})
            WHERE  id = ${versionId}
              AND  status NOT IN ('active', 'archived')
          `);
        });

        // Refresh resolver cache after the transaction commits.
        try {
          await productMappingResolver.refresh();
          console.log(`[product-mapping] Cache refreshed after activating version ${versionId} for ${activated.length} product(s)`);
        } catch (cacheErr: any) {
          // Non-fatal: DB write succeeded; cache will self-heal on next request.
          console.error('[product-mapping] Cache refresh failed after activation (non-fatal):', cacheErr.message);
        }

        res.json({
          versionId,
          label:     version.label,
          activated,
          message:   `Activated ${activated.length} product${activated.length !== 1 ? 's' : ''} from version "${version.label}".`,
        });
      } catch (err: any) {
        console.error('[product-mapping] activate error:', err);
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET /api/gcs/product-mappings/versions/:id/diff ─────────────────────────
  //
  // Query param: compareWith=<versionId>  (defaults to most recent superseded version)

  app.get(
    '/api/gcs/product-mappings/versions/:id/diff',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res: any) => {
      try {
        const versionId        = parseInt(req.params.id);
        const compareWithParam = req.query.compareWith ? parseInt(req.query.compareWith as string) : null;

        const thisRows = await db.execute(sql`
          SELECT product_id, dial_prefix_normalized
          FROM   product_destination_mappings
          WHERE  mapping_version_id = ${versionId}
            AND  resolution_status != 'duplicate'
        `).then(r => r.rows as any[]);

        const thisMap = new Map<number, Set<string>>();
        for (const r of thisRows) {
          if (!thisMap.has(r.product_id)) thisMap.set(r.product_id, new Set());
          thisMap.get(r.product_id)!.add(r.dial_prefix_normalized);
        }

        let compareVersionId: number;
        if (compareWithParam) {
          compareVersionId = compareWithParam;
        } else {
          const prevActive = await db.execute(sql`
            SELECT DISTINCT mapping_version_id
            FROM   product_mapping_activation_log
            WHERE  action = 'rollback'
               OR  action = 'supersede'
            ORDER  BY mapping_version_id DESC
            LIMIT  1
          `).then(r => (r.rows[0] as any)?.mapping_version_id ?? null);

          if (!prevActive) {
            return res.json({ message: 'No previous version to compare against', diff: [] });
          }
          compareVersionId = prevActive;
        }

        const compareRows = await db.execute(sql`
          SELECT product_id, dial_prefix_normalized
          FROM   product_destination_mappings
          WHERE  mapping_version_id = ${compareVersionId}
            AND  resolution_status != 'duplicate'
        `).then(r => r.rows as any[]);

        const compareMap = new Map<number, Set<string>>();
        for (const r of compareRows) {
          if (!compareMap.has(r.product_id)) compareMap.set(r.product_id, new Set());
          compareMap.get(r.product_id)!.add(r.dial_prefix_normalized);
        }

        // Product names from product_registry
        const productNames = await db.execute(sql`
          SELECT id, name FROM product_registry
        `).then(r => new Map((r.rows as any[]).map(p => [p.id, p.name])));

        const allProductIds = new Set([...thisMap.keys(), ...compareMap.keys()]);
        const diff: {
          productId:   number;
          productName: string;
          added:       string[];
          removed:     string[];
          unchanged:   number;
        }[] = [];

        for (const productId of allProductIds) {
          const thisPrefixes    = thisMap.get(productId)    ?? new Set<string>();
          const comparePrefixes = compareMap.get(productId) ?? new Set<string>();

          const added     = [...thisPrefixes].filter(p => !comparePrefixes.has(p));
          const removed   = [...comparePrefixes].filter(p => !thisPrefixes.has(p));
          const unchanged = [...thisPrefixes].filter(p => comparePrefixes.has(p)).length;

          diff.push({
            productId,
            productName: productNames.get(productId) ?? String(productId),
            added,
            removed,
            unchanged,
          });
        }

        res.json({
          versionId,
          compareVersionId,
          diff:      diff.filter(d => d.added.length > 0 || d.removed.length > 0),
          unchanged: diff.filter(d => d.added.length === 0 && d.removed.length === 0),
        });
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── POST /api/gcs/product-mappings/versions/:id/archive ─────────────────────

  app.post(
    '/api/gcs/product-mappings/versions/:id/archive',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (req: any, res: any) => {
      try {
        const versionId   = parseInt(req.params.id);
        const performedBy = req.user?.claims?.sub  ?? 'unknown';
        const byName      = req.user?.claims?.name ?? null;

        const [activeCheck] = await db.execute(sql`
          SELECT COUNT(*) AS cnt
          FROM   product_mapping_active_config
          WHERE  mapping_version_id = ${versionId}
        `).then(r => r.rows as any[]);

        if (parseInt(activeCheck.cnt) > 0) {
          return res.status(409).json({
            error: 'Cannot archive a version with active products. Activate a different version for those products first.',
          });
        }

        await db.execute(sql`
          UPDATE product_mapping_versions
          SET    status = 'archived', archived_at = NOW()
          WHERE  id = ${versionId}
        `);

        await db.execute(sql`
          INSERT INTO product_mapping_activation_log
            (mapping_version_id, product_id, action, performed_by, performed_by_name, created_at)
          VALUES
            (${versionId}, NULL, 'archive', ${performedBy}, ${byName}, NOW())
        `);

        res.json({ message: 'Version archived.' });
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── GET /api/gcs/product-mappings/active ────────────────────────────────────

  app.get(
    '/api/gcs/product-mappings/active',
    async (req: any, res: any) => {
      try {
        const productId = req.query.productId ? parseInt(req.query.productId as string) : undefined;
        const limit     = Math.min(parseInt((req.query.limit  as string) ?? '200'), 1000);
        const offset    = parseInt((req.query.offset as string) ?? '0');

        const rows = await db.execute(sql`
          SELECT *
          FROM   active_product_destination_mappings
          WHERE  (${productId ?? null} IS NULL OR product_id = ${productId ?? null})
          ORDER  BY product_name, dial_prefix_normalized
          LIMIT  ${limit}
          OFFSET ${offset}
        `);
        res.json(rows.rows);
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── GET /api/gcs/product-mappings/products ──────────────────────────────────
  //
  // Returns products that have an active mapping version, with prefix stats.

  app.get(
    '/api/gcs/product-mappings/products',
    async (_req: any, res: any) => {
      try {
        const rows = await db.execute(sql`
          SELECT
            pmac.product_id,
            p.name                AS product_name,
            pmac.mapping_version_id,
            pmv.label             AS version_label,
            pmac.activated_at,
            COUNT(pdm.id)         AS prefix_count
          FROM   product_mapping_active_config    pmac
          JOIN   product_registry                 p    ON p.id   = pmac.product_id
          JOIN   product_mapping_versions         pmv  ON pmv.id = pmac.mapping_version_id
          JOIN   product_destination_mappings     pdm
            ON   pdm.mapping_version_id = pmac.mapping_version_id
            AND  pdm.product_id         = pmac.product_id
            AND  pdm.resolution_status  = 'resolved'
          GROUP  BY pmac.product_id, p.name, pmac.mapping_version_id, pmv.label, pmac.activated_at
          ORDER  BY p.name
        `);
        res.json(rows.rows);
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── GET /api/gcs/product-mappings/active-config ─────────────────────────────
  //
  // Returns a map of product_id → { versionId, versionLabel, activatedAt }.
  // Used by ProductMappingResolver to bootstrap its cache.

  app.get(
    '/api/gcs/product-mappings/active-config',
    async (_req: any, res: any) => {
      try {
        const rows = await db.execute(sql`
          SELECT
            pmac.product_id,
            p.name             AS product_name,
            pmac.mapping_version_id,
            pmv.label          AS version_label,
            pmac.activated_at
          FROM   product_mapping_active_config pmac
          JOIN   product_registry              p    ON p.id   = pmac.product_id
          JOIN   product_mapping_versions      pmv  ON pmv.id = pmac.mapping_version_id
          ORDER  BY p.name
        `);
        res.json(rows.rows);
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── POST /api/gcs/product-mappings/refresh ──────────────────────────────────
  //
  // Force cache reload from DB without activating anything.
  // Body (optional): { productIds?: number[] } — if omitted, reloads all.

  app.post(
    '/api/gcs/product-mappings/refresh',
    (req: any, res: any, next: any) => requireRole(['admin'], req, res, next),
    async (req: any, res: any) => {
      try {
        const t0 = Date.now();

        await productMappingResolver.refresh();

        const stats      = productMappingResolver.getStats();
        const durationMs = Date.now() - t0;

        res.json({
          durationMs,
          stats,
          message: `Full cache reload complete in ${durationMs}ms.`,
        });
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

  // ── GET /api/gcs/product-mappings/health ────────────────────────────────────
  //
  // Resolver metrics for the Server Health dashboard.
  //
  // Status:
  //   'ok'       — loaded, no duplicates
  //   'warning'  — loaded, duplicates present
  //   'degraded' — 0 products loaded (resolver may not be initialized)

  app.get(
    '/api/gcs/product-mappings/health',
    (req: any, res: any, next: any) => requireRole(['admin', 'management'], req, res, next),
    async (_req: any, res: any) => {
      try {
        const meta  = productMappingResolver.getMetadata();
        const stats = meta.stats;
        const total = stats.cacheHits + stats.cacheMisses;

        res.json({
          subsystem:         'ProductMappingResolver',
          resolverVersion:   meta.resolverVersion,
          loadedAt:          meta.loadedAt,
          refreshDurationMs: meta.refreshDurationMs,

          productsLoaded:   stats.productsLoaded,
          cacheEntries:     stats.cacheEntries,
          cacheHits:        stats.cacheHits,
          cacheMisses:      stats.cacheMisses,
          hitPct:           total > 0 ? Math.round((stats.cacheHits / total) * 100) : null,

          duplicateCount:    stats.duplicateCount,
          duplicatePrefixes: stats.duplicatePrefixes,

          activeVersions: meta.activeVersions,

          status: stats.productsLoaded === 0 ? 'degraded'
                : stats.duplicateCount  > 0  ? 'warning'
                : 'ok',
        });
      } catch (err: any) { res.status(500).json({ error: err.message }); }
    },
  );

} // end registerProductMappingRoutes
