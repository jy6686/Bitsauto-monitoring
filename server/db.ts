
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
    console.log('[db] Safe migrations applied.');
  } catch (err: any) {
    console.error('[db] Safe migration warning (non-fatal):', err.message);
  } finally {
    client.release();
  }
}
