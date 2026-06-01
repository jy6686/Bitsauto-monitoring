/**
 * Meta WhatsApp Flows — OTP Verification Service
 *
 * Handles RSA key generation, Flow provisioning, OTP dispatch via
 * interactive Flow messages, and end-to-end encrypted webhook processing.
 * Uses only Node.js built-in crypto — no extra packages required.
 */

import { createDecipheriv, createCipheriv, generateKeyPairSync, privateDecrypt, constants, createHash } from 'crypto';

// ── Types ───────────────────────────────────────────────────────────────────

export interface MetaFlowSettings {
  metaPhoneNumberId: string;
  metaAccessToken:   string;
  metaFlowId:        string;
}

export interface EncryptedFlowBody {
  encrypted_flow_data: string;
  encrypted_aes_key:   string;
  initial_vector:      string;
}

export interface DecryptedFlowPayload {
  screen:     string;
  data:       Record<string, any>;
  flow_token: string;
  version:    string;
  action:     string;
}

// ── In-memory OTP session map ────────────────────────────────────────────────
// Keyed by flow_token (UUID generated per dispatch). TTL = 5 minutes.

interface OtpSession {
  code:      string;
  expiresAt: number;
  messageId: number;
  toNumber:  string;
}

const otpSessions = new Map<string, OtpSession>();

// Clean expired sessions every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of otpSessions) {
    if (session.expiresAt < now) otpSessions.delete(token);
  }
}, 2 * 60_000);

export function storeOtpSession(flowToken: string, session: OtpSession): void {
  otpSessions.set(flowToken, session);
}

export function lookupOtpSession(flowToken: string): OtpSession | null {
  const session = otpSessions.get(flowToken);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    otpSessions.delete(flowToken);
    return null;
  }
  return session;
}

export function deleteOtpSession(flowToken: string): void {
  otpSessions.delete(flowToken);
}

// ── RSA Key Generation ───────────────────────────────────────────────────────

export function generateRsaKeyPair(): { privateKeyPem: string; publicKeyPem: string; fingerprint: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fingerprint = computePublicKeyFingerprint(publicKey as string);
  return { privateKeyPem: privateKey as string, publicKeyPem: publicKey as string, fingerprint };
}

export function computePublicKeyFingerprint(publicKeyPem: string): string {
  const body = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  const der = Buffer.from(body, 'base64');
  return createHash('sha256').update(der).digest('hex').slice(0, 16).toUpperCase();
}

// ── Encryption / Decryption ──────────────────────────────────────────────────

/**
 * Decrypts an incoming Meta Flow webhook payload.
 * Meta sends: encrypted_aes_key (RSA-OAEP encrypted) + encrypted_flow_data (AES-128-GCM) + initial_vector
 */
export function decryptFlowPayload(body: EncryptedFlowBody, privateKeyPem: string): DecryptedFlowPayload {
  const encryptedAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
  const encryptedData   = Buffer.from(body.encrypted_flow_data, 'base64');
  const iv              = Buffer.from(body.initial_vector, 'base64');

  // Decrypt AES key using RSA-OAEP (SHA-256)
  const aesKey = privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    encryptedAesKey,
  );

  // AES-128-GCM: last 16 bytes of ciphertext are the auth tag
  const authTag    = encryptedData.slice(-16);
  const ciphertext = encryptedData.slice(0, -16);

  const decipher = createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

/**
 * Encrypts a response to send back to Meta after processing a Flow action.
 * Uses the same AES key extracted during decryption, with a flipped IV.
 */
export function encryptFlowResponse(
  data:   Record<string, any>,
  aesKey: Buffer,
  iv:     Buffer,
): string {
  // Flip all bits of the IV for the response
  const responseIv = Buffer.alloc(iv.length);
  for (let i = 0; i < iv.length; i++) responseIv[i] = ~iv[i] & 0xff;

  const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
  const cipher    = createCipheriv('aes-128-gcm', aesKey, responseIv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return Buffer.concat([encrypted, authTag]).toString('base64');
}

/**
 * Decrypts the AES key from an encrypted payload (used to get the key for response encryption).
 */
export function extractAesKey(encryptedAesKeyB64: string, privateKeyPem: string): Buffer {
  const encryptedAesKey = Buffer.from(encryptedAesKeyB64, 'base64');
  return privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    encryptedAesKey,
  );
}

