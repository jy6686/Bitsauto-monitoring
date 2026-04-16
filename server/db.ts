
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
