import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { storage } from "../../storage";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user — includes auto role-assignment on first login
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

      res.json({ ...user, role });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
