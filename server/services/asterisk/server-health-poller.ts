/**
 * Asterisk Server Health Poller
 * SSH into the Asterisk/FreePBX server every 60 seconds.
 * Collects: disk, memory, swap, load, MariaDB status, Asterisk status,
 *           SIP peer status, recording folder size, log folder size.
 * Stores snapshots in asterisk_server_snapshots; keeps 30 days of history.
 * Latest snapshot cached in memory for zero-latency API reads.
 */

import { Client as SshClient } from 'ssh2';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

export interface ServerHealthSnapshot {
  capturedAt: string;
  diskPct: number | null;
  diskFreeGb: number | null;
  diskTotalGb: number | null;
  memUsedPct: number | null;
  swapUsedPct: number | null;
  load1m: number | null;
  load5m: number | null;
  load15m: number | null;
  cpuCores: number | null;
  mariadbRunning: boolean | null;
  asteriskRunning: boolean | null;
  sipPeerOk: boolean | null;
  amiConnected: boolean | null;
  recordingFolderMb: number | null;
  logFolderMb: number | null;
  sshError: string | null;
  status: 'ok' | 'warning' | 'critical' | 'error';
}

export interface CleanupPreview {
  asteriskLogsMb: number;
  asteriskFullLogMb: number;
  fail2banLogsMb: number;
  freepbxLogsMb: number;
  tmpFilesMb: number;
  totalReclaimableMb: number;
  details: { path: string; sizeMb: number; action: string }[];
}

const HOST  = process.env.ASTERISK_HOST     ?? '159.223.32.59';
const USER  = process.env.ASTERISK_SSH_USER ?? 'root';
const PASS  = () => process.env.ASTERISK_SSH_PASSWORD ?? '';

let latestSnapshot: ServerHealthSnapshot | null = null;
let pollerTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

// ── SSH exec helper ───────────────────────────────────────────────────────────
function sshExec(cmd: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    let output = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; conn.end(); reject(new Error('SSH timeout')); }
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); done = true; conn.end(); reject(err); return; }
        stream.on('data', (d: Buffer) => { output += d.toString(); });
        stream.stderr.on('data', (d: Buffer) => { output += d.toString(); });
        stream.on('close', () => {
          clearTimeout(timer);
          if (!done) { done = true; conn.end(); resolve(output.trim()); }
        });
      });
    });

    conn.on('error', (e) => {
      clearTimeout(timer);
      if (!done) { done = true; reject(e); }
    });

    const password = PASS();
    if (!password) { clearTimeout(timer); reject(new Error('ASTERISK_SSH_PASSWORD not set')); return; }
    conn.connect({ host: HOST, port: 22, username: USER, password, readyTimeout: 12_000 });
  });
}

// ── Metric collection command ─────────────────────────────────────────────────
// Single round-trip: returns a line-per-metric text block
const COLLECT_CMD = [
  // Disk
  `DF=$(df -BG / 2>/dev/null | tail -1)`,
  `DISK_PCT=$(echo "$DF" | awk '{gsub(/%/,"",$5); print $5}')`,
  `DISK_FREE=$(echo "$DF" | awk '{gsub(/G/,"",$4); print $4}')`,
  `DISK_TOTAL=$(echo "$DF" | awk '{gsub(/G/,"",$2); print $2}')`,
  // Memory
  `MEM=$(free 2>/dev/null | grep Mem)`,
  `MEM_TOTAL=$(echo $MEM | awk '{print $2}')`,
  `MEM_USED=$(echo $MEM | awk '{print $3}')`,
  `MEM_PCT=$(awk "BEGIN{if($MEM_TOTAL>0) printf \\"%.0f\\", ($MEM_USED/$MEM_TOTAL)*100; else print 0}" 2>/dev/null || echo 0)`,
  `MEM_PCT=$(echo "$MEM" | awk '{if($2>0) printf "%.0f", ($3/$2)*100; else print 0}')`,
  // Swap
  `SWAP=$(free 2>/dev/null | grep Swap)`,
  `SWAP_PCT=$(echo "$SWAP" | awk '{if($2>0) printf "%.0f", ($3/$2)*100; else print 0}')`,
  // Load
  `LOAD=$(cat /proc/loadavg 2>/dev/null)`,
  `LOAD1=$(echo $LOAD | awk '{print $1}')`,
  `LOAD5=$(echo $LOAD | awk '{print $2}')`,
  `LOAD15=$(echo $LOAD | awk '{print $3}')`,
  `CORES=$(nproc 2>/dev/null || echo 1)`,
  // Services
  `MARIADB=$(systemctl is-active mariadb 2>/dev/null || systemctl is-active mysql 2>/dev/null || echo unknown)`,
  `ASTERISK=$(systemctl is-active asterisk 2>/dev/null || echo unknown)`,
  // SIP peer (fast timeout)
  `SIP=$(timeout 5 asterisk -rx "sip show peer sippy" 2>/dev/null | grep -i "Status" | head -1 | awk '{print $3}' || echo unknown)`,
  // Folder sizes
  `RECMB=$(du -sm /var/spool/asterisk/monitor 2>/dev/null | cut -f1 || echo 0)`,
  `LOGMB=$(du -sm /var/log/asterisk 2>/dev/null | cut -f1 || echo 0)`,
  // Output
  `echo "DISK_PCT:$DISK_PCT"`,
  `echo "DISK_FREE:$DISK_FREE"`,
  `echo "DISK_TOTAL:$DISK_TOTAL"`,
  `echo "MEM_PCT:$MEM_PCT"`,
  `echo "SWAP_PCT:$SWAP_PCT"`,
  `echo "LOAD1:$LOAD1"`,
  `echo "LOAD5:$LOAD5"`,
  `echo "LOAD15:$LOAD15"`,
  `echo "CORES:$CORES"`,
  `echo "MARIADB:$MARIADB"`,
  `echo "ASTERISK:$ASTERISK"`,
  `echo "SIP:$SIP"`,
  `echo "REC_MB:$RECMB"`,
  `echo "LOG_MB:$LOGMB"`,
].join('; ');

