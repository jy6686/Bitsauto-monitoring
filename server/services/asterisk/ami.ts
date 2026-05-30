/**
 * Asterisk AMI (Asterisk Manager Interface) client
 * Used to originate Voice OTP calls via Asterisk → Sippy → Carrier
 */
import net from 'net';

function cfg() {
  return {
    host:      process.env.ASTERISK_HOST      ?? '159.223.32.59',
    port:      Number(process.env.ASTERISK_AMI_PORT ?? 5038),
    username:  process.env.ASTERISK_AMI_USER  ?? 'bitsauto',
    secret:    process.env.ASTERISK_AMI_SECRET ?? '',
    // PJSIP (modern FreePBX) vs SIP (legacy chan_sip)
    // PJSIP format: PJSIP/number@trunk  |  SIP format: SIP/trunk/number
    chanTech:  (process.env.ASTERISK_CHAN_TECH ?? 'SIP').toUpperCase() as 'SIP' | 'PJSIP',
    trunkName: process.env.ASTERISK_TRUNK_NAME ?? 'Sippy',
  };
}

/** Build the correct Asterisk channel string based on driver (SIP vs PJSIP) */
function buildChannel(chanTech: 'SIP' | 'PJSIP', trunkName: string, number: string): string {
  return chanTech === 'PJSIP'
    ? `PJSIP/${number}@${trunkName}`   // modern res_pjsip
    : `SIP/${trunkName}/${number}`;    // legacy chan_sip
}

export function isAmiConfigured(): boolean {
  return !!process.env.ASTERISK_AMI_SECRET;
}

export interface OriginateResult {
  success:    boolean;
  uniqueId?:  string;
  error?:     string;
  reason?:    number;   // Asterisk OriginateResponse reason code
  reasonText?: string;  // Human-readable reason
}

export interface OriginateParams {
  to:        string;   // e.g. +923001112233
  otp:       string;   // e.g. 987432 — passed as CallerID name so dialplan reads it
  trunk?:    string;   // Asterisk trunk/peer name, default 'Sippy'
  timeout?:  number;   // call timeout ms, default 30000
}

/** Map Asterisk OriginateResponse reason codes to text */
function reasonText(code: number): string {
  const map: Record<number, string> = {
    0: 'No such extension/number',
    1: 'No answer (timeout)',
    4: 'Answered',
    5: 'Busy',
    7: 'Failed/Error',
    8: 'Congestion',
  };
  return map[code] ?? `Unknown reason ${code}`;
}

/**
 * Open a short-lived AMI connection, originate one call, wait for
 * the real OriginateResponse event, then disconnect.
 *
 * With Async:true, Asterisk sends:
 *   1. Response: Success  (just means "queued", NOT that call connected)
 *   2. Event: OriginateResponse  (the REAL outcome — answered/busy/failed)
 *
 * We must wait for step 2 before resolving.
 */
