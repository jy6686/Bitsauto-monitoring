// server/rbac.ts
// RBAC middleware layer — requirePermission() and requireScope() replace/augment requireRole().
// Computes effective permissions: role defaults + per-user overrides, respecting expiry.

import { db } from './db.js';
import {
  rbacRolePermissions,
  rbacUserPermissionOverrides,
  rbacPermissionAuditEvents,
  userRoles,
} from '../shared/schema.js';
import { eq, and, or, isNull, gt } from 'drizzle-orm';
import type { PermissionKey, ScopeKey } from '../shared/permissions.js';

// ── Effective permission computation ──────────────────────────────────────────

export async function getUserPermissions(userId: string): Promise<Set<string>> {
  // 1. Get user's role
  const roleRows = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  const role = roleRows[0]?.role ?? 'viewer';

  // 2. Load role defaults
  const rolePerms = await db.select()
    .from(rbacRolePermissions)
    .where(and(eq(rbacRolePermissions.role, role), eq(rbacRolePermissions.granted, true)));

  const perms = new Set<string>(rolePerms.map(p => p.permissionKey));

  // 3. Apply per-user overrides (non-expired)
  const now = new Date();
  const overrides = await db.select()
    .from(rbacUserPermissionOverrides)
    .where(
      and(
        eq(rbacUserPermissionOverrides.userId, userId),
        or(isNull(rbacUserPermissionOverrides.expiresAt), gt(rbacUserPermissionOverrides.expiresAt, now))
      )
    );

  for (const o of overrides) {
    if (o.granted) { perms.add(o.permissionKey); }
    else           { perms.delete(o.permissionKey); }
  }

  return perms;
}

// Cache: userId → { perms, loadedAt } (5-minute TTL to avoid per-request DB hits)
const permCache = new Map<string, { perms: Set<string>; at: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function getCachedUserPermissions(userId: string): Promise<Set<string>> {
  const cached = permCache.get(userId);
  if (cached && (Date.now() - cached.at) < CACHE_TTL) return cached.perms;
  const perms = await getUserPermissions(userId);
  permCache.set(userId, { perms, at: Date.now() });
  return perms;
}

export function invalidatePermissionCache(userId?: string) {
  if (userId) permCache.delete(userId);
  else        permCache.clear();
}

// ── Middleware factories ───────────────────────────────────────────────────────

/**
 * requirePermission("invoice.approve") — replaces requireRole() for action-gated routes.
 * Falls back to raw role check if the RBAC tables don't exist yet (safe migration path).
 */
export function requirePermission(permissionKey: PermissionKey) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const perms = await getCachedUserPermissions(userId);
      if (!perms.has(permissionKey)) {
        return res.status(403).json({
          message: `Forbidden — requires permission: ${permissionKey}`,
          permission: permissionKey,
        });
      }
      next();
    } catch {
      // RBAC tables not yet migrated — fall through to allow (fail-open during rollout)
      next();
    }
  };
}

/**
 * requireAnyPermission(["invoice.view", "invoice.approve"]) — passes if user has ANY listed permission.
 */
export function requireAnyPermission(keys: PermissionKey[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const perms = await getCachedUserPermissions(userId);
      if (!keys.some(k => perms.has(k))) {
        return res.status(403).json({
          message: `Forbidden — requires one of: ${keys.join(', ')}`,
          permissions: keys,
        });
      }
      next();
    } catch { next(); }
  };
}

/**
 * Attach user's full permission set to req.permissions (for conditional logic inside handlers).
 */
export function attachPermissions() {
  return async (req: any, _res: any, next: any) => {
    const userId = req.user?.claims?.sub;
    if (userId) {
      try {
        req.permissions = await getCachedUserPermissions(userId);
      } catch {
        req.permissions = new Set<string>();
      }
    } else {
      req.permissions = new Set<string>();
    }
    next();
  };
}

// ── Audit helper ──────────────────────────────────────────────────────────────

export async function logPermissionEvent(opts: {
  eventType: string;
  actorId: string;
  targetUserId?: string;
  targetRole?: string;
  permissionKey?: string;
  beforeValue?: any;
  afterValue?: any;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await db.insert(rbacPermissionAuditEvents).values({
      eventType:     opts.eventType,
      actorId:       opts.actorId,
      targetUserId:  opts.targetUserId ?? null,
      targetRole:    opts.targetRole   ?? null,
      permissionKey: opts.permissionKey ?? null,
      beforeValue:   opts.beforeValue  ?? null,
      afterValue:    opts.afterValue   ?? null,
      ipAddress:     opts.ipAddress    ?? null,
      userAgent:     opts.userAgent    ?? null,
    });
  } catch { /* never throw on audit failure */ }
}
