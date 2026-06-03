
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                  // max concurrent DB connections
  idleTimeoutMillis: 30000, // close idle connections after 30 s
  connectionTimeoutMillis: 10000, // fail fast (10 s) instead of hanging
});

// Log pool errors so they appear in logs instead of crashing the process
pool.on('error', (err) => {
  console.error('[db-pool] Unexpected pool error (non-fatal):', err.message);
});

export const db = drizzle(pool, { schema });

// ── Safe column migrations ─────────────────────────────────────────────────────
// These run once at startup and are idempotent (IF NOT EXISTS). They handle
// schema changes that need to be applied to the production database without
// requiring a full db:push run.
export async function runSafeMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Add admin_web_password to switches (added 2026-04-17)
    await client.query(`
      ALTER TABLE switches
        ADD COLUMN IF NOT EXISTS admin_web_password VARCHAR(255)
    `);
    // Widen call_snapshots.connection from varchar(32) to varchar(255) (added 2026-04-17 —
    // SB1 connection names like "SKY-TELECOM-UK-PAK-PREFIX-7(ORTP)(MANOR)" exceed 32 chars)
    await client.query(`
      ALTER TABLE call_snapshots
        ALTER COLUMN connection TYPE VARCHAR(255)
    `);
    // ── Routing cache tables (added 2026-04-23) ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS routing_groups_cache (
        id               SERIAL PRIMARY KEY,
        i_routing_group  INTEGER NOT NULL UNIQUE,
        name             VARCHAR(255) NOT NULL,
        policy           VARCHAR(64),
        media_relay      VARCHAR(64),
        on_net           BOOLEAN DEFAULT FALSE,
        members_count    INTEGER DEFAULT 0,
        raw_json         TEXT,
        cached_at        TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS destination_sets_cache (
        id                SERIAL PRIMARY KEY,
        i_destination_set INTEGER NOT NULL UNIQUE,
        name              VARCHAR(255) NOT NULL,
        route_count       INTEGER DEFAULT 0,
        cld_translation   VARCHAR(255),
        cli_translation   VARCHAR(255),
        raw_json          TEXT,
        cached_at         TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS connection_vendor_cache2 (
        id           SERIAL PRIMARY KEY,
        i_connection INTEGER NOT NULL UNIQUE,
        name         VARCHAR(255) NOT NULL,
        i_vendor     INTEGER,
        vendor_name  VARCHAR(255),
        host         VARCHAR(255),
        protocol     VARCHAR(32),
        blocked      BOOLEAN DEFAULT FALSE,
        raw_json     TEXT,
        cached_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS routing_cache_meta (
        id               SERIAL PRIMARY KEY,
        last_sync_at     TIMESTAMP,
        last_sync_status VARCHAR(32) DEFAULT 'pending',
        last_sync_error  TEXT,
        rg_count         INTEGER DEFAULT 0,
        ds_count         INTEGER DEFAULT 0,
        conn_count       INTEGER DEFAULT 0
      )
    `);
    // Ensure at least one meta row exists
    await client.query(`
      INSERT INTO routing_cache_meta (last_sync_status) VALUES ('pending')
      ON CONFLICT DO NOTHING
    `);

    // ── Self-heal: purge number_lookup_cache entries with wrong country ──────────
    // Numbers like "1923400593877" were cached as "United States / Canada" because
    // the old lookup code didn't strip the Sippy routing-class prefix before parsing.
    // Delete all 11+ digit cache entries whose first digit is 1/2/6/7 so they will
    // be re-looked-up with the corrected logic on next access.
    await client.query(`
      DELETE FROM number_lookup_cache
      WHERE length(number) >= 11
        AND left(number, 1) IN ('1','2','6','7')
        AND number ~ '^[0-9]'
    `);

    // ── Self-heal: strip accidental https:// prefix from sbc_hosts.host ─────────
    // If a user saves a URL (e.g. "https://191.101.30.107/") instead of a bare IP,
    // the TCP probe gets an invalid hostname. This one-time idempotent UPDATE fixes
    // any such rows automatically at startup.
    await client.query(`
      UPDATE sbc_hosts
      SET host = regexp_replace(
                   regexp_replace(host, '^https?://', '', 'i'),
                   '/.*$', ''
                 )
      WHERE host ~ '^https?://'
    `);

    // ── Entity presence registry (added 2026-05-19) ───────────────────────────
    // Persists idle BitsEye-2 entities (clients / vendors / countries /
    // destinations) across server restarts so they survive with active=0.
    await client.query(`
      CREATE TABLE IF NOT EXISTS entity_presence_registry (
        id           SERIAL PRIMARY KEY,
        dim          VARCHAR(32)  NOT NULL,
        entity_name  VARCHAR(256) NOT NULL,
        last_seen    BIGINT       NOT NULL DEFAULT 0,
        first_seen   BIGINT       NOT NULL DEFAULT 0,
        peak_today   INTEGER      NOT NULL DEFAULT 0,
        peak_ts      BIGINT       NOT NULL DEFAULT 0,
        updated_at   TIMESTAMP    DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS epr_dim_name_uidx
        ON entity_presence_registry (dim, entity_name)
    `);

    // ── Portal Governance Framework (added 2026-05-28) ───────────────────────
    // portal_definitions — portal registry with theme engine fields
    await client.query(`
      CREATE TABLE IF NOT EXISTS portal_definitions (
        id               SERIAL PRIMARY KEY,
        slug             TEXT NOT NULL UNIQUE,
        name             TEXT NOT NULL,
        icon             TEXT NOT NULL DEFAULT 'layout-dashboard',
        theme            TEXT NOT NULL DEFAULT 'neutral',
        layout_type      TEXT NOT NULL DEFAULT 'sidebar-sections',
        default_route    TEXT NOT NULL DEFAULT '/',
        allowed_roles    TEXT[] NOT NULL DEFAULT '{}',
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order       INTEGER NOT NULL DEFAULT 0,
        primary_color    TEXT NOT NULL DEFAULT 'purple',
        accent_color     TEXT NOT NULL DEFAULT 'indigo',
        background_style TEXT NOT NULL DEFAULT 'flat',
        density          TEXT NOT NULL DEFAULT 'comfortable',
        nav_style        TEXT NOT NULL DEFAULT 'glass',
        font_scale       TEXT NOT NULL DEFAULT 'normal',
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Add theme columns if table already existed without them
    await client.query(`ALTER TABLE portal_definitions ADD COLUMN IF NOT EXISTS primary_color    TEXT NOT NULL DEFAULT 'purple'`);
    await client.query(`ALTER TABLE portal_definitions ADD COLUMN IF NOT EXISTS accent_color     TEXT NOT NULL DEFAULT 'indigo'`);
    await client.query(`ALTER TABLE portal_definitions ADD COLUMN IF NOT EXISTS background_style TEXT NOT NULL DEFAULT 'flat'`);
    await client.query(`ALTER TABLE portal_definitions ADD COLUMN IF NOT EXISTS density          TEXT NOT NULL DEFAULT 'comfortable'`);
    await client.query(`ALTER TABLE portal_definitions ADD COLUMN IF NOT EXISTS nav_style        TEXT NOT NULL DEFAULT 'glass'`);
    await client.query(`ALTER TABLE portal_definitions ADD COLUMN IF NOT EXISTS font_scale       TEXT NOT NULL DEFAULT 'normal'`);

    // Seed default portals
    await client.query(`
      INSERT INTO portal_definitions (slug, name, icon, theme, default_route, allowed_roles, is_active, sort_order, primary_color, accent_color)
      VALUES
        ('noc',       'NOC Dashboard',    'monitor',           'slate',   '/calls',               '{super_admin,admin,management,noc_operator}', TRUE, 1, 'slate',  'cyan'),
        ('analytics', 'Analytics',        'bar-chart-3',       'indigo',  '/analytics',           '{super_admin,admin,management}',              TRUE, 2, 'indigo', 'purple'),
        ('finance',   'Finance & Billing','wallet',            'emerald', '/billing',             '{super_admin,admin,management}',              TRUE, 3, 'emerald','green'),
        ('ops',       'Operations',       'git-branch',        'blue',    '/routing-manager',     '{super_admin,admin,management}',              TRUE, 4, 'blue',   'cyan'),
        ('security',  'Security',         'shield-alert',      'neutral', '/fraud',               '{super_admin,admin}',                         TRUE, 5, 'neutral','slate'),
        ('platform',  'Platform',         'settings',          'neutral', '/settings',            '{super_admin,admin}',                         TRUE, 6, 'neutral','slate')
      ON CONFLICT (slug) DO NOTHING
    `);

    // navigation_modules — module registry
    await client.query(`
      CREATE TABLE IF NOT EXISTS navigation_modules (
        id              SERIAL PRIMARY KEY,
        module_key      TEXT NOT NULL UNIQUE,
        title           TEXT NOT NULL,
        icon            TEXT NOT NULL DEFAULT 'circle',
        route           TEXT NOT NULL,
        engine          TEXT,
        adapter_support TEXT[] NOT NULL DEFAULT '{}',
        category        TEXT NOT NULL DEFAULT 'general',
        default_portal  TEXT,
        is_movable      BOOLEAN NOT NULL DEFAULT TRUE,
        is_system       BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Seed core navigation modules
    await client.query(`
      INSERT INTO navigation_modules (module_key, title, icon, route, category, default_portal, is_system, sort_order)
      VALUES
        ('live_calls',       'Live Calls',        'activity',      '/calls',            'live',      'noc',       TRUE,  1),
        ('bitseye',          'BitsEye 2',         'eye',           '/bitseye2',         'live',      'noc',       TRUE,  2),
        ('alerts',           'Alerts',            'zap',           '/alerts',           'live',      'noc',       FALSE, 3),
        ('analytics',        'Analytics',         'bar-chart-3',   '/analytics',        'analytics', 'analytics', FALSE, 1),
        ('asr_acd',          'ASR / ACD',         'activity',      '/asr-acd',          'analytics', 'analytics', FALSE, 2),
        ('cdrs',             'CDR Viewer',        'file-text',     '/cdrs',             'analytics', 'analytics', FALSE, 3),
        ('routing_manager',  'Routing Manager',   'git-branch',    '/routing-manager',  'operations','ops',       FALSE, 1),
        ('vendors',          'Vendors',           'users',         '/vendors',          'operations','ops',       FALSE, 2),
        ('billing',          'Billing',           'wallet',        '/billing',          'finance',   'finance',   FALSE, 1),
        ('rate_cards',       'Rate Cards',        'file-text',     '/rate-cards',       'finance',   'finance',   FALSE, 2),
        ('dmr',              'Daily Minutes',     'activity',      '/dmr',              'finance',   'finance',   FALSE, 3),
        ('fraud',            'Fraud Engine',      'shield-alert',  '/fraud',            'security',  'security',  FALSE, 1),
        ('settings',         'Platform Settings', 'settings',      '/settings',         'platform',  'platform',  TRUE,  1),
        ('team',             'Team & KAM',        'users',         '/team',             'platform',  'platform',  FALSE, 2)
      ON CONFLICT (module_key) DO NOTHING
    `);

    // portal_module_assignments — portal ↔ module mappings with adapter metadata
    await client.query(`
      CREATE TABLE IF NOT EXISTS portal_module_assignments (
        id                SERIAL PRIMARY KEY,
        portal_id         TEXT NOT NULL,
        module_id         INTEGER NOT NULL,
        section           TEXT NOT NULL DEFAULT 'main',
        display_order     INTEGER NOT NULL DEFAULT 0,
        display_label     TEXT,
        adapter           TEXT,
        visibility        TEXT NOT NULL DEFAULT 'full',
        is_home           BOOLEAN NOT NULL DEFAULT FALSE,
        is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_by        TEXT,
        adapter_type      TEXT,
        widget_profile    TEXT NOT NULL DEFAULT 'standard',
        access_scope      TEXT NOT NULL DEFAULT 'global',
        realtime_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
        density_mode      TEXT NOT NULL DEFAULT 'standard',
        default_time_range TEXT NOT NULL DEFAULT '24h'
      )
    `);
    // Add adapter metadata columns if table already existed without them
    await client.query(`ALTER TABLE portal_module_assignments ADD COLUMN IF NOT EXISTS adapter_type       TEXT`);
    await client.query(`ALTER TABLE portal_module_assignments ADD COLUMN IF NOT EXISTS widget_profile     TEXT NOT NULL DEFAULT 'standard'`);
    await client.query(`ALTER TABLE portal_module_assignments ADD COLUMN IF NOT EXISTS access_scope       TEXT NOT NULL DEFAULT 'global'`);
    await client.query(`ALTER TABLE portal_module_assignments ADD COLUMN IF NOT EXISTS realtime_enabled   BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE portal_module_assignments ADD COLUMN IF NOT EXISTS density_mode       TEXT NOT NULL DEFAULT 'standard'`);
    await client.query(`ALTER TABLE portal_module_assignments ADD COLUMN IF NOT EXISTS default_time_range TEXT NOT NULL DEFAULT '24h'`);

    // portal_sections — DB-driven section tabs per portal
    await client.query(`
      CREATE TABLE IF NOT EXISTS portal_sections (
        id          SERIAL PRIMARY KEY,
        portal_id   TEXT NOT NULL REFERENCES portal_definitions(slug) ON DELETE CASCADE,
        section_key TEXT NOT NULL,
        title       TEXT NOT NULL,
        icon        TEXT NOT NULL DEFAULT 'circle',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // user_favorites — pinned strip bookmarks
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        id         SERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        module_key TEXT NOT NULL,
        portal_key TEXT,
        label      TEXT,
        icon       TEXT NOT NULL DEFAULT 'circle',
        route      TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_user_module_uidx
        ON user_favorites (user_id, module_key)
    `);

    // ── NOC Incident Command Center tables (added 2026-05-28) ─────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS noc_incidents (
        id               SERIAL PRIMARY KEY,
        title            VARCHAR(255) NOT NULL,
        type             VARCHAR(32)  NOT NULL DEFAULT 'manual',
        severity         VARCHAR(20)  NOT NULL DEFAULT 'medium',
        status           VARCHAR(20)  NOT NULL DEFAULT 'open',
        entity_type      VARCHAR(32),
        entity_id        VARCHAR(128),
        entity_name      VARCHAR(255),
        description      TEXT,
        suggested_action TEXT,
        assignee_id      VARCHAR(255),
        assignee_name    VARCHAR(255),
        source           VARCHAR(64)  NOT NULL DEFAULT 'manual',
        tags             TEXT[]       NOT NULL DEFAULT '{}',
        opened_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
        acknowledged_at  TIMESTAMP,
        mitigated_at     TIMESTAMP,
        resolved_at      TIMESTAMP,
        updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS noc_incident_events (
        id          SERIAL PRIMARY KEY,
        incident_id INTEGER     NOT NULL,
        event_type  VARCHAR(32) NOT NULL,
        from_status VARCHAR(20),
        to_status   VARCHAR(20),
        actor_id    VARCHAR(255),
        actor_name  VARCHAR(255) NOT NULL DEFAULT 'system',
        note        TEXT,
        metadata    JSONB,
        created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS noc_incident_events_incident_idx
        ON noc_incident_events (incident_id, created_at DESC)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS noc_incident_assignments (
        id          SERIAL PRIMARY KEY,
        incident_id INTEGER      NOT NULL,
        user_id     VARCHAR(255) NOT NULL,
        user_name   VARCHAR(255) NOT NULL,
        assigned_by VARCHAR(255),
        assigned_at TIMESTAMP    NOT NULL DEFAULT NOW(),
        is_active   BOOLEAN      NOT NULL DEFAULT TRUE
      )
    `);

    // ── Messaging Intelligence Center: WhatsApp channel columns ───────────
    await client.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS channel      TEXT NOT NULL DEFAULT 'sms'`);
    await client.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS provider     TEXT`);
    await client.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS fallback_from INTEGER`);
    await client.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS latency_ms   INTEGER`);
    await client.query(`ALTER TABLE settings     ADD COLUMN IF NOT EXISTS otp_channel_policy TEXT`);

    // ── Meta WhatsApp Cloud API provider columns ───────────────────────────
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS meta_phone_number_id       VARCHAR(64)`);
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS meta_access_token          VARCHAR(512)`);
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS meta_otp_template_name     VARCHAR(128) DEFAULT 'otp_verification'`);
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS meta_otp_template_language VARCHAR(16)  DEFAULT 'en_us'`);
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS meta_use_otp_template      BOOLEAN      DEFAULT true`);

    // ── Copilot result cache (added 2026-06-03) ───────────────────────────────
    // Persists the last successful AI Copilot result so the panel pre-populates
    // across server restarts and deployments (same 30-min TTL enforced in app).
    await client.query(`
      CREATE TABLE IF NOT EXISTS copilot_result_cache (
        id           SERIAL PRIMARY KEY,
        result       JSONB      NOT NULL,
        generated_at TIMESTAMP  NOT NULL DEFAULT NOW()
      )
    `);

    console.log('[db] Safe migrations applied.');
  } catch (err: any) {
    console.error('[db] Safe migration warning (non-fatal):', err.message);
  } finally {
    client.release();
  }
}
