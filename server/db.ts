
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
    // Add admin_web_password to switches (added 2026-04-17 — web portal login password
    // for secondary switches when it differs from the XML-RPC API password)
    await client.query(`
      ALTER TABLE switches
        ADD COLUMN IF NOT EXISTS admin_web_password VARCHAR(255)
    `);
    console.log('[db] Safe migrations applied.');
  } catch (err: any) {
    console.error('[db] Safe migration warning (non-fatal):', err.message);
  } finally {
    client.release();
  }
}
