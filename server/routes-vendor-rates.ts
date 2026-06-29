import { Express } from 'express';
import { db } from './db';
import * as XLSX from 'xlsx';
import { eq, desc, and, sql, ilike } from 'drizzle-orm';
import {
  canonicalVendors, approvalRequests, marginAnalyticsDaily, approvalAuditLog, vendorRateSheets, vendorRateSheetRows, vendorColumnMaps,
} from '../shared/schema';

function getSheetList(fileData: string): { index: number; name: string; rowCount: number }[] {
  const buf = Buffer.from(fileData, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  return wb.SheetNames.map((name: string, index: number) => {
    const ws = wb.Sheets[name];
    const all: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    return { index, name, rowCount: all.filter((r:any[]) => r.some((c:any) => c != null)).length };
  });
}
function parseFile(fileData: string, sheetIndex?: number): { headers: string[]; dataRows: any[][] } {
  const buf = Buffer.from(fileData, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer', raw: false, cellDates: true });
  let sheetName: string;
  if (sheetIndex !== undefined && sheetIndex >= 0 && sheetIndex < wb.SheetNames.length) {
    sheetName = wb.SheetNames[sheetIndex];
  } else {
    const RATE_KW = ['pricing','rates','rate','tariff','price'];
    sheetName = wb.SheetNames.find((n:string) => RATE_KW.some(k => n.toLowerCase().includes(k))) ?? wb.SheetNames[0];
  }
  const ws = wb.Sheets[sheetName];
  const all: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  // Find the row with the most non-empty cells — that's the real header row
  let hIdx = -1, maxFilled = 0;
  all.forEach((r, i) => {
    const filled = r.filter(c => c != null && String(c).trim() !== '').length;
    if (filled > maxFilled) { maxFilled = filled; hIdx = i; }
  });
  if (hIdx === -1) return { headers: [], dataRows: [] };
  // Make empty column names unique so mapping state doesn't collide
  const headers = all[hIdx].map((h: any, i: number) => {
    const v = h != null ? String(h).trim() : '';
    return v !== '' ? v : ('col_' + i);
  });
  return { headers, dataRows: all.slice(hIdx + 1) };
}

function applyMap(
  headers: string[], rows: any[][],
  mappings: Record<string, string>, skipRows: number,
) {
  const colIdx: Record<string, number> = {};
  headers.forEach((h, i) => { if (h) colIdx[h] = i; });
  const cIdx: Record<string, number> = {};
  for (const [vc, canon] of Object.entries(mappings)) {
    if (colIdx[vc] !== undefined) cIdx[canon] = colIdx[vc];
  }
  const get = (row: any[], f: string) => cIdx[f] !== undefined ? row[cIdx[f]] : null;
  const parseDate = (v: any): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    // Excel date serial (5-digit number like 46085)
    if (/^\d{4,5}$/.test(s)) {
      const d = new Date(Date.UTC(1900, 0, 1) + (parseInt(s) - 2) * 86400000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  return rows.slice(skipRows).map(row => {
    const prefix = String(get(row, 'prefix') ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '').trim();
    const rate = parseFloat(String(get(row, 'rate') ?? '').replace(/[^0-9.\-]/g, ''));
    if (!prefix || isNaN(rate) || rate <= 0) return null;
    return {
      prefix, rate,
      destination: get(row, 'destination') != null ? String(get(row, 'destination')).trim() : null,
      currency: get(row, 'currency') != null ? String(get(row, 'currency')).trim().slice(0, 3) : 'USD',
      effectiveDate: parseDate(get(row, 'effectiveDate')),
      expiryDate: parseDate(get(row, 'expiryDate')),
      interval1: parseInt(String(get(row, 'interval1') ?? '60')) || 60,
      intervalN: parseInt(String(get(row, 'intervalN') ?? '60')) || 60,
      interconnect: get(row, 'interconnect') != null ? String(get(row, 'interconnect')).trim() : null,
      rawRow: row,
    };
  }).filter(Boolean);
}

export function registerVendorRatesRoutes(app: Express) {

  // GET /api/vendor-rates/vendors
  app.get('/api/vendor-rates/vendors', async (_req, res) => {
    try {
      const rows = await db.select().from(canonicalVendors)
        .where(eq(canonicalVendors.status, 'active'))
        .orderBy(canonicalVendors.name);
      return res.json(rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // POST /api/vendor-rates/preview — parse file, return headers + sample (no DB write)
  app.post('/api/vendor-rates/preview', async (req, res) => {
    try {
      const { fileData, skipRows = 0, sheetIndex } = req.body;
      if (!fileData) return res.status(400).json({ error: 'fileData required' });
      const sheets = getSheetList(fileData);
      const { headers, dataRows } = parseFile(fileData, sheetIndex);
      return res.json({ sheets, headers, sampleRows: dataRows.slice(skipRows, skipRows + 12), totalRows: dataRows.length });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // POST /api/vendor-rates/import
  app.post('/api/vendor-rates/import', async (req, res) => {
    try {
      const { fileData, fileType = 'xlsx', vendorId, fileName = 'upload', sheetIndex,
        currency = 'USD', effectiveDate, notes, columnMap, skipRows = 0,
        saveTemplate, templateLabel } = req.body;
      if (!fileData || !vendorId || !columnMap)
        return res.status(400).json({ error: 'fileData, vendorId, columnMap required' });

      const { headers, dataRows } = parseFile(fileData, sheetIndex);
      const parsed: any[] = applyMap(headers, dataRows, columnMap, skipRows) as any[];
      if (!parsed.length) return res.status(400).json({ error: 'No valid rows after mapping' });

      // Validation pass: dedup + sanity checks
      const seenPfx = new Set<string>();
      const dupPfx: string[] = [];
      const validated: any[] = (parsed as any[]).filter((r: any) => {
        if (r.prefix.length < 2 || r.prefix.length > 16) return false;
        if (r.effectiveDate && r.expiryDate && r.effectiveDate > r.expiryDate) return false;
        if (seenPfx.has(r.prefix)) { dupPfx.push(r.prefix); return false; }
        seenPfx.add(r.prefix);
        return true;
      });
      if (!validated.length) return res.status(400).json({ error: 'No valid rows after validation' });
      // Debug: log first 3 rows to find varchar overflow
      console.log('[vr-import] sample rows:', JSON.stringify(validated.slice(0,3).map((r:any)=>({
        prefix: r.prefix, prefixLen: r.prefix?.length,
        destination: r.destination?.slice(0,40), destLen: r.destination?.length,
        rate: r.rate,
        interconnect: r.interconnect?.slice(0,40), icLen: r.interconnect?.length,
        currency: r.currency,
      })), null, 2));

      if (saveTemplate && templateLabel) {
        const [ex] = await db.select({ id: vendorColumnMaps.id }).from(vendorColumnMaps)
          .where(and(eq(vendorColumnMaps.vendorId, vendorId), eq(vendorColumnMaps.label, templateLabel))).limit(1);
        if (ex) {
          await db.update(vendorColumnMaps).set({ mappings: columnMap, skipRows, updatedAt: new Date() }).where(eq(vendorColumnMaps.id, ex.id));
        } else {
          await db.insert(vendorColumnMaps).values({ vendorId, label: templateLabel, mappings: columnMap, skipRows });
        }
      }

      const [sheet] = await db.insert(vendorRateSheets).values({
        vendorId, fileName, fileType, currency,
        effectiveDate: effectiveDate ?? null,
        rowCount: validated.length, notes: notes ?? null,
      }).returning();

      for (let i = 0; i < validated.length; i += 500) {
        await db.insert(vendorRateSheetRows).values(
          validated.slice(i, i + 500).map((r: any) => ({
            sheetId: sheet.id, prefix: r.prefix, destination: r.destination,
            rate: String(r.rate), currency: r.currency,
            effectiveDate: r.effectiveDate, expiryDate: r.expiryDate,
            interval1: r.interval1, intervalN: r.intervalN,
            interconnect: r.interconnect, rawRow: r.rawRow,
          }))
        );
      }
      return res.json({ sheetId: sheet.id, rowCount: validated.length, duplicatesSkipped: dupPfx.length });
    } catch (e: any) { console.error('[vr/import]', e.message); return res.status(500).json({ error: e.message }); }
  });

  // GET /api/vendor-rates/sheets
  app.get('/api/vendor-rates/sheets', async (_req, res) => {
    try {
      const rows = await db.select({
        id: vendorRateSheets.id, vendorId: vendorRateSheets.vendorId,
        vendorName: canonicalVendors.name, fileName: vendorRateSheets.fileName,
        fileType: vendorRateSheets.fileType, currency: vendorRateSheets.currency,
        effectiveDate: vendorRateSheets.effectiveDate, rowCount: vendorRateSheets.rowCount,
        status: vendorRateSheets.status, uploadedBy: vendorRateSheets.uploadedBy,
        uploadedAt: vendorRateSheets.uploadedAt, notes: vendorRateSheets.notes,
      }).from(vendorRateSheets)
        .innerJoin(canonicalVendors, eq(vendorRateSheets.vendorId, canonicalVendors.id))
        .orderBy(desc(vendorRateSheets.uploadedAt));
      return res.json(rows);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/vendor-rates/sheets/:id/rows
  app.get('/api/vendor-rates/sheets/:id/rows', async (req, res) => {
    try {
      const sheetId = parseInt(req.params.id);
      const limit = Math.min(parseInt(String(req.query.limit ?? '200')), 1000);
      const offset = parseInt(String(req.query.offset ?? '0'));
      const rows = await db.select({
        prefix: vendorRateSheetRows.prefix, destination: vendorRateSheetRows.destination,
        rate: vendorRateSheetRows.rate, currency: vendorRateSheetRows.currency,
        effectiveDate: vendorRateSheetRows.effectiveDate, expiryDate: vendorRateSheetRows.expiryDate,
        interval1: vendorRateSheetRows.interval1, intervalN: vendorRateSheetRows.intervalN,
      }).from(vendorRateSheetRows)
        .where(eq(vendorRateSheetRows.sheetId, sheetId))
        .orderBy(vendorRateSheetRows.prefix)
        .limit(limit).offset(offset);
      return res.json({ rows, limit, offset });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/vendor-rates/column-maps/:vendorId
  app.get('/api/vendor-rates/column-maps/:vendorId', async (req, res) => {
    try {
      const maps = await db.select().from(vendorColumnMaps)
        .where(eq(vendorColumnMaps.vendorId, parseInt(req.params.vendorId)))
        .orderBy(vendorColumnMaps.label);
      return res.json(maps);
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/vendor-rates/sheets/:id
  app.delete('/api/vendor-rates/sheets/:id', async (req, res) => {
    try {
      await db.delete(vendorRateSheets).where(eq(vendorRateSheets.id, parseInt(req.params.id)));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });
  // POST /api/vendor-rates/compare
  app.post('/api/vendor-rates/compare', async (req, res) => {
    try {
      const { baseSheetId, newSheetId } = req.body as { baseSheetId: number; newSheetId: number };
      if (!baseSheetId || !newSheetId)
        return res.status(400).json({ error: 'baseSheetId and newSheetId required' });
      const [baseRows, newRows] = await Promise.all([
        db.select({ prefix: vendorRateSheetRows.prefix, destination: vendorRateSheetRows.destination, rate: vendorRateSheetRows.rate })
          .from(vendorRateSheetRows).where(eq(vendorRateSheetRows.sheetId, baseSheetId)),
        db.select({ prefix: vendorRateSheetRows.prefix, destination: vendorRateSheetRows.destination, rate: vendorRateSheetRows.rate })
          .from(vendorRateSheetRows).where(eq(vendorRateSheetRows.sheetId, newSheetId)),
      ]);
      const baseMap = new Map<string, { destination: string | null; rate: number }>();
      for (const r of baseRows) baseMap.set(r.prefix, { destination: r.destination, rate: Number(r.rate) });
      const newMap = new Map<string, { destination: string | null; rate: number }>();
      for (const r of newRows) newMap.set(r.prefix, { destination: r.destination, rate: Number(r.rate) });
      const allPrefixes = new Set([...baseMap.keys(), ...newMap.keys()]);
      const diffRows: any[] = [];
      const summary = { newPrefixes: 0, removedPrefixes: 0, increased: 0, decreased: 0, unchanged: 0 };
      for (const prefix of allPrefixes) {
        const base = baseMap.get(prefix);
        const cur  = newMap.get(prefix);
        if (!base && cur) {
          diffRows.push({ prefix, destination: cur.destination, oldRate: null, newRate: cur.rate, delta: null, deltaPercent: null, change: 'new' });
          summary.newPrefixes++;
        } else if (base && !cur) {
          diffRows.push({ prefix, destination: base.destination, oldRate: base.rate, newRate: null, delta: null, deltaPercent: null, change: 'removed' });
          summary.removedPrefixes++;
        } else if (base && cur) {
          const delta = cur.rate - base.rate;
          const deltaPercent = base.rate > 0 ? (delta / base.rate) * 100 : null;
          const change = Math.abs(delta) < 0.000001 ? 'unchanged' : delta > 0 ? 'increased' : 'decreased';
          (summary as any)[change]++;
          diffRows.push({ prefix, destination: cur.destination, oldRate: base.rate, newRate: cur.rate, delta, deltaPercent, change });
        }
      }
      const ord: Record<string,number> = { new:0, removed:1, increased:2, decreased:3, unchanged:4 };
      diffRows.sort((a, b) => (ord[a.change] - ord[b.change]) || a.prefix.localeCompare(b.prefix));
      return res.json({ summary, rows: diffRows });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // POST /api/vendor-rates/sheets/:id/activate
  app.post('/api/vendor-rates/sheets/:id/activate', async (req, res) => {
    try {
      const sheetId = parseInt(req.params.id);
      const [sheet] = await db.select({ vendorId: vendorRateSheets.vendorId })
        .from(vendorRateSheets).where(eq(vendorRateSheets.id, sheetId)).limit(1);
      if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
      await db.update(vendorRateSheets).set({ status: 'archived' })
        .where(and(eq(vendorRateSheets.vendorId, sheet.vendorId), eq(vendorRateSheets.status, 'active')));
      await db.update(vendorRateSheets).set({ status: 'active', activatedAt: new Date() })
        .where(eq(vendorRateSheets.id, sheetId));
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/vendor-rates/products-with-rates — distinct productPrefixes that have rate data
  app.get('/api/vendor-rates/products-with-rates', async (_req, res) => {
    try {
      const rows = await db.selectDistinct({ pp: destinationProductRates.productPrefix })
        .from(destinationProductRates)
        .orderBy(destinationProductRates.productPrefix);
      return res.json(rows.map(r => r.pp).filter(Boolean));
    } catch (err: any) { return res.status(500).json({ error: err.message }); }
  });

  // POST /api/vendor-rates/margin-analysis — join vendor cost rows vs sell rates
  app.post('/api/vendor-rates/margin-analysis', async (req, res) => {
    try {
      const { sheetId, productPrefix } = req.body as { sheetId: number; productPrefix: string };
      if (!sheetId || !productPrefix) return res.status(400).json({ error: 'sheetId and productPrefix required' });
      const result = await db.execute(sql`
        SELECT
          vr.prefix,
          vr.destination,
          CAST(vr.rate AS double precision)       AS cost_rate,
          CAST(dpr.sell_rate AS double precision)  AS sell_rate,
          CAST(dpr.sell_rate AS double precision) - CAST(vr.rate AS double precision) AS margin,
          CASE WHEN CAST(dpr.sell_rate AS double precision) > 0
            THEN ROUND(CAST(((CAST(dpr.sell_rate AS double precision) - CAST(vr.rate AS double precision))
                 / CAST(dpr.sell_rate AS double precision)) * 100 AS numeric), 2)
            ELSE NULL END AS margin_pct,
          COALESCE(dpr.destination_name, vr.destination) AS dest_name
        FROM vendor_rate_sheet_rows vr
        LEFT JOIN destination_product_rates dpr
          ON vr.prefix = LTRIM(dpr.dial_prefix, '+') AND dpr.product_prefix = ${productPrefix}
        WHERE vr.sheet_id = ${sheetId}
        ORDER BY
          CASE
            WHEN dpr.sell_rate IS NULL THEN 3
            WHEN CAST(dpr.sell_rate AS double precision) - CAST(vr.rate AS double precision) < 0 THEN 0
            WHEN ROUND(CAST(((CAST(dpr.sell_rate AS double precision) - CAST(vr.rate AS double precision))
                 / CAST(dpr.sell_rate AS double precision)) * 100 AS numeric),2) < 10 THEN 1
            ELSE 2 END ASC,
          margin ASC NULLS LAST
        LIMIT 5000
      `);
      const data = result.rows as any[];
      const withSell  = data.filter(r => r.sell_rate != null);
      const negative  = withSell.filter(r => Number(r.margin) < 0).length;
      const low       = withSell.filter(r => Number(r.margin) >= 0 && Number(r.margin_pct) < 10).length;
      const healthy   = withSell.filter(r => Number(r.margin_pct) >= 10).length;
      const unmatched = data.length - withSell.length;
      return res.json({
        summary: { total: data.length, matched: withSell.length, negative, low, healthy, unmatched },
        rows: data,
      });
    } catch (err: any) { return res.status(500).json({ error: err.message }); }
  });

  // POST /api/vendor-rates/impact-analysis
  app.post('/api/vendor-rates/impact-analysis', async (req, res) => {
    try {
      const { newSheetId, baseSheetId: providedBase } = req.body as { newSheetId: number; baseSheetId?: number };
      if (!newSheetId) return res.status(400).json({ error: 'newSheetId required' });

      // Auto-detect base sheet (current active for same vendor) if not provided
      let baseSheetId = providedBase;
      if (!baseSheetId) {
        const [newSheet] = await db.select({ vendorId: vendorRateSheets.vendorId })
          .from(vendorRateSheets).where(eq(vendorRateSheets.id, newSheetId)).limit(1);
        if (newSheet) {
          const [active] = await db.select({ id: vendorRateSheets.id })
            .from(vendorRateSheets)
            .where(and(eq(vendorRateSheets.vendorId, newSheet.vendorId), eq(vendorRateSheets.status, 'active')))
            .limit(1);
          baseSheetId = active?.id;
        }
      }

      // Summary counts — prefixes increased/decreased/new/removed
      const summaryQ = await db.execute(sql`
        WITH base AS (SELECT prefix, CAST(rate AS double precision) AS rate FROM vendor_rate_sheet_rows WHERE sheet_id = ${baseSheetId ?? 0}),
             newv AS (SELECT prefix, CAST(rate AS double precision) AS rate FROM vendor_rate_sheet_rows WHERE sheet_id = ${newSheetId})
        SELECT
          COUNT(*) FILTER (WHERE newv.rate > base.rate + 0.000001) AS increased,
          COUNT(*) FILTER (WHERE base.rate > newv.rate + 0.000001) AS decreased,
          COUNT(*) FILTER (WHERE base.prefix IS NULL)              AS new_pfx,
          COUNT(*) FILTER (WHERE newv.prefix IS NULL)              AS removed_pfx
        FROM newv FULL OUTER JOIN base ON newv.prefix = base.prefix
      `);
      const sc = summaryQ.rows[0] as any;
      // Main impact query — increased prefixes only, with product + client join
      const impactQ = await db.execute(sql`
        WITH
          base AS (SELECT prefix, CAST(rate AS double precision) AS rate FROM vendor_rate_sheet_rows WHERE sheet_id = ${baseSheetId ?? 0}),
          newv AS (SELECT prefix, destination, CAST(rate AS double precision) AS rate FROM vendor_rate_sheet_rows WHERE sheet_id = ${newSheetId}),
          increased AS (
            SELECT n.prefix, n.destination, n.rate AS new_rate, b.rate AS old_rate,
                   n.rate - b.rate AS delta,
                   CASE WHEN b.rate > 0 THEN ROUND(CAST(((n.rate - b.rate)/b.rate*100) AS numeric),2) ELSE NULL END AS delta_pct
            FROM newv n JOIN base b ON n.prefix = b.prefix WHERE n.rate > b.rate + 0.000001
          )
        SELECT
          i.prefix, i.destination, i.new_rate, i.old_rate, i.delta, i.delta_pct,
          dpr.product_prefix AS product_code,
          pr.name            AS product_name,
          CAST(dpr.sell_rate AS double precision) AS sell_rate,
          CAST(dpr.sell_rate AS double precision) - i.new_rate AS margin,
          CASE WHEN CAST(dpr.sell_rate AS double precision) > 0
            THEN ROUND(CAST(((CAST(dpr.sell_rate AS double precision) - i.new_rate)/CAST(dpr.sell_rate AS double precision)*100) AS numeric),2)
            ELSE NULL END AS margin_pct,
          cpa.customer_name
        FROM increased i
        LEFT JOIN destination_product_rates dpr ON i.prefix = LTRIM(dpr.dial_prefix, '+')
        LEFT JOIN product_registry pr ON dpr.product_prefix = pr.code
        LEFT JOIN customer_product_assignments cpa ON cpa.product_id = pr.id AND cpa.status = 'active'
        ORDER BY i.delta DESC, i.prefix
        LIMIT 10000
      `);

      // Aggregate into per-prefix structure
      const rows = impactQ.rows as any[];
      const byPfx = new Map<string,any>();
      for (const r of rows) {
        if (!byPfx.has(r.prefix)) byPfx.set(r.prefix, {
          prefix: r.prefix, destination: r.destination,
          newRate: Number(r.new_rate), oldRate: Number(r.old_rate),
          delta: Number(r.delta), deltaPct: r.delta_pct!=null?Number(r.delta_pct):null,
          products: new Map(),
        });
        const pfx = byPfx.get(r.prefix)!;
        if (r.product_code) {
          if (!pfx.products.has(r.product_code)) pfx.products.set(r.product_code, {
            productCode: r.product_code, productName: r.product_name,
            sellRate: r.sell_rate!=null?Number(r.sell_rate):null,
            margin: r.margin!=null?Number(r.margin):null,
            marginPct: r.margin_pct!=null?Number(r.margin_pct):null,
            clients: new Set<string>(),
          });
          if (r.customer_name) pfx.products.get(r.product_code)!.clients.add(r.customer_name as string);
        }
      }
      const increased = Array.from(byPfx.values()).map(p => ({
        ...p,
        products: Array.from(p.products.values()).map((pd:any) => ({
          ...pd, clients: Array.from(pd.clients),
          status: pd.margin==null?'unknown': pd.margin<0?'negative': pd.marginPct<10?'low':'healthy',
        })),
      }));

      const allClients  = new Set<string>();
      const allProducts = new Set<string>();
      let negativeMargins = 0, lowMargins = 0;
      let totalDelta = 0;
      for (const p of increased) { totalDelta += p.delta; for (const pd of p.products) {
        if (pd.productCode) allProducts.add(pd.productCode);
        for (const c of pd.clients) allClients.add(c as string);
        if (pd.status==='negative') negativeMargins++;
        if (pd.status==='low') lowMargins++;
      } }
      const avgDelta = increased.length > 0 ? totalDelta / increased.length : 0;

      // Per-client impact breakdown
      const clientMap = new Map<string,any>();
      for (const p of increased) for (const pd of p.products) {
        for (const c of pd.clients as string[]) {
          if (!clientMap.has(c)) clientMap.set(c, {
            clientName:c, affectedPrefixes:0, negativeCount:0, lowCount:0, healthyCount:0,
            worstMarginPct:null as number|null, productsAffected:new Set<string>(),
          });
          const cm = clientMap.get(c)!;
          cm.affectedPrefixes++;
          if (pd.status==='negative') cm.negativeCount++;
          else if (pd.status==='low') cm.lowCount++;
          else cm.healthyCount++;
          if (pd.marginPct!=null&&(cm.worstMarginPct==null||pd.marginPct<cm.worstMarginPct)) cm.worstMarginPct=pd.marginPct;
          if (pd.productCode) cm.productsAffected.add(pd.productCode);
        }
      }
      const clientImpact = Array.from(clientMap.values())
        .map((c:any)=>({...c, productsAffected:Array.from(c.productsAffected)}))
        .sort((a:any,b:any)=>(b.negativeCount-a.negativeCount)||(a.worstMarginPct??0)-(b.worstMarginPct??0));

      // ── Vendor traffic context (last 30 days from margin_analytics_daily) ──
      let vendorTraffic: any = null;
      try {
        const [sheet2] = await db.select({ vendorId: vendorRateSheets.vendorId })
          .from(vendorRateSheets).where(eq(vendorRateSheets.id, newSheetId)).limit(1);
        if (sheet2) {
          const [vend] = await db.select({ name: canonicalVendors.name })
            .from(canonicalVendors).where(eq(canonicalVendors.id, sheet2.vendorId)).limit(1);
          if (vend) {
            const tq = await db.execute(sql`
              SELECT
                COALESCE(SUM(duration_sec),0)/60.0 AS monthly_minutes,
                COALESCE(SUM(cost_usd),0)          AS monthly_cost_usd,
                COUNT(DISTINCT date)               AS days_of_data
              FROM margin_analytics_daily
              WHERE dimension_type = 'vendor'
                AND dimension_name ILIKE ${'%' + vend.name.split(' ')[0] + '%'}
                AND date >= CURRENT_DATE - INTERVAL '30 days'
            `);
            const tr = tq.rows[0] as any;
            vendorTraffic = {
              monthlyMinutes:  Math.round(Number(tr.monthly_minutes ?? 0)),
              monthlyCostUsd:  +Number(tr.monthly_cost_usd ?? 0).toFixed(2),
              daysOfData:      Number(tr.days_of_data ?? 0),
              vendorName:      vend.name,
            };
          }
        }
      } catch(_) { /* non-fatal */ }

      return res.json({
        hasBase: !!baseSheetId,
        summary: {
          prefixesIncreased: Number(sc.increased??0),
          prefixesDecreased: Number(sc.decreased??0),
          newPrefixes:       Number(sc.new_pfx??0),
          removedPrefixes:   Number(sc.removed_pfx??0),
          negativeMargins, lowMargins,
          productsAffected: Array.from(allProducts),
          clientCount: allClients.size,
          topClients: Array.from(allClients).slice(0,10),
          avgDeltaPerMin: +avgDelta.toFixed(6),
        },
        increased,
        clientImpact,
      });
    } catch (err:any) { return res.status(500).json({ error: err.message }); }
  });

  // POST /api/vendor-rates/sheets/:id/request-activation
  app.post('/api/vendor-rates/sheets/:id/request-activation', async (req, res) => {
    try {
      const sheetId = parseInt(req.params.id);
      const { requestedBy, requestedByName, impactSummary } = req.body as {
        requestedBy: string; requestedByName?: string; impactSummary?: any;
      };
      if (!requestedBy) return res.status(400).json({ error: 'requestedBy required' });
      const [sheet] = await db.select({
        id: vendorRateSheets.id, vendorId: vendorRateSheets.vendorId,
        fileName: vendorRateSheets.fileName, status: vendorRateSheets.status,
      }).from(vendorRateSheets).where(eq(vendorRateSheets.id, sheetId)).limit(1);
      if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
      if (sheet.status === 'active') return res.status(400).json({ error: 'Sheet is already active' });
      // Check no pending request already exists
      const [existing] = await db.select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(
          eq(approvalRequests.operationType, 'vendor_rate_sheet.activate'),
          eq(approvalRequests.entityId, String(sheetId)),
          eq(approvalRequests.status, 'pending')
        )).limit(1);
      if (existing) return res.status(409).json({ error: 'Approval request already pending for this sheet', requestId: existing.id });
      const vendor = await db.select({ name: canonicalVendors.name })
        .from(canonicalVendors).where(eq(canonicalVendors.id, sheet.vendorId)).limit(1);
      const [req2] = await db.insert(approvalRequests).values({
        operationType: 'vendor_rate_sheet.activate',
        action: 'update',
        entityId: String(sheetId),
        entityName: `${vendor[0]?.name ?? 'Vendor'} / ${sheet.fileName}`,
        payloadAfter: impactSummary ?? null,
        requestedBy,
        requestedByName: requestedByName ?? null,
        status: 'pending',
      }).returning();
      await db.insert(approvalAuditLog).values({
        requestId: req2.id, action: 'submitted',
        actorId: requestedBy, actorName: requestedByName ?? null,
        note: `Activation requested for sheet: ${sheet.fileName}`,
      });
      return res.json({ requestId: req2.id, status: 'pending' });
    } catch (err: any) { return res.status(500).json({ error: err.message }); }
  });

  // GET /api/vendor-rates/approvals/pending
  app.get('/api/vendor-rates/approvals/pending', async (_req, res) => {
    try {
      const rows = await db.select().from(approvalRequests)
        .where(and(
          eq(approvalRequests.operationType, 'vendor_rate_sheet.activate'),
          eq(approvalRequests.status, 'pending')
        ))
        .orderBy(desc(approvalRequests.requestedAt));
      return res.json(rows);
    } catch (err: any) { return res.status(500).json({ error: err.message }); }
  });

  // POST /api/vendor-rates/approvals/:id/decide  { decision: 'approved'|'rejected', reviewedBy, reviewedByName, rejectionReason? }
  app.post('/api/vendor-rates/approvals/:id/decide', async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const { decision, reviewedBy, reviewedByName, rejectionReason } = req.body as {
        decision: 'approved'|'rejected'; reviewedBy: string; reviewedByName?: string; rejectionReason?: string;
      };
      if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
      if (!reviewedBy) return res.status(400).json({ error: 'reviewedBy required' });
      const [apReq] = await db.select().from(approvalRequests)
        .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'pending'))).limit(1);
      if (!apReq) return res.status(404).json({ error: 'Pending request not found' });
      await db.update(approvalRequests).set({
        status: decision, reviewedBy, reviewedByName: reviewedByName ?? null,
        reviewedAt: new Date(), rejectionReason: rejectionReason ?? null,
      }).where(eq(approvalRequests.id, requestId));
      await db.insert(approvalAuditLog).values({
        requestId, action: decision,
        actorId: reviewedBy, actorName: reviewedByName ?? null,
        note: rejectionReason ?? null,
      });
      if (decision === 'approved') {
        const sheetId = parseInt(apReq.entityId!);
        const [sh] = await db.select({ vendorId: vendorRateSheets.vendorId })
          .from(vendorRateSheets).where(eq(vendorRateSheets.id, sheetId)).limit(1);
        if (sh) {
          await db.update(vendorRateSheets).set({ status: 'archived', activatedAt: null })
            .where(and(eq(vendorRateSheets.vendorId, sh.vendorId), eq(vendorRateSheets.status, 'active')));
          await db.update(vendorRateSheets).set({ status: 'active', activatedAt: new Date(), activatedBy: reviewedBy })
            .where(eq(vendorRateSheets.id, sheetId));
        }
      }
      return res.json({ ok: true, decision });
    } catch (err: any) { return res.status(500).json({ error: err.message }); }
  });

}
