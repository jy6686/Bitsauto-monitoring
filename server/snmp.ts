/**
 * Sippy Softswitch SNMP Monitoring
 *
 * Reference: https://support.sippysoft.com/support/solutions/articles/81166
 *
 * Sippy exposes real-time call statistics via SNMP using its own SIPPY-MIB.
 * The SNMP daemon (snmpd) runs on the switch host at UDP port 161.
 * Enterprise OID prefix: .1.3.6.1.4.1.36523
 *
 * MIB file on Sippy server: /usr/home/ssp/etc/SIPPY-MIB.txt
 * Enable remote access by adding to /home/ssp/etc/snmpd.conf:
 *   pass_persist .1.3.6.1.4.1.36523  /home/ssp/scripts/snmp_statsd.py
 *   rocommunity <COMMUNITY_STRING> <MONITOR_IP>
 *
 * Accumulative counters (delta-based for ACD/ASR calculations):
 *   SippyEnvNConnectedCallsEntry   — total connected calls since uptime
 *   SippyEnvTotalCallsDurationEntry — total call duration in seconds since uptime
 *   SippyEnvNReceivedCallsEntry    — total received (attempted) calls since uptime
 *
 * ACD formula:  (TotalDuration_delta) / (ConnectedCalls_delta)
 * ASR formula:  (ConnectedCalls_delta / ReceivedCalls_delta) * 100
 */

import snmp from 'net-snmp';

// ── SIPPY-MIB OID definitions ────────────────────────────────────────────────
const ENTERPRISE = '1.3.6.1.4.1.36523';

export const SIPPY_OIDS = {
  // System-wide RTP proxy stats (Sippy 2020+)
  rtpProxyOneWay:   `${ENTERPRISE}.1.1.6.1`,
  rtpProxyIncomplete: `${ENTERPRISE}.1.1.6.2`,
  rtpProxyNoRtp:    `${ENTERPRISE}.1.1.6.3`,
  rtpProxyDiscard:  `${ENTERPRISE}.1.1.6.4`,

  // Per-environment — instantaneous call counts (Sippy 5.0+)
  // Append .<i_environment> to query a specific environment
  envActiveCalls:         (env: number) => `${ENTERPRISE}.1.1.1.2.1.${env}`,
  envConnectedCalls:      (env: number) => `${ENTERPRISE}.1.1.1.3.1.${env}`,
  envAuthorizedCallsAvg:  (env: number) => `${ENTERPRISE}.1.1.1.6.1.${env}`,
  envRoutedCallsAvg:      (env: number) => `${ENTERPRISE}.1.1.1.7.1.${env}`,
  envConnectedCallsAvg:   (env: number) => `${ENTERPRISE}.1.1.1.8.1.${env}`,

  // Per-environment — accumulative counters (Sippy 2020+), delta-based for ACD/ASR
  envNAuthorizedCalls:    (env: number) => `${ENTERPRISE}.1.1.1.9.1.${env}`,
  envNRoutedCalls:        (env: number) => `${ENTERPRISE}.1.1.1.10.1.${env}`,
  envNConnectedCalls:     (env: number) => `${ENTERPRISE}.1.1.1.11.1.${env}`,  // For ACD & ASR
  envTotalCallsDuration:  (env: number) => `${ENTERPRISE}.1.1.1.12.1.${env}`,  // For ACD
  envNReceivedCalls:      (env: number) => `${ENTERPRISE}.1.1.1.13.1.${env}`,  // For ASR
  envNOriginatedCalls:    (env: number) => `${ENTERPRISE}.1.1.1.14.1.${env}`,
  envNRegistered:         (env: number) => `${ENTERPRISE}.1.1.1.15.1.${env}`,  // Sippy 2021+
  envPtime:               (env: number) => `${ENTERPRISE}.1.1.1.4.1.${env}`,
  envAaPtime:             (env: number) => `${ENTERPRISE}.1.1.1.5.1.${env}`,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SippySnmpEnvStats {
  environment: number;
  // Instantaneous
  activeCalls: number;
  connectedCalls: number;
  authorizedCallsAvg: number;
  routedCallsAvg: number;
  connectedCallsAvg: number;
  // Accumulative (since last switch restart — use deltas for metrics)
  nConnectedCalls: number;
  totalCallsDuration: number;   // seconds
  nReceivedCalls: number;
  nOriginatedCalls: number;
  nAuthorizedCalls: number;
  nRoutedCalls: number;
  nRegistered: number;
  ptime: number;
  aaPtime: number;
}

export interface SippySnmpSystemStats {
  rtpProxyOneWay: number;       // % calls with RTP on one leg only
  rtpProxyIncomplete: number;   // % calls with SDP for one leg only
  rtpProxyNoRtp: number;        // % calls with SDP on both legs but no RTP
  rtpProxyDiscard: number;      // % RTP/RTCP packets discarded
}

export interface SippySnmpResult {
  ok: boolean;
  host: string;
  port: number;
  community: string;
  system: SippySnmpSystemStats;
  environments: SippySnmpEnvStats[];
  // Computed ACD/ASR from accumulative counters (using total since uptime)
  // For interval-based ACD/ASR, store baseline externally and subtract
  acd: number;    // seconds — total duration / total connected calls (0 if no calls)
  asr: number;    // percent — (connected / received) * 100 (0 if no calls)
  error?: string;
}

// ── SNMP session helper ───────────────────────────────────────────────────────

function createSession(host: string, port: number, community: string): snmp.Session {
  return snmp.createSession(host, community, {
    port,
    version: snmp.Version2c,
    timeout: 5000,
    retries: 1,
  });
}

async function snmpGet(session: snmp.Session, oids: string[]): Promise<Map<string, number>> {
  return new Promise((resolve) => {
    session.get(oids, (error: Error | null, varbinds: snmp.VarBind[]) => {
      const result = new Map<string, number>();
      if (error || !varbinds) { resolve(result); return; }
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        const val = vb.value;
        const num = typeof val === 'number' ? val : Number(val?.toString?.() ?? 0);
        result.set(vb.oid, isNaN(num) ? 0 : num);
      }
      resolve(result);
    });
  });
}

