import { db } from "../db";
import { ipRestrictions } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";

function getClientIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";
}

function cidrToRange(cidr: string): { start: number; end: number } | null {
  try {
    const [ip, bits] = cidr.split("/");
    const mask = bits ? parseInt(bits) : 32;
    const ipNum = ip.split(".").reduce((acc, oct) => (acc << 8) | parseInt(oct), 0) >>> 0;
    const netMask = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    return { start: (ipNum & netMask) >>> 0, end: (ipNum | (~netMask >>> 0)) >>> 0 };
  } catch {
    return null;
  }
}

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) | parseInt(oct), 0) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  if (cidr === "0.0.0.0/0" || cidr === "::/0") return true;
  if (ip.includes(":")) return false; // skip IPv6 for now
  if (!cidr.includes("/")) return ip === cidr;
  const range = cidrToRange(cidr);
  if (!range) return false;
  const num = ipToNum(ip);
  return num >= range.start && num <= range.end;
}

let cachedRules: { cidr: string; scope: string; scopeValue: string | null }[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 60_000;

async function getRules() {
  if (cachedRules && Date.now() - cacheTs < CACHE_TTL) return cachedRules;
  const rows = await db.select({
    cidr: ipRestrictions.cidr,
    scope: ipRestrictions.scope,
    scopeValue: ipRestrictions.scopeValue,
  }).from(ipRestrictions).where(eq(ipRestrictions.isActive, true));
  cachedRules = rows;
  cacheTs = Date.now();
  return rows;
}

export function invalidateIpCache() { cachedRules = null; }

export const ipGuardMiddleware: RequestHandler = async (req, res, next) => {
  try {
    const rules = await getRules();
    if (rules.length === 0) return next(); // no rules = open access

    const globalRules = rules.filter(r => r.scope === "global");
    if (globalRules.length === 0) return next(); // only role/user rules, skip global check

    const ip = getClientIp(req);
    const allowed = globalRules.some(r => ipInCidr(ip, r.cidr));
    if (!allowed) {
      return res.status(403).json({ message: "Access denied: IP not in allowlist", code: "IP_RESTRICTED" });
    }
  } catch { /* fail open — don't block on DB error */ }
  next();
};

export async function checkRoleIp(ip: string, role: string): Promise<boolean> {
  try {
    const rules = await getRules();
    const roleRules = rules.filter(r => r.scope === "role" && r.scopeValue === role);
    if (roleRules.length === 0) return true; // no rules for this role
    return roleRules.some(r => ipInCidr(ip, r.cidr));
  } catch {
    return true; // fail open
  }
}

export async function listRestrictions() {
  return db.select().from(ipRestrictions).orderBy(ipRestrictions.createdAt);
}

export async function addRestriction(data: {
  scope: string; scopeValue?: string | null;
  cidr: string; description?: string; createdBy: string;
}) {
  const [row] = await db.insert(ipRestrictions).values({
    scope: data.scope,
    scopeValue: data.scopeValue ?? null,
    cidr: data.cidr,
    description: data.description ?? null,
    createdBy: data.createdBy,
  }).returning();
  invalidateIpCache();
  return row;
}

export async function deleteRestriction(id: number) {
  await db.delete(ipRestrictions).where(eq(ipRestrictions.id, id));
  invalidateIpCache();
}

export async function toggleRestriction(id: number, isActive: boolean) {
  await db.update(ipRestrictions).set({ isActive }).where(eq(ipRestrictions.id, id));
  invalidateIpCache();
}
