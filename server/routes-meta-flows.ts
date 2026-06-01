/**
 * Meta WhatsApp Flows — API Routes
 * Registered by server/routes.ts via registerMetaFlowsRoutes(app)
 *
 * Endpoints:
 *   POST /api/flows/otp/webhook       — Meta calls this on every Flow interaction (encrypted)
 *   GET  /api/flows/otp/health-check  — Meta health-check ping
 *   GET  /api/flows/otp/public-key    — Returns the RSA public key for registration with Meta
 *   POST /api/flows/otp/provision     — Operator UI: provision/create the OTP Flow on Meta
 *   POST /api/flows/otp/generate-keys — Operator UI: generate a new RSA key pair
 *   POST /api/flows/otp/test          — Operator UI: send a test Flow message
 */

import type { Express } from 'express';
import { randomUUID } from 'crypto';
import { storage } from './storage';
import { db } from './db';
import { smsMessages, smsDlrEvents } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  decryptFlowPayload,
  encryptFlowResponse,
  extractAesKey,
  generateRsaKeyPair,
  computePublicKeyFingerprint,
  provisionOtpFlow,
  sendOtpFlow,
  storeOtpSession,
  lookupOtpSession,
  deleteOtpSession,
  type EncryptedFlowBody,
} from './services/meta-flows/index';

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Unauthorized' });
  const role = (req.user as any)?.role ?? '';
  if (role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

export function registerMetaFlowsRoutes(app: Express) {

  // ── GET /api/flows/otp/health-check ──────────────────────────────────────
  // Meta calls this to verify the endpoint is live. Must return encrypted response.
  app.get('/api/flows/otp/health-check', async (req: any, res: any) => {
    try {
      const privateKeyPem = process.env.FLOWS_RSA_PRIVATE_KEY;
      if (!privateKeyPem) {
        return res.json({ data: { status: 'active' } });
      }
      // Return plaintext for health-check (Meta accepts both)
      res.json({ data: { status: 'active' } });
    } catch (err: any) {
      res.json({ data: { status: 'active' } });
    }
  });

  // ── GET /api/flows/otp/public-key ─────────────────────────────────────────
  // Returns the RSA public key for registration with Meta.
  app.get('/api/flows/otp/public-key', requireAuth, async (req: any, res: any) => {
    try {
      const settings = await storage.getSettings() as any;
      const publicKey = settings.metaFlowsPublicKey ?? null;
      const fingerprint = publicKey ? computePublicKeyFingerprint(publicKey) : null;
      res.json({
        publicKey,
        fingerprint,
        hasPrivateKey: !!process.env.FLOWS_RSA_PRIVATE_KEY,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/flows/otp/generate-keys ────────────────────────────────────
  // Generates a new RSA 2048-bit key pair. Private key stored in env, public key in DB.
  // Attempts to auto-persist the private key to Replit Secrets so no manual copy-paste is needed.
  app.post('/api/flows/otp/generate-keys', requireAdmin, async (req: any, res: any) => {
    try {
      const { privateKeyPem, publicKeyPem, fingerprint } = generateRsaKeyPair();

      // Activate the key in the current process immediately — no restart required for this session.
      process.env.FLOWS_RSA_PRIVATE_KEY = privateKeyPem;

      // Store public key in DB settings.
      await storage.updateSettings({ metaFlowsPublicKey: publicKeyPem } as any);

      // Attempt to persist the private key as a Replit Secret so it survives server restarts.
      let secretStored = false;
      try {
        const replId     = process.env.REPL_ID;
        const replitToken = process.env.REPLIT_TOKEN;
        if (replId && replitToken) {
          const apiRes = await fetch(
            `https://replit.com/api/v1/repls/${encodeURIComponent(replId)}/secrets`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${replitToken}`,
                'Content-Type':  'application/json',
              },
              body: JSON.stringify({ key: 'FLOWS_RSA_PRIVATE_KEY', value: privateKeyPem }),
            },
          );
          secretStored = apiRes.ok;
          if (!apiRes.ok) {
            const text = await apiRes.text().catch(() => '');
            console.warn(`[meta-flows] Replit Secrets API ${apiRes.status}: ${text}`);
          } else {
            console.log('[meta-flows] FLOWS_RSA_PRIVATE_KEY auto-stored in Replit Secrets');
          }
        } else {
          console.warn('[meta-flows] REPL_ID or REPLIT_TOKEN not available — skipping auto-secret storage');
        }
      } catch (apiErr: any) {
        console.warn('[meta-flows] Could not auto-store private key in Replit Secrets:', apiErr.message);
      }

      res.json({
        ok:             true,
        publicKey:      publicKeyPem,
        privateKey:     privateKeyPem,   // always returned so operator can manually store if needed
        fingerprint,
        secretStored,
        secretActiveNow: true,
        instruction: secretStored
          ? 'Key generated and stored as a Replit Secret — restart the server to re-activate after the next deploy.'
          : 'Key is active for this session. Add FLOWS_RSA_PRIVATE_KEY to Replit Secrets to persist after restart.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/flows/otp/provision ────────────────────────────────────────
  // Creates the OTP Flow on Meta, registers the public key, and publishes it.
  app.post('/api/flows/otp/provision', requireAdmin, async (req: any, res: any) => {
    try {
      const settings = await storage.getSettings() as any;
      const wabaId      = req.body.wabaId     ?? settings.metaWabaId;
      const accessToken = settings.metaAccessToken;
      const publicKey   = settings.metaFlowsPublicKey;

      if (!wabaId || !accessToken || !publicKey) {
        return res.status(400).json({
          error: 'Missing required settings: WABA ID, Access Token, and RSA public key must all be configured first.',
        });
      }

      const origin = `${req.protocol}://${req.get('host')}`;
      const webhookUrl = `${origin}/api/flows/otp/webhook`;

      const { flowId, error } = await provisionOtpFlow(wabaId, accessToken, webhookUrl, publicKey);
      if (error) {
        return res.status(400).json({ error });
      }

      await storage.updateSettings({ metaFlowId: flowId } as any);
      res.json({ ok: true, flowId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/flows/otp/test ──────────────────────────────────────────────
  // Sends a test Flow OTP to a given phone number.
  app.post('/api/flows/otp/test', requireAuth, async (req: any, res: any) => {
    try {
      const settings = await storage.getSettings() as any;
      const { to } = req.body;
      if (!to) return res.status(400).json({ error: 'to is required' });

      const phoneNumberId = settings.metaPhoneNumberId;
      const accessToken   = settings.metaAccessToken;
      const flowId        = settings.metaFlowId;

      if (!phoneNumberId || !accessToken || !flowId) {
        return res.status(400).json({ error: 'Meta Cloud API not fully configured (phone number ID, access token, and flow ID are required).' });
      }

      const flowToken = randomUUID();
      const testOtp   = '123456';

      // Store session
      storeOtpSession(flowToken, {
        code:      testOtp,
        expiresAt: Date.now() + 5 * 60_000,
        messageId: 0,
        toNumber:  to,
      });

      const result = await sendOtpFlow(phoneNumberId, accessToken, flowId, to, flowToken);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ ok: true, messageId: result.messageId, testOtp, note: 'Test OTP is 123456' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/flows/otp/webhook ───────────────────────────────────────────
  // Meta calls this endpoint for every Flow interaction (data_exchange action).
  // Payload is end-to-end encrypted using RSA + AES-128-GCM.
  app.post('/api/flows/otp/webhook', async (req: any, res: any) => {
    const privateKeyPem = process.env.FLOWS_RSA_PRIVATE_KEY;

    if (!privateKeyPem) {
      console.error('[meta-flows] FLOWS_RSA_PRIVATE_KEY env not set — cannot process webhook');
      return res.status(500).json({ error: 'RSA private key not configured' });
    }

    let aesKey: Buffer | null = null;
    let iv:     Buffer | null = null;

    try {
      const body = req.body as EncryptedFlowBody;

      if (!body.encrypted_flow_data || !body.encrypted_aes_key || !body.initial_vector) {
        return res.status(400).json({ error: 'Missing encrypted payload fields' });
      }

      // Extract AES key for response encryption (done before decryption to reuse)
      aesKey = extractAesKey(body.encrypted_aes_key, privateKeyPem);
      iv     = Buffer.from(body.initial_vector, 'base64');

      // Decrypt the payload
      const payload = decryptFlowPayload(body, privateKeyPem);
      console.log(`[meta-flows] webhook — screen=${payload.screen} action=${payload.action} token=${payload.flow_token?.slice(0, 8)}...`);

      // Handle health-check ping from Meta (sent as a decrypted action)
      if (payload.action === 'ping') {
        const responseData = { data: { status: 'active' } };
        const encrypted    = encryptFlowResponse(responseData, aesKey, iv);
        return res.json({ encrypted_flow_data: encrypted });
      }

      // Handle OTP submission
      if (payload.screen === 'VERIFY' && payload.action === 'data_exchange') {
        const submittedCode = String(payload.data?.otp_code ?? '').trim();
        const flowToken     = payload.flow_token;

        const session = lookupOtpSession(flowToken);

        // Log the submission attempt as a DLR event
        const dlrBase = {
          messageId:  session?.messageId ? String(session.messageId) : null,
          clientRef:  flowToken,
          msisdn:     session?.toNumber ?? null,
          operator:   'meta_cloud_api',
          rawPayload: { screen: payload.screen, action: payload.action } as any,
        };

        if (!session) {
          // Session expired or not found
          await db.insert(smsDlrEvents).values({ ...dlrBase, status: 4, statusText: 'expired', errorCode: 'SESSION_EXPIRED' }).catch(() => {});
          const responseData = {
            screen: 'VERIFY',
            data: { error_message: 'Session expired. Please request a new code.' },
          };
          const encrypted = encryptFlowResponse(responseData, aesKey, iv);
          return res.json({ encrypted_flow_data: encrypted });
        }

        // Log that the Flow OTP screen was opened/submitted
        await db.insert(smsDlrEvents).values({ ...dlrBase, status: 2, statusText: 'submitted' }).catch(() => {});

        if (submittedCode !== session.code) {
          // Wrong code — keep session alive for retry; log failed attempt
          await db.insert(smsDlrEvents).values({ ...dlrBase, status: 1, statusText: 'failed', errorCode: 'INVALID_CODE' }).catch(() => {});
          const responseData = {
            screen: 'VERIFY',
            data: { error_message: 'Invalid code. Please try again.' },
          };
          const encrypted = encryptFlowResponse(responseData, aesKey, iv);
          return res.json({ encrypted_flow_data: encrypted });
        }

        // ✅ Code is correct — mark as delivered and clear session
        deleteOtpSession(flowToken);
        await db.insert(smsDlrEvents).values({ ...dlrBase, status: 0, statusText: 'delivered' }).catch(() => {});

        if (session.messageId > 0) {
          try {
            await db.update(smsMessages)
              .set({ status: 'delivered', updatedAt: new Date() })
              .where(eq(smsMessages.id, session.messageId));
          } catch (dbErr: any) {
            console.error('[meta-flows] DB update failed:', dbErr.message);
          }
        }

        const responseData = { screen: 'SUCCESS' };
        const encrypted    = encryptFlowResponse(responseData, aesKey, iv);
        console.log(`[meta-flows] OTP verified for ${session.toNumber} (token ${flowToken.slice(0, 8)}...)`);
        return res.json({ encrypted_flow_data: encrypted });
      }

      // Unknown action — return a generic success screen
      const responseData = { screen: 'SUCCESS' };
      const encrypted    = encryptFlowResponse(responseData, aesKey, iv);
      return res.json({ encrypted_flow_data: encrypted });

    } catch (err: any) {
      console.error('[meta-flows] webhook error:', err.message);
      // If we have the AES key, return an encrypted error response so Meta doesn't retry
      if (aesKey && iv) {
        try {
          const responseData = {
            screen: 'VERIFY',
            data: { error_message: 'Server error. Please try again.' },
          };
          const encrypted = encryptFlowResponse(responseData, aesKey, iv);
          return res.json({ encrypted_flow_data: encrypted });
        } catch { /* fall through */ }
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}
