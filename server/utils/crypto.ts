/**
 * server/utils/crypto.ts
 *
 * AES-256-GCM encryption helpers for sensitive settings stored in the database
 * (SMTP passwords, etc). The key is derived from AUTH_SECRET via PBKDF2.
 *
 * Format on disk:  <salt_hex>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const KEY_LEN    = 32;    // 256 bits
const IV_LEN     = 12;    // 96 bits recommended for GCM
const SALT_LEN   = 16;
const ITERATIONS = 100_000;
const DIGEST     = 'sha256';

function deriveKey(secret: string, salt: Buffer): Buffer {
  return pbkdf2Sync(secret, salt, ITERATIONS, KEY_LEN, DIGEST);
}

/** Encrypt a plaintext string. Returns an opaque storage string. */
export function encryptSecret(plaintext: string): string {
  const secret = process.env.AUTH_SECRET ?? 'bitsauto-default-key';
  const salt   = randomBytes(SALT_LEN);
  const iv     = randomBytes(IV_LEN);
  const key    = deriveKey(secret, salt);

  const cipher  = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/** Decrypt a value previously produced by encryptSecret. Returns the original string or null on failure. */
export function decryptSecret(stored: string): string | null {
  try {
    const parts = stored.split(':');
    if (parts.length !== 4) return null;
    const [saltHex, ivHex, tagHex, ctHex] = parts;
    const secret = process.env.AUTH_SECRET ?? 'bitsauto-default-key';

    const salt   = Buffer.from(saltHex, 'hex');
    const iv     = Buffer.from(ivHex,   'hex');
    const tag    = Buffer.from(tagHex,  'hex');
    const ct     = Buffer.from(ctHex,   'hex');
    const key    = deriveKey(secret, salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** Returns true if the value looks like it was produced by encryptSecret. */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 4 && parts.every(p => /^[0-9a-f]+$/.test(p));
}
