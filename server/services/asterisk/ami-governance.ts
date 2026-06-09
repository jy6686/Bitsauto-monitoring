/**
 * Persistent AMI listener for Call Governance
 * Maintains a long-lived connection to Asterisk, emits Bridge/Hangup events
 * so the governance engine can schedule vendor-leg cuts.
 */
import net from 'net';
import { EventEmitter } from 'events';

function cfg() {
  return {
    host:     process.env.ASTERISK_HOST     ?? '159.223.32.59',
    port:     Number(process.env.ASTERISK_AMI_PORT ?? 5038),
    username: process.env.ASTERISK_AMI_USER ?? 'bitsauto',
    secret:   process.env.ASTERISK_AMI_SECRET ?? '',
  };
}

export interface BridgeEvent {
  uniqueId1:     string;
  uniqueId2:     string;
  channel1:      string;
  channel2:      string;
  callerIdNum1:  string;
  callerIdNum2:  string;
}

export interface HangupEvent {
  channel:  string;
  uniqueId: string;
  cause:    string;
}

interface BridgeLeg {
  channel:     string;
  uniqueId:    string;
  callerIdNum: string;
}

class AmiGovernanceListener extends EventEmitter {
  private socket:             net.Socket | null = null;
  private buffer              = '';
  private connected           = false;
  private loggedIn            = false;
  private reconnectTimer:     NodeJS.Timeout | null = null;
  private keepaliveTimer:     NodeJS.Timeout | null = null;
  private actionCounter       = 0;
  private started             = false;
  // BridgeEnter fires once per channel — accumulate until both legs present
  private bridgePending = new Map<string, BridgeLeg[]>();
  // channel → bridgeId for cleanup on hangup
  private channelToBridge = new Map<string, string>();
  // Raw frame listeners for collecting AMI action responses (e.g. CoreShowChannels)
  private rawFrameListeners: Array<(f: Record<string, string>) => void> = [];

  start() {
    if (this.started) return;
    if (!process.env.ASTERISK_AMI_SECRET) {
      console.log('[ami-governance] AMI not configured — governance listener inactive');
      return;
    }
    this.started = true;
    this.connect();
  }

