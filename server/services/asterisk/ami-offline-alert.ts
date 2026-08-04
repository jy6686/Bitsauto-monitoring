/**
 * AMI offline alerting — turns a silent governance outage into a notification.
 *
 * Written after the 2026-08-04 incident: Call Governance sat offline for hours
 * while every other subsystem kept working, and nothing said so. The loss came
 * from the gap between *broken* and *noticed*, not from the outage itself. The
 * pong watchdog now recovers zombie sockets within 35s, but a cause it cannot
 * fix — a blocked IP after a container move — leaves governance down until a
 * human happens to look at the badge.
 *
 * Deliberately conservative, because an alerter that cries wolf gets muted and
 * then the next real outage is silent again:
 *
 *   - Fires only after the connection has been down for GRACE_MS continuously,
 *     so ordinary reconnects (which the watchdog handles in ~35s) stay quiet.
 *   - One alert per outage, not one per check. A repeat only goes out after
 *     REALERT_MS, so a long outage reminds without flooding.
 *   - Sends a recovery notice, so an operator who saw the alarm learns it
 *     cleared without having to go and look.
 */

import { amiGovernance } from './ami-governance.js';
import { resolveSenderProfile, sendViaProfile } from '../../email.js';
import { storage } from '../../storage.js';

/** Down for this long before anyone is told. Longer than the 35s watchdog. */
const GRACE_MS = 3 * 60_000;
/** Repeat interval while it stays down. */
const REALERT_MS = 30 * 60_000;
const CHECK_MS = 30_000;

let downSince: number | null = null;
let lastAlertAt = 0;
let timer: NodeJS.Timeout | null = null;

async function notify(subject: string, html: string): Promise<void> {
  try {
    const settings = await storage.getSettings();
    const to = (settings as { alertAdminEmail?: string | null } | undefined)?.alertAdminEmail;
    if (!to) {
      console.warn('[ami-alert] no alertAdminEmail configured — alert not sent:', subject);
      return;
    }
    const profile = await resolveSenderProfile('noc');
    const res = await sendViaProfile({ to, subject, html, profile });
    if (!res.ok) console.error('[ami-alert] send failed:', res.error);
    else console.log('[ami-alert] sent:', subject);
  } catch (err) {
    // Never let alerting throw into the interval — a broken alerter must not
    // become a second outage.
    console.error('[ami-alert] notify error:', (err as Error).message);
  }
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)} min`;
}

async function check(): Promise<void> {
  const now = Date.now();

  if (amiGovernance.isConnected) {
    if (downSince && lastAlertAt) {
      // Only announce recovery if we actually alarmed about this outage.
      const outage = now - downSince;
      await notify(
        '✅ Call Governance AMI reconnected',
        `<p>Call Governance AMI is <b>connected again</b>.</p>
         <p>Outage lasted <b>${minutes(outage)}</b>. Vendor-leg cutting has resumed.</p>
         <p>Total reconnects since start: ${amiGovernance.reconnectCount}.</p>`,
      );
    }
    downSince = null;
    lastAlertAt = 0;
    return;
  }

  if (!downSince) { downSince = now; return; }

  const downFor = now - downSince;
  if (downFor < GRACE_MS) return;
  if (lastAlertAt && now - lastAlertAt < REALERT_MS) return;

  lastAlertAt = now;
  await notify(
    '🔴 Call Governance AMI OFFLINE — vendor legs are not being cut',
    `<p><b>Call Governance has been disconnected from Asterisk AMI for ${minutes(downFor)}.</b></p>
     <p>While it is offline, governed calls are <b>not being time-capped</b> — vendor legs run
        uncut, at cost.</p>
     <ul>
       <li>Last connected: ${amiGovernance.lastConnectedAt?.toISOString() ?? 'not since start'}</li>
       <li>Last error: ${amiGovernance.lastError ?? 'none recorded'}</li>
       <li>Reconnect attempts: ${amiGovernance.reconnectCount}</li>
     </ul>
     <p><b>Most common cause:</b> the deployment moved to a new egress IP and the Asterisk
        firewall is dropping it. On the Asterisk host, find who is knocking:</p>
     <pre>timeout 30 tcpdump -nn -i any "tcp[tcpflags] &amp; tcp-syn != 0 and port 5038"</pre>
     <p>then allow that address and persist it:</p>
     <pre>iptables -I INPUT -s &lt;IP&gt; -p tcp --dport 5038 -j ACCEPT &amp;&amp; service iptables save</pre>
     <p>Status endpoint: <code>/api/call-governance/ami-status</code></p>`,
  );
}

export function startAmiOfflineAlerting(): void {
  if (timer) return;
  timer = setInterval(() => { void check(); }, CHECK_MS);
  console.log(`[ami-alert] watching AMI — alerts after ${minutes(GRACE_MS)} offline`);
}
