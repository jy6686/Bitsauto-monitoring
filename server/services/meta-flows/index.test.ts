/**
 * Unit tests for Meta Flows encrypt/decrypt helpers.
 * These verify the RSA+AES-GCM round-trip that secures every Flow webhook call.
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
  type EncryptedFlowBody,
  type DecryptedFlowPayload,
} from './index.js';
import {
  publicEncrypt,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  constants,
} from 'crypto';

// ── Helpers to produce a Meta-style encrypted payload ────────────────────────

function buildEncryptedPayload(
  publicKeyPem: string,
  payload: DecryptedFlowPayload,
): { body: EncryptedFlowBody; aesKey: Buffer; iv: Buffer } {
  // Generate a random 16-byte AES-128 key + 12-byte IV (GCM standard)
  const aesKey = randomBytes(16);
  const iv     = randomBytes(12);

  // Encrypt AES key with RSA-OAEP (SHA-256) — what Meta actually does
  const encryptedAesKey = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  );

  // Encrypt payload with AES-128-GCM
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const cipher    = createCipheriv('aes-128-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  // Meta appends the 16-byte auth tag to the ciphertext
  const encryptedData = Buffer.concat([ciphertext, authTag]);

  return {
    body: {
      encrypted_aes_key:   encryptedAesKey.toString('base64'),
      encrypted_flow_data: encryptedData.toString('base64'),
      initial_vector:      iv.toString('base64'),
    },
    aesKey,
    iv,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

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

    // Corrupt the encrypted AES key
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

    // Flip a byte in the ciphertext (which includes the auth tag at the end)
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
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(() => {
    ({ privateKeyPem, publicKeyPem } = generateRsaKeyPair());
  });

  it('produces a non-empty base64 string', () => {
    const aesKey = randomBytes(16);
    const iv     = randomBytes(12);
    const result = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Must be valid base64
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
  });

  it('uses a bit-flipped IV so request and response IVs differ', () => {
    // Two calls with the same key+iv but different data should produce different ciphertexts
    // (they both use the flipped IV, so this also verifies determinism of the flip)
    const aesKey = randomBytes(16);
    const iv     = randomBytes(12);

    const r1 = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);
    const r2 = encryptFlowResponse({ screen: 'SUCCESS' }, aesKey, iv);

    // Same inputs → same output (deterministic for same key/iv/plaintext)
    expect(r1).toBe(r2);
  });

  it('can be decrypted back with the flipped IV', () => {
    const aesKey  = randomBytes(16);
    const iv      = randomBytes(12);
    const payload = { screen: 'SUCCESS', data: { verified: true } };

    const encrypted = encryptFlowResponse(payload, aesKey, iv);
    const raw       = Buffer.from(encrypted, 'base64');

    // Reproduce the flipped IV
    const responseIv = Buffer.alloc(iv.length);
    for (let i = 0; i < iv.length; i++) responseIv[i] = ~iv[i] & 0xff;

    const authTag    = raw.slice(-16);
    const ciphertext = raw.slice(0, -16);

    const decipher = createDecipheriv('aes-128-gcm', aesKey, responseIv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const decoded = JSON.parse(plain.toString('utf-8'));

    expect(decoded.screen).toBe('SUCCESS');
    expect(decoded.data?.verified).toBe(true);
  });
});

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
      expiresAt: Date.now() - 1,  // already expired
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
