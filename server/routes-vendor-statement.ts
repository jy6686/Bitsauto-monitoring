/**
 * routes-vendor-statement.ts
 *
 * Vendor AP Statement — CAP-003 Phase 3 Sprint A4.
 * Read-only aggregated ledger. No new migrations required.
 *
 * GET /api/vendor-statement?partnerId=&from=&to=
 *
 * Returns a chronological ledger of AP activity for a given business partner:
 *   - Vendor Bills        → DEBIT  (charges: increases what we owe)
 *   - Vendor Payments     → CREDIT (reduces what we owe)
 *   - Adjustments (posted):
 *       credit_note / write_off → CREDIT (reduces what we owe)
 *       debit_note              → DEBIT  (increases what we owe)
 *
 * Running balance = cumulative (debits − credits).
 * A positive balance means we still owe the vendor.
 */

import type { Express } from 'express';
import { db }           from './db';
import {
  eq, and, isNull, gte, lte, or, desc, asc,
} from 'drizzle-orm';
import {
  businessPartners, vendorBills, vendorPayments,
  vendorPaymentAllocations, vendorAdjustments,
  type Role,
} from '@shared/schema';

function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const READ = ['admin', 'management', 'super_admin', 'viewer', 'noc_operator',
              'destination_manager', 'routing_admin'] as Role[];

