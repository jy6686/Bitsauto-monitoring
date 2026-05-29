/**
 * BhaooSMS / REVE SMS V5 — API Routes
 * Registered by server/routes.ts via registerBhaooRoutes(app)
 */

import type { Express } from 'express';
import { db } from './db';
import {
  sendSms, sendSmsBulk, queryDlr, parseDlrPush,
  checkBalance, rechargeAccount, isConfigured,
} from './services/bhaoo/index';
import {
  smsMessages, smsDlrEvents, bhaooBalanceLog, smsVendorStats,
} from '@shared/schema';
import { eq, desc, gte, sql } from 'drizzle-orm';

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function registerBhaooRoutes(app: Express) {

  // ── Connection status ────────────────────────────────────────────────────────
  app.get('/api/bhaoo/status', requireAuth, async (_req: any, res: any) => {
    const configured = isConfigured();
    if (!configured) {
      return res.json({ connected: false, error: 'BHAOO_API_KEY / BHAOO_SECRET_KEY not set' });
    }
    const balance = await checkBalance();
    res.json({ connected: balance.status === 0, balance: balance.balance, currency: balance.currency, error: balance.error });
  });

  // ── Balance ─────────────────────────────────────────────────────────────────
  app.get('/api/bhaoo/balance', requireAuth, async (_req: any, res: any) => {
    try {
      const result = await checkBalance();
      if (result.status === 0) {
        await db.insert(bhaooBalanceLog).values({
          balance:     result.balance,
          creditLimit: result.creditLimit ?? null,
          currency:    result.currency ?? 'USD',
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Balance history ──────────────────────────────────────────────────────────
  app.get('/api/bhaoo/balance/history', requireAuth, async (_req: any, res: any) => {
    try {
      const rows = await db.select().from(bhaooBalanceLog).orderBy(desc(bhaooBalanceLog.checkedAt)).limit(48);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send SMS ─────────────────────────────────────────────────────────────────
  app.post('/api/sms/send', requireAuth, async (req: any, res: any) => {
    const { to, from, text, type } = req.body ?? {};
    if (!to || !from || !text) return res.status(400).json({ error: 'to, from, text are required' });

    try {
      const result = await sendSms({ to, from, text, type: type ?? 'text' });

      await db.insert(smsMessages).values({
        internalId:  result.internalId ?? null,
        bhaooId:     result.status === 0 ? result.messageId : null,
        toNumber:    to,
        fromId:      from,
        messageText: text,
        messageType: type ?? 'text',
        status:      result.status === 0 ? 'submitted' : 'failed',
        statusCode:  result.status,
        errorMessage: result.error ?? null,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Bulk SMS ────────────────────────────────────────────────────────────
  app.post('/api/sms/send-bulk', requireAuth, async (req: any, res: any) => {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }
    if (messages.length > 100) return res.status(400).json({ error: 'Max 100 messages per bulk request' });

    try {
      const results = await sendSmsBulk(messages);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const m = messages[i];
        await db.insert(smsMessages).values({
          internalId:  r.internalId ?? null,
          bhaooId:     r.status === 0 ? r.messageId : null,
          toNumber:    m.to,
          fromId:      m.from,
          messageText: m.text,
          messageType: m.type ?? 'text',
          status:      r.status === 0 ? 'submitted' : 'failed',
          statusCode:  r.status,
          errorMessage: r.error ?? null,
        });
      }
      res.json({ total: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DLR webhook — shared handler (GET or POST) ──────────────────────────────
  async function handleDlrPush(data: Record<string, any>, res: any) {
    try {
      const payload = parseDlrPush(data);

      await db.insert(smsDlrEvents).values({
        messageId:  payload.messageId || null,
        clientRef:  payload.clientRef || null,
        status:     payload.status,
        statusText: payload.statusText || null,
        msisdn:     payload.msisdn || null,
        operator:   payload.operator || null,
        country:    payload.country || null,
        errorCode:  payload.errorCode || null,
        rawPayload: data,
      });

      if (payload.messageId) {
        const dlrStatus = payload.status === 0 ? 'delivered'
          : payload.status === 1 ? 'failed'
          : payload.status === 2 ? 'pending'
          : payload.status === 4 ? 'sent'
          : 'unknown';

        await db.update(smsMessages)
          .set({
            status:        dlrStatus,
            statusCode:    payload.status,
            operator:      payload.operator ?? undefined,
            country:       payload.country ?? undefined,
            errorCode:     payload.errorCode ?? undefined,
            dlrReceivedAt: new Date(),
            updatedAt:     new Date(),
          })
          .where(eq(smsMessages.bhaooId, payload.messageId));
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error('[bhaoo-dlr] error:', err.message);
      res.status(500).json({ error: err.message });
    }
  }

  // BhaooSMS POST push (recommended)
  app.post('/api/bhaoo/dlr', (req: any, res: any) => handleDlrPush(req.body ?? {}, res));

  // BhaooSMS GET push (if GET method selected in BhaooSMS config)
  app.get('/api/bhaoo/dlr', (req: any, res: any) => handleDlrPush(req.query ?? {}, res));

  // ── DLR query — poll delivery status for a specific message ─────────────────
  app.get('/api/bhaoo/dlr/:messageId', requireAuth, async (req: any, res: any) => {
    try {
      const result = await queryDlr(req.params.messageId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Message log ─────────────────────────────────────────────────────────────
  app.get('/api/bhaoo/messages', requireAuth, async (req: any, res: any) => {
    try {
      const limit  = Math.min(Number(req.query.limit ?? 50), 200);
      const rows   = await db.select().from(smsMessages).orderBy(desc(smsMessages.submittedAt)).limit(limit);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Stats — delivery analytics from DB ──────────────────────────────────────
  app.get('/api/bhaoo/stats', requireAuth, async (_req: any, res: any) => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [totals] = await db.execute(sql`
        SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE status = 'delivered')   AS delivered,
          COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
          COUNT(*) FILTER (WHERE status = 'submitted'
                        OR status = 'sent'
                        OR status = 'pending')           AS pending
        FROM sms_messages
        WHERE submitted_at >= ${since}
      `) as any[];

      const row = totals ?? {};
      const total     = Number(row.total     ?? 0);
      const delivered = Number(row.delivered ?? 0);
      const failed    = Number(row.failed    ?? 0);
      const pending   = Number(row.pending   ?? 0);
      const rate      = total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0;

      const operatorRows = await db.execute(sql`
        SELECT operator, COUNT(*) AS sent,
               COUNT(*) FILTER (WHERE status = 'delivered') AS delivered
        FROM sms_messages
        WHERE submitted_at >= ${since}
          AND operator IS NOT NULL
        GROUP BY operator
        ORDER BY sent DESC
        LIMIT 10
      `) as any[];

      const operatorBreakdown = (operatorRows as any[]).map((r: any) => ({
        operator:  r.operator,
        sent:      Number(r.sent),
        delivered: Number(r.delivered),
        rate:      Number(r.sent) > 0 ? parseFloat((Number(r.delivered) / Number(r.sent) * 100).toFixed(1)) : 0,
      }));

      const balance = await checkBalance();

      res.json({
        sentToday:      total,
        deliveredToday: delivered,
        failedToday:    failed,
        pendingToday:   pending,
        deliveryRate:   rate,
        balance:        balance.balance,
        currency:       balance.currency ?? 'USD',
        balanceError:   balance.error,
        operatorBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Recharge ─────────────────────────────────────────────────────────────────
  app.post('/api/bhaoo/recharge', requireAuth, async (req: any, res: any) => {
    const { amount, clientId } = req.body ?? {};
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'amount is required' });
    try {
      const result = await rechargeAccount(Number(amount), clientId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[bhaoo] SMS routes registered');
}
