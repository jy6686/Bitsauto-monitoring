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
  smsMessages, smsDlrEvents, bhaooBalanceLog, smsVendorStats, bhaooProfiles,
  voiceOtpCalls,
} from '@shared/schema';
import { eq, desc, gte, sql } from 'drizzle-orm';
import { originateOtpCall } from './services/asterisk/index';

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function seedDefaultProfile() {
  try {
    const apiKey    = process.env.BHAOO_API_KEY;
    const secretKey = process.env.BHAOO_SECRET_KEY;
    if (!apiKey || !secretKey) return;

    const existing = await db.select({ id: bhaooProfiles.id }).from(bhaooProfiles).limit(1);
    if (existing.length > 0) return;

    await db.insert(bhaooProfiles).values({
      name:      'R.Testing1',
      baseUrl:   'http://149.20.185.6/BhaooSMSV5',
      apiKey,
      secretKey,
      isDefault: true,
      isActive:  true,
    });
    console.log('[bhaoo] seeded default profile R.Testing1');
  } catch (err: any) {
    console.warn('[bhaoo] seed skipped:', err.message);
  }
}

export function registerBhaooRoutes(app: Express) {
  seedDefaultProfile();

  // ── Connection status ────────────────────────────────────────────────────────
  app.get('/api/bhaoo/status', requireAuth, async (_req: any, res: any) => {
    const configured = isConfigured();
    if (!configured) {
      return res.json({ connected: false, error: 'BHAOO_API_KEY / BHAOO_SECRET_KEY not set' });
    }
    const balance = await checkBalance();
    // 404 means balance API endpoint unreachable (likely IP-whitelisted) — credentials are still valid
    const endpointUnreachable = balance.error?.includes('404') || balance.error?.includes('Not Found');
    const connected = balance.status === 0 || endpointUnreachable;
    res.json({ connected, balance: balance.balance, currency: balance.currency, error: endpointUnreachable ? null : balance.error, balanceUnknown: endpointUnreachable });
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
      if (!data || Object.keys(data).length === 0) {
        console.warn('[bhaoo-dlr] WARNING: received empty DLR push body — check REVE profile DLR URL (must be the deployed URL, not dev URL)');
      }
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

        // Try to update an existing record first
        const updated = await db.update(smsMessages)
          .set({
            status:        dlrStatus,
            statusCode:    payload.status,
            operator:      payload.operator ?? undefined,
            country:       payload.country ?? undefined,
            errorCode:     payload.errorCode ?? undefined,
            dlrReceivedAt: new Date(),
            updatedAt:     new Date(),
          })
          .where(eq(smsMessages.bhaooId, payload.messageId))
          .returning();

        // No existing record — message was sent directly from REVE/BhaooSMS
        // Create a new record so it appears in the SMS Monitor
        if (updated.length === 0) {
          await db.insert(smsMessages).values({
            bhaooId:      payload.messageId,
            toNumber:     payload.msisdn || 'unknown',
            fromId:       null,
            messageText:  null,
            messageType:  'text',
            status:       dlrStatus,
            statusCode:   payload.status,
            operator:     payload.operator || null,
            country:      payload.country || null,
            errorCode:    payload.errorCode || null,
            dlrReceivedAt: new Date(),
          }).onConflictDoNothing();
        }

        // ── Auto-fallback to Voice OTP on delivery failure ─────────────────
        if (dlrStatus === 'failed' && payload.msisdn) {
          try {
            const { originateOtpCall, isAmiConfigured } = await import('./services/asterisk/index');
            if (isAmiConfigured()) {
              // Find the message to get OTP text if available
              const [msgRecord] = updated.length > 0 ? updated : await db
                .select()
                .from(smsMessages)
                .where(eq(smsMessages.bhaooId, payload.messageId))
                .limit(1);

              // Extract OTP from message text (look for 4-8 digit sequence)
              let otp = '000000';
              if (msgRecord?.messageText) {
                const match = msgRecord.messageText.match(/\b(\d{4,8})\b/);
                if (match) otp = match[1];
              }

              console.log(`[bhaoo-dlr] SMS failed → triggering Voice OTP fallback to ${payload.msisdn}`);

              const { voiceOtpCalls } = await import('@shared/schema');
              const { eq: eqOp } = await import('drizzle-orm');

              const [callRow] = await db.insert(voiceOtpCalls).values({
                toNumber: payload.msisdn,
                otp:      otp[0] + '*'.repeat(Math.max(0, otp.length - 2)) + otp[otp.length - 1],
                trunk:    'Sippy',
                status:   'initiated',
              }).returning();

              originateOtpCall({ to: payload.msisdn, otp, trunk: 'Sippy', cli: payload.msisdn })
                .then(async (result) => {
                  await db.update(voiceOtpCalls)
                    .set({ status: result.success ? 'answered' : 'failed', asteriskId: result.uniqueId ?? null, errorMessage: result.error ?? result.reasonText ?? null })
                    .where(eqOp(voiceOtpCalls.id, callRow.id));
                })
                .catch((err) => console.error('[bhaoo-dlr] Voice OTP fallback error:', err.message));

              // Mark original SMS as fallback triggered
              if (msgRecord) {
                await db.update(smsMessages)
                  .set({ fallbackTriggered: true, fallbackAt: new Date(), updatedAt: new Date() })
                  .where(eq(smsMessages.id, msgRecord.id));
              }
            }
          } catch (fbErr: any) {
            console.error('[bhaoo-dlr] Fallback error:', fbErr.message);
          }
        }
      }

      res.json({ ok: true, status: 0, text: 'ACCEPTD', Message_ID: payload.messageId });
    } catch (err: any) {
      console.error('[bhaoo-dlr] error:', err.message);
      res.status(500).json({ ok: false, status: -1, text: 'REJECTD', error: err.message });
    }
  }

  // BhaooSMS POST push (recommended)
  app.post('/api/bhaoo/dlr', (req: any, res: any) => handleDlrPush(req.body ?? {}, res));

  // BhaooSMS GET push (if GET method selected in BhaooSMS config)
  app.get('/api/bhaoo/dlr', (req: any, res: any) => handleDlrPush(req.query ?? {}, res));

  // ── Inbound SMS receive — REVE submits here (Submit URL in HTTP profile) ─────
  // GET /api/bhaoo/receive?apikey=...&secretkey=...&to=...&from=...&smsText=...&transactionId=...
  app.get('/api/bhaoo/receive', async (req: any, res: any) => {
    try {
      const { apikey, secretkey, to, from, smsText, type, transactionId } = req.query as Record<string, string>;

      if (!to || !smsText) {
        return res.json({ status: -1, Text: 'REJECTD', message_id: '', error: 'to and smsText are required' });
      }

      // Validate credentials against stored profile
      const profiles = await db.select().from(bhaooProfiles).where(eq(bhaooProfiles.isActive, true)).limit(10);
      const matched  = profiles.find(p => p.apiKey === apikey && p.secretKey === secretkey);
      const envMatch = apikey === process.env.BHAOO_API_KEY && secretkey === process.env.BHAOO_SECRET_KEY;

      if (!matched && !envMatch) {
        console.warn(`[bhaoo-receive] Auth failed — apikey=${apikey}`);
        return res.json({ status: -42, Text: 'REJECTD', message_id: '', error: 'Authentication failed' });
      }

      // Extract OTP: first 4–8 digit sequence in the message
      const otpMatch = smsText.match(/\b(\d{4,8})\b/);
      const otp      = otpMatch?.[1] ?? '';

      const msgId    = transactionId || `recv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const profileId = matched?.id ?? null;

      // Log in sms_messages
      const [msgRow] = await db.insert(smsMessages).values({
        internalId:  msgId,
        bhaooId:     msgId,
        toNumber:    String(to),
        fromId:      from ? String(from) : null,
        messageText: String(smsText),
        messageType: type ?? 'text',
        status:      'submitted',
        profileId,
      }).returning();

      console.log(`[bhaoo-receive] SMS from REVE → to=${to} otp=${otp || '(none)'} msgId=${msgId}`);

      // Trigger Voice OTP call if OTP found in message
      if (otp) {
        const [callRow] = await db.insert(voiceOtpCalls).values({
          toNumber: String(to),
          otp:      otp[0] + '*'.repeat(Math.max(0, otp.length - 2)) + otp[otp.length - 1],
          trunk:    'Sippy',
          status:   'initiated',
        }).returning();

        originateOtpCall({ to: String(to), otp, trunk: 'Sippy', cli: from ? String(from) : undefined })
          .then(async (result) => {
            const { eq: eqOp } = await import('drizzle-orm');
            await db.update(voiceOtpCalls)
              .set({ status: result.success ? 'answered' : 'failed', asteriskId: result.uniqueId ?? null, errorMessage: result.error ?? result.reasonText ?? null })
              .where(eqOp(voiceOtpCalls.id, callRow.id));
            // Update sms message status based on call result
            await db.update(smsMessages)
              .set({ status: result.success ? 'delivered' : 'failed', fallbackTriggered: true, fallbackAt: new Date(), updatedAt: new Date() })
              .where(eqOp(smsMessages.id, msgRow.id));
            console.log(`[bhaoo-receive] Voice OTP call ${result.success ? 'initiated' : 'failed'}: ${result.error ?? result.uniqueId}`);
          })
          .catch((err) => console.error('[bhaoo-receive] AMI error:', err.message));
      } else {
        console.warn(`[bhaoo-receive] No OTP found in smsText: "${smsText}" — call not triggered`);
      }

      res.json({ status: 0, Text: 'ACCEPTD', message_id: msgId });
    } catch (err: any) {
      console.error('[bhaoo-receive] error:', err.message);
      res.json({ status: -1, Text: 'REJECTD', message_id: '', error: err.message });
    }
  });

  // ── Shared HTML generator for SMS API docs ──────────────────────────────────
  function buildSmsApiDocs(): string {
    const base = 'https://vo-ip-watcher--junaid70.replit.app';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BitsAuto SMS API Documentation</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6;padding:32px 16px}
  .wrap{max-width:860px;margin:0 auto}
  h1{font-size:1.8rem;font-weight:700;color:#f8fafc;margin-bottom:4px}
  .subtitle{color:#94a3b8;font-size:.95rem;margin-bottom:36px}
  h2{font-size:1.05rem;font-weight:700;color:#f1f5f9;margin:0 0 14px;display:flex;align-items:center;gap:10px}
  h3{font-size:.9rem;font-weight:600;color:#cbd5e1;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.06em;font-size:.78rem}
  p{color:#94a3b8;margin-bottom:12px;font-size:.88rem}
  .badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:4px;font-size:.72rem;font-weight:700;letter-spacing:.04em;flex-shrink:0}
  .get{background:#1e3a5f;color:#60a5fa}
  .post{background:#1c3529;color:#34d399}
  .url{font-family:'Courier New',monospace;background:#1e293b;padding:11px 14px;border-radius:7px;font-size:.82rem;color:#7dd3fc;word-break:break-all;margin:8px 0 14px;border:1px solid #334155}
  table{width:100%;border-collapse:collapse;font-size:.83rem;margin:10px 0}
  th{background:#1e293b;color:#64748b;text-align:left;padding:8px 12px;font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  td{padding:8px 12px;border-bottom:1px solid #1e293b;vertical-align:top;color:#94a3b8}
  td:first-child{font-family:'Courier New',monospace;color:#a5b4fc;white-space:nowrap}
  .req{color:#fb923c;font-size:.72rem;font-weight:700}
  .opt{color:#475569;font-size:.72rem;font-weight:600}
  .code{font-family:'Courier New',monospace;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:13px 15px;font-size:.8rem;color:#e2e8f0;white-space:pre;overflow-x:auto;margin:8px 0 14px;line-height:1.5}
  .green{color:#4ade80}
  .red{color:#f87171}
  .note{background:#1c2e1a;border-left:3px solid #4ade80;padding:11px 15px;border-radius:0 6px 6px 0;margin:12px 0;font-size:.83rem;color:#86efac}
  .warn{background:#2d1f08;border-left:3px solid #fbbf24;padding:11px 15px;border-radius:0 6px 6px 0;margin:12px 0;font-size:.83rem;color:#fcd34d}
  .section{background:#0f1f33;border:1px solid #1e293b;border-radius:10px;padding:22px 24px;margin-bottom:20px}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
  .toc a{background:#1e293b;color:#94a3b8;text-decoration:none;padding:5px 13px;border-radius:20px;font-size:.8rem;border:1px solid #334155;transition:color .15s}
  .toc a:hover{color:#e2e8f0}
  code{font-family:'Courier New',monospace;background:#1e293b;padding:1px 5px;border-radius:3px;font-size:.82em;color:#a5b4fc}
  .divider{border:none;border-top:1px solid #1e293b;margin:28px 0}
  .dl-bar{display:flex;gap:10px;margin-bottom:28px;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:7px;padding:8px 18px;border-radius:7px;font-size:.83rem;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:opacity .15s}
  .btn:hover{opacity:.85}
  .btn-pdf{background:#2563eb;color:#fff}
  .btn-html{background:#1e293b;color:#94a3b8;border:1px solid #334155}
  @media print{
    .dl-bar,.toc{display:none!important}
    body{background:#fff!important;color:#111!important;padding:24px!important}
    .section{background:#f8fafc!important;border:1px solid #e2e8f0!important;break-inside:avoid;page-break-inside:avoid}
    h1{color:#111!important}h2{color:#1e293b!important}
    .url{background:#f1f5f9!important;color:#1d4ed8!important;border:1px solid #cbd5e1!important}
    .code{background:#f8fafc!important;color:#1e293b!important;border:1px solid #e2e8f0!important}
    th{background:#f1f5f9!important;color:#475569!important}
    td{color:#374151!important}
    td:first-child{color:#6d28d9!important}
    .green{color:#16a34a!important}.red{color:#dc2626!important}
    .note{background:#f0fdf4!important;color:#166534!important}
    .warn{background:#fffbeb!important;color:#92400e!important}
    .badge.get{background:#dbeafe!important;color:#1d4ed8!important}
    .badge.post{background:#dcfce7!important;color:#166534!important}
    .req{color:#ea580c!important}.opt{color:#9ca3af!important}
    .subtitle{color:#475569!important}p{color:#374151!important}
    .divider{border-color:#e2e8f0!important}
    h3{color:#475569!important}
  }
</style>
</head>
<body>
<div class="wrap">

<h1>💬 BitsAuto SMS API</h1>
<p class="subtitle">Integration reference for REVE SMS / BhaooSMS V5 &nbsp;·&nbsp; v1.0 &nbsp;·&nbsp; Base URL: <code style="color:#7dd3fc;background:none;padding:0">${base}</code></p>

<div class="dl-bar">
  <button class="btn btn-pdf" onclick="window.print()">🖨️ Save as PDF</button>
  <a class="btn btn-html" href="/api/bhaoo/docs/download" download="BitsAuto-SMS-API.html">⬇ Download HTML</a>
</div>

<div class="toc">
  <a href="#receive">Inbound Webhook</a>
  <a href="#dlr">DLR Push</a>
  <a href="#send">Send SMS</a>
  <a href="#bulk">Send Bulk</a>
  <a href="#numbers">Number Format</a>
  <a href="#reve-config">REVE Config</a>
  <a href="#health">Health Check</a>
</div>

<!-- ═══ INBOUND RECEIVE ════════════════════════════════════════════ -->
<div class="section" id="receive">
<h2><span class="badge get">GET</span> Inbound SMS Webhook</h2>
<p>Set this as the <strong>Submit URL</strong> in your REVE HTTP profile. REVE calls this endpoint for every outgoing SMS, allowing BitsAuto to log and track the message.</p>
<div class="url">${base}/api/bhaoo/receive</div>

<h3>Query Parameters</h3>
<table>
  <tr><th>Parameter</th><th>Required</th><th>Type</th><th>Description</th></tr>
  <tr><td>apikey</td><td><span class="req">REQUIRED</span></td><td>string</td><td>API key provided by BitsAuto</td></tr>
  <tr><td>secretkey</td><td><span class="req">REQUIRED</span></td><td>string</td><td>Secret key paired with the API key</td></tr>
  <tr><td>to</td><td><span class="req">REQUIRED</span></td><td>string</td><td>Destination MSISDN in E.164 without <code>+</code> (e.g. <code>923219286686</code>)</td></tr>
  <tr><td>smsText</td><td><span class="req">REQUIRED</span></td><td>string</td><td>Full SMS body text (URL-encoded)</td></tr>
  <tr><td>from</td><td><span class="opt">OPTIONAL</span></td><td>string</td><td>Sender ID or originating CLI</td></tr>
  <tr><td>transactionId</td><td><span class="opt">OPTIONAL</span></td><td>string</td><td>REVE's unique message ID — used for DLR correlation</td></tr>
  <tr><td>type</td><td><span class="opt">OPTIONAL</span></td><td>string</td><td>Message type. Default: <code>text</code></td></tr>
</table>

<h3>Example Request</h3>
<div class="code">GET ${base}/api/bhaoo/receive
    ?apikey=YOUR_API_KEY
    &amp;secretkey=YOUR_SECRET_KEY
    &amp;to=923219286686
    &amp;from=BitsOTP
    &amp;smsText=Your+verification+code+is+847261
    &amp;transactionId=TX-20260530-00123</div>

<h3>Responses</h3>
<table>
  <tr><th>status</th><th>Text</th><th>Meaning</th></tr>
  <tr><td>0</td><td><span class="green">ACCEPTD</span></td><td>Message accepted and logged successfully</td></tr>
  <tr><td>-42</td><td><span class="red">REJECTD</span></td><td>Authentication failed — wrong <code>apikey</code> or <code>secretkey</code></td></tr>
  <tr><td>-1</td><td><span class="red">REJECTD</span></td><td>Missing required field or internal error</td></tr>
</table>

<div class="code"><span class="green">// Success
{ "status": 0, "Text": "ACCEPTD", "message_id": "TX-20260530-00123" }

// Auth failure
{ "status": -42, "Text": "REJECTD", "error": "Authentication failed" }</span></div>

<div class="note">✅ Response is returned immediately — message processing is asynchronous.</div>
</div>

<!-- ═══ DLR PUSH ═══════════════════════════════════════════════════ -->
<div class="section" id="dlr">
<h2><span class="badge post">POST</span><span class="badge get" style="margin-left:4px">GET</span> DLR Push Webhook</h2>
<p>Configure this as the <strong>DLR URL</strong> in your REVE profile. REVE calls this when a delivery receipt is received from the carrier.</p>
<div class="url">${base}/api/bhaoo/dlr</div>
<p>Accepts both <code>GET</code> (query string) and <code>POST</code> (JSON or form body). BitsAuto correlates the DLR with the original message using <code>message_id</code>.</p>

<h3>Expected Parameters</h3>
<table>
  <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
  <tr><td>message_id</td><td>string</td><td>REVE message ID matching the <code>transactionId</code> sent on receive</td></tr>
  <tr><td>status</td><td>integer</td><td>Delivery status code (see table below)</td></tr>
  <tr><td>msisdn</td><td>string</td><td>Destination number</td></tr>
  <tr><td>operator</td><td>string</td><td>Carrier / operator name (optional)</td></tr>
  <tr><td>country</td><td>string</td><td>Destination country (optional)</td></tr>
  <tr><td>error_code</td><td>string</td><td>Carrier error code if failed (optional)</td></tr>
</table>

<h3>DLR Status Codes</h3>
<table>
  <tr><th>status</th><th>Meaning</th></tr>
  <tr><td>0</td><td><span class="green">Delivered</span></td></tr>
  <tr><td>1</td><td><span class="red">Failed</span></td></tr>
  <tr><td>2</td><td>Pending / En-route</td></tr>
  <tr><td>4</td><td>Sent to carrier (awaiting DLR)</td></tr>
</table>

<h3>Example POST Body</h3>
<div class="code">{
  "message_id": "TX-20260530-00123",
  "status": 0,
  "msisdn": "923219286686",
  "operator": "Zong",
  "country": "Pakistan"
}</div>

<h3>Response</h3>
<div class="code"><span class="green">{ "ok": true, "status": 0, "text": "ACCEPTD", "Message_ID": "TX-20260530-00123" }</span></div>
</div>

<!-- ═══ SEND SMS ═══════════════════════════════════════════════════ -->
<div class="section" id="send">
<h2><span class="badge post">POST</span> Send SMS</h2>
<p>Send a single SMS message outbound via BitsAuto → BhaooSMS → Carrier.</p>
<div class="url">${base}/api/sms/send</div>
<p><em>Requires BitsAuto session authentication.</em></p>

<h3>Request Body (JSON)</h3>
<div class="code">{
  "to":   "923219286686",   // <span class="req">REQUIRED</span> — destination MSISDN (E.164, no +)
  "from": "BitsOTP",        // <span class="req">REQUIRED</span> — sender ID
  "text": "Your code: 847261", // <span class="req">REQUIRED</span> — message body
  "type": "text"            // optional — default "text"
}</div>

<h3>Success Response</h3>
<div class="code"><span class="green">{
  "status": 0,
  "messageId": "BHAOO-MSG-001",
  "internalId": "recv-1748620800-abc12"
}</span></div>
</div>

<!-- ═══ BULK SMS ════════════════════════════════════════════════════ -->
<div class="section" id="bulk">
<h2><span class="badge post">POST</span> Send Bulk SMS</h2>
<p>Send up to <strong>100 messages</strong> in a single request.</p>
<div class="url">${base}/api/sms/send-bulk</div>
<p><em>Requires BitsAuto session authentication.</em></p>

<h3>Request Body (JSON)</h3>
<div class="code">{
  "messages": [
    { "to": "923219286686", "from": "BitsOTP", "text": "Code: 847261" },
    { "to": "971501234567", "from": "BitsOTP", "text": "Code: 991234" }
  ]
}</div>

<h3>Success Response</h3>
<div class="code"><span class="green">{
  "total": 2,
  "results": [
    { "status": 0, "messageId": "BHAOO-MSG-001" },
    { "status": 0, "messageId": "BHAOO-MSG-002" }
  ]
}</span></div>
</div>

<!-- ═══ NUMBER FORMAT ══════════════════════════════════════════════ -->
<div class="section" id="numbers">
<h2>📱 Phone Number Format</h2>
<p>All number fields must be plain E.164 digits — <strong>no leading <code>+</code>, no <code>00</code> prefix, no spaces or dashes.</strong></p>
<table>
  <tr><th>Country</th><th>✅ Correct</th><th>❌ Wrong</th></tr>
  <tr><td>Pakistan</td><td><span class="green">923219286686</span></td><td><span class="red">+923219286686 &nbsp; 03219286686 &nbsp; 00923219286686</span></td></tr>
  <tr><td>UAE</td><td><span class="green">971501234567</span></td><td><span class="red">+971501234567 &nbsp; 00971501234567</span></td></tr>
  <tr><td>Saudi Arabia</td><td><span class="green">966501234567</span></td><td><span class="red">+966501234567 &nbsp; 00966501234567</span></td></tr>
  <tr><td>Bangladesh</td><td><span class="green">8801711234567</span></td><td><span class="red">+8801711234567</span></td></tr>
</table>
<div class="warn">⚠️ Sending with a leading <code>+</code> will cause authentication or routing errors on the carrier side.</div>
</div>

<!-- ═══ REVE CONFIG ════════════════════════════════════════════════ -->
<div class="section" id="reve-config">
<h2>⚙️ REVE HTTP Profile Configuration</h2>
<p>In REVE Admin → <strong>HTTP Profiles</strong> → create or edit a profile with the values below:</p>
<table>
  <tr><th>REVE Field</th><th>Value to enter</th></tr>
  <tr><td>Profile Type</td><td>HTTP GET</td></tr>
  <tr><td>Submit URL</td><td><code>${base}/api/bhaoo/receive</code></td></tr>
  <tr><td>API Key field name</td><td><code>apikey</code></td></tr>
  <tr><td>Secret Key field name</td><td><code>secretkey</code></td></tr>
  <tr><td>Destination field name</td><td><code>to</code></td></tr>
  <tr><td>Sender field name</td><td><code>from</code></td></tr>
  <tr><td>Message field name</td><td><code>smsText</code></td></tr>
  <tr><td>Transaction ID field name</td><td><code>transactionId</code></td></tr>
  <tr><td>DLR URL</td><td><code>${base}/api/bhaoo/dlr</code></td></tr>
  <tr><td>DLR Method</td><td>POST (preferred) or GET</td></tr>
  <tr><td>Success match string</td><td><code>ACCEPTD</code></td></tr>
</table>
</div>

<!-- ═══ HEALTH CHECK ═══════════════════════════════════════════════ -->
<div class="section" id="health">
<h2>🔍 Health Check</h2>
<p>Hit this URL to confirm the server is reachable before configuring REVE. No valid credentials required — the expected response confirms the server is live and the auth layer is active.</p>
<div class="url">${base}/api/bhaoo/receive?apikey=ping&amp;secretkey=ping&amp;to=0&amp;smsText=test</div>
<p>Expected response:</p>
<div class="code">{ "status": -42, "Text": "REJECTD", "error": "Authentication failed" }</div>
<div class="note">✅ Receiving this exact response means the webhook server is online and authentication is working correctly.</div>
</div>

<hr class="divider"/>
<p style="font-size:.78rem;color:#334155;text-align:center">BitsAuto Monitoring Platform &nbsp;·&nbsp; SMS API Reference &nbsp;·&nbsp; Confidential</p>
</div>
</body>
</html>`;
  }

  // ── Docs — view in browser ───────────────────────────────────────────────────
  app.get('/api/bhaoo/docs', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildSmsApiDocs());
  });

  // ── Docs — download as HTML file ─────────────────────────────────────────────
  app.get('/api/bhaoo/docs/download', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="BitsAuto-SMS-API.html"');
    res.send(buildSmsApiDocs());
  });

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

      const totalsResult = await db.execute(sql`
        SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE status = 'delivered')   AS delivered,
          COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
          COUNT(*) FILTER (WHERE status = 'submitted'
                        OR status = 'sent'
                        OR status = 'pending')           AS pending
        FROM sms_messages
        WHERE submitted_at >= ${since}
      `);
      const totalsRows = Array.isArray(totalsResult) ? totalsResult : ((totalsResult as any).rows ?? []);

      const row = (totalsRows[0] as any) ?? {};
      const total     = Number(row.total     ?? 0);
      const delivered = Number(row.delivered ?? 0);
      const failed    = Number(row.failed    ?? 0);
      const pending   = Number(row.pending   ?? 0);
      const rate      = total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0;

      const operatorResult = await db.execute(sql`
        SELECT operator, COUNT(*) AS sent,
               COUNT(*) FILTER (WHERE status = 'delivered') AS delivered
        FROM sms_messages
        WHERE submitted_at >= ${since}
          AND operator IS NOT NULL
        GROUP BY operator
        ORDER BY sent DESC
        LIMIT 10
      `);
      const operatorRows: any[] = Array.isArray(operatorResult) ? operatorResult : ((operatorResult as any).rows ?? []);

      const operatorBreakdown = operatorRows.map((r: any) => ({
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

  // ── Profiles CRUD ────────────────────────────────────────────────────────────
  app.get('/api/bhaoo/profiles', requireAuth, async (_req: any, res: any) => {
    try {
      const rows = await db.select().from(bhaooProfiles).orderBy(bhaooProfiles.createdAt);
      // Mask secrets in response
      res.json(rows.map(r => ({ ...r, secretKey: '••••••••' })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/bhaoo/profiles', requireAuth, async (req: any, res: any) => {
    const { name, baseUrl, apiKey, secretKey, isDefault } = req.body ?? {};
    if (!name || !apiKey || !secretKey) return res.status(400).json({ error: 'name, apiKey, secretKey are required' });
    try {
      if (isDefault) {
        await db.update(bhaooProfiles).set({ isDefault: false, updatedAt: new Date() });
      }
      const [row] = await db.insert(bhaooProfiles).values({
        name,
        baseUrl: baseUrl || 'http://149.20.185.6/BhaooSMSV5',
        apiKey,
        secretKey,
        isDefault: !!isDefault,
      }).returning();
      res.json({ ...row, secretKey: '••••••••' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/bhaoo/profiles/:id', requireAuth, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { name, baseUrl, apiKey, secretKey, isDefault, isActive } = req.body ?? {};
    try {
      if (isDefault) {
        await db.update(bhaooProfiles).set({ isDefault: false, updatedAt: new Date() });
      }
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (name      !== undefined) updates.name      = name;
      if (baseUrl   !== undefined) updates.baseUrl   = baseUrl;
      if (apiKey    !== undefined && apiKey    !== '••••••••') updates.apiKey    = apiKey;
      if (secretKey !== undefined && secretKey !== '••••••••') updates.secretKey = secretKey;
      if (isDefault !== undefined) updates.isDefault = isDefault;
      if (isActive  !== undefined) updates.isActive  = isActive;
      const [row] = await db.update(bhaooProfiles).set(updates).where(eq(bhaooProfiles.id, id)).returning();
      res.json({ ...row, secretKey: '••••••••' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/bhaoo/profiles/:id', requireAuth, async (req: any, res: any) => {
    const id = Number(req.params.id);
    try {
      await db.delete(bhaooProfiles).where(eq(bhaooProfiles.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Test a profile by checking its balance
  app.post('/api/bhaoo/profiles/:id/test', requireAuth, async (req: any, res: any) => {
    const id = Number(req.params.id);
    try {
      const [profile] = await db.select().from(bhaooProfiles).where(eq(bhaooProfiles.id, id));
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const { bhaooRequest } = await import('./services/bhaoo/client');
      const balResult = await checkBalance({ baseUrl: profile.baseUrl, apiKey: profile.apiKey, secretKey: profile.secretKey });
      const endpointUnreachable = balResult.error?.includes('404') || balResult.error?.includes('Not Found');
      if (balResult.status === 0) {
        res.json({ ok: true, balance: balResult.balance, currency: balResult.currency });
      } else if (endpointUnreachable) {
        res.json({ ok: true, balance: null, warning: 'Balance API endpoint unreachable (IP-whitelisted?) — credentials accepted, DLR will work normally' });
      } else {
        res.status(500).json({ ok: false, error: balResult.error });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Send SMS via a specific profile
  app.post('/api/sms/send-profile', requireAuth, async (req: any, res: any) => {
    const { profileId, to, from, text, type } = req.body ?? {};
    if (!profileId || !to || !from || !text) return res.status(400).json({ error: 'profileId, to, from, text are required' });
    try {
      const [profile] = await db.select().from(bhaooProfiles).where(eq(bhaooProfiles.id, Number(profileId)));
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      if (!profile.isActive) return res.status(400).json({ error: 'Profile is disabled' });

      const { bhaooRequest } = await import('./services/bhaoo/client');
      const internalId = `bts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const raw = await bhaooRequest<any>({
        method:  'POST',
        path:    '/api/',
        profile: { baseUrl: profile.baseUrl, apiKey: profile.apiKey, secretKey: profile.secretKey },
        body: { type: type ?? 'text', from, to, text, transactionId: internalId },
      });

      const status = Number(raw?.status ?? -1);
      await db.insert(smsMessages).values({
        internalId,
        bhaooId:     status === 0 ? raw.messageId : null,
        toNumber:    to,
        fromId:      from,
        messageText: text,
        messageType: type ?? 'text',
        status:      status === 0 ? 'submitted' : 'failed',
        statusCode:  status,
        errorMessage: status !== 0 ? (raw.text ?? 'Send failed') : null,
      });

      res.json({ status, messageId: raw.messageId, profile: profile.name });
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
