/**
 * SBC Poller — real TCP / HTTP REST / SNMP polling for Session Border Controllers
 *
 * Probe strategy (in order):
 *   1. TCP SIP-port probe   — always; determines reachability + round-trip latency
 *   2. HTTP REST probe      — if apiUrl configured; vendor-specific metrics (CPU, sessions)
 *   3. SNMP probe           — if snmpCommunity configured; HOST-RESOURCES-MIB CPU
 *
 * Status thresholds:
 *   down     — TCP connect failed
 *   degraded — TCP RTT > 500 ms  OR  CPU > 85%
 *   ok       — all probes passed within threshold
 */

import * as net from 'net';

export interface SbcPollResult {
  hostId: number;
  status: 'ok' | 'degraded' | 'down';
  optionsResponseMs: number;
  activeSessions: number;
  cpuPercent: number;
  transcodingLoad: number;
  registrations: number;
  mediaBypassRate: number;
  polledAt: Date;
  method: string;
  error?: string;
}

const _cache = new Map<number, SbcPollResult>();
let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function getSbcMetricsCache(hostId: number): SbcPollResult | undefined {
  return _cache.get(hostId);
}

export function getAllSbcCache(): Map<number, SbcPollResult> {
  return _cache;
}

// ── TCP SIP-port probe ────────────────────────────────────────────────────────
function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise(resolve => {
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(ok ? Date.now() - start : null);
    };

    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => finish(true));
    sock.on('error', () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

// ── Host reachability probe ───────────────────────────────────────────────────
// When TCP SIP probe fails, probe common admin ports to distinguish
// "host is down" from "SIP TCP is blocked / UDP-only" (very common for Sippy).
// ECONNREFUSED counts as reachable — the host sent a TCP RST, meaning IP connectivity works.
function hostReachable(host: string, timeoutMs = 2500): Promise<boolean> {
  const FALLBACK_PORTS = [443, 80, 8443, 8080, 8090, 8181, 22, 21];
  return new Promise(resolve => {
    let resolved = false;
    let pending   = FALLBACK_PORTS.length;

    const markDone = (reachable: boolean) => {
      if (resolved) return;
      if (reachable) { resolved = true; resolve(true); return; }
      pending--;
      if (pending === 0) resolve(false);
    };

    for (const port of FALLBACK_PORTS) {
      const sock = new net.Socket();
      sock.setTimeout(timeoutMs);
      sock.connect(port, host, () => {
        try { sock.destroy(); } catch { /* ignore */ }
        markDone(true);   // connected — definitely reachable
      });
      sock.on('error', (err: any) => {
        try { sock.destroy(); } catch { /* ignore */ }
        // ECONNREFUSED = host sent TCP RST → IP layer reachable, port just closed
        markDone(err?.code === 'ECONNREFUSED');
      });
      sock.on('timeout', () => {
        try { sock.destroy(); } catch { /* ignore */ }
        markDone(false);
      });
    }
  });
}

// ── HTTP REST probe — vendor-specific ─────────────────────────────────────────
async function httpProbe(
  apiUrl: string,
  apiKey: string | null | undefined,
  vendor: string,
): Promise<Pick<SbcPollResult, 'activeSessions' | 'cpuPercent' | 'registrations' | 'transcodingLoad' | 'mediaBypassRate'>> {
  const base = apiUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const empty = { activeSessions: 0, cpuPercent: 0, registrations: 0, transcodingLoad: 0, mediaBypassRate: 0 };

  try {
    if (vendor === 'audiocodes') {
      // AudioCodes REST Management API (OVOC / device REST)
      const r = await fetch(`${base}/api/v1/system/performance`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const d = await r.json() as any;
        return {
          ...empty,
          cpuPercent: d.CPUUsage ?? d.cpuUsage ?? 0,
          activeSessions: d.TotalActiveSessions ?? d.ActiveCalls ?? d.activeCalls ?? 0,
          transcodingLoad: d.TranscodingLoad ?? d.transcodingLoad ?? 0,
        };
      }
      // Fallback: try AudioCodes older REST path
      const r2 = await fetch(`${base}/api/v1/SBCGeneral/OperationalStatus`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (r2.ok) {
        const d = await r2.json() as any;
        return { ...empty, activeSessions: d.ActiveCalls ?? 0 };
      }
    } else if (vendor === 'kamailio') {
      // Kamailio HTTP JSON-RPC dispatcher
      const r = await fetch(`${base}/RPC`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'stats.get_statistics', params: ['dialog:', 'tm:', 'registrar:'], id: 1 }),
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const d = await r.json() as any;
        const stats = d.result ?? {};
        const sessions = stats['dialog:active_dialogs'] ?? stats['dialog:dialogs_active'] ?? 0;
        const regs = stats['registrar:registered_users'] ?? stats['registrar:max_expires'] ?? 0;
        return { ...empty, activeSessions: Number(sessions), registrations: Number(regs) };
      }
    } else if (vendor === 'opensips') {
      const r = await fetch(`${base}/mi`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'core_summary', id: 1 }),
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const d = await r.json() as any;
        return { ...empty, activeSessions: d.result?.active_dialogs ?? 0 };
      }
    } else if (vendor === 'sonus' || vendor === 'ribbon') {
      // Ribbon/Sonus REST
      const r = await fetch(`${base}/rest/system/status`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const d = await r.json() as any;
        return { ...empty, cpuPercent: d.cpuUtil ?? 0, activeSessions: d.activeCalls ?? 0 };
      }
    } else {
      // Generic: probe common health endpoints
      for (const path of ['/health', '/status', '/api/status', '/healthz']) {
        try {
          const r = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(3000) });
          if (r.ok) {
            try {
              const d = await r.json() as any;
              return {
                ...empty,
                cpuPercent: d.cpu ?? d.cpuPercent ?? d.cpuUsage ?? 0,
                activeSessions: d.sessions ?? d.activeSessions ?? d.activeCalls ?? 0,
              };
            } catch { return empty; }
          }
        } catch { continue; }
      }
    }
  } catch { /* HTTP probe failed — not fatal */ }

  return empty;
}