// ── Parse collected output ────────────────────────────────────────────────────
function parseMetrics(raw: string): Omit<ServerHealthSnapshot, 'capturedAt' | 'status' | 'sshError' | 'amiConnected'> {
  const kv: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  const n = (k: string) => { const v = parseFloat(kv[k] ?? ''); return isNaN(v) ? null : v; };
  const b = (k: string, ok = 'active') => kv[k] === ok ? true : kv[k] === 'unknown' ? null : false;

  return {
    diskPct:          n('DISK_PCT') !== null ? Math.round(n('DISK_PCT')!) : null,
    diskFreeGb:       n('DISK_FREE'),
    diskTotalGb:      n('DISK_TOTAL'),
    memUsedPct:       n('MEM_PCT') !== null ? Math.round(n('MEM_PCT')!) : null,
    swapUsedPct:      n('SWAP_PCT') !== null ? Math.round(n('SWAP_PCT')!) : null,
    load1m:           n('LOAD1'),
    load5m:           n('LOAD5'),
    load15m:          n('LOAD15'),
    cpuCores:         n('CORES') !== null ? Math.round(n('CORES')!) : null,
    mariadbRunning:   b('MARIADB'),
    asteriskRunning:  b('ASTERISK'),
    sipPeerOk:        kv['SIP'] === 'OK' || kv['SIP'] === 'Monitored' ? true : kv['SIP'] ? false : null,
    recordingFolderMb: n('REC_MB') !== null ? Math.round(n('REC_MB')!) : null,
    logFolderMb:      n('LOG_MB') !== null ? Math.round(n('LOG_MB')!) : null,
  };
}

// ── Derive overall status ─────────────────────────────────────────────────────
function deriveStatus(snap: Omit<ServerHealthSnapshot, 'capturedAt' | 'status'>): ServerHealthSnapshot['status'] {
  if (snap.sshError) return 'error';
  if (snap.diskPct !== null && snap.diskPct >= 90) return 'critical';
  if (snap.mariadbRunning === false) return 'critical';
  if (snap.asteriskRunning === false) return 'critical';
  if (snap.diskPct !== null && snap.diskPct >= 80) return 'warning';
  if (snap.memUsedPct !== null && snap.memUsedPct >= 90) return 'warning';
  if (snap.sipPeerOk === false) return 'warning';
  return 'ok';
}