export function originateOtpCall(params: OriginateParams): Promise<OriginateResult> {
  const config = cfg();
  const { otp, timeout: callTimeout = 45000 } = params;
  const trunkName = params.trunk ?? config.trunkName;
  // Strip leading '+' — chan_sip and PJSIP both prefer plain E.164 digits
  const to = params.to.replace(/^\+/, '');
  const actionId = `bitsauto-${Date.now()}`;

  return new Promise((resolve) => {
    const socket  = new net.Socket();
    let   buffer  = '';
    let   sentLogin     = false;
    let   loggedIn      = false;
    let   responded     = false;
    let   originateSent = false;

    const done = (result: OriginateResult) => {
      if (responded) return;
      responded = true;
      clearTimeout(connTimeout);
      try { socket.write('Action: Logoff\r\n\r\n'); } catch (_) {}
      try { socket.destroy(); } catch (_) {}
      console.log(`[ami] originateOtpCall → to=${to} success=${result.success} reason=${result.reasonText ?? result.error ?? 'ok'} uniqueId=${result.uniqueId ?? 'none'}`);
      resolve(result);
    };

    // Overall timeout — covers both connection + call dial time
    const connTimeout = setTimeout(
      () => done({ success: false, error: 'AMI timeout waiting for call outcome', reasonText: 'Timeout' }),
      callTimeout + 20_000,
    );

    socket.connect(config.port, config.host);

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      // Banner line — send login immediately
      if (!sentLogin && buffer.includes('Asterisk Call Manager')) {
        sentLogin = true;
        socket.write(
          `Action: Login\r\nUsername: ${config.username}\r\nSecret: ${config.secret}\r\nActionID: ami-login\r\n\r\n`,
        );
      }

      // Process complete AMI messages (separated by \r\n\r\n)
      let boundary: number;
      while ((boundary = buffer.indexOf('\r\n\r\n')) !== -1) {
        const msg = buffer.slice(0, boundary);
        buffer    = buffer.slice(boundary + 4);

        // ── Login response ───────────────────────────────────────────────────
        if (!loggedIn && msg.includes('ActionID: ami-login')) {
          if (msg.includes('Response: Success')) {
            loggedIn = true;
            const channel = buildChannel(config.chanTech, trunkName, to);
            // Using Application:SayDigits bypasses any FreePBX dialplan requirement
            console.log(`[ami] logged in — sending originate: Channel=${channel} Application=SayDigits Data=${otp} (tech=${config.chanTech})`);
            originateSent = true;
            socket.write([
              'Action: Originate',
              `Channel: ${channel}`,
              `Application: SayDigits`,
              `Data: ${otp}`,
              `CallerID: "OTP Service" <${otp}>`,
              `Timeout: ${callTimeout}`,
              'Async: true',
              `ActionID: ${actionId}`,
              '', '',
            ].join('\r\n'));
          } else {
            const m = msg.match(/Message: (.+)/);
            done({ success: false, error: `AMI auth failed: ${m?.[1]?.trim() ?? 'bad credentials'}` });
          }
        }

        // ── Originate queued acknowledgment (Async: true) ────────────────────
        // This is NOT the real result — just means Asterisk accepted the command
        if (originateSent && msg.includes(`ActionID: ${actionId}`) && msg.includes('Response:')) {
          if (msg.includes('Response: Error')) {
            const m = msg.match(/Message: (.+)/);
            done({ success: false, error: `Originate rejected by Asterisk: ${m?.[1]?.trim() ?? 'unknown'}` });
          }
          // Response: Success here = queued — keep waiting for OriginateResponse event
        }

        // ── OriginateResponse event — the REAL call outcome ───────────────────
        if (msg.includes('Event: OriginateResponse') && msg.includes(`ActionID: ${actionId}`)) {
          const responseLine = msg.match(/Response: (.+)/)?.[1]?.trim() ?? '';
          const reasonCode   = Number(msg.match(/Reason: (\d+)/)?.[1] ?? -1);
          const uniqueId     = msg.match(/Uniqueid: (.+)/)?.[1]?.trim();

          console.log(`[ami] OriginateResponse → Response=${responseLine} Reason=${reasonCode}(${reasonText(reasonCode)}) Uniqueid=${uniqueId ?? 'none'}`);

          if (responseLine === 'Success' || reasonCode === 4) {
            done({ success: true, uniqueId, reason: reasonCode, reasonText: reasonText(reasonCode) });
          } else {
            done({
              success:    false,
              uniqueId,
              reason:     reasonCode,
              reasonText: reasonText(reasonCode),
              error:      `Call ${responseLine}: ${reasonText(reasonCode)}`,
            });
          }
        }
      }
    });

    socket.on('error', (err) => done({ success: false, error: `AMI socket error: ${err.message}` }));
    socket.on('close', () => {
      if (!responded) done({ success: false, error: 'AMI connection closed before call outcome received' });
    });
  });
}

/** Quick ping — connect, login, logoff. Returns latency ms or error. */
export function pingAmi(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const config = cfg();
  return new Promise((resolve) => {
    const start  = Date.now();
    const socket = new net.Socket();
    let buffer   = '';
    let sentLogin = false;
    let responded = false;

    const done = (r: { ok: boolean; latencyMs?: number; error?: string }) => {
      if (responded) return;
      responded = true;
      clearTimeout(t);
      try { socket.destroy(); } catch (_) {}
      resolve(r);
    };

    const t = setTimeout(() => done({ ok: false, error: 'timeout' }), 8_000);

    socket.connect(config.port, config.host);
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!sentLogin && buffer.includes('Asterisk Call Manager')) {
        sentLogin = true;
        socket.write(
          `Action: Login\r\nUsername: ${config.username}\r\nSecret: ${config.secret}\r\nActionID: ping\r\n\r\n`,
        );
      }
      let boundary: number;
      while ((boundary = buffer.indexOf('\r\n\r\n')) !== -1) {
        const msg = buffer.slice(0, boundary);
        buffer    = buffer.slice(boundary + 4);
        if (msg.includes('ActionID: ping')) {
          const ok = msg.includes('Response: Success');
          socket.write('Action: Logoff\r\n\r\n');
          done(ok ? { ok: true, latencyMs: Date.now() - start } : { ok: false, error: 'Auth failed' });
        }
      }
    });
    socket.on('error', (err) => done({ ok: false, error: err.message }));
  });
}