// ── SNMP probe — HOST-RESOURCES-MIB hrProcessorLoad ──────────────────────────
async function snmpProbe(host: string, community: string): Promise<{ cpuPercent: number; registrations: number }> {
  return new Promise(resolve => {
    let snmpMod: any;
    try {
      snmpMod = require('net-snmp');
    } catch {
      return resolve({ cpuPercent: 0, registrations: 0 });
    }

    const session = snmpMod.createSession(host, community, {
      timeout: 3000,
      retries: 1,
      version: snmpMod.Version2c,
    });

    const oids = [
      '1.3.6.1.2.1.25.3.3.1.2.1', // hrProcessorLoad — first CPU core
      '1.3.6.1.2.1.1.1.0',         // sysDescr — connectivity probe
    ];

    session.get(oids, (err: any, varbinds: any[]) => {
      try { session.close(); } catch { /* ignore */ }
      if (err || !varbinds?.length) return resolve({ cpuPercent: 0, registrations: 0 });

      let cpuPercent = 0;
      for (const vb of varbinds) {
        if (snmpMod.isVarbindError(vb)) continue;
        if (vb.oid === '1.3.6.1.2.1.25.3.3.1.2.1') {
          cpuPercent = Number(vb.value) || 0;
        }
      }
      resolve({ cpuPercent, registrations: 0 });
    });
  });
}

// ── Host sanitiser ────────────────────────────────────────────────────────────
// Strips accidental protocol prefixes (https://, http://) and trailing slashes
// so net.Socket.connect() always receives a bare hostname or IP address.
function sanitizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')   // strip http:// or https://
    .replace(/\/.*$/, '')            // strip path component and trailing slash
    .trim();
}

