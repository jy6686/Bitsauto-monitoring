/**
 * nativeAuth.ts — Sprint 1 native (username + password) authentication.
 *
 * Adds POST /api/auth/login for credential-based login.
 * Uses Node's built-in crypto.scrypt — no additional npm dependency.
 * On success calls req.login() to create a Passport-compatible session so that
 * the existing isAuthenticated middleware and GET /api/auth/user work unchanged.
 *
 * Password storage format in users.password_hash: "<hex-salt>:<hex-hash>"
 * Use hashPassword() (exported below) when seeding initial credentials in the DB.
 */
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express } from "express";
import { db } from "../../db";
import { users } from "@shared/models/auth";
import { eq, or } from "drizzle-orm";
import { storage } from "../../storage";

const scryptAsync = promisify(scrypt);

/**
 * Hash a plain-text password. Returns "<hex-salt>:<hex-hash>" for storage.
 * Use this to seed initial user credentials directly in the DB.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

/**
 * Verify a plain-text password against a stored hash (timing-safe).
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const storedBuf = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(storedBuf, derived);
}

/**
 * Build a Passport session user object that satisfies the existing isAuthenticated
 * middleware. Shape mirrors the OIDC session so GET /api/auth/user works unchanged.
 */
function buildNativeSessionUser(user: {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  return {
    claims: {
      sub: user.id,
      email: user.email ?? null,
      first_name: user.firstName ?? null,
      last_name: user.lastName ?? null,
    },
    access_token: null as null,
    refresh_token: null as null,
    // 7-day sliding window — extended on every request by isAuthenticated
    expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    auth_method: "native" as const,
  };
}

export function registerNativeAuthRoutes(app: Express): void {
  /**
   * POST /api/auth/login
   * Body: { identifier: string (email or username), password: string }
   * Response: { user: { id, email, firstName, lastName, username, jobTitle,
   *                      platformAccessType, defaultPortal, role } }
   *
   * Already covered by the authLimiter applied to '/api/auth' in server/index.ts.
   */
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const { identifier, password } = req.body ?? {};

      if (!identifier || !password) {
        return res
          .status(400)
          .json({ message: "Email/username and password are required." });
      }

      // Look up by email (lowercased) OR exact username
      const [user] = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.email, identifier.toLowerCase()),
            eq(users.username, identifier)
          )
        )
        .limit(1);

      if (!user) {
        // Consume scrypt time to resist user-enumeration via timing attack
        await scryptAsync("dummy-password", "00000000000000000000000000000000", 64);
        return res.status(401).json({ message: "Invalid credentials." });
      }

      if (!user.passwordHash) {
        return res.status(401).json({
          message:
            'This account does not have a password set. Please use "Sign in with Replit".',
        });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Auto-assign role if first login
      let role = await storage.getUserRole(user.id);
      if (!role) {
        const totalRoles = await storage.countRoleEntries();
        role = totalRoles === 0 ? "admin" : "viewer";
        await storage.setUserRole(user.id, role);
      }

      // Create Passport-compatible session (req.login serializes user → sessions table)
      const sessionUser = buildNativeSessionUser(user);
      await new Promise<void>((resolve, reject) => {
        req.login(sessionUser, (err: any) => (err ? reject(err) : resolve()));
      });

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          jobTitle: user.jobTitle,
          platformAccessType: user.platformAccessType,
          defaultPortal: user.defaultPortal,
          role,
        },
      });
    } catch (err: any) {
      console.error("[native-auth] POST /api/auth/login error:", err?.message);
      return res
        .status(500)
        .json({ message: "Authentication failed. Please try again." });
    }
  });
}
