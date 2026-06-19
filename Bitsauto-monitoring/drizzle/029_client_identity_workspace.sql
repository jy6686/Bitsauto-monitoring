-- Migration 029: Client Identity Map + Workspace Navigation tables
-- client_identity_map: canonical identity source for Sippy accounts.
-- workspace_definitions / workspace_tabs / workspace_tab_items: tab-bar navigation layer.

CREATE TABLE IF NOT EXISTS client_identity_map (
  id                 SERIAL PRIMARY KEY,
  i_account          INTEGER UNIQUE,
  sippy_username     VARCHAR(255),
  billing_name       VARCHAR(255),
  display_name       VARCHAR(255),
  crm_name           VARCHAR(255),
  portal_name        VARCHAR(255),
  external_ref       VARCHAR(255),
  account_manager_id VARCHAR(255),
  finance_owner_id   VARCHAR(255),
  risk_tier          VARCHAR(20) DEFAULT 'standard',
  notes              TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at     TIMESTAMP,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_definitions (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  portal_slug TEXT,
  domain_id   TEXT,
  icon        TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_tabs (
  id               SERIAL PRIMARY KEY,
  workspace_id     INTEGER NOT NULL,
  slug             TEXT NOT NULL,
  label            TEXT NOT NULL,
  icon             TEXT,
  sort_order       INTEGER DEFAULT 0,
  is_visible       BOOLEAN NOT NULL DEFAULT TRUE,
  visibility_roles TEXT[]
);

CREATE TABLE IF NOT EXISTS workspace_tab_items (
  id               SERIAL PRIMARY KEY,
  tab_id           INTEGER NOT NULL,
  route            TEXT NOT NULL,
  label            TEXT,
  icon             TEXT,
  sort_order       INTEGER DEFAULT 0,
  is_contextual    BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
  visibility_roles TEXT[]
);
