
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

    console.log('[db] Safe migrations applied.');
  } catch (err: any) {
    console.error('[db] Safe migration warning (non-fatal):', err.message);
  } finally {
    client.release();
  }
}
