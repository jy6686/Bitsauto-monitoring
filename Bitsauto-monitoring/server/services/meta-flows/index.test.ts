/**
 * Unit tests for Meta Flows service helpers.
 *
 * Covers:
 *   - RSA key generation and fingerprinting
 *   - encrypt/decrypt round-trips (RSA+AES-128-GCM)
 *   - OTP session store / lookup / delete
 *   - handleFlowWebhookPayload(): ping, unknown, expired, correct code,
 *     wrong-code attempt counting, lockout after MAX_ATTEMPTS (3)
 *   - isFlowTokenVerified / consumeFlowTokenVerified lifecycle
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateRsaKeyPair,
  computePublicKeyFingerprint,
  decryptFlowPayload,
  encryptFlowResponse,
  extractAesKey,
  storeOtpSession,
  lookupOtpSession,
  deleteOtpSession,
  handleFlowWebhookPayload,
  isFlowTokenVerified,
  consumeFlowTokenVerified,
  type EncryptedFlowBody,
  type DecryptedFlowPayload,
} from './index.js';
import {
  publicEncrypt,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  constants,
} from 'crypto';

// ── Helpers to produce a Meta-style encrypted payload ────────────────────────

function buildEncryptedPayload(
  publicKeyPem: string,
  payload: DecryptedFlowPayload,
): { body: EncryptedFlowBody; aesKey: Buffer; iv: Buffer } {
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

function makePayload(overrides: Partial<DecryptedFlowPayload> = {}): DecryptedFlowPayload {
  return {
    screen:     'VERIFY',
    action:     'data_exchange',
    flow_token: randomUUID(),
    version:    '3.1',
    data:       { otp_code: '123456' },
    ...overrides,
  };
}

function freshSession(code = '123456', userId: string | null = null) {
  return {
    code,
    expiresAt: Date.now() + 5 * 60_000,
    messageId: 42,
    toNumber:  '+15550001234',
    userId,
  };
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

describe('generateRsaKeyPair', () => {
  it('returns a private key, public key, and fingerprint', () => {
    const { privateKeyPem, publicKeyPem, fingerprint } = generateRsaKeyPair();
    expect(privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(fingerprint).toMatch(/^[0-9A-F]{16}$/);
  });
});

describe('computePublicKeyFingerprint', () => {
  it('produces a stable 16-char uppercase hex string for the same key', () => {
    const { publicKeyPem } = generateRsaKeyPair();
    const fp1 = computePublicKeyFingerprint(publicKeyPem);
    const fp2 = computePublicKeyFingerprint(publicKeyPem);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
    expect(fp1).toMatch(/^[0-9A-F]+$/);
  });

  it('produces different fingerprints for different keys', () => {
    const kp1 = generateRsaKeyPair();
    const kp2 = generateRsaKeyPair();
    expect(kp1.fingerprint).not.toBe(kp2.fingerprint);
  });
});

describe('decryptFlowPayload', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(() => {
    ({ privateKeyPem, publicKeyPem } = generateRsaKeyPair());
  });

  it('round-trips a standard OTP submission payload', () => {
    const original: DecryptedFlowPayload = {
      screen:     'VERIFY',
      action:     'data_exchange',
      flow_token: 'test-token-abc',
      version:    '3.1',
      data:       { otp_code: '123456' },
    };

    const { body } = buildEncryptedPayload(publicKeyPem, original);
    const result   = decryptFlowPayload(body, privateKeyPem);

    expect(result.screen).toBe('VERIFY');
    expect(result.action).toBe('data_exchange');
    expect(result.flow_token).toBe('test-token-abc');
    expect(result.data?.otp_code).toBe('123456');
  });

  it('round-trips a ping action payload', () => {
    const original: DecryptedFlowPayload = {
      screen:     '',
      action:     'ping',
      flow_token: 'ping-token',
      version:    '3.1',
      data:       {},
    };

    const { body } = buildEncryptedPayload(publicKeyPem, original);
    const result   = decryptFlowPayload(body, privateKeyPem);

    expect(result.action).toBe('ping');
  });

  it('throws when the AES key is tampered with', () => {
    const original: DecryptedFlowPayload = {
      screen: 'VERIFY', action: 'data_exchange', flow_token: 'x', version: '3', data: {},
    };
    const { body } = buildEncryptedPayload(publicKeyPem, original);

    const badAesKey = Buffer.from(body.encrypted_aes_key, 'base64');
    badAesKey[0] ^= 0xff;
    const badBody = { ...body, encrypted_aes_key: badAesKey.toString('base64') };

    expect(() => decryptFlowPayload(badBody, privateKeyPem)).toThrow();
  });

  it('throws when the ciphertext auth tag is tampered with', () => {
    const original: DecryptedFlowPayload = {
      screen: 'VERIFY', action: 'data_exchange', flow_token: 'x', version: '3', data: {},
    };
    const { body } = buildEncryptedPayload(publicKeyPem, original);

    const badData = Buffer.from(body.encrypted_flow_data, 'base64');
    badData[badData.length - 1] ^= 0xff;
    const badBody = { ...body, encrypted_flow_data: badData.toString('base64') };

    expect(() => decryptFlowPayload(badBody, privateKeyPem)).toThrow();
  });
});

describe('extractAesKey', () => {
  it('extracts the same AES key that was used for encryption', () => {
    const { privateKeyPem, publicKeyPem } = generateRsaKeyPair();
    const original: DecryptedFlowPayload = {
      screen: 'VERIFY', action: 'data_exchange', flow_token: 'tk', version: '3', data: {},
    };
    const { body, aesKey } = buildEncryptedPayload(publicKeyPem, original);
    const extracted = extractAesKey(body.encrypted_aes_key, privateKeyPem);
    expect(extracted).toEqual(aesKey);
  });
});

describe('encryptFlowResponse', () => {
  it('produces a non-empty base64 string', () => {
    const aesKey = randomBytes(16);
    const iv     = randomBytes(12);
    const result = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
  });

  it('is deterministic for the same key/iv/plaintext', () => {
    const aesKey = randomBytes(16);
    const iv     = randomBytes(12);
    const r1 = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
    const r2 = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
    expect(r1).toBe(r2);
  });

  it('can be decrypted back with the flipped IV', () => {
    const aesKey  = randomBytes(16);
    const iv      = randomBytes(12);
    const payload = { screen: 'SUCCESS', data: { verified: true } };

    const encrypted = encryptFlowResponse(payload, aesKey, iv);
    const raw       = Buffer.from(encrypted, 'base64');

    const responseIv = Buffer.alloc(iv.length);
    for (let i = 0; i < iv.length; i++) responseIv[i] = ~iv[i] & 0xff;

    const authTag    = raw.slice(-16);
    const ciphertext = raw.slice(0, -16);

    const decipher = createDecipheriv('aes-128-gcm', aesKey, responseIv);
    decipher.setAuthTag(authTag);
    const plain   = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const decoded = JSON.parse(plain.toString('utf-8'));

    expect(decoded.screen).toBe('SUCCESS');
    expect(decoded.data?.verified).toBe(true);
  });
});

// ── OTP session management ────────────────────────────────────────────────────

describe('OTP session management', () => {
  it('stores and retrieves a session by flow_token', () => {
    const token   = 'session-test-token-' + Date.now();
    const session = { code: '999888', expiresAt: Date.now() + 60_000, messageId: 42, toNumber: '+1234567890' };

    storeOtpSession(token, session);
    const found = lookupOtpSession(token);

    expect(found).not.toBeNull();
    expect(found?.code).toBe('999888');
    expect(found?.toNumber).toBe('+1234567890');
  });

  it('returns null for an unknown token', () => {
    expect(lookupOtpSession('nonexistent-token-xyz')).toBeNull();
  });

  it('returns null for an expired session', () => {
    const token = 'expired-token-' + Date.now();
    storeOtpSession(token, {
      code:      '111222',
      expiresAt: Date.now() - 1,
      messageId: 0,
      toNumber:  '+0',
    });
    expect(lookupOtpSession(token)).toBeNull();
  });

  it('deletes a session', () => {
    const token = 'delete-test-' + Date.now();
    storeOtpSession(token, { code: '000000', expiresAt: Date.now() + 60_000, messageId: 0, toNumber: '+0' });
    deleteOtpSession(token);
    expect(lookupOtpSession(token)).toBeNull();
  });
});

// ── handleFlowWebhookPayload ──────────────────────────────────────────────────

describe('handleFlowWebhookPayload', () => {
  it('ping action returns action=ping without touching sessions', () => {
    const payload = makePayload({ action: 'ping', screen: 'VERIFY' });
    expect(handleFlowWebhookPayload(payload).action).toBe('ping');
  });

  it('unknown screen returns action=unknown', () => {
    const payload = makePayload({ screen: 'UNKNOWN_SCREEN', action: 'data_exchange' });
    expect(handleFlowWebhookPayload(payload).action).toBe('unknown');
  });

  it('missing flow_token (no session) returns action=expired with SESSION_EXPIRED', () => {
    const payload = makePayload({ flow_token: randomUUID() });
    const result  = handleFlowWebhookPayload(payload);
    expect(result.action).toBe('expired');
    expect(result.errorCode).toBe('SESSION_EXPIRED');
  });

  it('expired session (past expiresAt) returns action=expired', () => {
    const token = randomUUID();
    storeOtpSession(token, { ...freshSession(), expiresAt: Date.now() - 1 });
    expect(handleFlowWebhookPayload(makePayload({ flow_token: token })).action).toBe('expired');
  });

  it('correct code returns action=verified with toNumber, messageId, userId', () => {
    const token = randomUUID();
    storeOtpSession(token, freshSession('999888', 'user-abc'));
    const result = handleFlowWebhookPayload(makePayload({ flow_token: token, data: { otp_code: '999888' } }));
    expect(result.action).toBe('verified');
    expect(result.toNumber).toBe('+15550001234');
    expect(result.messageId).toBe(42);
    expect(result.userId).toBe('user-abc');
  });

  it('verified token appears in isFlowTokenVerified registry', () => {
    const token = randomUUID();
    storeOtpSession(token, freshSession('777666'));
    handleFlowWebhookPayload(makePayload({ flow_token: token, data: { otp_code: '777666' } }));
    const rec = isFlowTokenVerified(token);
    expect(rec).not.toBeNull();
    expect(rec?.toNumber).toBe('+15550001234');
    expect(rec?.verifiedAt).toBeGreaterThan(0);
  });

  it('wrong code returns action=invalid_code but keeps session alive for retry', () => {
    const token = randomUUID();
    storeOtpSession(token, freshSession('111222'));
    const bad  = makePayload({ flow_token: token, data: { otp_code: '000000' } });
    const r1   = handleFlowWebhookPayload(bad);
    expect(r1.action).toBe('invalid_code');
    expect(r1.errorCode).toBe('INVALID_CODE');
    // Session still alive — correct code should now work
    const good = handleFlowWebhookPayload({ ...bad, data: { otp_code: '111222' } });
    expect(good.action).toBe('verified');
  });

  it('locks out after 3 wrong attempts (MAX_OTP_ATTEMPTS)', () => {
    const token = randomUUID();
    storeOtpSession(token, freshSession('ABCDEF'));
    const bad = makePayload({ flow_token: token, data: { otp_code: '000000' } });

    expect(handleFlowWebhookPayload(bad).action).toBe('invalid_code');
    expect(handleFlowWebhookPayload(bad).action).toBe('invalid_code');
    const r3 = handleFlowWebhookPayload(bad);
    expect(r3.action).toBe('locked_out');
    expect(r3.errorCode).toBe('MAX_ATTEMPTS_EXCEEDED');

    // After lockout even the correct code returns expired (session deleted)
    const good = makePayload({ flow_token: token, data: { otp_code: 'ABCDEF' } });
    expect(handleFlowWebhookPayload(good).action).toBe('expired');
  });

  it('consumeFlowTokenVerified is one-shot — second call returns null', () => {
    const token = randomUUID();
    storeOtpSession(token, freshSession('ONESHOT'));
    handleFlowWebhookPayload(makePayload({ flow_token: token, data: { otp_code: 'ONESHOT' } }));
    const first  = consumeFlowTokenVerified(token);
    const second = consumeFlowTokenVerified(token);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