// ── Main query function ───────────────────────────────────────────────────────

/**
 * Query a Sippy switch via SNMP and return structured statistics.
 * The switch must have SNMP enabled (pass_persist line in snmpd.conf).
 *
 * @param host      IP or hostname of the Sippy switch (e.g. "191.101.30.107")
 * @param port      SNMP UDP port (default 161)
 * @param community SNMP community string (default "public")
 * @param envIds    Environment IDs to query (default [1])
 */
export async function querySippySnmp(
  host: string,
  port = 161,
  community = 'public',
  envIds: number[] = [1],
): Promise<SippySnmpResult> {
  const empty: SippySnmpResult = {
    ok: false, host, port, community,
    system: { rtpProxyOneWay: 0, rtpProxyIncomplete: 0, rtpProxyNoRtp: 0, rtpProxyDiscard: 0 },
    environments: [],
    acd: 0, asr: 0,
  };

  let session: snmp.Session | null = null;
  try {
    session = createSession(host, port, community);

    // ── System-wide OIDs ────────────────────────────────────────────────────
    const systemOids = [
      SIPPY_OIDS.rtpProxyOneWay,
      SIPPY_OIDS.rtpProxyIncomplete,
      SIPPY_OIDS.rtpProxyNoRtp,
      SIPPY_OIDS.rtpProxyDiscard,
    ];

    // ── Per-environment OIDs ────────────────────────────────────────────────
    const envOids: string[] = [];
    for (const env of envIds) {
      envOids.push(
        SIPPY_OIDS.envActiveCalls(env),
        SIPPY_OIDS.envConnectedCalls(env),
        SIPPY_OIDS.envAuthorizedCallsAvg(env),
        SIPPY_OIDS.envRoutedCallsAvg(env),
        SIPPY_OIDS.envConnectedCallsAvg(env),
        SIPPY_OIDS.envNConnectedCalls(env),
        SIPPY_OIDS.envTotalCallsDuration(env),
        SIPPY_OIDS.envNReceivedCalls(env),
        SIPPY_OIDS.envNOriginatedCalls(env),
        SIPPY_OIDS.envNAuthorizedCalls(env),
        SIPPY_OIDS.envNRoutedCalls(env),
        SIPPY_OIDS.envNRegistered(env),
        SIPPY_OIDS.envPtime(env),
        SIPPY_OIDS.envAaPtime(env),
      );
    }

    // Fetch in two batches (system + env) in parallel
    const [sysVars, envVars] = await Promise.all([
      snmpGet(session, systemOids),
      snmpGet(session, envOids),
    ]);

    const g = (map: Map<string, number>, oid: string) => map.get(oid) ?? 0;

    const system: SippySnmpSystemStats = {
      rtpProxyOneWay:    g(sysVars, SIPPY_OIDS.rtpProxyOneWay),
      rtpProxyIncomplete: g(sysVars, SIPPY_OIDS.rtpProxyIncomplete),
      rtpProxyNoRtp:     g(sysVars, SIPPY_OIDS.rtpProxyNoRtp),
      rtpProxyDiscard:   g(sysVars, SIPPY_OIDS.rtpProxyDiscard),
    };

    const environments: SippySnmpEnvStats[] = envIds.map(env => ({
      environment:        env,
      activeCalls:        g(envVars, SIPPY_OIDS.envActiveCalls(env)),
      connectedCalls:     g(envVars, SIPPY_OIDS.envConnectedCalls(env)),
      authorizedCallsAvg: g(envVars, SIPPY_OIDS.envAuthorizedCallsAvg(env)),
      routedCallsAvg:     g(envVars, SIPPY_OIDS.envRoutedCallsAvg(env)),
      connectedCallsAvg:  g(envVars, SIPPY_OIDS.envConnectedCallsAvg(env)),
      nConnectedCalls:    g(envVars, SIPPY_OIDS.envNConnectedCalls(env)),
      totalCallsDuration: g(envVars, SIPPY_OIDS.envTotalCallsDuration(env)),
      nReceivedCalls:     g(envVars, SIPPY_OIDS.envNReceivedCalls(env)),
      nOriginatedCalls:   g(envVars, SIPPY_OIDS.envNOriginatedCalls(env)),
      nAuthorizedCalls:   g(envVars, SIPPY_OIDS.envNAuthorizedCalls(env)),
      nRoutedCalls:       g(envVars, SIPPY_OIDS.envNRoutedCalls(env)),
      nRegistered:        g(envVars, SIPPY_OIDS.envNRegistered(env)),
      ptime:              g(envVars, SIPPY_OIDS.envPtime(env)),
      aaPtime:            g(envVars, SIPPY_OIDS.envAaPtime(env)),
    }));

    // ACD / ASR — computed from totals across all queried environments
    // Per docs: these are accumulative; use delta between two calls for interval metrics.
    // Here we return totals — the frontend or caller can store a baseline for delta calc.
    const totalDuration  = environments.reduce((s, e) => s + e.totalCallsDuration, 0);
    const totalConnected = environments.reduce((s, e) => s + e.nConnectedCalls, 0);
    const totalReceived  = environments.reduce((s, e) => s + e.nReceivedCalls, 0);

    const acd = totalConnected > 0 ? totalDuration / totalConnected : 0;
    const asr = totalReceived  > 0 ? (totalConnected / totalReceived) * 100 : 0;

    return { ok: true, host, port, community, system, environments, acd, asr };
  } catch (e: any) {
    return { ...empty, error: e.message ?? 'SNMP query failed.' };
  } finally {
    try { session?.close(); } catch { /* ignore */ }
  }
}

/**
 * Extract the host from a portal URL string.
 * e.g. "https://191.101.30.107" → "191.101.30.107"
 *      "http://191.101.30.107:8080/eng/" → "191.101.30.107"
 */
export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
  }
}
