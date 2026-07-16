/**
 * platformAccess.ts — Sprint 1 backend platform access enforcement.
 *
 * Express middleware that blocks unauthorized users from main-platform API routes.
 * Apply this AFTER isAuthenticated on any route that only full-platform or hybrid
 * users should reach.
 *
 * Usage in routes.ts (apply to route groups, not individually):
 *
 *   import { isAuthenticated, requirePlatformAccess } from "./replit_integrations/auth";
 *
 *   // Option A: per-route
 *   app.get("/api/calls", isAuthenticated, requirePlatformAccess, callsHandler);
 *
 *   // Option B: route group (add once above the handlers)
 *   app.use("/api/calls",          isAuthenticated, requirePlatformAccess);
 *   app.use("/api/analytics",      isAuthenticated, requirePlatformAccess);
 *   app.use("/api/vendor-rates",   isAuthenticated, requirePlatformAccess);
 *   // ... etc.
 *
 * Portal-scoped APIs (/api/portal/*, /api/auth/*) do NOT need this middleware.
 *
 * Enforcement layers (this is the single enforcement point):
 *   Layer 1 (Sprint 1)  — platform_access_type: portal_only → 403
 *   Layer 2 (Sprint 2+) — account status: suspended/disabled → 403
 *   Layer 3 (Phase 1)   — tenant restrictions, expired assignments → 403
 *
 * Cache: AccessProfile is cached in-process for 5 minutes per user.
 * Sprint 2 should call invalidatePlatformAccessCache() after any admin update.
 */
import type { RequestHandler } from "express";
import { db } from "../../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

// ─── Access Profile ───────────────────────────────────────────────────────────
// The full set of fields consulted by canAccessPlatform().
// Add columns to this interface (and the DB select below) as new enforcement
// layers are introduced in later sprints — never add logic directly to the
// middleware function.

interface AccessProfile {
  platformAccessType: string;
  // Sprint 2+: accountStatus: "active" | "suspended" | "disabled"
  // Phase 1:  tenantId: string | null; accessExpiresAt: Date | null;
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map<string, { profile: AccessProfile; exp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Prune stale entries every hour to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of _cache) {
    if (entry.exp < now) _cache.delete(id);
  }
}, 60 * 60 * 1000);

async function getAccessProfile(userId: string): Promise<AccessProfile> {
  const cached = _cache.get(userId);
  if (cached && Date.now() < cached.exp) return cached.profile;

  const [row] = await db
    .select({ platformAccessType: users.platformAccessType })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const profile: AccessProfile = {
    platformAccessType: row?.platformAccessType ?? "full_platform",
    // Sprint 2+: accountStatus: row?.accountStatus ?? "active",
  };

  _cache.set(userId, { profile, exp: Date.now() + CACHE_TTL_MS });
  return profile;
}

/**
 * Invalidate the cached access profile for a user.
 * Call this after an admin changes platform_access_type or any enforced field.
 */
export function invalidatePlatformAccessCache(userId: string): void {
  _cache.delete(userId);
}

// ─── Access Decision ──────────────────────────────────────────────────────────
// One place that says "can this profile access the platform?".
// Each layer is a clearly-labelled block so future contributors know where to add.

interface AccessDecision {
  allowed: boolean;
  code?: string;
  message?: string;
}

function canAccessPlatform(profile: AccessProfile): AccessDecision {
  // Layer 1 — Platform access type
  if (profile.platformAccessType === "portal_only") {
    return {
      allowed: false,
      code: "PLATFORM_ACCESS_DENIED",
      message: "You are not authorized to access the main platform.",
    };
  }

  // Layer 2 — Account status (Sprint 2+)
  // if (profile.accountStatus !== "active") {
  //   return {
  //     allowed: false,
  //     code: "ACCOUNT_INACTIVE",
  //     message: "Your account has been suspended or disabled.",
  //   };
  // }

  // Layer 3 — Tenant restrictions / temporal access (Phase 1 IAM)
  // if (profile.accessExpiresAt && profile.accessExpiresAt < new Date()) {
  //   return {
  //     allowed: false,
  //     code: "ACCESS_EXPIRED",
  //     message: "Your platform access has expired.",
  //   };
  // }

  return { allowed: true };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * requirePlatformAccess — Express middleware.
 *
 * Must be applied AFTER isAuthenticated (req.user must be set).
 * Delegates the access decision entirely to canAccessPlatform() so this
 * function never needs to change when new enforcement layers are added.
 */
export const requirePlatformAccess: RequestHandler = async (req: any, res, next) => {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const profile = await getAccessProfile(userId);
    const decision = canAccessPlatform(profile);

    if (!decision.allowed) {
      return res.status(403).json({
        code: decision.code ?? "PLATFORM_ACCESS_DENIED",
        message: decision.message ?? "Access denied.",
      });
    }

    return next();
  } catch (err: any) {
    console.error("[platform-access] Error checking access profile:", err?.message);
    // Fail CLOSED: if the authorization lookup cannot complete, deny access.
    // A portal_only user must never slip through due to a transient DB error.
    // Fail-open is only appropriate for non-security concerns (logging, telemetry).
    return res.status(503).json({
      code: "ACCESS_CHECK_UNAVAILABLE",
      message: "Unable to verify platform access. Please try again.",
    });
  }
};