// ── Persist snapshot to DB ────────────────────────────────────────────────────
async function persistSnapshot(snap: ServerHealthSnapshot): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO asterisk_server_snapshots (
        captured_at, disk_pct, disk_free_gb, disk_total_gb,
        mem_used_pct, swap_used_pct,
        load_1m, load_5m, load_15m, cpu_cores,
        mariadb_running, asterisk_running, sip_peer_ok, ami_connected,
        recording_folder_mb, log_folder_mb, ssh_error
      ) VALUES (
        NOW(),
        ${snap.diskPct}, ${snap.diskFreeGb}, ${snap.diskTotalGb},
        ${snap.memUsedPct}, ${snap.swapUsedPct},
        ${snap.load1m}, ${snap.load5m}, ${snap.load15m}, ${snap.cpuCores},
        ${snap.mariadbRunning}, ${snap.asteriskRunning}, ${snap.sipPeerOk}, ${snap.amiConnected},
        ${snap.recordingFolderMb}, ${snap.logFolderMb}, ${snap.sshError}
      )
    `);

    // Purge rows older than 30 days
    await db.execute(sql`
      DELETE FROM asterisk_server_snapshots
      WHERE captured_at < NOW() - INTERVAL '30 days'
    `);
  } catch (e: any) {
    console.error('[server-health] DB persist error:', e?.message);
  }
}

// ── Single poll cycle ─────────────────────────────────────────────────────────
export async function pollServerHealth(): Promise<ServerHealthSnapshot> {
  const password = PASS();
  if (!password) {
    const snap: ServerHealthSnapshot = {
      capturedAt: new Date().toISOString(),
      diskPct: null, diskFreeGb: null, diskTotalGb: null,
      memUsedPct: null, swapUsedPct: null,
      load1m: null, load5m: null, load15m: null, cpuCores: null,
      mariadbRunning: null, asteriskRunning: null, sipPeerOk: null, amiConnected: null,
      recordingFolderMb: null, logFolderMb: null,
      sshError: 'ASTERISK_SSH_PASSWORD not configured',
      status: 'error',
    };
    latestSnapshot = snap;
    return snap;
  }

  try {
    const raw = await sshExec(COLLECT_CMD, 30_000);
    const metrics = parseMetrics(raw);

    // AMI connected status from the global AMI governance listener
    const amiConnected = (() => {
      try {
        const { amiGovernance } = require('../asterisk/ami-governance');
        return amiGovernance?.isConnected?.() ?? null;
      } catch { return null; }
    })();

    const snap: ServerHealthSnapshot = {
      capturedAt: new Date().toISOString(),
      ...metrics,
      amiConnected,
      sshError: null,
      status: 'ok',
    };
    snap.status = deriveStatus(snap);

    latestSnapshot = snap;
    await persistSnapshot(snap);
    return snap;
  } catch (e: any) {
    console.error('[server-health] Poll error:', e?.message);
    const snap: ServerHealthSnapshot = {
      capturedAt: new Date().toISOString(),
      diskPct: null, diskFreeGb: null, diskTotalGb: null,
      memUsedPct: null, swapUsedPct: null,
      load1m: null, load5m: null, load15m: null, cpuCores: null,
      mariadbRunning: null, asteriskRunning: null, sipPeerOk: null, amiConnected: null,
      recordingFolderMb: null, logFolderMb: null,
      sshError: e?.message ?? 'SSH error',
      status: 'error',
    };
    latestSnapshot = snap;
    await persistSnapshot(snap);
    return snap;
  }
}

// ── Get cleanup preview via SSH ───────────────────────────────────────────────
export async function getCleanupPreview(): Promise<CleanupPreview> {
  const cmd = [
    `AST_FULL=$(du -sm /var/log/asterisk/full 2>/dev/null | cut -f1 || echo 0)`,
    `AST_LOGS=$(du -sm /var/log/asterisk 2>/dev/null | cut -f1 || echo 0)`,
    `FAIL2BAN=$(du -sm /var/log/fail2ban.log /var/log/fail2ban.log.1 2>/dev/null | awk '{s+=$1} END{print s}' || echo 0)`,
    `FPBX=$(du -sm /var/log/freepbx 2>/dev/null | cut -f1 || echo 0)`,
    `TMP=$(du -sm /tmp 2>/dev/null | cut -f1 || echo 0)`,
    `echo "AST_FULL:$AST_FULL"`,
    `echo "AST_LOGS:$AST_LOGS"`,
    `echo "FAIL2BAN:$FAIL2BAN"`,
    `echo "FPBX:$FPBX"`,
    `echo "TMP:$TMP"`,
  ].join('; ');

  const raw = await sshExec(cmd, 20_000);
  const kv: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    kv[line.slice(0, idx).trim()] = parseInt(line.slice(idx + 1).trim(), 10) || 0;
  }

  const astFull    = kv['AST_FULL']  || 0;
  const astLogs    = kv['AST_LOGS']  || 0;
  const fail2ban   = kv['FAIL2BAN']  || 0;
  const fpbx       = kv['FPBX']      || 0;
  const tmp        = kv['TMP']       || 0;

  const otherAstLogs = Math.max(0, astLogs - astFull);

  const details = [
    { path: '/var/log/asterisk/full',    sizeMb: astFull,      action: 'Truncate (logrotate)' },
    { path: '/var/log/asterisk/*.log',   sizeMb: otherAstLogs, action: 'Rotate/truncate older logs' },
    { path: '/var/log/fail2ban.log*',    sizeMb: fail2ban,     action: 'Truncate' },
    { path: '/var/log/freepbx/',         sizeMb: fpbx,         action: 'Truncate FreePBX logs' },
    { path: '/tmp/',                     sizeMb: tmp,          action: 'Clear temp files' },
  ];

  return {
    asteriskLogsMb:     astLogs,
    asteriskFullLogMb:  astFull,
    fail2banLogsMb:     fail2ban,
    freepbxLogsMb:      fpbx,
    tmpFilesMb:         tmp,
    totalReclaimableMb: astLogs + fail2ban + fpbx,
    details,
  };
}

// ── Execute disk cleanup via SSH ──────────────────────────────────────────────
export async function executeDiskCleanup(): Promise<{ reclaimedMb: number; log: string[] }> {
  const cmd = [
    `echo "START_CLEANUP"`,
    `truncate -s 0 /var/log/asterisk/full 2>/dev/null && echo "OK: truncated asterisk/full" || echo "WARN: could not truncate asterisk/full"`,
    `for f in /var/log/asterisk/*.log; do [ -f "$f" ] && truncate -s 0 "$f" 2>/dev/null && echo "OK: truncated $f"; done`,
    `truncate -s 0 /var/log/fail2ban.log 2>/dev/null && echo "OK: truncated fail2ban.log" || true`,
    `find /var/log/freepbx -name "*.log" -exec truncate -s 0 {} \\; 2>/dev/null && echo "OK: truncated freepbx logs" || true`,
    `find /tmp -maxdepth 1 -type f -mtime +1 -delete 2>/dev/null && echo "OK: cleaned /tmp" || true`,
    `DISK=$(df -BG / | tail -1 | awk '{gsub(/%/,"",$5); print $5}')`,
    `echo "DISK_PCT_AFTER:$DISK"`,
  ].join('; ');

  const raw = await sshExec(cmd, 40_000);
  const lines = raw.split('\n').filter(Boolean);
  const diskLine = lines.find(l => l.startsWith('DISK_PCT_AFTER:'));
  const diskAfter = diskLine ? parseInt(diskLine.split(':')[1], 10) : null;

  // Trigger a fresh poll after cleanup
  setTimeout(() => pollServerHealth().catch(() => {}), 2_000);

  const diskBefore = latestSnapshot?.diskPct ?? 100;
  const pctReclaimed = diskAfter !== null ? Math.max(0, diskBefore - diskAfter) : 0;
  const reclaimedMb = pctReclaimed > 0 && latestSnapshot?.diskTotalGb
    ? Math.round((pctReclaimed / 100) * (latestSnapshot.diskTotalGb * 1024))
    : 0;

  return {
    reclaimedMb,
    log: lines.filter(l => !l.startsWith('DISK_PCT_AFTER:')),
  };
}

// ── Get latest cached snapshot ────────────────────────────────────────────────
export function getLatestSnapshot(): ServerHealthSnapshot | null {
  return latestSnapshot;
}

// ── Get historical snapshots from DB ─────────────────────────────────────────
export async function getSnapshotHistory(days = 7): Promise<any[]> {
  try {
    const rows = await db.execute(sql`
      SELECT
        date_trunc('hour', captured_at) AS hour,
        AVG(disk_pct)::integer           AS disk_pct,
        AVG(disk_free_gb)::numeric(8,2)  AS disk_free_gb,
        AVG(mem_used_pct)::integer        AS mem_used_pct,
        AVG(swap_used_pct)::integer       AS swap_used_pct,
        AVG(load_1m)::numeric(6,2)       AS load_1m,
        AVG(log_folder_mb)::integer      AS log_folder_mb,
        bool_and(mariadb_running)        AS mariadb_running,
        bool_and(asterisk_running)       AS asterisk_running,
        COUNT(*)                         AS sample_count
      FROM asterisk_server_snapshots
      WHERE captured_at > NOW() - (${days} || ' days')::interval
        AND ssh_error IS NULL
      GROUP BY date_trunc('hour', captured_at)
      ORDER BY hour DESC
      LIMIT 168
    `);
    return (rows as any).rows ?? [];
  } catch (e: any) {
    console.error('[server-health] History query error:', e?.message);
    return [];
  }
}

// ── Start background poller ───────────────────────────────────────────────────
export function startServerHealthPoller(): void {
  if (pollerTimer) return; // already running

  console.log('[server-health] Starting poller (60s interval)');

  // First poll after 10s (let server finish booting)
  setTimeout(() => {
    pollServerHealth().catch((e: any) => console.error('[server-health] Initial poll error:', e?.message));
  }, 10_000);

  pollerTimer = setInterval(() => {
    if (isPolling) return;
    isPolling = true;
    pollServerHealth()
      .catch((e: any) => console.error('[server-health] Poll error:', e?.message))
      .finally(() => { isPolling = false; });
  }, 60_000);
}
