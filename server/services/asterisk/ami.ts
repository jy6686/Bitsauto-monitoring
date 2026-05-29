/**
 * Asterisk AMI (Asterisk Manager Interface) client
 * Used to originate Voice OTP calls via Asterisk → Sippy → Carrier
 */
import net from 'net';

function cfg() {
  return {
    host:     process.env.ASTERISK_HOST     ?? '159.223.32.59',
    port:     Number(process.env.ASTERISK_AMI_PORT ?? 5038),
    username: process.env.ASTERISK_AMI_USER ?? 'bitsauto',
    secret:   process.env.ASTERISK_AMI_SECRET ?? '',
  };
}

export function isAmiConfigured(): boolean {
  return !!process.env.ASTERISK_AMI_SECRET;
}

export interface OriginateResult {
  success:   boolean;
  uniqueId?: string;
  error?:    string;
}

export interface OriginateParams {
  to:        string;   // e.g. +923001112233
  otp:       string;   // e.g. 987432 — passed as CallerID name so dialplan reads it
  trunk?:    string;   // Asterisk trunk/peer name, default 'Sippy'
  timeout?:  number;   // call timeout ms, default 30000
}

/**
 * Open a short-lived AMI connection, originate one call, then disconnect.
 */
export function originateOtpCall(params: OriginateParams): Promise<OriginateResult> {
  const config = cfg();
  const { to, otp, trunk = 'Sippy', timeout: callTimeout = 30000 } = params;
  const actionId = `bitsauto-${Date.now()}`;

  return new Promise((resolve) => {
    const socket  = new net.Socket();
    let   buffer  = '';
    let   sentLogin    = false;
    let   loggedIn     = false;
    let   responded    = false;

    const done = (result: OriginateResult) => {
      if (responded) return;
      responded = true;
      clearTimeout(connTimeout);
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };

    const connTimeout = setTimeout(
      () => done({ success: false, error: 'AMI connection timed out' }),
      15_000,
    );

    socket.connect(config.port, config.host);

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      // Banner arrives as a single \r\n terminated line — send login immediately
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

        // Login success
        if (!loggedIn && msg.includes('ActionID: ami-login') && msg.includes('Response: Success')) {
          loggedIn = true;
          const channel = `SIP/${trunk}/${to}`;
          socket.write([
            'Action: Originate',
            `Channel: ${channel}`,
            'Context: otp-playback',
            'Exten: s',
            'Priority: 1',
            `CallerID: "${otp}" <${otp}>`,
            `Timeout: ${callTimeout}`,
            'Async: true',
            `ActionID: ${actionId}`,
            '', '',
          ].join('\r\n'));
        }

        // Login failure
        if (!loggedIn && msg.includes('ActionID: ami-login') && msg.includes('Response: Error')) {
          done({ success: false, error: 'AMI authentication failed — check ASTERISK_AMI_SECRET' });
        }

        // Originate response
        if (loggedIn && msg.includes(`ActionID: ${actionId}`)) {
          if (msg.includes('Response: Success')) {
            const m = msg.match(/Uniqueid: (.+)/);
            socket.write('Action: Logoff\r\n\r\n');
            done({ success: true, uniqueId: m?.[1]?.trim() });
          } else {
            const m = msg.match(/Message: (.+)/);
            done({ success: false, error: m?.[1]?.trim() ?? 'Originate failed' });
          }
        }
      }
    });

    socket.on('error', (err) => done({ success: false, error: err.message }));
    socket.on('close', () => {
      if (!responded) done({ success: false, error: 'AMI connection closed unexpectedly' });
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
