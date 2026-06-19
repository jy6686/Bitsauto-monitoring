/**
 * cdr-recon.service.ts
 *
 * CDR-Level Dispute Reconciliation Service
 * Parses a counterparty Excel CDR file, matches each call against our
 * invoice_cdr_snapshots records, classifies each row, and persists the
 * session + rows to cdr_recon_sessions / cdr_recon_rows.
 */

import * as XLSX from 'xlsx';
import { db } from '../../db';
import { invoiceCdrSnapshots } from '@shared/schema';
import { and, gte, lte } from 'drizzle-orm';
import { Pool } from 'pg';

const DURATION_TOLERANCE_SEC = 10;

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  cli: string;
  cld: string;
  startTime: Date | null;
  durationSec: number;
  cost: number;
}

export interface ReconRow {
  cli: string;
  cld: string;
  startTime: Date | null;
  theirDuration: number;
  ourDuration: number | null;
  delta: number | null;
  theirCost: number;
  ourCost: number | null;
  matchStatus: 'matched' | 'duration_mismatch' | 'missing_ours' | 'extra_ours';
  sippyCallId: string | null;
}

export interface ReconStats {
  total: number;
  matched: number;
  durationMismatch: number;
  missingOurs: number;
  extraOurs: number;
}

export interface ReconSession {
  id: number;
  sessionType: string;
  partyName: string;
  billingPeriod: string;
  uploadedAt: string;
  totalRows: number;
  matched: number;
  durationMismatch: number;
  missingOurs: number;
  extraOurs: number;
  notes: string | null;
}

// ── Parse uploaded xlsx ───────────────────────────────────────────────────────

export function parseXLSXToCDRs(buf: Buffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  if (!wb.SheetNames.length) return [];

  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

  return raw
    .map(row => {
      // Accept various column name conventions
      const cli = normalise(
        row.cli ?? row.CLI ?? row.caller ?? row.from_number ?? row.a_number ?? row['A Number'] ?? ''
      );
      const cld = normalise(
        row.cld ?? row.CLD ?? row.callee ?? row.to_number ?? row.b_number ?? row['B Number'] ??
        row.destination ?? row.Destination ?? ''
      );
      const startRaw =
        row.start_time ?? row['Start Time'] ?? row.start ?? row.date ?? row.call_date ??
        row.timestamp ?? row.Timestamp ?? row.Date ?? '';
      const durationRaw =
        row.duration ?? row.Duration ?? row.duration_sec ?? row.billsec ?? row.Billsec ??
        row.duration_seconds ?? row.seconds ?? row['Duration (sec)'] ?? 0;
      const costRaw =
        row.cost ?? row.Cost ?? row.amount ?? row.Amount ?? row.charge ?? row.billed ??
        row['Cost (USD)'] ?? 0;

      let startTime: Date | null = null;
      if (startRaw instanceof Date) {
        startTime = startRaw;
      } else if (startRaw) {
        const d = new Date(String(startRaw));
        if (!isNaN(d.getTime())) startTime = d;
      }

      return {
        cli,
        cld,
        startTime,
        durationSec: Math.round(Math.max(0, Number(durationRaw) || 0)),
        cost: Number(costRaw) || 0,
      };
    })
    .filter(r => r.cld.length > 0);
}

function normalise(v: any): string {
  return String(v ?? '').trim().replace(/\s+/g, '');
}

// ── Match uploaded rows against our snapshots ─────────────────────────────────

async function fetchOurCDRs(billingPeriod: string) {
  const [year, month] = billingPeriod.split('-');
  if (!year || !month) return [];
  const periodStart = `${year}-${month}-01`;
  // Last day of month — overshooting is fine because the lte uses T23:59:59
  const periodEnd = `${year}-${month}-31`;

  return db
    .select()
    .from(invoiceCdrSnapshots)
    .where(
      and(
        gte(invoiceCdrSnapshots.cdrStartTime, periodStart),
        lte(invoiceCdrSnapshots.cdrStartTime, periodEnd + 'T23:59:59'),
      ),
    )
    .limit(1_000_000);
}

function matchRows(
  uploaded: ParsedRow[],
  ourRows: Awaited<ReturnType<typeof fetchOurCDRs>>,
): { rows: ReconRow[]; extraOurs: number } {
  // Build lookup: normalised CLD + date → our CDR rows (array, may have dupes)
  type OurEntry = { row: typeof ourRows[0]; used: boolean };
  const lookup = new Map<string, OurEntry[]>();

  for (const r of ourRows) {
    if (!r.callee || !r.cdrStartTime) continue;
    const cldKey = normalise(r.callee);
    const dateStr = String(r.cdrStartTime).substring(0, 10);
    const k = `${cldKey}|${dateStr}`;
    if (!lookup.has(k)) lookup.set(k, []);
    lookup.get(k)!.push({ row: r, used: false });
  }

  const reconRows: ReconRow[] = [];

  for (const up of uploaded) {
    const cldKey = normalise(up.cld);
    const dateStr = up.startTime ? up.startTime.toISOString().substring(0, 10) : null;

    if (!dateStr || !cldKey) {
      reconRows.push(makeRow(up, null, 'missing_ours'));
      continue;
    }

    const candidates = lookup.get(`${cldKey}|${dateStr}`) ?? [];
    // Find unused candidate with closest duration
    let bestEntry: OurEntry | null = null;
    let bestDelta = Infinity;

    for (const entry of candidates) {
      if (entry.used) continue;
      const d = Math.abs((entry.row.durationSecs ?? 0) - up.durationSec);
      if (d < bestDelta) {
        bestDelta = d;
        bestEntry = entry;
      }
    }

    if (!bestEntry) {
      reconRows.push(makeRow(up, null, 'missing_ours'));
    } else {
      bestEntry.used = true;
      const ourDur = bestEntry.row.durationSecs ?? 0;
      const delta = up.durationSec - ourDur;
      const status = Math.abs(delta) <= DURATION_TOLERANCE_SEC ? 'matched' : 'duration_mismatch';
      reconRows.push({
        cli: up.cli,
        cld: up.cld,
        startTime: up.startTime,
        theirDuration: up.durationSec,
        ourDuration: ourDur,
        delta,
        theirCost: up.cost,
        ourCost: bestEntry.row.reproducedCost ?? null,
        matchStatus: status,
        sippyCallId: bestEntry.row.cdrId ?? null,
      });
    }
  }

  // Count unused our-side rows (extra in our records)
  let extraOurs = 0;
  for (const entries of lookup.values()) {
    for (const e of entries) if (!e.used) extraOurs++;
  }

  return { rows: reconRows, extraOurs };
}

