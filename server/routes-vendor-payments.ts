/**
 * routes-vendor-payments.ts
 *
 * Vendor Payments CRUD — CAP-003 Phase 3 Sprint A3.
 *
 * GET  /api/vendor-payments                  — list (filters: partnerId, status, from, to)
 * POST /api/vendor-payments                  — create payment + allocations (transactional)
 * GET  /api/vendor-payments/:id              — single payment + allocations + bill names
 * POST /api/vendor-payments/:id/reverse      — reverse: restore bill outstanding balances
 *
 * Bill balance logic on payment creation:
 *   bill.outstanding -= allocation.allocated_amount
 *   if outstanding == 0            → bill.status = 'paid'
 *   if outstanding < total && > 0  → bill.status = 'partially_paid'
 *
 * On reversal:
 *   bill.outstanding += allocation.allocated_amount
 *   if bill was paid/partially_paid and outstanding > 0 → bill.status = 'approved'
 */

import type { Express } from 'express';
import { db }           from './db';
import {
  eq, and, isNull, gte, lte, desc, like, sql,
} from 'drizzle-orm';
import {
  vendorPayments, vendorPaymentAllocations, vendorBills,
  businessPartners, type Role,
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

// ── payment number sequence ───────────────────────────────────────────────────
async function nextPaymentNumber(): Promise<string> {
  const year   = new Date().getFullYear().toString();
  const prefix = `VP-${year}-`;

  const [row] = await db
    .select({ n: vendorPayments.paymentNumber })
    .from(vendorPayments)
    .where(like(vendorPayments.paymentNumber, `${prefix}%`))
    .orderBy(desc(vendorPayments.paymentNumber))
    .limit(1);

  let seq = 1;
  if (row) {
    const parts = row.n.split('-');
    const last  = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── bill status after payment ─────────────────────────────────────────────────
function billStatusAfterPayment(outstanding: number, total: number): string {
  if (outstanding <= 0) return 'paid';
  if (outstanding < total) return 'partially_paid';
  return 'approved';
}

export function registerVendorPaymentRoutes(app: Express) {

  // ── LIST ───────────────────────────────────────────────────────────────────
  app.get('/api/vendor-payments',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (_req: any, res) => {
      try {
        const { partnerId, status, from, to } = _req.query as Record<string, string | undefined>;

        const conds: any[] = [isNull(vendorPayments.deletedAt)];
        if (partnerId) conds.push(eq(vendorPayments.businessPartnerId, parseInt(partnerId, 10)));
        if (status)    conds.push(eq(vendorPayments.status, status));
        if (from)      conds.push(gte(vendorPayments.paymentDate, from));
        if (to)        conds.push(lte(vendorPayments.paymentDate, to));

        const rows = await db
          .select({
            payment: vendorPayments,
            partner: { id: businessPartners.id, name: businessPartners.name },
          })
          .from(vendorPayments)
          .leftJoin(businessPartners, eq(vendorPayments.businessPartnerId, businessPartners.id))
          .where(and(...conds))
          .orderBy(desc(vendorPayments.createdAt));

        res.json(rows.map(r => ({ ...r.payment, partnerName: r.partner?.name })));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── CREATE (transactional) ─────────────────────────────────────────────────
  // Body: { businessPartnerId, paymentDate, currency, amount, paymentMethod,
  //         reference?, notes?,
  //         allocations: [{ vendorBillId, allocatedAmount }] }
  app.post('/api/vendor-payments',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const {
          businessPartnerId, paymentDate, currency = 'USD',
          amount, paymentMethod = 'bank_transfer',
          reference, notes,
          allocations = [],
        } = req.body;

        if (!businessPartnerId) return res.status(422).json({ error: 'businessPartnerId required' });
        if (!paymentDate)       return res.status(422).json({ error: 'paymentDate required' });
        if (!amount || parseFloat(amount) <= 0)
          return res.status(422).json({ error: 'amount must be positive' });
        if (!Array.isArray(allocations) || allocations.length === 0)
          return res.status(422).json({ error: 'At least one allocation is required' });

        // Validate total allocated == payment amount
        const totalAllocated = (allocations as any[]).reduce(
          (s: number, a: any) => s + parseFloat(a.allocatedAmount ?? 0), 0,
        );
        if (Math.abs(totalAllocated - parseFloat(amount)) > 0.01)
          return res.status(422).json({
            error: `Allocated total (${totalAllocated.toFixed(4)}) must equal payment amount (${parseFloat(amount).toFixed(4)})`,
          });

        const actor      = req.user?.username ?? req.user?.email ?? 'system';
        const paymentNum = await nextPaymentNumber();

        // Run everything in a transaction
        const result = await db.transaction(async (tx) => {
          // Insert payment
          const [payment] = await tx.insert(vendorPayments).values({
            paymentNumber:     paymentNum,
            businessPartnerId: parseInt(businessPartnerId, 10),
            paymentDate,
            currency,
            amount:            String(parseFloat(amount).toFixed(4)),
            paymentMethod,
            reference:         reference || null,
            notes:             notes || null,
            status:            'posted',
            createdBy:         actor,
          }).returning();

          // Process each allocation
          const allocationResults: any[] = [];
          for (const alloc of allocations as any[]) {
            const billId  = parseInt(alloc.vendorBillId, 10);
            const allocAmt = parseFloat(alloc.allocatedAmount);

            // Fetch bill (must be approved or partially_paid)
            const [bill] = await tx.select().from(vendorBills)
              .where(and(eq(vendorBills.id, billId), isNull(vendorBills.deletedAt)))
              .limit(1);

            if (!bill) throw new Error(`Bill ID ${billId} not found`);
            if (!['approved', 'partially_paid'].includes(bill.status))
              throw new Error(`Bill ${bill.billNumber} status '${bill.status}' cannot receive payment`);

            const currentOutstanding = parseFloat(String(bill.outstanding));
            if (allocAmt > currentOutstanding + 0.001)
              throw new Error(`Allocation ${allocAmt} exceeds outstanding ${currentOutstanding} on bill ${bill.billNumber}`);

            const newOutstanding = parseFloat((currentOutstanding - allocAmt).toFixed(4));
            const total          = parseFloat(String(bill.total));
            const newStatus      = billStatusAfterPayment(newOutstanding, total);

            // Update bill
            await tx.update(vendorBills)
              .set({ outstanding: String(newOutstanding), status: newStatus, updatedAt: new Date() })
              .where(eq(vendorBills.id, billId));

            // Insert allocation
            const [allocation] = await tx.insert(vendorPaymentAllocations).values({
              vendorPaymentId: payment.id,
              vendorBillId:    billId,
              allocatedAmount: String(allocAmt.toFixed(4)),
            }).returning();

            allocationResults.push({ ...allocation, billNumber: bill.billNumber, newStatus, newOutstanding });
          }

          return { payment, allocations: allocationResults };
        });

        res.status(201).json(result);
      } catch (err: any) {
        res.status(err.message?.includes('not found') || err.message?.includes('cannot')
          ? 422 : 500).json({ error: err.message });
      }
    },
  );

  // ── GET SINGLE + ALLOCATIONS ───────────────────────────────────────────────
  app.get('/api/vendor-payments/:id',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [row] = await db
          .select({
            payment: vendorPayments,
            partner: { id: businessPartners.id, name: businessPartners.name },
          })
          .from(vendorPayments)
          .leftJoin(businessPartners, eq(vendorPayments.businessPartnerId, businessPartners.id))
          .where(and(eq(vendorPayments.id, id), isNull(vendorPayments.deletedAt)))
          .limit(1);

        if (!row) return res.status(404).json({ error: 'Payment not found' });

        const allocations = await db
          .select({
            alloc: vendorPaymentAllocations,
            bill:  { billNumber: vendorBills.billNumber, status: vendorBills.status,
                     outstanding: vendorBills.outstanding, total: vendorBills.total },
          })
          .from(vendorPaymentAllocations)
          .leftJoin(vendorBills, eq(vendorPaymentAllocations.vendorBillId, vendorBills.id))
          .where(eq(vendorPaymentAllocations.vendorPaymentId, id));

        res.json({
          ...row.payment,
          partner: row.partner,
          allocations: allocations.map(a => ({ ...a.alloc, ...a.bill })),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── REVERSE ────────────────────────────────────────────────────────────────
  // Restores outstanding balance on all allocated bills and marks payment reversed.
  app.post('/api/vendor-payments/:id/reverse',
    (req: any, res, next) => requireRole(MGMT, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [payment] = await db.select().from(vendorPayments)
          .where(and(eq(vendorPayments.id, id), isNull(vendorPayments.deletedAt))).limit(1);

        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        if (payment.status === 'reversed') return res.status(409).json({ error: 'Payment is already reversed' });

        const actor = req.user?.username ?? req.user?.email ?? 'system';

        await db.transaction(async (tx) => {
          // Restore outstanding on each allocated bill
          const allocs = await tx.select().from(vendorPaymentAllocations)
            .where(eq(vendorPaymentAllocations.vendorPaymentId, id));

          for (const alloc of allocs) {
            const [bill] = await tx.select().from(vendorBills)
              .where(eq(vendorBills.id, alloc.vendorBillId)).limit(1);
            if (!bill) continue;

            const restored    = parseFloat((parseFloat(String(bill.outstanding)) + parseFloat(String(alloc.allocatedAmount))).toFixed(4));
            const total       = parseFloat(String(bill.total));
            const newStatus   = restored >= total ? 'approved' : 'partially_paid';

            await tx.update(vendorBills)
              .set({ outstanding: String(restored), status: newStatus, updatedAt: new Date() })
              .where(eq(vendorBills.id, bill.id));
          }

          // Mark payment reversed
          await tx.update(vendorPayments)
            .set({ status: 'reversed', reversedAt: new Date(), reversedBy: actor, updatedAt: new Date() })
            .where(eq(vendorPayments.id, id));
        });

        const [reversed] = await db.select().from(vendorPayments).where(eq(vendorPayments.id, id)).limit(1);
        res.json(reversed);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
