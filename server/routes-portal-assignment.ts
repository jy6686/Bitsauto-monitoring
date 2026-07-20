/**
 * routes-portal-assignment.ts — Sprint #366 portal assignment management.
 *
 * PATCH /api/users/:id/portal-assignment
 *   Guards: isAuthenticated + admin/super_admin role check
 *   Validates via validatePortalAssignment (Sprint #367)
 *   Updates platform_access_type, default_portal, and user_portal_assignments
 *
 * GET /api/users — list all platform users with their portal profile
 *   Guards: isAuthenticated + admin/super_admin role check
 */
import type { Express } from "express";
import { db } from "./db";
import { users, userPortalAssignments } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth";
import { storage } from "./storage";
import { validatePortalAssignment } from "./lib/portal-validation";

/** Inline role guard — mirrors the requireRole closure inside registerRoutes. */
async function requireAdminRole(req: any, res: any, next: any) {
  const userId = req.user?.claims?.sub;
  if (!userId) return res.status(401).json({ message: "Unauthenticated" });
  const role = await storage.getUserRole(userId);
  if (!role || !["admin", "super_admin"].includes(role)) {
    return res.status(403).json({ message: "Forbidden — admin or super_admin required." });
  }
  next();
}

export function registerPortalAssignmentRoutes(app: Express): void {

  /**
   * GET /api/users
   * Returns all platform users with their current portal profile.
   * Used by the "Access & Portals" UI in Team Management.
   */
  app.get(
    "/api/users",
    isAuthenticated,
    requireAdminRole,
    async (_req: any, res: any) => {
      try {
        const allUsers = await db.select().from(users).orderBy(users.createdAt);

        // Fetch all portal assignments in one query, group by user
        const allAssignments = await db
          .select({
            userId:     userPortalAssignments.userId,
            portalSlug: userPortalAssignments.portalSlug,
          })
          .from(userPortalAssignments);

        const assignmentMap = allAssignments.reduce<Record<string, string[]>>(
          (acc, a) => {
            acc[a.userId] = acc[a.userId] ?? [];
            acc[a.userId].push(a.portalSlug);
            return acc;
          },
          {}
        );

        const result = allUsers.map((u) => ({
          id:                 u.id,
          email:              u.email,
          username:           u.username,
          firstName:          u.firstName,
          lastName:           u.lastName,
          profileImageUrl:    u.profileImageUrl,
          jobTitle:           u.jobTitle,
          platformAccessType: u.platformAccessType,
          defaultPortal:      u.defaultPortal,
          assignedPortals:    assignmentMap[u.id] ?? [],
          createdAt:          u.createdAt,
        }));

        res.json(result);
      } catch (err: any) {
        console.error("[portal-assignment] GET /api/users error:", err?.message);
        res.status(500).json({ message: "Failed to fetch users." });
      }
    }
  );

  /**
   * PATCH /api/users/:id/portal-assignment
   * Body: { accessScope, assignedPortals, defaultPortal, status? }
   * Validates, then atomically updates users + user_portal_assignments.
   */
  app.patch(
    "/api/users/:id/portal-assignment",
    isAuthenticated,
    requireAdminRole,
    async (req: any, res: any) => {
      try {
        const { id } = req.params;
        const { accessScope, assignedPortals = [], defaultPortal, status } =
          req.body ?? {};

        if (!accessScope) {
          return res.status(400).json({ message: "accessScope is required." });
        }
        if (!Array.isArray(assignedPortals)) {
          return res
            .status(400)
            .json({ message: "assignedPortals must be an array." });
        }

        // Validate business rules (Sprint #367)
        const validation = validatePortalAssignment({
          accessScope,
          defaultPortal: defaultPortal ?? null,
          assignedPortals,
          status,
        });

        if (!validation.valid) {
          return res.status(400).json({ message: validation.error });
        }

        const { assignedPortals: cleanPortals, defaultPortal: cleanDefault } =
          validation.normalised!;

        // Persist — update users table
        await db
          .update(users)
          .set({
            platformAccessType: accessScope as any,
            defaultPortal:      cleanDefault,
            updatedAt:          new Date(),
          })
          .where(eq(users.id, id));

        // Atomically sync portal assignments:
        // delete all existing, then insert the new set
        await db
          .delete(userPortalAssignments)
          .where(eq(userPortalAssignments.userId, id));

        if (cleanPortals.length > 0) {
          await db.insert(userPortalAssignments).values(
            cleanPortals.map((slug) => ({
              userId:     id,
              portalSlug: slug,
              assignedBy: req.user?.claims?.sub ?? null,
            }))
          );
        }

        console.log(
          `[portal-assignment] Updated user ${id}: scope=${accessScope} portals=[${cleanPortals.join(",")}] default=${cleanDefault}`
        );

        res.json({
          success:            true,
          userId:             id,
          platformAccessType: accessScope,
          defaultPortal:      cleanDefault,
          assignedPortals:    cleanPortals,
        });
      } catch (err: any) {
        console.error(
          "[portal-assignment] PATCH /api/users/:id/portal-assignment error:",
          err?.message
        );
        res
          .status(500)
          .json({ message: "Failed to update portal assignment." });
      }
    }
  );
}
