/**
 * routes-vendor-bills.ts
 *
 * Vendor Bills CRUD — CAP-003 Phase 3 Sprint A2.
 *
 * GET    /api/vendor-bills                    — list (filters: status, partnerId, search, from, to)
 * POST   /api/vendor-bills                    — create draft bill (with optional lines array)
 * GET    /api/vendor-bills/:id                — single bill + lines
 * PATCH  /api/vendor-bills/:id               — update draft bill header + lines
 * POST   /api/vendor-bills/:id/submit         — DRAFT → SUBMITTED; assigns VB-YYYY-NNNN
 * POST   /api/vendor-bills/:id/approve        — SUBMITTED|UNDER_REVIEW → APPROVED
 * POST   /api/vendor-bills/:id/reject         — → DRAFT (with rejection note)
 * POST   /api/vendor-bills/:id/void           — any non-paid → VOID
 *
 * Bill numbering:
 *   While draft:  bill_number = DRAFT-{8-char hex}   (assigned on creation)
 *   On submit:    bill_number = VB-{YYYY}-{NNNN}     (sequential, year-scoped)
 */

import type { Express }   from 'express';
import { db }              from './db';
import {
  eq, and, isNull, ilike, or, desc, gte, lte, ne, like, sql,
} from 'drizzle-orm';
import { randomBytes }     from 'crypto';
import {
  vendorBills, vendorBillLines,
  businessPartners,
  type Role,
} from '@shared/schema';

// ── auth helper ───────────────────────────────────────────────────────────────
function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const MGMT = ['admin', 'management'] as Role[];
const READ  = ['admin', 'management', 'super_admin', 'viewer', 'noc_operator',
               'destination_manager', 'routing_admin'] as Role[];

