---
name: Security Sprint 1 implementation
description: MFA/TOTP, session governance, IP restrictions — architecture decisions and gotchas.
---

## What was built
- `server/security/mfa.ts` — pure Node.js crypto TOTP (RFC 6238), no external lib
- `server/security/sessions.ts` — session upsert + idle-timeout middleware
- `server/security/ip-guard.ts` — CIDR allowlist middleware with 60s cache
- DB tables: `mfa_secrets`, `user_sessions`, `ip_restrictions` (created via raw SQL — see below)
- Routes in `server/routes.ts`: `/api/security/mfa/*`, `/api/security/sessions/*`, `/api/security/ip-restrictions/*`
- `sessionActivityMiddleware` registered on `app.use('/api', ...)` after auth setup
- Frontend: `mfa-setup.tsx`, `mfa-verify.tsx`, `security-ops.tsx`

## Key decisions

### Do NOT use otplib for TOTP
**Why:** `otplib` v13.4.0 is `"type": "module"` ESM-only and requires a separate crypto plugin (`@otplib/plugin-crypto`, `@otplib/plugin-thirty-two`) — it will crash at startup with `CryptoPluginMissingError` and also throws `SyntaxError: does not provide an export named 'authenticator'` under some Node ESM interop modes.
**How to apply:** Use Node's built-in `createHmac('sha1', ...)` for TOTP. The mfa.ts file has a self-contained Base32 + TOTP implementation (~60 lines).

### db:push gets stuck on interactive prompt
**Why:** `drizzle-kit push` asks interactively about the `routing_groups_cache_i_routing_group_unique` constraint on each run. Piping `echo "" | npm run db:push` doesn't resolve it reliably.
**How to apply:** For new tables, use `executeSql` via the code_execution tool to run raw `CREATE TABLE IF NOT EXISTS` statements directly. This is faster and avoids the interactive prompt entirely.

### AuditCategory extended
Added `'security'` and `'operational'` to the union type in `server/audit.ts`. All security events (MFA_ENABLED, SESSION_REVOKED, IP_RESTRICTION_ADDED, etc.) use category `'security'`.

### MFA gate is session-flag based
`req.session.mfaVerified = true` is set after successful TOTP validation. The MFA verify page (`/mfa-verify`) posts to `/api/security/mfa/validate`. The gate is advisory — frontend enforces redirect to `/mfa-verify` when `mfaVerified` is false for MFA-required roles. The backend `isAuthenticated` middleware does NOT yet hard-block unverified MFA sessions (can be added in Sprint 2).

### Session activity middleware
Throttled to update DB at most every 30s per session to avoid write storms. Idle timeout is role-based (30m for admin/finance, 120m for viewer). Registered as `app.use('/api', sessionActivityMiddleware)` — non-critical errors are swallowed so it never blocks requests.
