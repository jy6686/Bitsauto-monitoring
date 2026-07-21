/**
 * routes-payment-runs.ts
 *
 * Payment Runs — CAP-003 Phase 4 Sprint T2.
 *
 * Lifecycle: draft → reviewed → approved → executed → completed
 *                                                    → cancelled (from any pre-executed state)
 *
 * On execute (status-only, no external API calls):
 *   - For each included item: creates a vendor_payment + vendor_payment_allocation
 *     using the same transactional pattern as routes-vendor-payments.ts
 *   - Updates vendor_bill outstanding balance and status
 *   - Reduces treasury_account.current_balance by total_amount
 *   - Sets item.vendor_payment_id
 *   - Marks run as executed
 *
 * Routes:
 *   GET    /api/payment-runs                   — list (filters: status, treasuryAccountId, from, to)
 *   POST   /api/payment-runs                   — create draft with items
 *   GET    /api/payment-runs/:id               — single run + items + account + partner details
 *   PATCH  /api/payment-runs/:id               — update draft (name, notes, scheduledDate, items replaced)
 *   POST   /api/payment-runs/:id/review        — DRAFT → REVIEWED
 *   POST   /api/payment-runs/:id/approve       — REVIEWED → APPROVED (self-approval of review blocked)
 *   POST   /api/payment-runs/:id/execute       — APPROVED → EXECUTED (creates vendor_payments)
 *   POST   /api/payment-runs/:id/complete      — EXECUTED → COMPLETED
 *   POST   /api/payment-runs/:id/cancel        — any pre-executed state → CANCELLED
 *   DELETE /api/payment-runs/:id               — soft delete (draft/cancelled only)
 *
 *   GET    /api/payment-runs/eligible-bills    — vendor_bills eligible for inclusion
 *                                                (approved/partially_paid, not already in an active run)
 */

import type { Express }  from 'express';
import { db }            from './db';
import {
  eq, and, isNull, or, like, desc, inArray, notInArray, gte, lte,
} from 'drizzle-orm';
import {
  paymentRuns, paymentRunItems,
  vendorBills, vendorPayments, vendorPaymentAllocations,
  businessPartners, treasuryAccounts,
  type Role,
} from '@shared/schema';
import { randomBytes } from 'crypto';

// ── auth ───────────────────────────────────────────────────────────────────────
function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}
const READ  = ['admin','management','super_admin','viewer','noc_operator',
               'destination_manager','routing_admin'] as Role[];
const WRITE = ['admin','management','super_admin'] as Role[];

