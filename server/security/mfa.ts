import { createHmac, randomBytes } from "crypto";
import QRCode from "qrcode";
import { db } from "../db";
import { mfaSecrets } from "@shared/schema";
import { eq } from "drizzle-orm";

const APP_NAME = "BitsAuto NOC";
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_DRIFT  = 1; // accept 1 step before/after (±30s)

// Roles that REQUIRE MFA
export const MFA_REQUIRED_ROLES = new Set(["admin", "super_admin", "finance", "noc"]);
// Roles where MFA is recommended
export const MFA_RECOMMENDED_ROLES = new Set(["management", "team_lead", "kam"]);

// ── Base32 helpers ────────────────────────────────────────────────────────────
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += B32_ALPHABET[(val >> bits) & 31]; } }
  if (bits > 0) out += B32_ALPHABET[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s) { const idx = B32_ALPHABET.indexOf(ch); if (idx < 0) continue; val = (val << 5) | idx; bits += 5; if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); } }
  return Buffer.from(out);
}

// ── TOTP core (RFC 6238) ──────────────────────────────────────────────────────
function totpAt(secretB32: string, step: number): string {
  const key     = base32Decode(secretB32);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac  = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code   = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % Math.pow(10, TOTP_DIGITS);
  return String(code).padStart(TOTP_DIGITS, "0");
}

function totpNow(secretB32: string): string {
  return totpAt(secretB32, Math.floor(Date.now() / 1000 / TOTP_PERIOD));
}

export function verifyToken(secretB32: string, token: string): boolean {
  const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  const t = token.replace(/\s/g, "");
  for (let d = -TOTP_DRIFT; d <= TOTP_DRIFT; d++) {
    if (totpAt(secretB32, step + d) === t) return true;
  }
  return false;
}

// ── Secret + backup generation ────────────────────────────────────────────────
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const h = randomBytes(4).toString("hex").toUpperCase();
    return `${h.slice(0,4)}-${h.slice(4,8)}`;
  });
}

export function getOtpAuthUrl(secret: string, userId: string, email: string): string {
  const label = encodeURIComponent(`${APP_NAME}:${email ?? userId}`);
  const issuer = encodeURIComponent(APP_NAME);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

export async function generateQrCode(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl);
}

// ── DB operations ─────────────────────────────────────────────────────────────
export async function getMfaRecord(userId: string) {
  const [row] = await db.select().from(mfaSecrets).where(eq(mfaSecrets.userId, userId));
  return row ?? null;
}

export async function setupMfa(userId: string, secret: string, backupCodes: string[]) {
  await db.insert(mfaSecrets).values({
    userId, secret, isEnabled: false, backupCodes,
  }).onConflictDoUpdate({
    target: mfaSecrets.userId,
    set: { secret, isEnabled: false, backupCodes },
  });
}

export async function enableMfa(userId: string) {
  await db.update(mfaSecrets)
    .set({ isEnabled: true, enabledAt: new Date() })
    .where(eq(mfaSecrets.userId, userId));
}

export async function disableMfa(userId: string) {
  await db.delete(mfaSecrets).where(eq(mfaSecrets.userId, userId));
}

export async function recordMfaUsage(userId: string) {
  await db.update(mfaSecrets)
    .set({ lastUsedAt: new Date() })
    .where(eq(mfaSecrets.userId, userId));
}

export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  const record = await getMfaRecord(userId);
  if (!record) return false;
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  const match = record.backupCodes.find(c => c.replace(/-/g, "") === normalized);
  if (!match) return false;
  const remaining = record.backupCodes.filter(c => c !== match);
  await db.update(mfaSecrets)
    .set({ backupCodes: remaining, lastUsedAt: new Date() })
    .where(eq(mfaSecrets.userId, userId));
  return true;
}
