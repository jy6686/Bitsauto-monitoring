import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { storage } from "../../storage";
import { registerNativeAuthRoutes } from "./nativeAuth";
import { db } from "../../db";
import { userPortalAssignments } from "@shared/models/auth";
import { eq } from "drizzle-orm";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Native username/password login (POST /api/auth/login)
  registerNativeAuthRoutes(app);

  // Get current authenticated user — includes auto role-assignment on first login
  // and portal assignments for the welcome gateway / workspace selector.
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Auto-assign role: first ever user → admin, new users → viewer
      let role = await storage.getUserRole(userId);
      if (!role) {
        const totalRoles = await storage.countRoleEntries();
        role = totalRoles === 0 ? 'admin' : 'viewer';
        await storage.setUserRole(userId, role);
      }

      // Portal assignments — used by the Welcome Gateway and Workspace Selector
      const assignments = await db
        .select({ portalSlug: userPortalAssignments.portalSlug })
        .from(userPortalAssignments)
        .where(eq(userPortalAssignments.userId, userId));

      res.json({
        ...user,
        role,
        portals: assignments.map((a) => a.portalSlug),
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
