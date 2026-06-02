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
      } else {
        console.error('[ami-governance] Login failed:', f['message']);
      }
      return;
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

  get isConnected() { return this.connected && this.loggedIn; }
}

export const amiGovernance = new AmiGovernanceListener();