// ── Main poll function ────────────────────────────────────────────────────────
export async function pollSbcHost(host: {
  id: number; host: string; port: number; vendor: string;
  snmpCommunity?: string | null; apiUrl?: string | null; apiKey?: string | null;
}): Promise<SbcPollResult> {
  const cleanHost = sanitizeHost(host.host);
  const base: SbcPollResult = {
    hostId: host.id,
    status: 'down',
    optionsResponseMs: 0,
    activeSessions: 0,
    cpuPercent: 0,
    transcodingLoad: 0,
    registrations: 0,
    mediaBypassRate: 0,
    polledAt: new Date(),
    method: 'tcp',
  };

  // 1. TCP SIP-port probe — authoritative for up/down
  const tcpMs = await tcpProbe(cleanHost, host.port ?? 5060);

  if (tcpMs === null) {
    // TCP SIP failed — check if the host IP is reachable at all on any common port.
    // ECONNREFUSED on any fallback port means IP-layer connectivity exists; the SIP
    // port is just blocked/filtered (most Sippy switches use UDP SIP, not TCP SIP).
    const reachable = await hostReachable(cleanHost);
    if (reachable) {
      const result = {
        ...base,
        status: 'degraded' as const,
        method: 'reachability',
        error: `SIP TCP port ${host.port ?? 5060} blocked — host is reachable (Sippy uses UDP SIP; TCP SIP may be disabled or firewalled)`,
      };
      _cache.set(host.id, result);
      return result;
    }
    const result = { ...base, status: 'down' as const, error: `Host unreachable — TCP SIP port ${host.port ?? 5060} and all fallback ports timed out` };
    _cache.set(host.id, result);
    return result;
  }

  base.optionsResponseMs = tcpMs;
  base.status = tcpMs > 500 ? 'degraded' : 'ok';
  base.method = 'tcp';

  // 2. HTTP REST probe — enriches with CPU + session metrics
  if (host.apiUrl) {
    try {
      const http = await httpProbe(host.apiUrl, host.apiKey, host.vendor ?? 'generic');
      if (http.cpuPercent > 0) base.cpuPercent = http.cpuPercent;
      if (http.activeSessions > 0) base.activeSessions = http.activeSessions;
      if (http.transcodingLoad > 0) base.transcodingLoad = http.transcodingLoad;
      if (http.registrations > 0) base.registrations = http.registrations;
      if (http.mediaBypassRate > 0) base.mediaBypassRate = http.mediaBypassRate;
      base.method = 'http+tcp';
    } catch { /* ignore — TCP status is authoritative */ }
  }

  // 3. SNMP probe — fills CPU if not already fetched via HTTP
  if (host.snmpCommunity && base.cpuPercent === 0) {
    try {
      const snmpData = await snmpProbe(cleanHost, host.snmpCommunity);
      if (snmpData.cpuPercent > 0) base.cpuPercent = snmpData.cpuPercent;
      base.method = host.apiUrl ? 'http+snmp+tcp' : 'snmp+tcp';
    } catch { /* ignore */ }
  }

  // Re-evaluate status based on enriched metrics
  if (base.cpuPercent > 85) base.status = 'degraded';

  _cache.set(host.id, base);
  return base;
}

// ── Background poller — polls all enabled hosts every 5 min ──────────────────
export async function startSbcPoller(getHosts: () => Promise<any[]>, updateStatus: (id: number, status: string) => Promise<void>) {
  if (_pollTimer) clearInterval(_pollTimer);

  const run = async () => {
    let hosts: any[] = [];
    try { hosts = await getHosts(); } catch { return; }

    for (const h of hosts) {
      if (!h.enabled) continue;
      try {
        const result = await pollSbcHost(h);
        await updateStatus(h.id, result.status).catch(() => {});
        console.log(`[sbc-poller] ${h.name} (${sanitizeHost(h.host)}:${h.port}) → ${result.status} via ${result.method} ${result.optionsResponseMs}ms RTT`);
      } catch (e: any) {
        console.warn(`[sbc-poller] ${h.name} poll error:`, e.message);
      }
    }
  };

  // First run on a short delay so the server is fully up
  setTimeout(run, 15_000);
  _pollTimer = setInterval(run, 5 * 60_000); // every 5 minutes
  console.log('[sbc-poller] Started — polling every 5 minutes');
}
