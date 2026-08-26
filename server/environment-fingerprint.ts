/**
 * environment-fingerprint.ts — which database and which clock produced an answer.
 *
 * Every diagnostic must be able to say where its numbers came from, because a
 * valid query against the wrong data source returns a confident wrong answer and
 * nothing in the output reveals it.
 *
 * This has now cost six rounds of debugging on separate occasions. The workspace
 * shell's DATABASE_URL is not the deployed app's: a psql session reported an
 * EMPTY raw_sippy_cdrs and 24 companies while the running app held 804 snapshots
 * and 49. Every conclusion drawn from that session was about the wrong database,
 * and the session gave no sign of it — the table existed, the query parsed, the
 * result was simply empty.
 *
 * The counts are the fingerprint an operator compares in one glance: if
 * `companies` disagrees between /api/build and their psql prompt, they are not
 * looking at the same database, and no further query is worth running until that
 * is resolved.
 *
 * Extracted from /api/build so both it and the completeness diagnostic report the
 * SAME shape from the SAME query. Two fingerprints that could drift would defeat
 * the comparison they exist to enable.
 *
 * Host and database name only — never credentials.
 */

import { sql } from 'drizzle-orm';
import { db } from './db';

export interface DatabaseFingerprint {
  name: string | null;
  host: string | null;
  port: number | null;
  counts: {
    companies: number | null;
    schedules: number | null;
    snapshots: number | null;
    invoices:  number | null;
  };
}

export interface ClockFingerprint {
  /** The server's IANA zone, or 'unknown'. */
  timezone: string;
  /** False means offsetless date parsing shifts by the local offset. */
  utc: boolean;
}

export interface EnvironmentFingerprint {
  database: DatabaseFingerprint | { error: string };
  clock:    ClockFingerprint;
}

export async function databaseFingerprint(): Promise<DatabaseFingerprint | { error: string }> {
  try {
    const d = await db.execute(sql`
      SELECT current_database() AS db,
             coalesce(host(inet_server_addr())::text, 'local') AS host,
             inet_server_port() AS port,
             (SELECT count(*)::int FROM companies)             AS companies,
             (SELECT count(*)::int FROM invoice_schedules)     AS schedules,
             (SELECT count(*)::int FROM invoice_cdr_snapshots) AS snapshots,
             (SELECT count(*)::int FROM invoices)              AS invoices`);
    const d0 = ((d as any).rows ?? [])[0] ?? {};
    return {
      name: d0.db ?? null,
      host: d0.host ?? null,
      port: d0.port ?? null,
      counts: {
        companies: d0.companies ?? null,
        schedules: d0.schedules ?? null,
        snapshots: d0.snapshots ?? null,
        invoices:  d0.invoices  ?? null,
      },
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

/**
 * Whether this process treats an offsetless date-time as UTC.
 *
 * Not merely a zone-name check: a host can be configured in a zone whose offset
 * is zero, and what actually matters is how `new Date('2026-01-01T00:00:00')`
 * resolves — which is what the CDR fetch window depends on.
 */
export function clockFingerprint(): ClockFingerprint {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  const utc = new Date('2026-01-01T00:00:00').getUTCHours() === 0;
  return { timezone, utc };
}

export async function environmentFingerprint(): Promise<EnvironmentFingerprint> {
  return { database: await databaseFingerprint(), clock: clockFingerprint() };
}
