
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { is, getTableName, getTableColumns } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { is, getTableName, getTableColumns } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 25,                   // raised from 10 — 274 concurrent calls need headroom
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});
// Pool health monitor — logs every 30s so we can spot starvation
setInterval(() => {
  if (pool.waitingCount > 0 || pool.totalCount >= 20) {
    console.warn(`[db-pool] total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`);
  }
}, 30_000);

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

    // ── Dual-approval TTL setting ─────────────────────────────────────────────
    // Allows admins to configure the pending-approval expiry window from the UI.
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS dual_approval_ttl_minutes INTEGER DEFAULT 30`);

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

    // ── Approval expiry out-of-band notifications ──────────────────────────────
    // Global email/Slack settings for notifying operators when a pending approval
    // expires, plus a per-operator opt-out flag on watcher_recipients.
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS approval_expiry_email_enabled BOOLEAN DEFAULT true`);
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS approval_expiry_slack_webhook_url VARCHAR(512)`);
    await client.query(`ALTER TABLE watcher_recipients ADD COLUMN IF NOT EXISTS notify_approval_expiry BOOLEAN NOT NULL DEFAULT true`);

    // ── SIP OPTIONS Vendor Probe Results (added 2026-06-04) ───────────────────
    // Stores one row per probe attempt per vendor connection.
    // Pruned automatically to the last 2 000 rows per vendor by the probe engine.
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_probe_results (
        id                SERIAL PRIMARY KEY,
        vendor_id         VARCHAR(32)  NOT NULL,
        vendor_name       VARCHAR(255),
        connection_id     VARCHAR(32),
        connection_name   VARCHAR(255),
        host              VARCHAR(255),
        port              INTEGER      DEFAULT 5060,
        probed_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
        latency_ms        INTEGER,
        sip_response_code INTEGER,
        reachable         BOOLEAN      NOT NULL DEFAULT FALSE,
        error             VARCHAR(255)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS vpr_vendor_probed_idx
        ON vendor_probe_results (vendor_id, probed_at DESC)
    `);

    // ── SSL Certificate Status table (added 2026-06-04) ─────────────────────
    // Stores the latest per-cert status snapshot so the SSL monitor survives
    // server restarts without losing state. One row per certId (upserted hourly).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ssl_cert_status (
        cert_id        TEXT        PRIMARY KEY,
        subject        TEXT        NOT NULL,
        issuer         TEXT,
        expires_at     TIMESTAMP,
        days_remaining INTEGER     NOT NULL DEFAULT 0,
        status         TEXT        NOT NULL DEFAULT 'ok',
        source         TEXT        NOT NULL DEFAULT 'sippy_api',
        auto_renew     BOOLEAN     NOT NULL DEFAULT FALSE,
        checked_at     TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);

    // ── Route Intelligence snapshots (added 2026-06-04) ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS route_quality_snapshots (
        id             SERIAL PRIMARY KEY,
        vendor_id      VARCHAR(64)  NOT NULL,
        vendor_name    VARCHAR(128) NOT NULL,
        prefix         VARCHAR(32)  NOT NULL,
        window_hours   INTEGER      NOT NULL,
        computed_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
        call_count     INTEGER      NOT NULL DEFAULT 0,
        answered_count INTEGER      NOT NULL DEFAULT 0,
        asr            REAL,
        acd_seconds    REAL,
        pdd_ms         REAL,
        total_cost_usd REAL,
        revenue_usd    REAL,
        margin_usd     REAL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rqs_vendor_prefix_window
        ON route_quality_snapshots (vendor_id, prefix, window_hours, computed_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rqs_computed_at
        ON route_quality_snapshots (computed_at DESC)
    `);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS revenue_usd REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS margin_usd  REAL`);
    // SIP error rate columns (Task #146) — tracked codes: 503, 486, 480, 408, 404, 403
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS rate_503    REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS rate_486    REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS rate_480    REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS rate_408    REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS rate_404    REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS rate_403    REAL`);
    await client.query(`ALTER TABLE route_quality_snapshots ADD COLUMN IF NOT EXISTS spike_flags JSONB`);

    // ── Account cap monitoring tables ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS account_caps (
        account_id        VARCHAR(64)  PRIMARY KEY,
        account_name      TEXT,
        session_limit     INTEGER,
        cps_limit         INTEGER,
        warning_threshold INTEGER      NOT NULL DEFAULT 90,
        critical_threshold INTEGER     NOT NULL DEFAULT 100,
        synced_at         TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cap_alert_events (
        id               SERIAL       PRIMARY KEY,
        account_id       VARCHAR(64)  NOT NULL,
        account_name     TEXT,
        cap_type         VARCHAR(32)  NOT NULL,
        utilisation_pct  INTEGER      NOT NULL,
        current_value    INTEGER      NOT NULL,
        limit_value      INTEGER      NOT NULL,
        severity         VARCHAR(16)  NOT NULL,
        triggered_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
        resolved_at      TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cap_alert_events_account_triggered ON cap_alert_events (account_id, triggered_at DESC)`);

    // ── Route Testing Engine tables ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS route_test_jobs (
        id                  SERIAL PRIMARY KEY,
        name                VARCHAR(256) NOT NULL,
        destination_prefix  VARCHAR(64)  NOT NULL,
        vendor_ids          TEXT[]       NOT NULL DEFAULT '{}',
        vendor_names        TEXT[]       NOT NULL DEFAULT '{}',
        schedule_minutes    INTEGER      NOT NULL DEFAULT 0,
        enabled             BOOLEAN      NOT NULL DEFAULT true,
        created_by          VARCHAR(128),
        last_run_at         TIMESTAMP,
        next_run_at         TIMESTAMP,
        created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS route_test_results (
        id           SERIAL PRIMARY KEY,
        job_id       INTEGER REFERENCES route_test_jobs(id) ON DELETE SET NULL,
        vendor_id    VARCHAR(128),
        vendor_name  VARCHAR(256),
        destination  VARCHAR(64),
        started_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
        connected    BOOLEAN      NOT NULL DEFAULT false,
        sip_code     INTEGER,
        pdd_ms       INTEGER,
        duration_ms  INTEGER,
        cli_received VARCHAR(64),
        notes        TEXT,
        raw_response JSONB
      )
    `);

    // ── Balance Alert Engine tables (added 2026-06-04) ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS balance_alert_thresholds (
        id           SERIAL PRIMARY KEY,
        account_id   VARCHAR(32),
        account_name VARCHAR(128),
        threshold_usd REAL NOT NULL,
        severity     VARCHAR(16) NOT NULL DEFAULT 'warning',
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS balance_alert_events (
        id                   SERIAL PRIMARY KEY,
        account_id           VARCHAR(32)  NOT NULL,
        account_name         VARCHAR(128),
        threshold_usd        REAL         NOT NULL,
        severity             VARCHAR(16)  NOT NULL,
        current_balance      REAL         NOT NULL,
        triggered_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
        resolved_at          TIMESTAMP,
        checked_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
        notification_sent_at TIMESTAMP
      )
    `);
    await client.query(`ALTER TABLE balance_alert_events ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMP`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS balance_alert_notification_settings (
        id                SERIAL PRIMARY KEY,
        email_list        TEXT,
        webhook_url       VARCHAR(512),
        notify_on_warning BOOLEAN NOT NULL DEFAULT true,
        notify_on_urgent  BOOLEAN NOT NULL DEFAULT true,
        notify_on_critical BOOLEAN NOT NULL DEFAULT true,
        enabled           BOOLEAN NOT NULL DEFAULT true,
        updated_at        TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── RTP / MOS Quality Stats (added 2026-06-04) ────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS rtp_quality_stats (
        id                  SERIAL PRIMARY KEY,
        vendor_id           VARCHAR(128) NOT NULL,
        destination_prefix  VARCHAR(32),
        window_minutes      INTEGER      NOT NULL,
        avg_mos             REAL,
        p10_mos             REAL,
        avg_jitter_ms       REAL,
        avg_pkt_loss_pct    REAL,
        avg_latency_ms      REAL,
        sample_count        INTEGER      NOT NULL DEFAULT 0,
        computed_at         TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS rtp_quality_stats_uidx
        ON rtp_quality_stats (vendor_id, destination_prefix, window_minutes)
    `);
    await client.query(`
      ALTER TABLE rtp_quality_stats ADD COLUMN IF NOT EXISTS avg_latency_ms REAL
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_email_log (
        id              SERIAL PRIMARY KEY,
        sent_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
        sender_user_id  VARCHAR(128),
        sender_name     VARCHAR(255),
        recipient_email VARCHAR(320) NOT NULL,
        report_type     VARCHAR(16)  NOT NULL,
        format          VARCHAR(8)   NOT NULL,
        filename        VARCHAR(255),
        subject         VARCHAR(500),
        status          VARCHAR(16)  NOT NULL DEFAULT 'sent',
        error_message   TEXT
      )
    `);
    // ── Invoice SMTP + SIP error threshold columns (added 2026-06-04) ─────────
    // These were defined in shared/schema.ts but the ALTER TABLE was never applied,
    // causing getSettings() to fail and blocking Sippy auto-connect on every startup.
    await client.query(`
      ALTER TABLE settings
        ADD COLUMN IF NOT EXISTS invoice_smtp_host        VARCHAR(255),
        ADD COLUMN IF NOT EXISTS invoice_smtp_port        INTEGER DEFAULT 587,
        ADD COLUMN IF NOT EXISTS invoice_smtp_secure      BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS invoice_smtp_user        VARCHAR(255),
        ADD COLUMN IF NOT EXISTS invoice_smtp_pass        VARCHAR(512),
        ADD COLUMN IF NOT EXISTS invoice_smtp_from_name   VARCHAR(255) DEFAULT 'Ichibaan Logic Billing',
        ADD COLUMN IF NOT EXISTS invoice_smtp_from_email  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS sip_error_alert_threshold REAL DEFAULT 15
    `);
    // ── CDR-Level Dispute Reconciliation tables (incoming from main) ─────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cdr_recon_sessions (
        id               SERIAL PRIMARY KEY,
        session_type     VARCHAR(10)  NOT NULL CHECK (session_type IN ('vendor', 'client')),
        party_name       VARCHAR(255) NOT NULL,
        billing_period   VARCHAR(20)  NOT NULL,
        uploaded_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        total_rows       INTEGER DEFAULT 0,
        matched          INTEGER DEFAULT 0,
        duration_mismatch INTEGER DEFAULT 0,
        missing_ours     INTEGER DEFAULT 0,
        extra_ours       INTEGER DEFAULT 0,
        notes            TEXT
      );
      CREATE TABLE IF NOT EXISTS cdr_recon_rows (
        id              SERIAL PRIMARY KEY,
        session_id      INTEGER NOT NULL REFERENCES cdr_recon_sessions(id) ON DELETE CASCADE,
        cli             VARCHAR(100),
        cld             VARCHAR(100),
        start_time      TIMESTAMP WITH TIME ZONE,
        their_duration  INTEGER,
        our_duration    INTEGER,
        delta           INTEGER,
        their_cost      NUMERIC(14,6),
        our_cost        NUMERIC(14,6),
        match_status    VARCHAR(30) NOT NULL,
        sippy_call_id   VARCHAR(100)
      );
      CREATE INDEX IF NOT EXISTS idx_cdr_recon_rows_session_id ON cdr_recon_rows(session_id);
      CREATE INDEX IF NOT EXISTS idx_cdr_recon_rows_status     ON cdr_recon_rows(session_id, match_status);
    `);

    // ── ACD as quality signal in carrier scoring (added 2026-06-04) ───────────
    // avg_acd_secs stores Average Call Duration (seconds) per carrier window so
    // the vendor health engine can use persisted ACD after a server restart.
    await client.query(`
      ALTER TABLE carrier_quality_scores
        ADD COLUMN IF NOT EXISTS avg_acd_secs REAL
    `);

    // ── Meta WhatsApp Flows columns (migration 025) ───────────────────────────
    await client.query(`
      ALTER TABLE settings
        ADD COLUMN IF NOT EXISTS meta_flow_id          VARCHAR(64),
        ADD COLUMN IF NOT EXISTS meta_waba_id          VARCHAR(64),
        ADD COLUMN IF NOT EXISTS meta_flows_enabled    BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS meta_flows_public_key TEXT
    `);

    // ── Route test CLI columns (migration 026) ────────────────────────────────
    await client.query(`ALTER TABLE route_test_jobs    ADD COLUMN IF NOT EXISTS cli_to_send VARCHAR(32)`);
    await client.query(`ALTER TABLE route_test_results ADD COLUMN IF NOT EXISTS cli_sent    VARCHAR(32)`);
    await client.query(`ALTER TABLE route_test_results ADD COLUMN IF NOT EXISTS cli_match   VARCHAR(16)`);

    // ── Companies wizard draft (migration 027) ────────────────────────────────
    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS wizard_draft TEXT`);

    // ── SMS OTP retry + Flow verification columns (migration 028) ─────────────
    await client.query(`
      ALTER TABLE sms_messages
        ADD COLUMN IF NOT EXISTS retry_count   INTEGER   NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS flow_token    VARCHAR(64),
        ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMP
    `);

    // ── Client Identity Map + Workspace Navigation (migration 029) ────────────
    await client.query(`
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
      )
    `);
    await client.query(`
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
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_tabs (
        id               SERIAL PRIMARY KEY,
        workspace_id     INTEGER NOT NULL,
        slug             TEXT NOT NULL,
        label            TEXT NOT NULL,
        icon             TEXT,
        sort_order       INTEGER DEFAULT 0,
        is_visible       BOOLEAN NOT NULL DEFAULT TRUE,
        visibility_roles TEXT[]
      )
    `);
    await client.query(`
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
      )
    `);
    // Ensure visibility_roles exists on tables created before migration 029 was corrected
    await client.query(`ALTER TABLE workspace_tab_items ADD COLUMN IF NOT EXISTS visibility_roles TEXT[]`);
    await client.query(`ALTER TABLE workspace_tabs      ADD COLUMN IF NOT EXISTS visibility_roles TEXT[]`);

    // ── Tables discovered missing by schema-derived check (migration 031) ────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cdr_anomaly_batches (
        id              SERIAL PRIMARY KEY,
        run_date        VARCHAR(12)  NOT NULL,
        account         VARCHAR(128) NOT NULL,
        metric          VARCHAR(32)  NOT NULL,
        baseline        REAL         NOT NULL,
        observed        REAL         NOT NULL,
        deviation_sigma REAL         NOT NULL,
        severity        VARCHAR(16)  NOT NULL,
        created_at      TIMESTAMP    DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoice_email_deliveries (
        id            SERIAL PRIMARY KEY,
        invoice_id    INTEGER      NOT NULL,
        recipients    TEXT         NOT NULL,
        cc_addresses  TEXT         DEFAULT '[]',
        subject       VARCHAR(512) NOT NULL,
        body_text     TEXT,
        sent_by       VARCHAR(255),
        status        VARCHAR(32)  NOT NULL DEFAULT 'sent',
        error_message TEXT,
        sent_at       TIMESTAMP    DEFAULT NOW(),
        created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_report_schedules (
        id             SERIAL PRIMARY KEY,
        name           VARCHAR(128) NOT NULL,
        report_type    VARCHAR(20)  NOT NULL DEFAULT 'carrier',
        recipients     TEXT         NOT NULL,
        format         VARCHAR(10)  NOT NULL DEFAULT 'pdf',
        frequency      VARCHAR(20)  NOT NULL DEFAULT 'monthly',
        day_of_month   INTEGER      DEFAULT 1,
        day_of_week    INTEGER,
        cron_hour      INTEGER      NOT NULL DEFAULT 8,
        carrier_tariff VARCHAR(64),
        enabled        BOOLEAN      NOT NULL DEFAULT true,
        last_sent_at   TIMESTAMP,
        next_due_at    TIMESTAMP,
        created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS rtp_quality_history (
        id               SERIAL PRIMARY KEY,
        vendor_id        VARCHAR(128) NOT NULL,
        avg_mos          REAL,
        p10_mos          REAL,
        avg_jitter_ms    REAL,
        avg_pkt_loss_pct REAL,
        avg_latency_ms   REAL,
        sample_count     INTEGER NOT NULL DEFAULT 0,
        snapped_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rqh_vendor_snapped ON rtp_quality_history (vendor_id, snapped_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_health_scores (
        id                SERIAL PRIMARY KEY,
        vendor_name       VARCHAR(128) NOT NULL,
        scored_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
        overall_score     REAL         NOT NULL,
        quality_score     REAL,
        reliability_score REAL,
        fraud_score       REAL,
        margin_score      REAL,
        trend             VARCHAR(16),
        trend_delta       REAL,
        details           JSONB
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_vhs_vendor_scored ON vendor_health_scores (vendor_name, scored_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS route_health_scores (
        id                  SERIAL PRIMARY KEY,
        routing_group_id    VARCHAR(64)  NOT NULL,
        routing_group_name  VARCHAR(256) NOT NULL,
        scored_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
        overall_score       REAL         NOT NULL,
        vendor_count        INTEGER      NOT NULL DEFAULT 0,
        lowest_vendor_score REAL,
        details             JSONB
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rhs_group_scored ON route_health_scores (routing_group_id, scored_at DESC)`);

    // ── Rate notification job destination snapshot (migration 032) ────────────
    await client.query(`ALTER TABLE rate_notification_jobs ADD COLUMN IF NOT EXISTS destination_snapshot TEXT`);

    // ── governed_calls channel indexes (prevent full-table scan on AMI hangup) ─
    await client.query(`CREATE INDEX IF NOT EXISTS idx_governed_calls_channel_a ON governed_calls (channel_a)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_governed_calls_channel_b ON governed_calls (channel_b)`);

    console.log('[db] Safe migrations applied.');
  } catch (err: any) {
    console.error('[db] Safe migration warning (non-fatal):', err.message);
  } finally {
    client.release();
  }
}