function makeRow(up: ParsedRow, _our: null, status: ReconRow['matchStatus']): ReconRow {
  return {
    cli: up.cli,
    cld: up.cld,
    startTime: up.startTime,
    theirDuration: up.durationSec,
    ourDuration: null,
    delta: null,
    theirCost: up.cost,
    ourCost: null,
    matchStatus: status,
    sippyCallId: null,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runCDRRecon(params: {
  sessionType: 'vendor' | 'client';
  partyName: string;
  billingPeriod: string;
  uploadBuffer: Buffer;
}): Promise<{ sessionId: number; stats: ReconStats }> {
  const uploaded = parseXLSXToCDRs(params.uploadBuffer);
  if (uploaded.length === 0) throw new Error('No valid rows found in uploaded file');

  const ourRows = await fetchOurCDRs(params.billingPeriod);
  const { rows, extraOurs } = matchRows(uploaded, ourRows);

  const stats: ReconStats = {
    total: rows.length,
    matched: rows.filter(r => r.matchStatus === 'matched').length,
    durationMismatch: rows.filter(r => r.matchStatus === 'duration_mismatch').length,
    missingOurs: rows.filter(r => r.matchStatus === 'missing_ours').length,
    extraOurs,
  };

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sessionRes = await pool.query(
      `INSERT INTO cdr_recon_sessions
         (session_type, party_name, billing_period, total_rows, matched, duration_mismatch, missing_ours, extra_ours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [params.sessionType, params.partyName, params.billingPeriod,
       stats.total, stats.matched, stats.durationMismatch, stats.missingOurs, stats.extraOurs],
    );
    const sessionId: number = sessionRes.rows[0].id;

    // Insert rows in batches of 500
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const vals: any[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const r of batch) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        );
        vals.push(
          sessionId,
          r.cli || null,
          r.cld || null,
          r.startTime,
          r.theirDuration,
          r.ourDuration,
          r.delta,
          r.theirCost || null,
          r.ourCost,
          r.matchStatus,
          r.sippyCallId,
        );
      }
      await pool.query(
        `INSERT INTO cdr_recon_rows
           (session_id,cli,cld,start_time,their_duration,our_duration,delta,their_cost,our_cost,match_status,sippy_call_id)
         VALUES ${placeholders.join(',')}`,
        vals,
      );
    }

    return { sessionId, stats };
  } finally {
    await pool.end();
  }
}

// ── Export session rows as xlsx ───────────────────────────────────────────────

export async function buildCDRReconXLSX(sessionId: number): Promise<Buffer> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sessionRes = await pool.query(
      `SELECT * FROM cdr_recon_sessions WHERE id = $1`, [sessionId],
    );
    if (!sessionRes.rows.length) throw new Error('Session not found');
    const session = sessionRes.rows[0];

    const rowsRes = await pool.query(
      `SELECT cli,cld,start_time,their_duration,our_duration,delta,their_cost,our_cost,match_status,sippy_call_id
       FROM cdr_recon_rows WHERE session_id = $1 ORDER BY match_status, id`,
      [sessionId],
    );

    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryData = [
      ['Field', 'Value'],
      ['Session ID', session.id],
      ['Type', session.session_type],
      ['Party', session.party_name],
      ['Billing Period', session.billing_period],
      ['Uploaded At', session.uploaded_at],
      ['Total Rows', session.total_rows],
      ['Matched', session.matched],
      ['Duration Mismatch', session.duration_mismatch],
      ['Missing from Our Records', session.missing_ours],
      ['Extra in Our Records', session.extra_ours],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Summary');

    // CDR Diff sheet
    const headers = [
      'CLI', 'CLD', 'Start Time', 'Their Duration (s)', 'Our Duration (s)',
      'Delta (s)', 'Their Cost', 'Our Cost', 'Match Status', 'Sippy Call ID',
    ];
    const dataRows = rowsRes.rows.map((r: any) => [
      r.cli ?? '',
      r.cld ?? '',
      r.start_time ? new Date(r.start_time).toISOString() : '',
      r.their_duration ?? '',
      r.our_duration ?? '',
      r.delta ?? '',
      r.their_cost ?? '',
      r.our_cost ?? '',
      r.match_status,
      r.sippy_call_id ?? '',
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...dataRows]), 'CDR Diff');

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  } finally {
    await pool.end();
  }
}