// ── document numbering ─────────────────────────────────────────────────────────
async function nextRunNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `PR-${year}-`;
  const [last] = await db
    .select({ n: paymentRuns.runNumber })
    .from(paymentRuns)
    .where(like(paymentRuns.runNumber, `${prefix}%`))
    .orderBy(desc(paymentRuns.runNumber))
    .limit(1);
  const seq = last ? parseInt(last.n.split('-')[2] ?? '0', 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── bill status helper (mirrors vendor-payments logic) ─────────────────────────
function billStatusAfterPayment(outstanding: number, total: number): string {
  if (outstanding <= 0)     return 'paid';
  if (outstanding < total)  return 'partially_paid';
  return 'approved';
}

// ── register routes ────────────────────────────────────────────────────────────
export function registerPaymentRunRoutes(app: Express) {

  // ── GET /api/payment-runs/eligible-bills ───────────────────────────────────
  // Returns vendor_bills in approved/partially_paid status that are not already
  // included in an active (non-cancelled/non-executed) payment run.
  app.get('/api/payment-runs/eligible-bills',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { partnerId } = req.query as Record<string, string | undefined>;

        // Find bill IDs already in active runs
        const activeBillItems = await db
          .select({ vendorBillId: paymentRunItems.vendorBillId })
          .from(paymentRunItems)
          .innerJoin(paymentRuns, eq(paymentRunItems.paymentRunId, paymentRuns.id))
          .where(
            and(
              isNull(paymentRuns.deletedAt),
              notInArray(paymentRuns.status, ['cancelled','executed','completed']),
              eq(paymentRunItems.itemStatus, 'included'),
            ),
          );

        const excludedBillIds = activeBillItems.map(r => r.vendorBillId);

        const conds: any[] = [
          isNull(vendorBills.deletedAt),
          or(eq(vendorBills.status, 'approved'), eq(vendorBills.status, 'partially_paid')),
        ];
        if (partnerId) conds.push(eq(vendorBills.businessPartnerId, parseInt(partnerId, 10)));
        if (excludedBillIds.length > 0) conds.push(notInArray(vendorBills.id, excludedBillIds));

        const bills = await db
          .select({
            id:              vendorBills.id,
            billNumber:      vendorBills.billNumber,
            businessPartnerId: vendorBills.businessPartnerId,
            status:          vendorBills.status,
            currency:        vendorBills.currency,
            total:           vendorBills.total,
            outstanding:     vendorBills.outstanding,
            dueDate:         vendorBills.dueDate,
            billDate:        vendorBills.billDate,
            partnerName:     businessPartners.name,
          })
          .from(vendorBills)
          .leftJoin(businessPartners, eq(vendorBills.businessPartnerId, businessPartners.id))
          .where(and(...conds))
          .orderBy(vendorBills.dueDate, vendorBills.billNumber);

        res.json(bills);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET /api/payment-runs ──────────────────────────────────────────────────
  app.get('/api/payment-runs',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { status, treasuryAccountId, from, to } = req.query as Record<string, string | undefined>;

        const conds: any[] = [isNull(paymentRuns.deletedAt)];
        if (status)            conds.push(eq(paymentRuns.status, status));
        if (treasuryAccountId) conds.push(eq(paymentRuns.treasuryAccountId, parseInt(treasuryAccountId, 10)));
        if (from)              conds.push(gte(paymentRuns.createdAt, new Date(from)));
        if (to)                conds.push(lte(paymentRuns.createdAt, new Date(to + 'T23:59:59Z')));

        const rows = await db
          .select({
            id:                 paymentRuns.id,
            runNumber:          paymentRuns.runNumber,
            name:               paymentRuns.name,
            treasuryAccountId:  paymentRuns.treasuryAccountId,
            accountName:        treasuryAccounts.name,
            currency:           paymentRuns.currency,
            totalAmount:        paymentRuns.totalAmount,
            itemCount:          paymentRuns.itemCount,
            status:             paymentRuns.status,
            scheduledDate:      paymentRuns.scheduledDate,
            executedAt:         paymentRuns.executedAt,
            createdBy:          paymentRuns.createdBy,
            createdAt:          paymentRuns.createdAt,
          })
          .from(paymentRuns)
          .leftJoin(treasuryAccounts, eq(paymentRuns.treasuryAccountId, treasuryAccounts.id))
          .where(and(...conds))
          .orderBy(desc(paymentRuns.createdAt));

        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/payment-runs ────────────────────────────────────────────────
  // Creates a draft run with items. items: [{ vendorBillId, amount, currency, notes? }]
  app.post('/api/payment-runs',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const actor = req.user.username ?? req.user.email ?? 'system';
        const { name, treasuryAccountId, currency, scheduledDate, notes, items } = req.body;

        if (!name)               return res.status(400).json({ error: 'name is required' });
        if (!treasuryAccountId)  return res.status(400).json({ error: 'treasuryAccountId is required' });
        if (!Array.isArray(items) || items.length === 0)
          return res.status(400).json({ error: 'At least one item is required' });

        // Validate treasury account exists
        const [account] = await db
          .select().from(treasuryAccounts)
          .where(and(eq(treasuryAccounts.id, parseInt(treasuryAccountId, 10)), isNull(treasuryAccounts.deletedAt)))
          .limit(1);
        if (!account) return res.status(400).json({ error: 'Treasury account not found' });

        // Validate bills and fetch partner IDs
        const billIds = items.map((i: any) => parseInt(i.vendorBillId, 10));
        const bills = await db
          .select().from(vendorBills)
          .where(and(inArray(vendorBills.id, billIds), isNull(vendorBills.deletedAt)));

        for (const item of items) {
          const bill = bills.find(b => b.id === parseInt(item.vendorBillId, 10));
          if (!bill) return res.status(400).json({ error: `Bill ${item.vendorBillId} not found` });
          if (!['approved','partially_paid'].includes(bill.status))
            return res.status(400).json({ error: `Bill ${bill.billNumber} is not in a payable status` });
          const amt = parseFloat(item.amount);
          if (isNaN(amt) || amt <= 0)
            return res.status(400).json({ error: `Invalid amount for bill ${bill.billNumber}` });
          if (amt > parseFloat(String(bill.outstanding)))
            return res.status(400).json({ error: `Amount exceeds outstanding balance for bill ${bill.billNumber}` });
        }

        const runNumber  = `DRAFT-RUN-${randomBytes(3).toString('hex').toUpperCase()}`;
        const totalAmount = items.reduce((s: number, i: any) => s + parseFloat(i.amount), 0);

        const result = await db.transaction(async (tx) => {
          const [run] = await tx.insert(paymentRuns).values({
            runNumber,
            name,
            treasuryAccountId: parseInt(treasuryAccountId, 10),
            currency:          currency ?? account.currency,
            totalAmount:       String(totalAmount.toFixed(4)),
            itemCount:         items.length,
            status:            'draft',
            createdBy:         actor,
            scheduledDate:     scheduledDate ?? null,
            notes:             notes ?? null,
          }).returning();

          const insertedItems = [];
          for (const item of items) {
            const bill = bills.find(b => b.id === parseInt(item.vendorBillId, 10))!;
            const [inserted] = await tx.insert(paymentRunItems).values({
              paymentRunId:      run.id,
              vendorBillId:      bill.id,
              businessPartnerId: bill.businessPartnerId,
              amount:            String(parseFloat(item.amount).toFixed(4)),
              currency:          item.currency ?? bill.currency,
              itemStatus:        'included',
              notes:             item.notes ?? null,
            }).returning();
            insertedItems.push(inserted);
          }

          return { run, items: insertedItems };
        });

        res.status(201).json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET /api/payment-runs/:id ─────────────────────────────────────────────
  app.get('/api/payment-runs/:id',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [run] = await db
          .select({
            id:                paymentRuns.id,
            runNumber:         paymentRuns.runNumber,
            name:              paymentRuns.name,
            treasuryAccountId: paymentRuns.treasuryAccountId,
            accountName:       treasuryAccounts.name,
            accountType:       treasuryAccounts.type,
            currency:          paymentRuns.currency,
            totalAmount:       paymentRuns.totalAmount,
            itemCount:         paymentRuns.itemCount,
            status:            paymentRuns.status,
            executionMode:     paymentRuns.executionMode,
            executedAt:        paymentRuns.executedAt,
            executedBy:        paymentRuns.executedBy,
            externalReference: paymentRuns.externalReference,
            executionNotes:    paymentRuns.executionNotes,
            scheduledDate:     paymentRuns.scheduledDate,
            notes:             paymentRuns.notes,
            createdBy:         paymentRuns.createdBy,
            reviewedBy:        paymentRuns.reviewedBy,
            reviewedAt:        paymentRuns.reviewedAt,
            approvedBy:        paymentRuns.approvedBy,
            approvedAt:        paymentRuns.approvedAt,
            createdAt:         paymentRuns.createdAt,
            updatedAt:         paymentRuns.updatedAt,
          })
          .from(paymentRuns)
          .leftJoin(treasuryAccounts, eq(paymentRuns.treasuryAccountId, treasuryAccounts.id))
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt)))
          .limit(1);

        if (!run) return res.status(404).json({ error: 'Payment run not found' });

        const items = await db
          .select({
            id:              paymentRunItems.id,
            vendorBillId:    paymentRunItems.vendorBillId,
            billNumber:      vendorBills.billNumber,
            billStatus:      vendorBills.status,
            billTotal:       vendorBills.total,
            billOutstanding: vendorBills.outstanding,
            billDueDate:     vendorBills.dueDate,
            businessPartnerId: paymentRunItems.businessPartnerId,
            partnerName:     businessPartners.name,
            amount:          paymentRunItems.amount,
            currency:        paymentRunItems.currency,
            itemStatus:      paymentRunItems.itemStatus,
            vendorPaymentId: paymentRunItems.vendorPaymentId,
            notes:           paymentRunItems.notes,
          })
          .from(paymentRunItems)
          .leftJoin(vendorBills,       eq(paymentRunItems.vendorBillId,      vendorBills.id))
          .leftJoin(businessPartners,  eq(paymentRunItems.businessPartnerId, businessPartners.id))
          .where(eq(paymentRunItems.paymentRunId, id));

        res.json({ ...run, items });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── PATCH /api/payment-runs/:id ───────────────────────────────────────────
  // Update draft only — name, notes, scheduledDate; replaces items if provided.
  app.patch('/api/payment-runs/:id',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (existing.status !== 'draft')
          return res.status(400).json({ error: 'Only draft runs can be edited' });

        const { name, notes, scheduledDate, items } = req.body;

        const result = await db.transaction(async (tx) => {
          const updates: any = { updatedAt: new Date() };
          if (name          !== undefined) updates.name          = name;
          if (notes         !== undefined) updates.notes         = notes;
          if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;

          // Replace items if provided
          if (Array.isArray(items)) {
            await tx.delete(paymentRunItems).where(eq(paymentRunItems.paymentRunId, id));

            const billIds = items.map((i: any) => parseInt(i.vendorBillId, 10));
            const bills = await tx.select().from(vendorBills)
              .where(and(inArray(vendorBills.id, billIds), isNull(vendorBills.deletedAt)));

            for (const item of items) {
              const bill = bills.find(b => b.id === parseInt(item.vendorBillId, 10));
              if (!bill) throw new Error(`Bill ${item.vendorBillId} not found`);
              if (!['approved','partially_paid'].includes(bill.status))
                throw new Error(`Bill ${bill.billNumber} is not payable`);
            }

            const totalAmount = items.reduce((s: number, i: any) => s + parseFloat(i.amount), 0);
            updates.totalAmount = String(totalAmount.toFixed(4));
            updates.itemCount   = items.length;

            for (const item of items) {
              const bill = bills.find(b => b.id === parseInt(item.vendorBillId, 10))!;
              await tx.insert(paymentRunItems).values({
                paymentRunId:      id,
                vendorBillId:      bill.id,
                businessPartnerId: bill.businessPartnerId,
                amount:            String(parseFloat(item.amount).toFixed(4)),
                currency:          item.currency ?? bill.currency,
                itemStatus:        'included',
                notes:             item.notes ?? null,
              });
            }
          }

          const [updated] = await tx.update(paymentRuns).set(updates)
            .where(eq(paymentRuns.id, id)).returning();
          return updated;
        });

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/payment-runs/:id/review ─────────────────────────────────────
  app.post('/api/payment-runs/:id/review',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id    = parseInt(req.params.id, 10);
        const actor = req.user.username ?? req.user.email ?? 'system';

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (existing.status !== 'draft')
          return res.status(400).json({ error: `Run is ${existing.status}, must be draft to review` });

        const [updated] = await db.update(paymentRuns)
          .set({ status: 'reviewed', reviewedBy: actor, reviewedAt: new Date(), updatedAt: new Date() })
          .where(eq(paymentRuns.id, id)).returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/payment-runs/:id/approve ────────────────────────────────────
  // Self-approval of review is blocked (approver ≠ reviewer).
  app.post('/api/payment-runs/:id/approve',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id    = parseInt(req.params.id, 10);
        const actor = req.user.username ?? req.user.email ?? 'system';

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (existing.status !== 'reviewed')
          return res.status(400).json({ error: `Run is ${existing.status}, must be reviewed to approve` });
        if (actor === existing.reviewedBy)
          return res.status(403).json({ error: 'Cannot approve a run you reviewed — four-eyes principle' });

        const [updated] = await db.update(paymentRuns)
          .set({ status: 'approved', approvedBy: actor, approvedAt: new Date(), updatedAt: new Date() })
          .where(eq(paymentRuns.id, id)).returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/payment-runs/:id/execute ────────────────────────────────────
  // Creates vendor_payments for each included item; reduces treasury balance.
  app.post('/api/payment-runs/:id/execute',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id    = parseInt(req.params.id, 10);
        const actor = req.user.username ?? req.user.email ?? 'system';
        const { externalReference, executionNotes } = req.body ?? {};

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (existing.status !== 'approved')
          return res.status(400).json({ error: `Run is ${existing.status}, must be approved to execute` });

        const items = await db.select().from(paymentRunItems)
          .where(and(eq(paymentRunItems.paymentRunId, id), eq(paymentRunItems.itemStatus, 'included')));

        if (items.length === 0)
          return res.status(400).json({ error: 'No included items in this run' });

        const [account] = await db.select().from(treasuryAccounts)
          .where(eq(treasuryAccounts.id, existing.treasuryAccountId)).limit(1);
        if (!account) return res.status(400).json({ error: 'Source treasury account not found' });

        const totalAmount = parseFloat(String(existing.totalAmount));

        const result = await db.transaction(async (tx) => {
          const createdPayments = [];

          for (const item of items) {
            // Fetch current bill state inside transaction
            const [bill] = await tx.select().from(vendorBills)
              .where(eq(vendorBills.id, item.vendorBillId)).limit(1);
            if (!bill) throw new Error(`Bill ${item.vendorBillId} not found`);
            if (!['approved','partially_paid'].includes(bill.status))
              throw new Error(`Bill ${bill.billNumber} is no longer in a payable status`);

            const allocAmt      = parseFloat(String(item.amount));
            const curOutstanding = parseFloat(String(bill.outstanding));
            if (allocAmt > curOutstanding + 0.01)
              throw new Error(`Allocation ${allocAmt} exceeds outstanding ${curOutstanding} for bill ${bill.billNumber}`);

            // Create vendor_payment
            const year   = new Date().getFullYear();
            const prefix = `VP-${year}-`;
            const [lastPay] = await tx.select({ n: vendorPayments.paymentNumber })
              .from(vendorPayments)
              .where(like(vendorPayments.paymentNumber, `${prefix}%`))
              .orderBy(desc(vendorPayments.paymentNumber)).limit(1);
            const seq = lastPay ? parseInt(lastPay.n.split('-')[2] ?? '0', 10) + 1 : 1;
            const paymentNumber = `${prefix}${String(seq).padStart(4, '0')}`;

            const [payment] = await tx.insert(vendorPayments).values({
              paymentNumber,
              businessPartnerId: item.businessPartnerId,
              amount:            String(allocAmt.toFixed(4)),
              currency:          item.currency,
              paymentDate:       new Date().toISOString().slice(0, 10),
              paymentMethod:     'bank_transfer',
              status:            'posted',
              reference:         existing.runNumber,
              notes:             `Payment Run ${existing.runNumber}`,
              createdBy:         actor,
            }).returning();

            // Allocate to bill
            const newOutstanding = Math.max(0, curOutstanding - allocAmt);
            const newStatus      = billStatusAfterPayment(newOutstanding, parseFloat(String(bill.total)));

            await tx.update(vendorBills)
              .set({
                outstanding: String(newOutstanding.toFixed(4)),
                status:      newStatus,
                updatedAt:   new Date(),
              })
              .where(eq(vendorBills.id, bill.id));

            await tx.insert(vendorPaymentAllocations).values({
              vendorPaymentId:  payment.id,
              vendorBillId:     bill.id,
              allocatedAmount:  String(allocAmt.toFixed(4)),
            });

            // Update item
            await tx.update(paymentRunItems)
              .set({ itemStatus: 'paid', vendorPaymentId: payment.id, updatedAt: new Date() })
              .where(eq(paymentRunItems.id, item.id));

            createdPayments.push(payment);
          }

          // Reduce treasury account balance
          const newBalance = parseFloat(String(account.currentBalance)) - totalAmount;
          await tx.update(treasuryAccounts)
            .set({ currentBalance: String(newBalance.toFixed(4)), updatedAt: new Date() })
            .where(eq(treasuryAccounts.id, account.id));

          // Mark run as executed
          const [updatedRun] = await tx.update(paymentRuns)
            .set({
              status:            'executed',
              executedAt:        new Date(),
              executedBy:        actor,
              externalReference: externalReference ?? null,
              executionNotes:    executionNotes    ?? null,
              updatedAt:         new Date(),
            })
            .where(eq(paymentRuns.id, id))
            .returning();

          return { run: updatedRun, paymentsCreated: createdPayments.length };
        });

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/payment-runs/:id/complete ───────────────────────────────────
  app.post('/api/payment-runs/:id/complete',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (existing.status !== 'executed')
          return res.status(400).json({ error: 'Only executed runs can be marked completed' });

        const [updated] = await db.update(paymentRuns)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(paymentRuns.id, id)).returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/payment-runs/:id/cancel ─────────────────────────────────────
  app.post('/api/payment-runs/:id/cancel',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (['executed','completed','cancelled'].includes(existing.status))
          return res.status(400).json({ error: `Cannot cancel a ${existing.status} run` });

        const [updated] = await db.update(paymentRuns)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(paymentRuns.id, id)).returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── DELETE /api/payment-runs/:id ──────────────────────────────────────────
  app.delete('/api/payment-runs/:id',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);

        const [existing] = await db.select().from(paymentRuns)
          .where(and(eq(paymentRuns.id, id), isNull(paymentRuns.deletedAt))).limit(1);
        if (!existing) return res.status(404).json({ error: 'Payment run not found' });
        if (!['draft','cancelled'].includes(existing.status))
          return res.status(400).json({ error: 'Only draft or cancelled runs can be deleted' });

        const now = new Date();
        await db.update(paymentRuns)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(paymentRuns.id, id));

        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
