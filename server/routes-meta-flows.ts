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
  isFlowTokenVerified,
  consumeFlowTokenVerified,
  handleFlowWebhookPayload,
  rotateToNewKey,
  getKeysForDecryption,
  getKeyRotationStatus,
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

  // ── GET /api/flows/otp/key-rotation-status ────────────────────────────────
  // Returns how much grace-period time remains for the previous private key.
  app.get('/api/flows/otp/key-rotation-status', requireAuth, (req: any, res: any) => {
    res.json(getKeyRotationStatus());
  });

  // ── POST /api/flows/otp/generate-keys ────────────────────────────────────
  // Generates a new RSA 2048-bit key pair. Private key stored in env, public key in DB.
  // The previous key is kept in memory for a grace period so active sessions continue to work.
  // Attempts to auto-persist the private key to Replit Secrets so no manual copy-paste is needed.
  app.post('/api/flows/otp/generate-keys', requireAdmin, async (req: any, res: any) => {
    try {
      const { privateKeyPem, publicKeyPem, fingerprint } = generateRsaKeyPair();

      // Rotate: keeps the old key in a grace-period store, activates the new key immediately.
      rotateToNewKey(privateKeyPem);

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
      const callerUserId = (req.user as any)?.claims?.sub ?? (req.user as any)?.id ?? null;

      // Store session — bind to the requesting operator so poll-verified enforces ownership
      storeOtpSession(flowToken, {
        code:      testOtp,
        expiresAt: Date.now() + 5 * 60_000,
        messageId: 0,
        toNumber:  to,
        userId:    callerUserId,
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
  // During key rotation, the webhook tries the new key first, then any grace-period keys.
  app.post('/api/flows/otp/webhook', async (req: any, res: any) => {
    const availableKeys = getKeysForDecryption();

    if (availableKeys.length === 0) {
      console.error('[meta-flows] No RSA private key available — cannot process webhook');
      return res.status(500).json({ error: 'RSA private key not configured' });
    }

    let aesKey: Buffer | null = null;
    let iv:     Buffer | null = null;
    let usedKey: string | null = null;

    try {
      const body = req.body as EncryptedFlowBody;

      if (!body.encrypted_flow_data || !body.encrypted_aes_key || !body.initial_vector) {
        return res.status(400).json({ error: 'Missing encrypted payload fields' });
      }

      iv = Buffer.from(body.initial_vector, 'base64');

      // Try each key in order (newest first, then grace-period fallbacks)
      for (let i = 0; i < availableKeys.length; i++) {
        try {
          aesKey  = extractAesKey(body.encrypted_aes_key, availableKeys[i]);
          usedKey = availableKeys[i];
          if (i > 0) {
            console.log(`[meta-flows] webhook — decrypted with grace-period key (index ${i})`);
          }
          break;
        } catch {
          if (i === availableKeys.length - 1) {
            throw new Error('RSA decryption failed with all available keys — key mismatch');
          }
        }
      }

      if (!usedKey || !aesKey) {
        throw new Error('No key succeeded for RSA decryption');
      }

      // Decrypt the payload using the key that successfully decrypted the AES key
      const payload   = decryptFlowPayload(body, usedKey);
      const flowToken = payload.flow_token;
      console.log(`[meta-flows] webhook — screen=${payload.screen} action=${payload.action} token=${flowToken?.slice(0, 8)}...`);

      const result = handleFlowWebhookPayload(payload);

      // ── Handle each outcome ──────────────────────────────────────────────

      if (result.action === 'ping') {
        const encrypted = encryptFlowResponse({ data: { status: 'active' } }, aesKey, iv);
        return res.json({ encrypted_flow_data: encrypted });
      }

      // Base DLR fields (some may be null for unknown/ping paths)
      const dlrBase = {
        messageId:  result.messageId ? String(result.messageId) : null,
        clientRef:  flowToken,
        msisdn:     result.toNumber ?? null,
        operator:   'meta_cloud_api',
        rawPayload: { screen: payload.screen, action: payload.action } as any,
      };

      if (result.action === 'expired') {
        await db.insert(smsDlrEvents).values({
          ...dlrBase, status: 4, statusText: 'expired', errorCode: 'SESSION_EXPIRED',
        }).catch(() => {});
        const encrypted = encryptFlowResponse({
          screen: 'VERIFY',
          data:   { error_message: 'Session expired. Please request a new code.' },
        }, aesKey, iv);
        return res.json({ encrypted_flow_data: encrypted });
      }

      if (result.action === 'invalid_code') {
        await db.insert(smsDlrEvents).values({
          ...dlrBase, status: 1, statusText: 'failed', errorCode: 'INVALID_CODE',
        }).catch(() => {});
        const encrypted = encryptFlowResponse({
          screen: 'VERIFY',
          data:   { error_message: 'Invalid code. Please try again.' },
        }, aesKey, iv);
        return res.json({ encrypted_flow_data: encrypted });
      }

      if (result.action === 'locked_out') {
        await db.insert(smsDlrEvents).values({
          ...dlrBase, status: 1, statusText: 'locked_out', errorCode: 'MAX_ATTEMPTS_EXCEEDED',
        }).catch(() => {});
        console.warn(`[meta-flows] OTP locked out for ${result.toNumber} after max attempts (token ${flowToken?.slice(0, 8)}...)`);
        const encrypted = encryptFlowResponse({
          screen: 'VERIFY',
          data:   { error_message: 'Too many incorrect attempts. Please request a new code.' },
        }, aesKey, iv);
        return res.json({ encrypted_flow_data: encrypted });
      }

      if (result.action === 'verified') {
        // ✅ Correct code — write DLR delivered event and update the message row
        await db.insert(smsDlrEvents).values({
          ...dlrBase, status: 0, statusText: 'delivered',
        }).catch(() => {});

        if (result.messageId && result.messageId > 0) {
          // Stamp both status='delivered' and verified_at as the explicit auth artifact
          await db.update(smsMessages)
            .set({ status: 'delivered', updatedAt: new Date(), verifiedAt: new Date() } as any)
            .where(eq(smsMessages.id, result.messageId))
            .catch((dbErr: any) => console.error('[meta-flows] DB update failed:', dbErr.message));
        }

        console.log(`[meta-flows] OTP verified for ${result.toNumber}${result.userId ? ` (user: ${result.userId})` : ''} (token ${flowToken?.slice(0, 8)}...)`);
        const encrypted = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
        return res.json({ encrypted_flow_data: encrypted });
      }

      // Unknown screen/action — return a terminal screen so the Flow closes cleanly
      const encrypted = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
      return res.json({ encrypted_flow_data: encrypted });

    } catch (err: any) {
      console.error('[meta-flows] webhook error:', err.message);
      if (aesKey && iv) {
        try {
          const encrypted = encryptFlowResponse({
            screen: 'VERIFY',
            data:   { error_message: 'Server error. Please try again.' },
          }, aesKey, iv);
          return res.json({ encrypted_flow_data: encrypted });
        } catch { /* fall through */ }
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/flows/otp/poll-verified ──────────────────────────────────────
  // Lets the Bitsauto frontend (or any server-side auth gate) check whether a
  // given flow_token was successfully verified by the user in WhatsApp.
  //
  // This is a ONE-SHOT endpoint: on the first confirmed verification the record
  // is consumed (deleted) so the frontend can complete the login and redirect.
  // Unverified polls return { verified: false } without side-effects.
  //
  // Ownership rules:
  //   • Admin can poll any token.
  //   • Non-admin callers may only poll tokens that were bound to their own userId
  //     at session creation time. Tokens with userId=null (externally initiated by
  //     REVE/Sippy) are admin-only because no operator owns them.
  app.get('/api/flows/otp/poll-verified', requireAuth, async (req: any, res: any) => {
    const flowToken = String(req.query.token ?? '').trim();
    if (!flowToken) return res.status(400).json({ error: 'token query param is required' });

    const callerUserId = (req.user as any)?.claims?.sub ?? (req.user as any)?.id ?? null;
    const callerRole   = (req.user as any)?.role ?? '';
    const isAdmin      = callerRole === 'admin';

    // Peek without consuming first — enforce ownership before we remove the record
    const peeked = isFlowTokenVerified(flowToken);
    if (!peeked) {
      return res.json({ verified: false });
    }

    // Enforce ownership: non-admin callers can only see their own sessions
    if (!isAdmin) {
      if (!peeked.userId || peeked.userId !== callerUserId) {
        return res.status(403).json({ error: 'Forbidden: token not owned by caller' });
      }
    }

    // Ownership confirmed — consume the record (one-shot login gate)
    const record = consumeFlowTokenVerified(flowToken);
    if (!record) {
      // Raced with another consumer — treat as not yet verified
      return res.json({ verified: false });
    }

    res.json({
      verified:   true,
      toNumber:   record.toNumber,
      userId:     record.userId,
      messageId:  record.messageId,
      verifiedAt: record.verifiedAt,
    });
  });
}
