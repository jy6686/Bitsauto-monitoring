/**
 * The two rate-sheet routes, driven through Express with fakes for the assembly, the
 * sender and the role check. What is pinned: who may call them, what a download returns
 * (the assembly's bytes, unchanged, with the sheet's own filename), that a download never
 * sends, that a resend never assembles on its own, and what an operator is told when
 * nothing can be produced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerRateSheetRoutes } from './routes-rate-sheet';

vi.mock('./storage', () => ({ storage: { getUserRole: vi.fn() } }));
vi.mock('./services/provisioning/rate-notification-email', () => ({
  assembleRateSheets: vi.fn(),
  sendRateNotificationEmails: vi.fn(),
  RATE_SHEET_PRODUCT_CODES: ['FC', 'BC', 'SB', 'SC'],
}));

const requireRole = (roles: string[], req: any, res: any, next: any) => {
  const role = req.headers['x-role'];
  if (!role) return res.status(401).json({ message: 'Unauthorized' });
  if (!roles.includes(String(role))) return res.status(403).json({ message: 'Forbidden' });
  next();
};

const XLSX_BYTES = Buffer.from('PK not really a workbook, but bytes are bytes');
const sheet = {
  productCode: 'FC', productLabel: 'FIRST CLASS', productDigit: '1', currency: 'USD',
  subject: 'RATE NOTIFICATION (FULL) | 1GLOBAL | FIRST CLASS | 15 September 2026',
  filename: '1GLOBAL-FIRST_CLASS-202609150900-FULL.xlsx',
  html: '<p>body</p>', xlsx: XLSX_BYTES, rows: new Array(9).fill({}), excluded: [],
};
const company = { id: 105, name: '1global', accountPrefix: '1019', recipients: ['noc@1global.example'] };

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

function build() {
  const assemble = vi.fn();
  const send = vi.fn();
  const app = express();
  app.use(express.json());
  registerRateSheetRoutes(app, { assemble: assemble as any, send: send as any, requireRole });
  return { app, assemble, send };
}

describe('GET /api/companies/:id/rate-sheet', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => { t = build(); });

  it('is admin-only', async () => {
    expect((await request(t.app).get('/api/companies/105/rate-sheet?product=FC')).status).toBe(401);
    expect((await request(t.app).get('/api/companies/105/rate-sheet?product=FC').set('x-role', 'management')).status).toBe(403);
    expect(t.assemble).not.toHaveBeenCalled();
  });

  it('refuses an unknown product before touching anything', async () => {
    const r = await request(t.app).get('/api/companies/105/rate-sheet?product=XX').set('x-role', 'admin');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/FC, BC, SB, SC/);
    expect(t.assemble).not.toHaveBeenCalled();
  });

  it('returns the assembly bytes as an attachment named by the sheet, and sends nothing', async () => {
    t.assemble.mockResolvedValue({ company, products: [sheet], unsendable: [], details: ['KAM fell back to the company record'] });
    const r = await request(t.app).get('/api/companies/105/rate-sheet?product=fc').set('x-role', 'admin').buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect(r.headers['content-disposition']).toBe(`attachment; filename="${sheet.filename}"`);
    expect(r.headers['x-rate-sheet-rows']).toBe('9');
    expect(Buffer.compare(r.body as Buffer, XLSX_BYTES)).toBe(0);
    expect(t.assemble).toHaveBeenCalledWith(105, { productCode: 'FC' });
    expect(t.send).not.toHaveBeenCalled();
  });

  it('404s with the reasons when every price for the product was refused', async () => {
    t.assemble.mockResolvedValue({
      company, products: [],
      unsendable: [{ productCode: 'FC', productLabel: 'FIRST CLASS', reasons: ['FC destination 999: not_eligible — First Class is not declared eligible'] }],
      details: ['FIRST CLASS: not on the sheet — FC destination 999: not_eligible — First Class is not declared eligible'],
    });
    const r = await request(t.app).get('/api/companies/105/rate-sheet?product=FC').set('x-role', 'admin');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No FIRST CLASS sheet can be produced for 1global/);
    expect(r.body.details[0]).toMatch(/not_eligible/);
  });

  it('404s plainly when the product has no effective prices, and when the company does not exist', async () => {
    t.assemble.mockResolvedValueOnce({ company, products: [], unsendable: [], details: [] });
    const none = await request(t.app).get('/api/companies/105/rate-sheet?product=BC').set('x-role', 'admin');
    expect(none.status).toBe(404);
    expect(none.body.error).toMatch(/no effective BC prices/);

    t.assemble.mockResolvedValueOnce({ company: null, products: [], unsendable: [], details: ['Company 9 not found.'] });
    const missing = await request(t.app).get('/api/companies/9/rate-sheet?product=FC').set('x-role', 'admin');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/Company 9 not found/);
  });
});

describe('POST /api/companies/:id/rate-notifications/resend', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => { t = build(); });

  it('is admin-only', async () => {
    expect((await request(t.app).post('/api/companies/105/rate-notifications/resend')).status).toBe(401);
    expect((await request(t.app).post('/api/companies/105/rate-notifications/resend').set('x-role', 'support')).status).toBe(403);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('calls the rebuilt sender for the company and returns its report unchanged', async () => {
    const report = { sent: 1, failed: 0, skipped: 0, details: ['✓ FIRST CLASS → noc@1global.example (1GLOBAL-FIRST_CLASS-202609150900-FULL.xlsx, 9 prefix row(s))'] };
    t.send.mockResolvedValue(report);
    const r = await request(t.app).post('/api/companies/105/rate-notifications/resend').set('x-role', 'admin').send({});
    expect(r.status).toBe(200);
    expect(r.body).toEqual(report);
    expect(t.send).toHaveBeenCalledWith(105);
    expect(t.assemble).not.toHaveBeenCalled();
  });

  it('rejects a malformed company id without sending', async () => {
    const r = await request(t.app).post('/api/companies/abc/rate-notifications/resend').set('x-role', 'admin').send({});
    expect(r.status).toBe(400);
    expect(t.send).not.toHaveBeenCalled();
  });
});