  private connect() {
    const c = cfg();
    this.socket  = new net.Socket();
    this.buffer  = '';
    this.connected = false;
    this.loggedIn  = false;

    this.socket.connect(c.port, c.host);

    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[ami-governance] Connected to Asterisk AMI');
    });

    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString();

      // AMI banner arrives as a single line ending \r\n (not \r\n\r\n).
      // Detect and handle it immediately so login is sent before authtimeout.
      if (!this.loggedIn && this.buffer.includes('Asterisk Call Manager')) {
        const lineEnd = this.buffer.indexOf('\r\n');
        if (lineEnd !== -1) {
          const bannerLine = this.buffer.slice(0, lineEnd);
          this.buffer = this.buffer.slice(lineEnd + 2);
          this.handleMessage(bannerLine);
        }
      }

      // Standard AMI messages are terminated by \r\n\r\n
      let boundary: number;
      while ((boundary = this.buffer.indexOf('\r\n\r\n')) !== -1) {
        const msg  = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 4);
        this.handleMessage(msg);
      }
    });

    this.socket.on('error', (err) => {
      console.error(`[ami-governance] Socket error: ${err.message}`);
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.loggedIn  = false;
      if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
      console.log('[ami-governance] Connection closed — reconnecting in 15s');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 15_000);
  }

  private parseFields(msg: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const line of msg.split('\r\n')) {
      const idx = line.indexOf(': ');
      if (idx !== -1) fields[line.slice(0, idx).toLowerCase()] = line.slice(idx + 2).trim();
    }
    return fields;
  }

  private handleMessage(msg: string) {
    const f = this.parseFields(msg);

    // AMI banner → send login
    if (!this.loggedIn && msg.includes('Asterisk Call Manager')) {
      const c = cfg();
      this.socket?.write(
        `Action: Login\r\nUsername: ${c.username}\r\nSecret: ${c.secret}\r\nActionID: gov-login\r\n\r\n`
      );
      return;
    }

    // Login response
    if (f['actionid'] === 'gov-login') {
      if (f['response'] === 'Success') {
        this.loggedIn = true;
        console.log('[ami-governance] Logged in — listening for Bridge/Hangup events');
        // Send a Ping every 20s to keep the connection alive
        if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = setInterval(() => {
          if (this.connected && this.loggedIn && this.socket) {
            this.socket.write(`Action: Ping\r\nActionID: gov-keepalive\r\n\r\n`);
          }
        }, 20_000);
        // Emit 'connected' so governance engine can reconcile existing calls
        this.emit('connected');
      } else {
        console.error('[ami-governance] Login failed:', f['message']);
      }
      return;
    }

    // Route frame to any registered raw listeners (used by fetchActiveBridges)
    for (const fn of this.rawFrameListeners) {
      try { fn(f); } catch {}
    }

    // Bridge event (chan_sip style — both channels in one event)
    if (f['event'] === 'Bridge') {
      const evt: BridgeEvent = {
        uniqueId1:    f['uniqueid1'] || f['uniqueid'] || '',
        uniqueId2:    f['uniqueid2'] || '',
        channel1:     f['channel1']  || f['channel']  || '',
        channel2:     f['channel2']  || '',
        callerIdNum1: f['calleridnum1'] || f['calleridnum'] || '',
        callerIdNum2: f['calleridnum2'] || '',
      };
      if (evt.channel1 && evt.channel2) this.emit('bridge', evt);
    }

    // BridgeEnter (PJSIP style — fires once per channel leg)
    // Accumulate by bridgeUniqueid; emit when both legs have arrived.
    if (f['event'] === 'BridgeEnter') {
      const bridgeId  = f['bridgeuniqueid'] || '';
      const channel   = f['channel']        || '';
      const uniqueId  = f['uniqueid']        || '';
      const callerIdNum = f['calleridnum']   || '';
      if (!bridgeId || !channel) return;

      this.channelToBridge.set(channel, bridgeId);

      const legs = this.bridgePending.get(bridgeId) ?? [];
      legs.push({ channel, uniqueId, callerIdNum });
      this.bridgePending.set(bridgeId, legs);

      if (legs.length >= 2) {
        this.bridgePending.delete(bridgeId);
        const evt: BridgeEvent = {
          uniqueId1:    legs[0].uniqueId,
          uniqueId2:    legs[1].uniqueId,
          channel1:     legs[0].channel,
          channel2:     legs[1].channel,
          callerIdNum1: legs[0].callerIdNum,
          callerIdNum2: legs[1].callerIdNum,
        };
        console.log(`[ami-governance] Bridge: ${evt.channel1} ↔ ${evt.channel2}`);
        this.emit('bridge', evt);
      }
    }

    // Hangup event — clean up pending bridge state
    if (f['event'] === 'Hangup') {
      const channel = f['channel'] || '';
      const bridgeId = this.channelToBridge.get(channel);
      if (bridgeId) {
        const legs = this.bridgePending.get(bridgeId);
        if (legs) {
          this.bridgePending.set(bridgeId, legs.filter(l => l.channel !== channel));
          if ((this.bridgePending.get(bridgeId)?.length ?? 0) === 0) {
            this.bridgePending.delete(bridgeId);
          }
        }
        this.channelToBridge.delete(channel);
      }
      const evt: HangupEvent = {
        channel:  channel,
        uniqueId: f['uniqueid'] || '',
        cause:    f['cause']    || '',
      };
      if (evt.channel) this.emit('hangup', evt);
    }
  }

  /**
   * Start a MixMonitor recording on a channel.
   * Called at bridge time (after call is answered) so the recording captures
   * only post-answer conversation audio — never pre-answer ringback/ringing.
   * Option 'b' = only record while the bridge is active (extra safety guard).
   * filename should be the full path WITHOUT extension (e.g. /var/spool/asterisk/monitor/gov_123)
   */
  async startMixMonitor(channel: string, filename: string): Promise<boolean> {
    if (!this.connected || !this.loggedIn || !this.socket) {
      console.warn('[ami-governance] Cannot start MixMonitor — not connected');
      return false;
    }
    const actionId = `gov-mm-${++this.actionCounter}`;
    console.log(`[ami-governance] StartMixMonitor → channel=${channel} file=${filename}.wav`);
    this.socket.write(
      `Action: MixMonitor\r\nChannel: ${channel}\r\nFile: ${filename}.wav\r\nOptions: b\r\nActionID: ${actionId}\r\n\r\n`
    );
    return true;
  }

  /** Send BYE to a single channel (fallback — only when no A-leg/recording available) */
  async hangup(channel: string): Promise<boolean> {
    if (!this.connected || !this.loggedIn || !this.socket) {
      console.warn('[ami-governance] Cannot hangup — not connected');
      return false;
    }
    const actionId = `gov-hangup-${++this.actionCounter}`;
    console.log(`[ami-governance] Hangup → channel=${channel}`);
    this.socket.write(
      `Action: Hangup\r\nChannel: ${channel}\r\nCause: 16\r\nActionID: ${actionId}\r\n\r\n`
    );
    return true;
  }

  /**
   * Atomically redirect both bridge legs simultaneously:
   *   channelA → gov-playback  (StopMixMonitor + Wait + Playback + Hangup)
   *   channelB → gov-hangup    (immediate Hangup)
   * This dissolves the bridge cleanly without Asterisk hanging up the A-leg
   * as a side-effect of hanging up the B-leg.
   */
  async cutAndPlayback(channelA: string, channelB: string, filename: string): Promise<boolean> {
    if (!this.connected || !this.loggedIn || !this.socket) {
      console.warn('[ami-governance] Cannot cut — not connected');
      return false;
    }
    const actionId = `gov-cut-${++this.actionCounter}`;
    console.log(`[ami-governance] CutAndPlayback → A-leg=${channelA} B-leg=${channelB} file=${filename}`);
    // Set the playback filename variable on the A-leg first
    this.socket.write(
      `Action: Setvar\r\nChannel: ${channelA}\r\nVariable: GOV_PLAYBACK_FILE\r\nValue: ${filename}\r\nActionID: ${actionId}-var\r\n\r\n`
    );
    // Atomic redirect: both legs leave the bridge simultaneously
    // channelA goes to playback, channelB goes to hangup context
    this.socket.write(
      `Action: Redirect\r\n` +
      `Channel: ${channelA}\r\n` +
      `ExtraChannel: ${channelB}\r\n` +
      `Context: gov-playback\r\nExten: s\r\nPriority: 1\r\n` +
      `ExtraContext: gov-hangup\r\nExtraExten: s\r\nExtraPriority: 1\r\n` +
      `ActionID: ${actionId}\r\n\r\n`
    );
    return true;
  }

  /**
   * Fetch SIP Call-ID and peer IP for a channel via AMI Getvar.
   * Returns within 3 s or resolves with empty strings on timeout/error.
   * Works for both chan_sip (SIP/) and PJSIP/ channels.
   */
  getChannelVars(channel: string): Promise<{ sipCallId: string; peerIp: string }> {
    return new Promise((resolve) => {
      if (!this.connected || !this.loggedIn || !this.socket) {
        resolve({ sipCallId: '', peerIp: '' });
        return;
      }

      const tag      = `gov-gv-${++this.actionCounter}`;
      const tagCallId = `${tag}-callid`;
      const tagPeerIp = `${tag}-peerip`;
      let sipCallId = '';
      let peerIp    = '';
      let received  = 0;

      const done = () => {
        this.removeRawFrameListener(listener);
        resolve({ sipCallId, peerIp });
      };

      const timeout = setTimeout(done, 3_000);

      const listener = (f: Record<string, string>) => {
        if (f['actionid'] === tagCallId && f['value'] !== undefined) {
          sipCallId = f['value'] || '';
          if (++received >= 2) { clearTimeout(timeout); done(); }
        }
        if (f['actionid'] === tagPeerIp && f['value'] !== undefined) {
          peerIp = f['value'] || '';
          if (++received >= 2) { clearTimeout(timeout); done(); }
        }
      };

      this.addRawFrameListener(listener);

      // Try CHANNEL(sip_call_id) first — works for chan_sip and PJSIP
      this.socket.write(
        `Action: Getvar\r\nActionID: ${tagCallId}\r\nChannel: ${channel}\r\nVariable: CHANNEL(sip_call_id)\r\n\r\n`
      );
      // CHANNEL(peerip) — peer IP of the SIP dialog
      this.socket.write(
        `Action: Getvar\r\nActionID: ${tagPeerIp}\r\nChannel: ${channel}\r\nVariable: CHANNEL(peerip)\r\n\r\n`
      );
    });
  }

  get isConnected() { return this.connected && this.loggedIn; }

  // ── Raw frame listener management (used by fetchActiveBridges) ────────────
  addRawFrameListener(fn: (f: Record<string, string>) => void) {
    this.rawFrameListeners.push(fn);
  }
  removeRawFrameListener(fn: (f: Record<string, string>) => void) {
    this.rawFrameListeners = this.rawFrameListeners.filter(l => l !== fn);
  }

  /**
   * Query Asterisk for all currently active bridged channels.
   * Uses AMI CoreShowChannels — returns both legs of every active bridge
   * so the governance engine can reconcile missed bridge events (e.g. after reconnect).
   */
  async fetchActiveBridges(): Promise<Array<{
    channel:          string;
    bridgeId:         string;
    durationSec:      number;
    uniqueId:         string;
    callerIdNum:      string;
    connectedLineNum: string;
  }>> {
    return new Promise((resolve) => {
      if (!this.loggedIn || !this.socket) { resolve([]); return; }

      const actionId  = `gov-csc-${++this.actionCounter}`;
      const channels: Array<{
        channel: string; bridgeId: string; durationSec: number;
        uniqueId: string; callerIdNum: string; connectedLineNum: string;
      }> = [];

      // Timeout safety — resolve with whatever we have after 5s
      const timeout = setTimeout(() => {
        this.removeRawFrameListener(listener);
        console.warn('[ami-governance] fetchActiveBridges timed out — returning partial results');
        resolve(channels);
      }, 5_000);

      const listener = (f: Record<string, string>) => {
        if (f['event'] === 'coreshowchannel') {
          const bridgeId = f['bridgeid'] ?? '';
          if (!bridgeId) return; // not currently bridged — skip

          // Parse duration "H:MM:SS" or "M:SS"
          const raw   = f['duration'] ?? '0:00:00';
          const parts = raw.split(':').map(Number);
          let secs = 0;
          if (parts.length === 3)      secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) secs = parts[0] * 60  + parts[1];
          else                         secs = parts[0] || 0;

          channels.push({
            channel:          f['channel']          ?? '',
            bridgeId,
            durationSec:      secs,
            uniqueId:         f['uniqueid']          ?? '',
            callerIdNum:      f['calleridnum']       ?? '',
            connectedLineNum: f['connectedlinenum']  ?? '',
          });
        }

        if (f['event'] === 'coreshowchannelscomplete') {
          clearTimeout(timeout);
          this.removeRawFrameListener(listener);
          resolve(channels);
        }
      };

      this.addRawFrameListener(listener);
      this.socket.write(`Action: CoreShowChannels\r\nActionID: ${actionId}\r\n\r\n`);
    });
  }
}

export const amiGovernance = new AmiGovernanceListener();