// ── Schema Sanity Check ────────────────────────────────────────────────────────
// Runs once at startup after runSafeMigrations(). Derives the full set of expected
// (table, column) pairs directly from the Drizzle schema module — no hand-maintained
// list required. Any column added to shared/schema.ts is automatically included.
//
// Queries information_schema.columns in one round-trip and logs a WARNING for every
// column that is defined in the schema but absent from the live database.
// The server still starts (non-fatal) so operators can diagnose from logs.

/** Auto-derive every (table_name, column_name) pair from the exported Drizzle schema. */
function deriveExpectedFromSchema(): Array<{ table: string; column: string }> {
  const result: Array<{ table: string; column: string }> = [];
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      const tableName = getTableName(value as PgTable);
      const columns = getTableColumns(value as PgTable);
      for (const col of Object.values(columns)) {
        result.push({ table: tableName, column: col.name });
      }
    }
  }
  return result;
}

export async function runSchemaCheck(): Promise<void> {
  const expected = deriveExpectedFromSchema();
  if (expected.length === 0) return;
  const client = await pool.connect();
  try {
    // Build a parameterised VALUES list for a single round-trip
    const values = expected.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const params = expected.flatMap(({ table, column }) => [table, column]);
    const result = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (${values})`,
      params,
    );
    const found = new Set(result.rows.map(r => `${r.table_name}.${r.column_name}`));
    const missing = expected.filter(({ table, column }) => !found.has(`${table}.${column}`));
    if (missing.length === 0) {
      console.log(`[db-schema] Sanity check passed — all ${expected.length} schema columns present.`);
    } else {
      for (const { table, column } of missing) {
        console.warn(`[db-schema] WARNING: missing column ${table}.${column} — add to runSafeMigrations()`);
      }
    }
  } catch (err: any) {
    console.warn('[db-schema] Schema check could not run (non-fatal):', err.message);
  } finally {
    client.release();
  }
}
