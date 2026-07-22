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

/** Derive a human-readable display name from available user fields. */
export function deriveDisplayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.username || user.email?.split("@")[0] || "User";
}

export function registerNativeAuthRoutes(app: Express): void {
  /**
   * GET /set-password
   * Serves a minimal HTML form for the bootstrap password-set flow.
   * Protected by SESSION_SECRET — token must be provided in the URL query.
   */
  app.get("/set-password", (req: any, res: any) => {
    const token = String(req.query.token ?? "");
    const secret = process.env.SESSION_SECRET ?? "";
    if (!secret || token !== secret) {
      return res.status(403).send("Forbidden — invalid or missing token.");
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set Password — Bitsauto Auth</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem;width:100%;max-width:400px}
  h2{margin:0 0 1.5rem;font-size:1.25rem;color:#f8fafc}
  label{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.35rem}
  input{width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:.65rem .75rem;color:#f8fafc;font-size:.9rem;outline:none;margin-bottom:1rem}
  input:focus{border-color:#6366f1}
  button{width:100%;background:#6366f1;color:#fff;border:none;border-radius:8px;padding:.75rem;font-size:.9rem;font-weight:600;cursor:pointer}
  button:hover{background:#4f46e5}
  #msg{margin-top:1rem;font-size:.85rem;text-align:center;color:#94a3b8}
  .ok{color:#4ade80}.err{color:#f87171}
</style>
</head>
<body>
<div class="card">
  <h2>Set / Reset Password</h2>
  <label for="email">Email or Username</label>
  <input id="email" type="text" placeholder="you@company.com" />
  <label for="pw">New Password</label>
  <input id="pw" type="password" placeholder="••••••••" />
  <label for="pw2">Confirm Password</label>
  <input id="pw2" type="password" placeholder="••••••••" />
  <button onclick="go()">Set Password</button>
  <div id="msg"></div>
</div>
<script>
async function go(){
  const email=document.getElementById('email').value.trim();
  const pw=document.getElementById('pw').value;
  const pw2=document.getElementById('pw2').value;
  const msg=document.getElementById('msg');
  msg.className='';msg.textContent='';
  if(!email||!pw){msg.className='err';msg.textContent='Email and password are required.';return;}
  if(pw!==pw2){msg.className='err';msg.textContent='Passwords do not match.';return;}
  if(pw.length<8){msg.className='err';msg.textContent='Password must be at least 8 characters.';return;}
  msg.textContent='Setting…';
  try{
    const r=await fetch('/api/auth/bootstrap-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:email,newPassword:pw,token:${JSON.stringify(token)}})});
    const d=await r.json();
    if(r.ok){msg.className='ok';msg.textContent='Password set! You can now log in.';}
    else{msg.className='err';msg.textContent=d.message||'Failed.';}
  }catch(e){msg.className='err';msg.textContent='Network error.';}
}
</script>
</body></html>`
      .replace("${JSON.stringify(token)}", JSON.stringify(token)));
  });

  /**
   * POST /api/auth/bootstrap-password
   * Body: { identifier, newPassword, token }
   * token must equal SESSION_SECRET — one-time admin bootstrap, not for general use.
   */
  app.post("/api/auth/bootstrap-password", async (req: any, res: any) => {
    try {
      const { identifier, newPassword, token } = req.body ?? {};
      const secret = process.env.SESSION_SECRET ?? "";
      if (!secret || token !== secret) {
        return res.status(403).json({ message: "Forbidden — invalid token." });
      }
      if (!identifier?.trim() || !newPassword) {
        return res.status(400).json({ message: "identifier and newPassword are required." });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
      }
      const { or, eq } = await import("drizzle-orm");
      const [user] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(or(eq(users.email, identifier.toLowerCase().trim()), eq(users.username, identifier.trim())))
        .limit(1);
      if (!user) {
        return res.status(404).json({ message: "No account found with that email or username." });
      }
      const hash = await hashPassword(newPassword);
      await db.update(users).set({ passwordHash: hash } as any).where(eq(users.id, user.id));
      console.log(`[bootstrap-password] password set for ${user.email ?? identifier}`);
      return res.json({ ok: true, message: "Password set successfully." });
    } catch (err: any) {
      console.error("[bootstrap-password] error:", err?.message);
      return res.status(500).json({ message: "Internal error." });
    }
  });

  /**
   * POST /api/auth/login
   * Body: { identifier: string (email or username), password: string }
   * Response (200): { user: { id, email, username, role, accessScope, defaultPortal,
   *                           assignedPortals, displayName, avatar } }
   * Response (400): missing fields
   * Response (401): account-not-found | wrong-password | account-disabled
   *
   * Already covered by the authLimiter applied to '/api/auth' in server/index.ts.
   */
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const { identifier, password } = req.body ?? {};

      // Server-side guard — client validation runs first but we always validate here
      if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
        return res.status(400).json({
          code: "missing_identifier",
          message: "Email or username is required.",
        });
      }
      if (!password || typeof password !== "string") {
        return res.status(400).json({
          code: "missing_password",
          message: "Password is required.",
        });
      }

      // Look up by email (lowercased) OR exact username
      const [user] = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.email, identifier.toLowerCase().trim()),
            eq(users.username, identifier.trim())
          )
        )
        .limit(1);

      if (!user) {
        // Consume scrypt time to resist user-enumeration via timing attack,
        // then return a distinct (non-misleading) error code for UX.
        await scryptAsync("dummy-password", "00000000000000000000000000000000", 64);
        return res.status(401).json({
          code: "account_not_found",
          message: "No account found with that email or username.",
        });
      }

      if (!user.passwordHash) {
        return res.status(401).json({
          code: "no_password",
          message: 'This account does not have a password set. Please use "Sign in with Replit".',
        });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({
          code: "wrong_password",
          message: "Incorrect password. Please try again.",
        });
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

      const displayName = deriveDisplayName(user);

      return res.json({
        user: {
          id:              user.id,
          email:           user.email,
          username:        user.username,
          displayName,
          avatar:          user.profileImageUrl ?? null,
          firstName:       user.firstName,
          lastName:        user.lastName,
          jobTitle:        user.jobTitle,
          accessScope:     user.platformAccessType,
          defaultPortal:   user.defaultPortal,
          assignedPortals: [],   // populated by /api/auth/user — empty here for speed
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
