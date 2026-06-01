/**
 * Integration tests for POST /api/flows/otp/webhook
 *
 * Simulates Meta's RSA+AES-GCM encrypted payload format end-to-end:
 *  1. Generates a real RSA key pair
 *  2. Encrypts a test payload exactly as Meta would
 *  3. POSTs to the Express webhook handler
 *  4. Decrypts + asserts the encrypted response
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  publicEncrypt,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  constants,
} from 'crypto';
import {
  generateRsaKeyPair,
  storeOtpSession,
  deleteOtpSession,
  type DecryptedFlowPayload,
} from './services/meta-flows/index.js';

// ── Mock DB and storage so the webhook doesn't need a real database ──────────

vi.mock('./db.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('./storage.js', () => ({
  storage: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

interface EncryptedBody {
  encrypted_flow_data: string;
  encrypted_aes_key:   string;
  initial_vector:      string;
}

function encryptForMeta(
  publicKeyPem: string,
  payload: DecryptedFlowPayload,
): { body: EncryptedBody; aesKey: Buffer; iv: Buffer } {
  const aesKey = randomBytes(16);
  const iv     = randomBytes(12);

  const encryptedAesKey = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  );

  const plaintext  = Buffer.from(JSON.stringify(payload), 'utf-8');
  const cipher     = createCipheriv('aes-128-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  return {
    body: {
      encrypted_aes_key:   encryptedAesKey.toString('base64'),
      encrypted_flow_data: Buffer.concat([ciphertext, authTag]).toString('base64'),
      initial_vector:      iv.toString('base64'),
    },
    aesKey,
    iv,
  };
}

function decryptResponse(encryptedB64: string, aesKey: Buffer, originalIv: Buffer): any {
  // Response uses bit-flipped IV
  const responseIv = Buffer.alloc(originalIv.length);
  for (let i = 0; i < originalIv.length; i++) responseIv[i] = ~originalIv[i] & 0xff;

  const raw      = Buffer.from(encryptedB64, 'base64');
  const authTag  = raw.slice(-16);
  const cipher   = raw.slice(0, -16);
  const decipher = createDecipheriv('aes-128-gcm', aesKey, responseIv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return JSON.parse(plain.toString('utf-8'));
}

// ── Test setup ───────────────────────────────────────────────────────────────

let app: express.Express;
let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(async () => {
  ({ privateKeyPem, publicKeyPem } = generateRsaKeyPair());

  // Inject the private key into the environment before importing the routes
  process.env.FLOWS_RSA_PRIVATE_KEY = privateKeyPem;

  // Dynamically import routes after env is set so the module captures the key
  const { registerMetaFlowsRoutes } = await import('./routes-meta-flows.js');

  app = express();
  app.use(express.json());
  registerMetaFlowsRoutes(app);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/flows/otp/webhook — missing private key', () => {
  it('returns 500 when FLOWS_RSA_PRIVATE_KEY is not set', async () => {
    // Temporarily remove the key
    const saved = process.env.FLOWS_RSA_PRIVATE_KEY;
    delete process.env.FLOWS_RSA_PRIVATE_KEY;

    const { default: _express } = await import('express');
    const tempApp = _express();
    tempApp.use(_express.json());
    const { registerMetaFlowsRoutes: register } = await import('./routes-meta-flows.js');
    register(tempApp);

    const res = await request(tempApp)
      .post('/api/flows/otp/webhook')
      .send({ encrypted_flow_data: 'x', encrypted_aes_key: 'y', initial_vector: 'z' });

    process.env.FLOWS_RSA_PRIVATE_KEY = saved;

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/RSA private key not configured/i);
  });
});

describe('POST /api/flows/otp/webhook — missing fields', () => {
  it('returns 400 when encrypted fields are absent', async () => {
    const res = await request(app)
      .post('/api/flows/otp/webhook')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing encrypted payload fields/i);
  });
});

describe('POST /api/flows/otp/webhook — ping action', () => {
  it('decrypts the ping and returns an encrypted { data: { status: "active" } }', async () => {
    const payload: DecryptedFlowPayload = {
      screen:     '',
      action:     'ping',
      flow_token: 'ping-token-1',
      version:    '3.1',
      data:       {},
    };

    const { body: encBody, aesKey, iv } = encryptForMeta(publicKeyPem, payload);

    const res = await request(app)
      .post('/api/flows/otp/webhook')
      .send(encBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('encrypted_flow_data');

    const decoded = decryptResponse(res.body.encrypted_flow_data, aesKey, iv);
    expect(decoded).toMatchObject({ data: { status: 'active' } });
  });
});

describe('POST /api/flows/otp/webhook — OTP verification', () => {
  const FLOW_TOKEN = 'integration-test-token-abc';
  const CORRECT_CODE = '654321';

  beforeEach(() => {
    storeOtpSession(FLOW_TOKEN, {
      code:      CORRECT_CODE,
      expiresAt: Date.now() + 5 * 60_000,
      messageId: 0,
      toNumber:  '+15550001234',
    });
  });

  afterEach(() => {
    deleteOtpSession(FLOW_TOKEN);
  });

  it('resolves the session and returns SUCCESS screen for the correct code', async () => {
    const payload: DecryptedFlowPayload = {
      screen:     'VERIFY',
      action:     'data_exchange',
      flow_token: FLOW_TOKEN,
      version:    '3.1',
      data:       { otp_code: CORRECT_CODE },
    };

    const { body: encBody, aesKey, iv } = encryptForMeta(publicKeyPem, payload);

    const res = await request(app)
      .post('/api/flows/otp/webhook')
      .send(encBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('encrypted_flow_data');

    const decoded = decryptResponse(res.body.encrypted_flow_data, aesKey, iv);
    expect(decoded.screen).toBe('SUCCESS');
  });

  it('keeps the session alive and returns an error message for a wrong code', async () => {
    const payload: DecryptedFlowPayload = {
      screen:     'VERIFY',
      action:     'data_exchange',
      flow_token: FLOW_TOKEN,
      version:    '3.1',
      data:       { otp_code: '000000' },  // wrong
    };

    const { body: encBody, aesKey, iv } = encryptForMeta(publicKeyPem, payload);

    const res = await request(app)
      .post('/api/flows/otp/webhook')
      .send(encBody);

    expect(res.status).toBe(200);
    const decoded = decryptResponse(res.body.encrypted_flow_data, aesKey, iv);
    expect(decoded.screen).toBe('VERIFY');
    expect(decoded.data?.error_message).toMatch(/invalid code/i);
  });

  it('returns an expired-session message when the flow_token is unknown', async () => {
    const payload: DecryptedFlowPayload = {
      screen:     'VERIFY',
      action:     'data_exchange',
      flow_token: 'nonexistent-token-xyz',
      version:    '3.1',
      data:       { otp_code: '123456' },
    };

    const { body: encBody, aesKey, iv } = encryptForMeta(publicKeyPem, payload);

    const res = await request(app)
      .post('/api/flows/otp/webhook')
      .send(encBody);

    expect(res.status).toBe(200);
    const decoded = decryptResponse(res.body.encrypted_flow_data, aesKey, iv);
    expect(decoded.screen).toBe('VERIFY');
    expect(decoded.data?.error_message).toMatch(/session expired/i);
  });

  it('clears the session after a successful verification', async () => {
    const singleUseToken = 'single-use-token-' + Date.now();
    storeOtpSession(singleUseToken, {
      code:      '112233',
      expiresAt: Date.now() + 5 * 60_000,
      messageId: 0,
      toNumber:  '+15550001234',
    });

    const payload: DecryptedFlowPayload = {
      screen:     'VERIFY',
      action:     'data_exchange',
      flow_token: singleUseToken,
      version:    '3.1',
      data:       { otp_code: '112233' },
    };

    // First call — should succeed
    const { body: encBody1, aesKey: k1, iv: v1 } = encryptForMeta(publicKeyPem, payload);
    const res1 = await request(app).post('/api/flows/otp/webhook').send(encBody1);
    const decoded1 = decryptResponse(res1.body.encrypted_flow_data, k1, v1);
    expect(decoded1.screen).toBe('SUCCESS');

    // Second call with the same token — session should be gone → expired
    const { body: encBody2, aesKey: k2, iv: v2 } = encryptForMeta(publicKeyPem, payload);
    const res2 = await request(app).post('/api/flows/otp/webhook').send(encBody2);
    const decoded2 = decryptResponse(res2.body.encrypted_flow_data, k2, v2);
    expect(decoded2.screen).toBe('VERIFY');
    expect(decoded2.data?.error_message).toMatch(/session expired/i);
  });
});
