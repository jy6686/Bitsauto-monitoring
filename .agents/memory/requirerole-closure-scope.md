---
name: requireRole closure scope
description: requireRole in routes.ts is a closure inside registerRoutes() and is never exported; new route files must implement their own inline role check.
---

## Rule
`requireRole` is defined as a local async function inside the `registerRoutes()` closure in `server/routes.ts` around line 1974. It is **not** exported and cannot be imported by standalone route files (e.g. `server/routes-portal-assignment.ts`).

## How to apply
When creating a new route file that needs role-based access control, implement an inline guard like this:

```ts
import { storage } from "./storage";

async function requireAdminRole(req: any, res: any, next: any) {
  const userId = req.user?.claims?.sub;
  if (!userId) return res.status(401).json({ message: "Unauthenticated" });
  const role = await storage.getUserRole(userId);
  if (!role || !["admin", "super_admin"].includes(role)) {
    return res.status(403).json({ message: "Forbidden — admin or super_admin required." });
  }
  next();
}
```

**Why:** The function uses `storage` which is available in the module scope, and Express middleware is stateless — there is no reason it needs to be a closure. The pattern is identical to the one inside `registerRoutes()`.
