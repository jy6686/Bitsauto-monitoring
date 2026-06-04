/**
 * SIP OPTIONS Probe Engine
 *
 * Sends SIP OPTIONS messages (the VoIP equivalent of a ping) to vendor/carrier
 * endpoints and measures round-trip latency. Any SIP response (200, 405, 403,
 * 408 …) is treated as reachable — we care about connectivity, not capability.
 *
 * Transport: UDP is tried first (standard SIP). On ICMP-unreachable or timeout
 * the probe falls back to a TCP connect check.
 */

import dgram from 'node:dgram';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

export interface ProbeResult {
  host:            string;
  port:            number;
  reachable:       boolean;
  latencyMs:       number | null;
  sipResponseCode: number | null;
  error:           string | null;
}

const PROBE_TIMEOUT_MS = 3000;

function buildOptionsMessage(host: string, port: number): string {
  const callId  = randomBytes(8).toString('hex');
  const branch  = 'z9hG4bK' + randomBytes(6).toString('hex');
  const tag     = randomBytes(4).toString('hex');

  return [
    `OPTIONS sip:probe@${host}:${port} SIP/2.0`,
    `Via: SIP/2.0/UDP ${host}:${port};branch=${branch};rport`,
    `Max-Forwards: 70`,
    `From: <sip:monitor@bitsauto.local>;tag=${tag}`,
    `To: <sip:probe@${host}:${port}>`,
    `Call-ID: ${callId}@bitsauto`,
    `CSeq: 1 OPTIONS`,
    `Contact: <sip:monitor@bitsauto.local>`,
    `Accept: application/sdp`,
    `Content-Length: 0`,
    ``,
    ``,
  ].join('\r\n');
}

function parseSipResponseCode(data: Buffer): number | null {
  const text = data.toString('utf8', 0, Math.min(data.length, 256));
  const m = text.match(/^SIP\/2\.0\s+(\d{3})/);
  return m ? parseInt(m[1], 10) : null;
}

/** UDP SIP OPTIONS probe */
function probeUdp(host: string, port: number): Promise<ProbeResult> {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const msg  = Buffer.from(buildOptionsMessage(host, port));
    const t0   = Date.now();
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ host, port, reachable: false, latencyMs: null, sipResponseCode: null, error: 'timeout' });
    }, PROBE_TIMEOUT_MS);

    sock.on('message', (buf) => {
      clearTimeout(timer);
      const code = parseSipResponseCode(buf);
      finish({
        host, port,
        reachable:       true,
        latencyMs:       Date.now() - t0,
        sipResponseCode: code,
        error:           null,
      });
    });

    sock.on('error', (err) => {
      clearTimeout(timer);
      finish({ host, port, reachable: false, latencyMs: null, sipResponseCode: null, error: err.message });
    });

    try {
      sock.send(msg, 0, msg.length, port, host, (err) => {
        if (err) {
          clearTimeout(timer);
          finish({ host, port, reachable: false, latencyMs: null, sipResponseCode: null, error: err.message });
        }
      });
    } catch (err: any) {
      clearTimeout(timer);
      finish({ host, port, reachable: false, latencyMs: null, sipResponseCode: null, error: err.message });
    }
  });
}

/** TCP connect fallback — just checks that the port accepts connections */
function probeTcp(host: string, port: number): Promise<ProbeResult> {
  return new Promise(resolve => {
    const t0  = Date.now();
    const sock = net.createConnection({ host, port, timeout: PROBE_TIMEOUT_MS });
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    sock.on('connect', () => {
      finish({ host, port, reachable: true, latencyMs: Date.now() - t0, sipResponseCode: null, error: null });
    });

    sock.on('timeout', () => {
      finish({ host, port, reachable: false, latencyMs: null, sipResponseCode: null, error: 'tcp_timeout' });
    });

    sock.on('error', (err) => {
      finish({ host, port, reachable: false, latencyMs: null, sipResponseCode: null, error: err.message });
    });
  });
}

/**
 * Probe a SIP endpoint.
 * Tries UDP first. If UDP times out (no response rather than explicit error),
 * falls back to TCP to distinguish "no SIP process" from "network unreachable".
 */
export async function probeEndpoint(host: string, portStr?: string | number | null): Promise<ProbeResult> {
  const port = portStr ? parseInt(String(portStr), 10) : 5060;
  if (!host || !/^[\w.\-:]+$/.test(host)) {
    return { host: host ?? '', port, reachable: false, latencyMs: null, sipResponseCode: null, error: 'invalid_host' };
  }

  const udpResult = await probeUdp(host, port);

  if (udpResult.reachable) return udpResult;

  if (udpResult.error === 'timeout') {
    const tcpResult = await probeTcp(host, port);
    if (tcpResult.reachable) {
      return { ...tcpResult, sipResponseCode: null };
    }
  }

  return udpResult;
}

/** Parse host and port from a Sippy connection destination string like "1.2.3.4:5060" or "1.2.3.4" */
export function parseHostPort(destination: string | null | undefined): { host: string; port: number } | null {
  if (!destination) return null;
  const clean = destination.replace(/^SIP:/i, '').trim();
  const colonIdx = clean.lastIndexOf(':');
  if (colonIdx > 0) {
    const portNum = parseInt(clean.slice(colonIdx + 1), 10);
    if (!isNaN(portNum)) {
      return { host: clean.slice(0, colonIdx), port: portNum };
    }
  }
  return { host: clean, port: 5060 };
}
