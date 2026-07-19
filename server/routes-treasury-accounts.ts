/**
 * routes-treasury-accounts.ts
 *
 * Treasury Accounts CRUD — CAP-003 Phase 4 Sprint T1.
 *
 * Generic treasury account table (bank / wallet / cash / escrow).
 * Bank Accounts and Wallets pages are filtered views; this single
 * API serves both.
 *
 * Account numbering: TA-YYYY-NNNN (assigned on create).
 *
 * Routes:
 *   GET    /api/treasury-accounts          — list (filters: type, status, currency, search)
 *   POST   /api/treasury-accounts          — create
 *   GET    /api/treasury-accounts/:id      — single record
 *   PATCH  /api/treasury-accounts/:id      — update
 *   DELETE /api/treasury-accounts/:id      — soft delete
 *   PATCH  /api/treasury-accounts/:id/balance — update current_balance (manual adjustment)
 */

import type { Express } from 'express';
import { db }           from './db';
import { randomBytes }  from 'crypto';
import {
  eq, and, isNull, ilike, or, like, desc,
} from 'drizzle-orm';
import {
  treasuryAccounts,
  insertTreasuryAccountSchema,
  type Role,
} from '@shared/schema';

// ── auth helper ────────────────────────────────────────────────────────────────
function requireRole(roles: Role[], req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const READ  = ['admin','management','super_admin','viewer','noc_operator',
               'destination_manager','routing_admin'] as Role[];
const WRITE = ['admin','management','super_admin'] as Role[];

// ── document numbering ─────────────────────────────────────────────────────────
async function nextAccountNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `TA-${year}-`;
  const [last] = await db
    .select({ n: treasuryAccounts.accountNumber })
    .from(treasuryAccounts)
    .where(like(treasuryAccounts.accountNumber, `${prefix}%`))
    .orderBy(desc(treasuryAccounts.accountNumber))
    .limit(1);
  const seq = last ? parseInt(last.n.split('-')[2] ?? '0', 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── register routes ────────────────────────────────────────────────────────────
export function registerTreasuryAccountRoutes(app: Express) {

  // ── GET /api/treasury-accounts ─────────────────────────────────────────────
  app.get('/api/treasury-accounts',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const { type, status, currency, search } = req.query as Record<string, string | undefined>;

        const conds: any[] = [isNull(treasuryAccounts.deletedAt)];

        if (type)     conds.push(eq(treasuryAccounts.type,     type));
        if (status)   conds.push(eq(treasuryAccounts.status,   status));
        if (currency) conds.push(eq(treasuryAccounts.currency, currency));
        if (search) {
          const s = `%${search}%`;
          conds.push(or(
            ilike(treasuryAccounts.name,              s),
            ilike(treasuryAccounts.institutionName,   s),
            ilike(treasuryAccounts.accountIdentifier, s),
          ));
        }

        const rows = await db
          .select()
          .from(treasuryAccounts)
          .where(and(...conds))
          .orderBy(treasuryAccounts.type, treasuryAccounts.name);

        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── POST /api/treasury-accounts ────────────────────────────────────────────
  app.post('/api/treasury-accounts',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const parsed = insertTreasuryAccountSchema.safeParse({
          ...req.body,
          createdBy: req.user.username ?? req.user.email ?? 'system',
        });
        if (!parsed.success) {
          return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
        }

        const accountNumber = await nextAccountNumber();

        const [created] = await db
          .insert(treasuryAccounts)
          .values({ ...parsed.data, accountNumber })
          .returning();

        res.status(201).json(created);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── GET /api/treasury-accounts/:id ─────────────────────────────────────────
  app.get('/api/treasury-accounts/:id',
    (req: any, res, next) => requireRole(READ, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [row] = await db
          .select()
          .from(treasuryAccounts)
          .where(and(eq(treasuryAccounts.id, id), isNull(treasuryAccounts.deletedAt)))
          .limit(1);

        if (!row) return res.status(404).json({ error: 'Treasury account not found' });
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── PATCH /api/treasury-accounts/:id ───────────────────────────────────────
  app.patch('/api/treasury-accounts/:id',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db
          .select()
          .from(treasuryAccounts)
          .where(and(eq(treasuryAccounts.id, id), isNull(treasuryAccounts.deletedAt)))
          .limit(1);

        if (!existing) return res.status(404).json({ error: 'Treasury account not found' });

        // Strip immutable audit fields from update payload
        const { id: _id, accountNumber: _num, createdAt: _ca, createdBy: _cb, deletedAt: _da, ...updates } = req.body;

        const [updated] = await db
          .update(treasuryAccounts)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(treasuryAccounts.id, id))
          .returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── DELETE /api/treasury-accounts/:id ──────────────────────────────────────
  app.delete('/api/treasury-accounts/:id',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [existing] = await db
          .select()
          .from(treasuryAccounts)
          .where(and(eq(treasuryAccounts.id, id), isNull(treasuryAccounts.deletedAt)))
          .limit(1);

        if (!existing) return res.status(404).json({ error: 'Treasury account not found' });

        const now = new Date();
        await db
          .update(treasuryAccounts)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(treasuryAccounts.id, id));

        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── PATCH /api/treasury-accounts/:id/balance ───────────────────────────────
  // Manual balance adjustment (used when syncing from bank/exchange).
  app.patch('/api/treasury-accounts/:id/balance',
    (req: any, res, next) => requireRole(WRITE, req, res, next),
    async (req: any, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const { currentBalance } = req.body;
        if (currentBalance === undefined || isNaN(parseFloat(currentBalance))) {
          return res.status(400).json({ error: 'currentBalance is required' });
        }

        const [existing] = await db
          .select()
          .from(treasuryAccounts)
          .where(and(eq(treasuryAccounts.id, id), isNull(treasuryAccounts.deletedAt)))
          .limit(1);

        if (!existing) return res.status(404).json({ error: 'Treasury account not found' });

        const [updated] = await db
          .update(treasuryAccounts)
          .set({ currentBalance: String(parseFloat(currentBalance).toFixed(4)), updatedAt: new Date() })
          .where(eq(treasuryAccounts.id, id))
          .returning();

        res.json(updated);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}