// ── bill number sequence ──────────────────────────────────────────────────────
async function nextBillNumber(): Promise<string> {
  const year = new Date().getFullYear().toString();
  const prefix = `VB-${year}-`;

  // Find the highest existing sequence for this year
  const [row] = await db
    .select({ billNumber: vendorBills.billNumber })
    .from(vendorBills)
    .where(like(vendorBills.billNumber, `${prefix}%`))
    .orderBy(desc(vendorBills.billNumber))
    .limit(1);

  let seq = 1;
  if (row) {
    const parts = row.billNumber.split('-');
    const last  = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── line totals helper ────────────────────────────────────────────────────────
function calcLineTotals(line: {
  quantity: number; unitPrice: number; taxRate: number;
}) {
  const amount    = parseFloat((line.quantity * line.unitPrice).toFixed(4));
  const taxAmount = parseFloat((amount * line.taxRate).toFixed(4));
  return { amount, taxAmount };
}

function calcBillTotals(lines: Array<{ amount: number; taxAmount: number }>) {
  const subtotal  = parseFloat(lines.reduce((s, l) => s + l.amount,    0).toFixed(4));
  const taxAmount = parseFloat(lines.reduce((s, l) => s + l.taxAmount, 0).toFixed(4));
  const total     = parseFloat((subtotal + taxAmount).toFixed(4));
  return { subtotal, taxAmount, total, outstanding: total };
}

// ── route registration ────────────────────────────────────────────────────────
export function registerVendorBillRoutes(app: Express) {

  // ── LIST ───────────────────────────────────────────────────────────────────
  app.get('/api/vendor-bills',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { status, partnerId, search, from, to } = req.query as Record<string, string | undefined>;

        const conds: any[] = [isNull(vendorBills.deletedAt)];

        if (status)    conds.push(eq(vendorBills.status, status));
        if (partnerId) conds.push(eq(vendorBills.businessPartnerId, parseInt(partnerId, 10)));
        if (from)      conds.push(gte(vendorBills.billDate, from));
        if (to)        conds.push(lte(vendorBills.billDate, to));
        if (search) {
          const p = `%${search}%`;
          conds.push(or(
            ilike(vendorBills.billNumber,      p),
            ilike(vendorBills.vendorReference, p),
          ));
        }

        const rows = await db
          .select({
            bill:    vendorBills,
            partner: { id: businessPartners.id, name: businessPartners.name, type: businessPartners.type },
          })
          .from(vendorBills)
          .leftJoin(businessPartners, eq(vendorBills.businessPartnerId, businessPartners.id))
          .where(and(...conds))
          .orderBy(desc(vendorBills.createdAt));

        res.json(rows.map(r => ({ ...r.bill, partnerName: r.partner?.name, partnerType: r.partner?.type })));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── CREATE DRAFT ──────────────────────────────────────────────────────────
  app.post('/api/vendor-bills',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const {
          businessPartnerId, vendorReference, billDate, dueDate,
          currency = 'USD', notes, lines = [],
        } = req.body;

        if (!businessPartnerId) return res.status(422).json({ error: 'businessPartnerId required' });
        if (!billDate)          return res.status(422).json({ error: 'billDate required' });
        if (!dueDate)           return res.status(422).json({ error: 'dueDate required' });
        if (dueDate < billDate) return res.status(422).json({ error: 'dueDate must be on or after billDate' });

        // Validate partner exists
        const [partner] = await db.select({ id: businessPartners.id })
          .from(businessPartners)
          .where(and(eq(businessPartners.id, parseInt(businessPartnerId, 10)), isNull(businessPartners.deletedAt)))
          .limit(1);
        if (!partner) return res.status(404).json({ error: 'Business partner not found' });

        // Compute line totals
        const processedLines = (lines as any[]).map((l, i) => {
          const qty       = parseFloat(l.quantity   ?? 1);
          const unitPrice = parseFloat(l.unitPrice  ?? 0);
          const taxRate   = parseFloat(l.taxRate    ?? 0);
          const { amount, taxAmount } = calcLineTotals({ quantity: qty, unitPrice, taxRate });
          return {
            lineNumber:  i + 1,
            description: l.description || '',
            quantity:    String(qty),
            unitPrice:   String(unitPrice),
            taxRate:     String(taxRate),
            amount:      String(amount),
            taxAmount:   String(taxAmount),
            glCode:      l.glCode ?? null,
          };
        });

        const billTotals = calcBillTotals(
          processedLines.map(l => ({ amount: parseFloat(l.amount), taxAmount: parseFloat(l.taxAmount) })),
        );

        const draftNum = `DRAFT-${randomBytes(4).toString('hex').toUpperCase()}`;
        const actor    = req.user?.username ?? req.user?.email ?? 'system';

        const [bill] = await db.insert(vendorBills).values({
          billNumber:         draftNum,
          businessPartnerId:  parseInt(businessPartnerId, 10),
          vendorReference:    vendorReference || null,
          billDate,
          dueDate,
          currency,
          subtotal:           String(billTotals.subtotal),
          taxAmount:          String(billTotals.taxAmount),
          total:              String(billTotals.total),
          outstanding:        String(billTotals.outstanding),
          status:             'draft',
          approvalStatus:     'pending',
          notes:              notes || null,
          createdBy:          actor,
        }).returning();

        // Insert lines
        if (processedLines.length > 0) {
          await db.insert(vendorBillLines).values(
            processedLines.map(l => ({ ...l, vendorBillId: bill.id })),
          );
        }

        const insertedLines = await db.select().from(vendorBillLines)
          .where(eq(vendorBillLines.vendorBillId, bill.id))
          .orderBy(vendorBillLines.lineNumber);

        res.status(201).json({ ...bill, lines: insertedLines });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET SINGLE + LINES ────────────────────────────────────────────────────
  app.get('/api/vendor-bills/:id',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [row] = await db
          .select({
            bill:    vendorBills,
            partner: { id: businessPartners.id, name: businessPartners.name,
                       type: businessPartners.type, currency: businessPartners.currency,
                       paymentTermsDays: businessPartners.paymentTermsDays },
          })
          .from(vendorBills)
          .leftJoin(businessPartners, eq(vendorBills.businessPartnerId, businessPartners.id))
          .where(and(eq(vendorBills.id, id), isNull(vendorBills.deletedAt)))
          .limit(1);

        if (!row) return res.status(404).json({ error: 'Vendor bill not found' });

        const lines = await db.select().from(vendorBillLines)
          .where(eq(vendorBillLines.vendorBillId, id))
          .orderBy(vendorBillLines.lineNumber);

        res.json({ ...row.bill, partner: row.partner, lines });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── UPDATE DRAFT ──────────────────────────────────────────────────────────
  // Only allowed when status = 'draft'. Replaces lines if provided.
  app.patch('/api/vendor-bills/:id',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorBills)
          .where(and(eq(vendorBills.id, id), isNull(vendorBills.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Vendor bill not found' });
        if (existing.status !== 'draft')
          return res.status(409).json({ error: `Bill is ${existing.status} — only draft bills can be edited` });

        const { lines, id: _id, createdAt: _ca, createdBy: _cb, deletedAt: _da,
                billNumber: _bn, status: _st, approvalStatus: _as,
                subtotal: _sub, taxAmount: _ta, total: _tot, outstanding: _out,
                ...headerFields } = req.body;

        let updatePayload: any = { ...headerFields, updatedAt: new Date() };

        // Recompute totals if lines provided
        if (Array.isArray(lines)) {
          // Delete + re-insert lines
          await db.delete(vendorBillLines).where(eq(vendorBillLines.vendorBillId, id));

          const processedLines = (lines as any[]).map((l, i) => {
            const qty       = parseFloat(l.quantity  ?? 1);
            const unitPrice = parseFloat(l.unitPrice ?? 0);
            const taxRate   = parseFloat(l.taxRate   ?? 0);
            const { amount, taxAmount } = calcLineTotals({ quantity: qty, unitPrice, taxRate });
            return {
              vendorBillId: id,
              lineNumber:   i + 1,
              description:  l.description || '',
              quantity:     String(qty),
              unitPrice:    String(unitPrice),
              taxRate:      String(taxRate),
              amount:       String(amount),
              taxAmount:    String(taxAmount),
              glCode:       l.glCode ?? null,
            };
          });

          if (processedLines.length > 0) {
            await db.insert(vendorBillLines).values(processedLines);
          }

          const billTotals = calcBillTotals(
            processedLines.map(l => ({ amount: parseFloat(l.amount), taxAmount: parseFloat(l.taxAmount) })),
          );
          updatePayload = {
            ...updatePayload,
            subtotal:    String(billTotals.subtotal),
            taxAmount:   String(billTotals.taxAmount),
            total:       String(billTotals.total),
            outstanding: String(billTotals.outstanding),
          };
        }

        const [updated] = await db.update(vendorBills)
          .set(updatePayload)
          .where(eq(vendorBills.id, id))
          .returning();

        const updatedLines = await db.select().from(vendorBillLines)
          .where(eq(vendorBillLines.vendorBillId, id))
          .orderBy(vendorBillLines.lineNumber);

        res.json({ ...updated, lines: updatedLines });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── SUBMIT (DRAFT → SUBMITTED + permanent bill number) ────────────────────
  app.post('/api/vendor-bills/:id/submit',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorBills)
          .where(and(eq(vendorBills.id, id), isNull(vendorBills.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Vendor bill not found' });
        if (existing.status !== 'draft')
          return res.status(409).json({ error: `Bill is already ${existing.status}` });

        // Ensure at least one line
        const lines = await db.select().from(vendorBillLines)
          .where(eq(vendorBillLines.vendorBillId, id));
        if (lines.length === 0)
          return res.status(422).json({ error: 'A bill must have at least one line item before submission' });

        const billNumber = await nextBillNumber();

        const [submitted] = await db.update(vendorBills)
          .set({ billNumber, status: 'submitted', updatedAt: new Date() })
          .where(eq(vendorBills.id, id))
          .returning();

        res.json({ ...submitted, lines });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── APPROVE ───────────────────────────────────────────────────────────────
  app.post('/api/vendor-bills/:id/approve',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorBills)
          .where(and(eq(vendorBills.id, id), isNull(vendorBills.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Vendor bill not found' });

        const allowed = ['submitted', 'under_review'];
        if (!allowed.includes(existing.status))
          return res.status(409).json({ error: `Cannot approve a bill with status '${existing.status}'` });

        // Self-approval prevention: approver must differ from submitter/creator
        const actor = req.user?.username ?? req.user?.email ?? 'system';
        if (actor === existing.createdBy)
          return res.status(403).json({ error: 'Self-approval not permitted — a different user must approve this bill' });

        const now = new Date();
        const [approved] = await db.update(vendorBills)
          .set({
            status: 'approved', approvalStatus: 'approved',
            approvedBy: actor, approvedAt: now, updatedAt: now,
          })
          .where(eq(vendorBills.id, id))
          .returning();

        res.json(approved);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── REJECT (→ DRAFT) ──────────────────────────────────────────────────────
  app.post('/api/vendor-bills/:id/reject',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const { reason } = req.body as { reason?: string };
        if (!reason?.trim()) return res.status(422).json({ error: 'Rejection reason required' });

        const [existing] = await db.select().from(vendorBills)
          .where(and(eq(vendorBills.id, id), isNull(vendorBills.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Vendor bill not found' });

        const allowed = ['submitted', 'under_review'];
        if (!allowed.includes(existing.status))
          return res.status(409).json({ error: `Cannot reject a bill with status '${existing.status}'` });

        // Reset to draft, append rejection note, clear permanent bill number
        const draftNum  = `DRAFT-${randomBytes(4).toString('hex').toUpperCase()}`;
        const noteEntry = `[REJECTED by ${req.user?.username ?? 'system'}]: ${reason}`;
        const updatedNotes = existing.notes
          ? `${existing.notes}\n${noteEntry}`
          : noteEntry;

        const [rejected] = await db.update(vendorBills)
          .set({
            status:         'draft',
            approvalStatus: 'rejected',
            billNumber:     draftNum,
            notes:          updatedNotes,
            updatedAt:      new Date(),
          })
          .where(eq(vendorBills.id, id))
          .returning();

        res.json(rejected);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── VOID ──────────────────────────────────────────────────────────────────
  app.post('/api/vendor-bills/:id/void',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(vendorBills)
          .where(and(eq(vendorBills.id, id), isNull(vendorBills.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Vendor bill not found' });
        if (existing.status === 'paid')
          return res.status(409).json({ error: 'Paid bills cannot be voided' });
        if (existing.status === 'void')
          return res.status(409).json({ error: 'Bill is already void' });

        const [voided] = await db.update(vendorBills)
          .set({ status: 'void', updatedAt: new Date() })
          .where(eq(vendorBills.id, id))
          .returning();

        res.json(voided);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
