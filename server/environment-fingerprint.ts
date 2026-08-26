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

/**
 * Is each billing table populated, and roughly how large?
 *
 * `populated` is EXACT and cheap — a single EXISTS. It is the field that matters,
 * because "empty" and "wrong database" look identical in every other output.
 *
 * `approxRows` is an ESTIMATE from pg_class.reltuples, refreshed by ANALYZE, and
 * is labelled as one everywhere it is shown. An exact count(*) over a table
 * holding 1.6M rows for a single account-week is a sequential scan, and a
 * provenance header that is itself slow will be the first thing removed. A
 * finance surface must never print an estimate as though it were a count — hence
 * the name, and hence `populated` being exact rather than derived from it. A
 * never-analysed table reports null rather than zero, since reltuples is -1
 * before its first ANALYZE and zero would read as empty.
 */
export interface TableVolume {
  populated:  boolean;
  approxRows: number | null;
}

export interface RepositoryVolumes {
  rawCdrs:              TableVolume;
  ratingVerifications:  TableVolume;
  invoiceCdrSnapshots:  TableVolume;
  dmrRows:              TableVolume;
  invoices:             TableVolume;
}

export interface EnvironmentFingerprint {
  /** Which commit is running — from the same source as /api/build. */
  build:       Record<string, any>;
  /** When this answer was produced, UTC. */
  generatedAt: string;
  database:    DatabaseFingerprint | { error: string };
  clock:       ClockFingerprint;
  repository:  RepositoryVolumes | { error: string };
}

const vol = (populated: any, approx: any): TableVolume => ({
  populated: Boolean(populated),
  approxRows: approx == null ? null : Number(approx),
});

export async function repositoryVolumes(): Promise<RepositoryVolumes | { error: string }> {
  try {
    const r = await db.execute(sql`
      SELECT EXISTS(SELECT 1 FROM raw_sippy_cdrs)        AS raw_pop,
             EXISTS(SELECT 1 FROM rating_verifications)  AS ver_pop,
             EXISTS(SELECT 1 FROM invoice_cdr_snapshots) AS snap_pop,
             EXISTS(SELECT 1 FROM daily_minutes_reports) AS dmr_pop,
             EXISTS(SELECT 1 FROM invoices)              AS inv_pop,
             (SELECT CASE WHEN reltuples < 0 THEN NULL ELSE reltuples::bigint END
                FROM pg_class WHERE oid = 'raw_sippy_cdrs'::regclass)        AS raw_approx,
             (SELECT CASE WHEN reltuples < 0 THEN NULL ELSE reltuples::bigint END
                FROM pg_class WHERE oid = 'rating_verifications'::regclass)  AS ver_approx,
             (SELECT CASE WHEN reltuples < 0 THEN NULL ELSE reltuples::bigint END
                FROM pg_class WHERE oid = 'invoice_cdr_snapshots'::regclass) AS snap_approx,
             (SELECT CASE WHEN reltuples < 0 THEN NULL ELSE reltuples::bigint END
                FROM pg_class WHERE oid = 'daily_minutes_reports'::regclass) AS dmr_approx,
             (SELECT CASE WHEN reltuples < 0 THEN NULL ELSE reltuples::bigint END
                FROM pg_class WHERE oid = 'invoices'::regclass)              AS inv_approx`);
    const x = ((r as any).rows ?? [])[0] ?? {};
    return {
      rawCdrs:             vol(x.raw_pop,  x.raw_approx),
      ratingVerifications: vol(x.ver_pop,  x.ver_approx),
      invoiceCdrSnapshots: vol(x.snap_pop, x.snap_approx),
      dmrRows:             vol(x.dmr_pop,  x.dmr_approx),
      invoices:            vol(x.inv_pop,  x.inv_approx),
    };
  } catch (e: any) {
    return { error: e.message };
  }
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
  const { getBuildInfo } = await import('./build-info');
  const [database, repository] = await Promise.all([
    databaseFingerprint(),
    repositoryVolumes(),
  ]);
  return {
    build:       { ...getBuildInfo() },
    generatedAt: new Date().toISOString(),
    database,
    clock:       clockFingerprint(),
    repository,
  };
}