// ── Flow Provisioning ────────────────────────────────────────────────────────

const OTP_FLOW_JSON = {
  version: '3.1',
  screens: [
    {
      id: 'VERIFY',
      title: 'Verify Your Identity',
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Enter your code' },
          { type: 'TextBody', text: 'A 6-digit code was sent to your account. Enter it below.' },
          {
            type: 'TextInput',
            label: 'Verification Code',
            name: 'otp_code',
            'input-type': 'number',
            required: true,
            'helper-text': '6-digit code',
          },
          {
            type: 'Footer',
            label: 'Verify',
            'on-click-action': {
              name: 'data_exchange',
              payload: { otp_code: '${form.otp_code}' },
            },
          },
        ],
      },
    },
    {
      id: 'SUCCESS',
      title: 'Verified',
      terminal: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Identity Confirmed' },
          { type: 'TextBody', text: 'Your verification was successful.' },
        ],
      },
    },
  ],
};

/**
 * Creates a new WhatsApp Flow via the Meta Flows API.
 * Returns the flow_id of the newly created flow.
 */
export async function provisionOtpFlow(
  wabaId:      string,
  accessToken: string,
  webhookUrl:  string,
  publicKeyPem: string,
): Promise<{ flowId: string; error?: string }> {
  try {
    // Step 1: Create the Flow
    const createRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/flows`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name:       'BitsAuto OTP Verification',
        categories: ['AUTHENTICATION'],
        endpoint_uri: webhookUrl,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const createData = await createRes.json() as any;
    if (!createRes.ok || !createData.id) {
      return { flowId: '', error: `Flow create failed: ${createData.error?.message ?? JSON.stringify(createData)}` };
    }
    const flowId = createData.id as string;

    // Step 2: Upload the Flow JSON
    const jsonStr = JSON.stringify(OTP_FLOW_JSON);
    const formData = new FormData();
    formData.append('name', 'flow.json');
    formData.append('asset_type', 'FLOW_JSON');
    formData.append('file', new Blob([jsonStr], { type: 'application/json' }), 'flow.json');

    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${flowId}/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      signal: AbortSignal.timeout(20_000),
    });
    const uploadData = await uploadRes.json() as any;
    if (!uploadRes.ok) {
      return { flowId, error: `Flow JSON upload failed: ${uploadData.error?.message ?? JSON.stringify(uploadData)}` };
    }

    // Step 3: Register the public key for encrypted payloads
    const keyRes = await fetch(`https://graph.facebook.com/v21.0/${flowId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ public_key: publicKeyPem }),
      signal: AbortSignal.timeout(20_000),
    });
    const keyData = await keyRes.json() as any;
    if (!keyRes.ok) {
      return { flowId, error: `Public key registration failed: ${keyData.error?.message ?? JSON.stringify(keyData)}` };
    }

    // Step 4: Publish the flow
    const publishRes = await fetch(`https://graph.facebook.com/v21.0/${flowId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const publishData = await publishRes.json() as any;
    if (!publishRes.ok) {
      return { flowId, error: `Flow publish failed: ${publishData.error?.message ?? JSON.stringify(publishData)}` };
    }

    return { flowId };
  } catch (err: any) {
    return { flowId: '', error: err.message ?? String(err) };
  }
}

// ── OTP Flow Dispatch ────────────────────────────────────────────────────────

/**
 * Sends a WhatsApp interactive Flow message to the given phone number.
 * The flow_token is a UUID that links the session to the webhook response.
 */
export async function sendOtpFlow(
  phoneNumberId: string,
  accessToken:   string,
  flowId:        string,
  toNumber:      string,
  flowToken:     string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                toNumber,
        type:              'interactive',
        interactive: {
          type: 'flow',
          header: { type: 'text', text: 'Identity Verification' },
          body: { text: 'Please enter your verification code to continue.' },
          footer: { text: 'Valid for 5 minutes' },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token:           flowToken,
              flow_id:              flowId,
              flow_cta:             'Enter Code',
              flow_action:          'data_exchange',
            },
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      return { success: false, error: `Meta API error ${res.status}: ${data.error?.message ?? JSON.stringify(data)}` };
    }

    const messageId = data.messages?.[0]?.id as string | undefined;
    return { success: true, messageId };
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) };
  }
}