export function registerVendorStatementRoutes(app: Express) {

  // ── GET /api/vendor-statement ──────────────────────────────────────────────
  app.get('/api/vendor-statement',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { partnerId, from, to } = req.query as Record<string, string | undefined>;

        if (!partnerId) return res.status(400).json({ error: 'partnerId is required' });

        const pid = parseInt(partnerId, 10);
        if (isNaN(pid)) return res.status(400).json({ error: 'Invalid partnerId' });

        // ── Fetch partner ────────────────────────────────────────────────────
        const [partner] = await db.select().from(businessPartners)
          .where(and(eq(businessPartners.id, pid), isNull(businessPartners.deletedAt)))
          .limit(1);

        if (!partner) return res.status(404).json({ error: 'Business partner not found' });

        // ── Build date conditions ────────────────────────────────────────────
        const billDateConds:   any[] = [eq(vendorBills.businessPartnerId, pid), isNull(vendorBills.deletedAt)];
        const payDateConds:    any[] = [eq(vendorPayments.businessPartnerId, pid), isNull(vendorPayments.deletedAt), eq(vendorPayments.status, 'posted')];
        const adjDateConds:    any[] = [eq(vendorAdjustments.businessPartnerId, pid), isNull(vendorAdjustments.deletedAt), eq(vendorAdjustments.status, 'posted')];

        if (from) {
          billDateConds.push(gte(vendorBills.billDate, from));
          payDateConds.push(gte(vendorPayments.paymentDate, from));
          adjDateConds.push(gte(vendorAdjustments.adjustmentDate, from));
        }
        if (to) {
          billDateConds.push(lte(vendorBills.billDate, to));
          payDateConds.push(lte(vendorPayments.paymentDate, to));
          adjDateConds.push(lte(vendorAdjustments.adjustmentDate, to));
        }

        // ── Exclude voided/draft bills ────────────────────────────────────────
        // Include bills in any non-void, non-draft status
        const EXCLUDED_BILL_STATUSES = ['draft', 'void'];

        const [bills, payments, adjustments] = await Promise.all([
          db.select().from(vendorBills).where(and(...billDateConds)),
          db.select().from(vendorPayments).where(and(...payDateConds)),
          db.select().from(vendorAdjustments).where(and(...adjDateConds)),
        ]);

        // ── Build ledger entries ──────────────────────────────────────────────
        type LedgerEntry = {
          date:        string;
          type:        'bill' | 'payment' | 'credit_note' | 'debit_note' | 'write_off';
          reference:   string;
          description: string;
          debit:       number;   // increases payable
          credit:      number;   // reduces payable
          balance:     number;   // running (computed below)
          currency:    string;
          sourceId:    number;
        };

        const entries: Omit<LedgerEntry, 'balance'>[] = [];

        // Bills (submitted and beyond, excluding void/draft)
        for (const b of bills) {
          if (EXCLUDED_BILL_STATUSES.includes(b.status)) continue;
          entries.push({
            date:        b.billDate,
            type:        'bill',
            reference:   b.billNumber,
            description: b.vendorReference
              ? `Bill — ref: ${b.vendorReference}`
              : 'Vendor Bill',
            debit:    parseFloat(String(b.total)),
            credit:   0,
            currency: b.currency,
            sourceId: b.id,
          });
        }

        // Payments (already filtered to posted/non-reversed)
        for (const p of payments) {
          entries.push({
            date:        p.paymentDate,
            type:        'payment',
            reference:   p.paymentNumber,
            description: p.reference
              ? `Payment — ${p.paymentMethod.replace('_', ' ')} ref: ${p.reference}`
              : `Payment — ${p.paymentMethod.replace('_', ' ')}`,
            debit:    0,
            credit:   parseFloat(String(p.amount)),
            currency: p.currency,
            sourceId: p.id,
          });
        }

        // Adjustments (posted only)
        for (const a of adjustments) {
          const isCredit = ['credit_note', 'write_off'].includes(a.type);
          const amount   = parseFloat(String(a.amount));
          entries.push({
            date:        a.adjustmentDate,
            type:        a.type as 'credit_note' | 'debit_note' | 'write_off',
            reference:   a.adjustmentNumber,
            description: `${a.type.replace('_', ' ')} — ${a.reason}`,
            debit:       isCredit ? 0 : amount,
            credit:      isCredit ? amount : 0,
            currency:    a.currency,
            sourceId:    a.id,
          });
        }

        // ── Sort by date ascending, then by type (bills before payments same day) ─
        const TYPE_ORDER: Record<string, number> = {
          bill: 0, debit_note: 1, payment: 2, credit_note: 3, write_off: 4,
        };
        entries.sort((a, b) => {
          const dateDiff = a.date.localeCompare(b.date);
          if (dateDiff !== 0) return dateDiff;
          return (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
        });

        // ── Compute running balance ───────────────────────────────────────────
        let runningBalance = 0;
        const ledger: LedgerEntry[] = entries.map(e => {
          runningBalance = parseFloat((runningBalance + e.debit - e.credit).toFixed(4));
          return { ...e, balance: runningBalance };
        });

        // ── Summary aggregates ────────────────────────────────────────────────
        const totalBilled      = ledger.filter(e => e.type === 'bill').reduce((s, e) => s + e.debit,  0);
        const totalPaid        = ledger.filter(e => e.type === 'payment').reduce((s, e) => s + e.credit, 0);
        const totalCredits     = ledger.filter(e => ['credit_note','write_off'].includes(e.type)).reduce((s, e) => s + e.credit, 0);
        const totalDebits      = ledger.filter(e => e.type === 'debit_note').reduce((s, e) => s + e.debit,  0);
        const closingBalance   = runningBalance;

        res.json({
          partner: {
            id:              partner.id,
            name:            partner.name,
            type:            partner.type,
            currency:        partner.currency,
            paymentTermsDays: partner.paymentTermsDays,
            contactName:     partner.contactName,
            contactEmail:    partner.contactEmail,
          },
          period: { from: from ?? null, to: to ?? null },
          summary: {
            totalBilled:    parseFloat(totalBilled.toFixed(4)),
            totalPaid:      parseFloat(totalPaid.toFixed(4)),
            totalCredits:   parseFloat(totalCredits.toFixed(4)),
            totalDebits:    parseFloat(totalDebits.toFixed(4)),
            closingBalance: parseFloat(closingBalance.toFixed(4)),
            entryCount:     ledger.length,
          },
          ledger,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
