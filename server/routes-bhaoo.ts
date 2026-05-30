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

              originateOtpCall({ to: payload.msisdn, otp, trunk: 'Sippy' })
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

        originateOtpCall({ to: String(to), otp, trunk: 'Sippy' })
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

  // ── Public API documentation — no auth required (for REVE / third-party setup) ─
  app.get('/api/bhaoo/docs', (_req: any, res: any) => {
    const base = 'https://vo-ip-watcher--junaid70.replit.app';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BitsAuto Voice OTP — Webhook API Documentation</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6;padding:32px 16px}
  .wrap{max-width:860px;margin:0 auto}
  h1{font-size:1.8rem;font-weight:700;color:#f8fafc;margin-bottom:4px}
  .subtitle{color:#94a3b8;font-size:.95rem;margin-bottom:36px}
  h2{font-size:1.1rem;font-weight:600;color:#f1f5f9;margin:32px 0 12px;border-bottom:1px solid #1e293b;padding-bottom:8px}
  h3{font-size:.95rem;font-weight:600;color:#cbd5e1;margin:20px 0 8px}
  p{color:#94a3b8;margin-bottom:12px;font-size:.9rem}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:700;margin-right:8px}
  .get{background:#1e3a5f;color:#60a5fa}
  .post{background:#1c3529;color:#34d399}
  .url{font-family:'Courier New',monospace;background:#1e293b;padding:12px 16px;border-radius:8px;font-size:.85rem;color:#7dd3fc;word-break:break-all;margin:8px 0 16px;border:1px solid #334155}
  table{width:100%;border-collapse:collapse;font-size:.85rem;margin:12px 0}
  th{background:#1e293b;color:#94a3b8;text-align:left;padding:8px 12px;font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em}
  td{padding:8px 12px;border-bottom:1px solid #1e293b;vertical-align:top}
  td:first-child{font-family:'Courier New',monospace;color:#a5b4fc;white-space:nowrap}
  .req{color:#fb923c;font-size:.75rem;font-weight:600}
  .opt{color:#64748b;font-size:.75rem}
  .code{font-family:'Courier New',monospace;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:14px 16px;font-size:.82rem;color:#e2e8f0;white-space:pre;overflow-x:auto;margin:8px 0 16px}
  .green{color:#4ade80}
  .red{color:#f87171}
  .yellow{color:#fbbf24}
  .note{background:#1c2e1a;border-left:3px solid #4ade80;padding:12px 16px;border-radius:0 6px 6px 0;margin:12px 0;font-size:.85rem;color:#86efac}
  .warn{background:#2d1f08;border-left:3px solid #fbbf24;padding:12px 16px;border-radius:0 6px 6px 0;margin:12px 0;font-size:.85rem;color:#fcd34d}
  .section{background:#0f1f33;border:1px solid #1e293b;border-radius:10px;padding:24px;margin-bottom:24px}
  .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0;font-size:.85rem}
  .step{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 14px;color:#e2e8f0}
  .arrow{color:#475569;font-size:1.1rem}
</style>
</head>
<body>
<div class="wrap">

<h1>📞 BitsAuto Voice OTP — Webhook API</h1>
<p class="subtitle">Integration guide for REVE SMS / BhaooSMS V5 &nbsp;·&nbsp; Version 1.0 &nbsp;·&nbsp; Base: <code style="color:#7dd3fc">${base}</code></p>

<div class="section">
<h2>Overview</h2>
<p>When REVE sends an OTP SMS to a subscriber, it also calls this webhook. BitsAuto extracts the OTP digits from the SMS text and immediately places a voice call to the same number via Asterisk → Sippy → Carrier, speaking the OTP digits aloud.</p>
<div class="flow">
  <span class="step">REVE sends OTP SMS</span><span class="arrow">→</span>
  <span class="step">BitsAuto /receive webhook</span><span class="arrow">→</span>
  <span class="step">Extract OTP digits</span><span class="arrow">→</span>
  <span class="step">Asterisk AMI</span><span class="arrow">→</span>
  <span class="step">Sippy SoftSwitch</span><span class="arrow">→</span>
  <span class="step">Carrier → Phone rings</span>
</div>
</div>

<div class="section">
<h2><span class="badge get">GET</span> Inbound SMS Webhook (Submit URL)</h2>
<p>Configure this as the <strong>Submit URL</strong> in your REVE HTTP profile. REVE calls this endpoint every time an SMS is dispatched.</p>

<div class="url">${base}/api/bhaoo/receive</div>

<h3>Query Parameters</h3>
<table>
  <tr><th>Parameter</th><th>Required</th><th>Description</th></tr>
  <tr><td>apikey</td><td><span class="req">REQUIRED</span></td><td>API key issued by BitsAuto for this REVE profile</td></tr>
  <tr><td>secretkey</td><td><span class="req">REQUIRED</span></td><td>Secret key paired with the API key</td></tr>
  <tr><td>to</td><td><span class="req">REQUIRED</span></td><td>Destination phone number in E.164 format without + (e.g. <code>923219286686</code>)</td></tr>
  <tr><td>from</td><td><span class="opt">optional</span></td><td>Sender ID or originating number</td></tr>
  <tr><td>smsText</td><td><span class="req">REQUIRED</span></td><td>Full SMS message body. Must contain the OTP as a 4–8 digit sequence (e.g. <em>"Your OTP is 847261"</em>)</td></tr>
  <tr><td>transactionId</td><td><span class="opt">optional</span></td><td>REVE's unique message ID for deduplication and DLR correlation</td></tr>
  <tr><td>type</td><td><span class="opt">optional</span></td><td>Message type (default: <code>text</code>)</td></tr>
</table>

<h3>Example Request</h3>
<div class="code">GET ${base}/api/bhaoo/receive
  ?apikey=YOUR_API_KEY
  &amp;secretkey=YOUR_SECRET_KEY
  &amp;to=923219286686
  &amp;from=BitsOTP
  &amp;smsText=Your+OTP+is+847261.+Valid+for+5+minutes.
  &amp;transactionId=TX-20260530-00123
  &amp;type=text</div>

<h3>Success Response — <span class="green">HTTP 200</span></h3>
<div class="code"><span class="green">{
  "status": 0,
  "Text": "ACCEPTD",
  "message_id": "TX-20260530-00123"
}</span></div>

<h3>Error Responses</h3>
<table>
  <tr><th>status</th><th>Text</th><th>Reason</th></tr>
  <tr><td>-42</td><td>REJECTD</td><td>Authentication failed — wrong apikey or secretkey</td></tr>
  <tr><td>-1</td><td>REJECTD</td><td>Missing required fields (<code>to</code> or <code>smsText</code>) or internal error</td></tr>
  <tr><td>0</td><td>ACCEPTD</td><td>Message accepted; voice call will be triggered automatically</td></tr>
</table>

<div class="note">
  ✅ <strong>ACCEPTD</strong> is returned immediately (async) — the voice call is placed in the background. You do not need to wait for the call to complete.
</div>
</div>

<div class="section">
<h2>OTP Extraction Rules</h2>
<p>BitsAuto scans <code>smsText</code> for the first sequence of <strong>4 to 8 consecutive digits</strong> using the pattern <code>\\b(\\d{4,8})\\b</code>. The entire SMS body can contain other text.</p>
<table>
  <tr><th>smsText</th><th>Extracted OTP</th></tr>
  <tr><td>Your OTP is <strong>847261</strong>. Valid 5 min.</td><td><span class="green">847261</span></td></tr>
  <tr><td>Code: <strong>1234</strong></td><td><span class="green">1234</span></td></tr>
  <tr><td>Use <strong>99887766</strong> to verify</td><td><span class="green">99887766</span></td></tr>
  <tr><td>Welcome to BitsAuto</td><td><span class="red">No OTP found — call not triggered</span></td></tr>
</table>
</div>

<div class="section">
<h2>Phone Number Format</h2>
<p>The <code>to</code> parameter must be a plain E.164 number without the leading <code>+</code>.</p>
<table>
  <tr><th>Country</th><th>Correct Format</th><th>Wrong Format</th></tr>
  <tr><td>Pakistan (Zong/Jazz/Telenor)</td><td><span class="green">923219286686</span></td><td><span class="red">+923219286686 &nbsp;/&nbsp; 03219286686</span></td></tr>
  <tr><td>UAE</td><td><span class="green">971501234567</span></td><td><span class="red">+971501234567</span></td></tr>
  <tr><td>Saudi Arabia</td><td><span class="green">966501234567</span></td><td><span class="red">00966501234567</span></td></tr>
</table>
<div class="warn">⚠️ Do not include the leading <code>+</code> or country-exit codes like <code>00</code> in the <code>to</code> field.</div>
</div>

<div class="section">
<h2>REVE HTTP Profile Configuration</h2>
<p>In your REVE SMS Admin → HTTP Profiles → create or edit a profile with these settings:</p>
<table>
  <tr><th>Field</th><th>Value</th></tr>
  <tr><td>Profile Type</td><td>HTTP GET</td></tr>
  <tr><td>Submit URL</td><td><code>${base}/api/bhaoo/receive</code></td></tr>
  <tr><td>API Key parameter name</td><td><code>apikey</code></td></tr>
  <tr><td>Secret Key parameter name</td><td><code>secretkey</code></td></tr>
  <tr><td>Destination param name</td><td><code>to</code></td></tr>
  <tr><td>Sender param name</td><td><code>from</code></td></tr>
  <tr><td>Message param name</td><td><code>smsText</code></td></tr>
  <tr><td>Transaction ID param name</td><td><code>transactionId</code></td></tr>
  <tr><td>Success response check</td><td><code>"Text":"ACCEPTD"</code></td></tr>
</table>
</div>

<div class="section">
<h2><span class="badge get">GET</span> DLR Push Webhook (optional)</h2>
<p>If REVE supports DLR callbacks, configure this URL to receive delivery reports:</p>
<div class="url">${base}/api/bhaoo/dlr-push</div>
<p>Accepts both GET and POST. BitsAuto correlates DLR events with previously sent messages using <code>message_id</code> / <code>transactionId</code>.</p>
</div>

<div class="section">
<h2>Health Check</h2>
<p>Use this to verify the webhook server is reachable before configuring REVE:</p>
<div class="url">${base}/api/bhaoo/receive?apikey=test&secretkey=test&to=0&smsText=test</div>
<p>Expected response: <code>{"status":-42,"Text":"REJECTD","error":"Authentication failed"}</code> — confirms the server is live and auth is working.</p>
</div>

<hr style="border-color:#1e293b;margin:32px 0"/>
<p style="font-size:.8rem;color:#475569;text-align:center">BitsAuto Monitoring Platform &nbsp;·&nbsp; Voice OTP Integration &nbsp;·&nbsp; Confidential</p>
</div>
</body>
</html>`);
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
