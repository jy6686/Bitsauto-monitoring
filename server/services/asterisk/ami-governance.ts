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

class AmiGovernanceListener extends EventEmitter {
  private socket:          net.Socket | null = null;
  private buffer           = '';
  private connected        = false;
  private loggedIn         = false;
  private reconnectTimer:  NodeJS.Timeout | null = null;
  private actionCounter    = 0;
  private started          = false;

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
      } else {
        console.error('[ami-governance] Login failed:', f['message']);
      }
      return;
    }

    // Bridge event (two channels bridged together)
    if (f['event'] === 'Bridge' || f['event'] === 'BridgeEnter') {
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

    // Hangup event
    if (f['event'] === 'Hangup') {
      const evt: HangupEvent = {
        channel:  f['channel']  || '',
        uniqueId: f['uniqueid'] || '',
        cause:    f['cause']    || '',
      };
      if (evt.channel) this.emit('hangup', evt);
    }
  }

  /** Send BYE to a specific channel (vendor leg cut) */
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

  /** Redirect customer A-leg to playback context */
  async playback(channel: string, filename: string): Promise<boolean> {
    if (!this.connected || !this.loggedIn || !this.socket) {
      console.warn('[ami-governance] Cannot redirect for playback — not connected');
      return false;
    }
    const actionId = `gov-playback-${++this.actionCounter}`;
    console.log(`[ami-governance] Redirect for playback → channel=${channel} file=${filename}`);
    this.socket.write(
      `Action: Setvar\r\nChannel: ${channel}\r\nVariable: GOV_PLAYBACK_FILE\r\nValue: ${filename}\r\nActionID: ${actionId}-set\r\n\r\n` +
      `Action: Redirect\r\nChannel: ${channel}\r\nContext: gov-playback\r\nExten: s\r\nPriority: 1\r\nActionID: ${actionId}\r\n\r\n`
    );
    return true;
  }

  get isConnected() { return this.connected && this.loggedIn; }
}

export const amiGovernance = new AmiGovernanceListener();
