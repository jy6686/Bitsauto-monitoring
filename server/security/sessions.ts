import { db } from "../db";
import { userSessions } from "@shared/schema";
import { eq, and, desc, gt } from "drizzle-orm";
import type { RequestHandler } from "express";

const IDLE_TIMEOUT_MS: Record<string, number> = {
  admin:       30 * 60 * 1000,
  super_admin: 30 * 60 * 1000,
  finance:     30 * 60 * 1000,
  noc:         30 * 60 * 1000,
  management:  60 * 60 * 1000,
  team_lead:   60 * 60 * 1000,
  kam:         60 * 60 * 1000,
  viewer:      120 * 60 * 1000,
};

function getClientIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";
}

export async function upsertSessionRecord(
  sessionId: string,
  userId: string,
  req: any
): Promise<void> {
  try {
    const ip = getClientIp(req);
    const ua = (req.headers["user-agent"] as string) ?? null;
    const existing = await db.select({ id: userSessions.id })
      .from(userSessions)
      .where(eq(userSessions.sessionId, sessionId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(userSessions)
        .set({ lastActivity: new Date(), ipAddress: ip })
        .where(eq(userSessions.sessionId, sessionId));
    } else {
      await db.insert(userSessions).values({
        sessionId,
        userId,
        ipAddress: ip,
        userAgent: ua,
        lastActivity: new Date(),
      }).onConflictDoNothing();
    }
  } catch { /* non-critical */ }
}

export const sessionActivityMiddleware: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  if (!user?.claims?.sub || !req.sessionID) return next();
  const role: string = (req as any).userRole ?? user.role ?? "viewer";
  const timeoutMs = IDLE_TIMEOUT_MS[role] ?? 120 * 60 * 1000;

  try {
    const [record] = await db.select()
      .from(userSessions)
      .where(and(
        eq(userSessions.sessionId, req.sessionID),
        eq(userSessions.isRevoked, false),
      ))
      .limit(1);

    if (record) {
      const idleSince = Date.now() - record.lastActivity.getTime();
      if (idleSince > timeoutMs) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Session expired due to inactivity", code: "IDLE_TIMEOUT" });
      }
      // Update activity (throttle to every 30s to reduce DB writes)
      if (idleSince > 30_000) {
        await db.update(userSessions)
          .set({ lastActivity: new Date() })
          .where(eq(userSessions.sessionId, req.sessionID));
      }
    } else {
      // First request for this session — create the record
      upsertSessionRecord(req.sessionID, user.claims.sub, req).catch(() => {});
    }
  } catch { /* non-critical — don't block the request */ }

  next();
};

export async function listActiveSessions(userId?: string) {
  const where = userId
    ? and(eq(userSessions.isRevoked, false), eq(userSessions.userId, userId))
    : eq(userSessions.isRevoked, false);
  return db.select().from(userSessions).where(where).orderBy(desc(userSessions.lastActivity)).limit(200);
}

export async function revokeSession(sessionId: string, revokedBy: string): Promise<boolean> {
  const result = await db.update(userSessions)
    .set({ isRevoked: true, revokedAt: new Date(), revokedBy })
    .where(eq(userSessions.sessionId, sessionId));
  return true;
}

export async function revokeAllUserSessions(userId: string, revokedBy: string): Promise<void> {
  await db.update(userSessions)
    .set({ isRevoked: true, revokedAt: new Date(), revokedBy })
    .where(and(eq(userSessions.userId, userId), eq(userSessions.isRevoked, false)));
}

export async function getSessionStats() {
  const all = await db.select().from(userSessions).where(eq(userSessions.isRevoked, false));
  const now = Date.now();
  const active5m = all.filter(s => now - s.lastActivity.getTime() < 5 * 60 * 1000).length;
  const active1h = all.filter(s => now - s.lastActivity.getTime() < 60 * 60 * 1000).length;
  return { total: all.length, active5m, active1h };
}
