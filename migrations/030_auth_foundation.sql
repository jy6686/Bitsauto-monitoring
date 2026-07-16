-- 030_auth_foundation.sql
-- Sprint 1 — Native authentication foundation.
--
-- Extends users with native login fields (username / password_hash / job_title)
-- and access-type control (platform_access_type / default_portal).
-- Creates user_portal_assignments for per-user portal access mapping.
-- Idempotent: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- Run against production Neon DB ($PROD_DB) BEFORE deploying the Sprint 1 build:
--   psql "$PROD_DB" -f migrations/030_auth_foundation.sql
--
-- Seed initial admin password (after running migration):
--   node -e "
--     import('./server/replit_integrations/auth/nativeAuth.js')
--       .then(m => m.hashPassword('YourPassword'))
--       .then(h => console.log('UPDATE users SET username=\'admin\', password_hash=\'' + h + '\' WHERE email=\'admin@example.com\';'))
--   "

BEGIN;

-- ── 1. Native auth + access-control columns on users ──────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username              VARCHAR UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash         VARCHAR,
  ADD COLUMN IF NOT EXISTS job_title             VARCHAR,
  ADD COLUMN IF NOT EXISTS platform_access_type  VARCHAR NOT NULL DEFAULT 'full_platform'
    CHECK (platform_access_type IN ('full_platform', 'portal_only', 'hybrid')),
  ADD COLUMN IF NOT EXISTS default_portal        VARCHAR
    REFERENCES portal_definitions(slug) ON DELETE SET NULL;

-- ── 2. Per-user portal access table ──────────────────────────────────────────
-- Only relevant when platform_access_type = 'portal_only'.
-- Managed via the Portal Assignment Manager (Sprint 2 admin UI).
CREATE TABLE IF NOT EXISTS user_portal_assignments (
  id           SERIAL    PRIMARY KEY,
  user_id      VARCHAR   NOT NULL REFERENCES users(id)                 ON DELETE CASCADE,
  portal_slug  VARCHAR   NOT NULL REFERENCES portal_definitions(slug)  ON DELETE CASCADE,
  assigned_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_by  VARCHAR   REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, portal_slug)
);

CREATE INDEX IF NOT EXISTS idx_upa_user_id  ON user_portal_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_upa_portal   ON user_portal_assignments (portal_slug);

COMMIT;
