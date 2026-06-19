/**
 * Asterisk Deployment & Configuration Guide Generator
 * Produces a complete Word (.docx) reference covering installation,
 * configuration, AMI integration, call governance, and troubleshooting.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer,
  NumberFormat, PageBreak,
} from 'docx';

// ── Colour palette (matches platform dark theme) ──────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GREEN    = '00C853';
const ORANGE   = 'FF6D00';
const RED      = 'FF3D3D';
const YELLOW   = 'FFD600';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E8E8E8';
const MID_GY   = 'BDBDBD';
const PANEL_BG = '161B22';
const CODE_BG  = '1E2533';

const PAGE_DXA = 9360;
function w(pct: number) { return Math.round(PAGE_DXA * pct / 100); }

// ── Type helpers ──────────────────────────────────────────────────────────────
function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 160 },
    children: [new TextRun({ text, color: ACCENT, bold: true, size: 42 })],
  });
}
function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text, color: WHITE, bold: true, size: 30 })],
  });
}
function h3(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 80 },
    children: [new TextRun({ text, color: LIGHT_GY, bold: true, size: 24 })],
  });
}
function p(text: string, opts: { bold?: boolean; color?: string; size?: number; indent?: number; italic?: boolean } = {}) {
  return new Paragraph({
    indent: opts.indent ? { left: opts.indent } : undefined,
    spacing: { after: 120 },
    children: [new TextRun({
      text,
      bold:   opts.bold,
      color:  opts.color ?? LIGHT_GY,
      size:   opts.size ?? 20,
      italics: opts.italic,
    })],
  });
}
function code(text: string) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    shading: { type: ShadingType.SOLID, color: CODE_BG, fill: CODE_BG },
    indent: { left: 360 },
    children: [new TextRun({ text, font: 'Courier New', size: 18, color: GREEN })],
  });
}
function bullet(text: string, color = LIGHT_GY) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, color, size: 20 })],
  });
}
function subbullet(text: string, color = MID_GY) {
  return new Paragraph({
    bullet: { level: 1 },
    spacing: { after: 60 },
    children: [new TextRun({ text, color, size: 19 })],
  });
}
function note(text: string) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    shading: { type: ShadingType.SOLID, color: '1a2332', fill: '1a2332' },
    indent: { left: 360 },
    children: [
      new TextRun({ text: '⚠  NOTE  ', bold: true, color: YELLOW, size: 18 }),
      new TextRun({ text, color: LIGHT_GY, size: 18 }),
    ],
  });
}
function warn(text: string) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    shading: { type: ShadingType.SOLID, color: '2a1515', fill: '2a1515' },
    indent: { left: 360 },
    children: [
      new TextRun({ text: '🔴  CAUTION  ', bold: true, color: RED, size: 18 }),
      new TextRun({ text, color: LIGHT_GY, size: 18 }),
    ],
  });
}
function tip(text: string) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    shading: { type: ShadingType.SOLID, color: '0d2a1a', fill: '0d2a1a' },
    indent: { left: 360 },
    children: [
      new TextRun({ text: '✅  TIP  ', bold: true, color: GREEN, size: 18 }),
      new TextRun({ text, color: LIGHT_GY, size: 18 }),
    ],
  });
}
function br() { return new Paragraph({ children: [new TextRun('')], spacing: { after: 80 } }); }
function pb() { return new Paragraph({ children: [new PageBreak()] }); }

function twoColRow(left: string, right: string, headerRow = false): TableRow {
  const shading = headerRow
    ? { type: ShadingType.SOLID, color: ACCENT, fill: ACCENT }
    : { type: ShadingType.SOLID, color: PANEL_BG, fill: PANEL_BG };
  const textColor = headerRow ? DARK_BG : LIGHT_GY;
  const bold = headerRow;
  return new TableRow({
    children: [
      new TableCell({
        width: { size: w(35), type: WidthType.DXA },
        shading,
        children: [new Paragraph({ children: [new TextRun({ text: left, bold, color: headerRow ? DARK_BG : ACCENT, size: 18 })] })],
      }),
      new TableCell({
        width: { size: w(65), type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: headerRow ? ACCENT : '111827', fill: headerRow ? ACCENT : '111827' },
        children: [new Paragraph({ children: [new TextRun({ text: right, bold, color: textColor, size: 18, font: 'Courier New' })] })],
      }),
    ],
  });
}

function kvTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => twoColRow(k, v)),
  });
}

// ── Document body ─────────────────────────────────────────────────────────────
export async function generateAsteriskGuide(): Promise<Buffer> {
  const sections = buildSections();
  const doc = new Document({
    background: { color: DARK_BG },
    styles: {
      default: {
        document: {
          run: { color: LIGHT_GY, size: 20, font: 'Calibri' },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'CONFIDENTIAL  ·  Ichibaan Logic Pvt Ltd  ·  Asterisk Deployment Guide', color: MID_GY, size: 16 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Page ', color: MID_GY, size: 16 }),
              new TextRun({ children: ['PAGE'], color: MID_GY, size: 16 }),
              new TextRun({ text: ' of ', color: MID_GY, size: 16 }),
              new TextRun({ children: ['NUMPAGES'], color: MID_GY, size: 16 }),
            ],
          })],
        }),
      },
      children: sections,
    }],
  });
  return Packer.toBuffer(doc);
}

function buildSections(): Paragraph[] {
  return [
    // ── Cover ────────────────────────────────────────────────────────────────
    new Paragraph({ spacing: { before: 1200, after: 200 }, children: [new TextRun({ text: 'ASTERISK', color: ACCENT, bold: true, size: 96 })] }),
    new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'DEPLOYMENT & CONFIGURATION GUIDE', color: WHITE, bold: true, size: 44 })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Ichibaan Logic Private Limited', color: MID_GY, size: 24, italics: true })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `Generated: ${new Date().toUTCString()}`, color: MID_GY, size: 20 })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Platform: BitsAuto VoIP Monitoring Dashboard', color: MID_GY, size: 20 })] }),
    warn('This document contains server credentials, IP addresses, and configuration secrets. Handle as CONFIDENTIAL. Do not share externally.'),
    pb(),

    // ── 1. Overview ──────────────────────────────────────────────────────────
    h1('1. Overview'),
    p('Asterisk acts as the media-origination layer for the BitsAuto platform. It has two distinct roles:'),
    bullet('Voice OTP Delivery — originate outbound calls via the Asterisk Manager Interface (AMI), speak OTP digits using the SayDigits application, and route through the Sippy softswitch to the carrier.'),
    bullet('Call Governance — a persistent AMI listener monitors live bridge and hangup events so the governance engine can cut vendor-side legs and enforce call duration policies in real time.'),
    br(),
    p('Both roles use the same Asterisk instance and the same AMI credentials. The platform connects to AMI via raw TCP (port 5038). No SIP endpoints are registered on Asterisk from the platform side — all calls are originated by the platform as Originate actions.'),
    br(),

    // ── 2. Server Details ────────────────────────────────────────────────────
    h1('2. Server Details'),
    kvTable([
      ['Server IP',       '159.223.32.59'],
      ['OS / Distro',     'Ubuntu 20.04 LTS (DigitalOcean Droplet)'],
      ['Asterisk Version','Asterisk 18.x (LTS)'],
      ['chan_sip port',   '5160 (non-standard — avoids conflict with Sippy on 5060)'],
      ['AMI port',        '5038 (default)'],
      ['SSH port',        '22'],
      ['SSH user',        'root'],
    ]),
    br(),
    note('Port 5160 for chan_sip is intentional. The Sippy SBC on SB-1 uses port 5060 for SIP. Using 5160 on Asterisk prevents port conflicts when both run on IPs in the same routing domain.'),
    br(),

    // ── 3. Prerequisites ─────────────────────────────────────────────────────
    h1('3. Installation Prerequisites'),
    h2('3.1  Operating System'),
    p('Ubuntu 20.04 LTS or 22.04 LTS (64-bit). Minimum 2 vCPU, 2 GB RAM, 20 GB SSD.'),
    h2('3.2  Required Packages'),
    code('apt-get update && apt-get upgrade -y'),
    code('apt-get install -y build-essential wget curl git libssl-dev libncurses5-dev \\'),
    code('  libnewt-dev libxml2-dev libsqlite3-dev uuid-dev jansson-dev \\'),
    code('  libjansson-dev libedit-dev'),
    h2('3.3  Firewall Rules (UFW)'),
    code('ufw allow 22/tcp        # SSH'),
    code('ufw allow 5038/tcp      # AMI (restrict to platform IP in production)'),
    code('ufw allow 5160/udp      # chan_sip'),
    code('ufw allow 5160/tcp      # chan_sip TCP'),
    code('ufw allow 10000:20000/udp  # RTP media'),
    code('ufw enable'),
    warn('In production, restrict port 5038 (AMI) to the Replit/platform server IP only. Leaving it open to 0.0.0.0 exposes AMI to brute-force attacks.'),
    br(),

    // ── 4. Installation ──────────────────────────────────────────────────────
    h1('4. Asterisk Installation Commands'),
    h2('4.1  Download & Extract'),
    code('cd /usr/src'),
    code('wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-18-current.tar.gz'),
    code('tar xzf asterisk-18-current.tar.gz'),
    code('cd asterisk-18.*/'),
    h2('4.2  Install Dependencies Script'),
    code('contrib/scripts/install_prereq install'),
    h2('4.3  Configure & Build'),
    code('./configure --with-jansson-bundled'),
    code('make menuselect'),
    p('In menuselect, ensure the following are selected:', { color: MID_GY }),
    subbullet('chan_sip (under Channel Drivers)'),
    subbullet('app_saydigits (under Applications) — used for Voice OTP'),
    subbullet('manager (AMI module — under Core Sound Packages)'),
    subbullet('func_callerid, app_originate (under Applications)'),
    code('make -j$(nproc)'),
    code('make install'),
    code('make samples   # installs sample config files to /etc/asterisk/'),
    h2('4.4  Set Permissions'),
    code('groupadd asterisk'),
    code('useradd -r -d /var/lib/asterisk -g asterisk asterisk'),
    code('chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/log/asterisk /var/run/asterisk /var/spool/asterisk'),
    h2('4.5  Enable Service'),
    code('cp contrib/init.d/rc.debian.asterisk /etc/init.d/asterisk'),
    code('chmod +x /etc/init.d/asterisk'),
    code('systemctl daemon-reload'),
    code('systemctl enable asterisk'),
    code('systemctl start asterisk'),
    pb(),

    // ── 5. Configuration Files ───────────────────────────────────────────────
    h1('5. Configuration Files & Locations'),
    kvTable([
      ['Main config dir',         '/etc/asterisk/'],
      ['SIP peers',               '/etc/asterisk/sip.conf'],
      ['PJSIP endpoints',         '/etc/asterisk/pjsip.conf'],
      ['Dialplan',                '/etc/asterisk/extensions.conf'],
      ['AMI users',               '/etc/asterisk/manager.conf'],
      ['General settings',        '/etc/asterisk/asterisk.conf'],
      ['Module loading',          '/etc/asterisk/modules.conf'],
      ['Log files',               '/var/log/asterisk/'],
      ['Full log',                '/var/log/asterisk/full'],
      ['Spool / recordings',      '/var/spool/asterisk/monitor/'],
    ]),
    br(),

    // ── 6. AMI Configuration ─────────────────────────────────────────────────
    h1('6. Asterisk Manager Interface (AMI) Configuration'),
    h2('6.1  /etc/asterisk/manager.conf'),
    p('This file controls which users can connect to the AMI and what permissions they have.'),
    code('[general]'),
    code('enabled = yes'),
    code('port = 5038'),
    code('bindaddr = 0.0.0.0   ; Restrict to platform IP in production'),
    code(''),
    code('[bitsauto]'),
    code('secret = <ASTERISK_AMI_SECRET_VALUE>   ; matches ASTERISK_AMI_SECRET env var'),
    code('deny = 0.0.0.0/0.0.0.0'),
    code('permit = 127.0.0.1/255.255.255.0'),
    code('permit = <PLATFORM_IP>/255.255.255.255  ; Replit server IP'),
    code('read = all'),
    code('write = all,originate'),
    code('eventmask = on'),
    br(),
    note('The "write = all,originate" permission is required for the Voice OTP feature. The originate permission allows the platform to launch outbound calls via the AMI Originate action.'),
    h2('6.2  Platform AMI Credentials (Environment Variables)'),
    kvTable([
      ['ASTERISK_HOST',       '159.223.32.59'],
      ['ASTERISK_AMI_PORT',   '5038'],
      ['ASTERISK_AMI_USER',   'bitsauto'],
      ['ASTERISK_AMI_SECRET', '<set in Replit Secrets — never hardcoded>'],
      ['ASTERISK_SSH_USER',   'root'],
      ['ASTERISK_SSH_PASSWORD','<set in Replit Secrets — never hardcoded>'],
      ['ASTERISK_CHAN_TECH',  'DIRECT_SIP (default) | SIP | PJSIP'],
      ['ASTERISK_TRUNK_NAME', 'Sippy (used only in SIP/PJSIP modes)'],
    ]),
    br(),

    // ── 7. SIP/PJSIP Configuration ───────────────────────────────────────────
    h1('7. SIP Configuration'),
    h2('7.1  Channel Technology'),
    p('The platform supports three channel modes, controlled by the ASTERISK_CHAN_TECH environment variable:'),
    br(),
    kvTable([
      ['Mode',         'Channel String Built'],
      ['DIRECT_SIP',   'SIP/number@SippySipIP — direct dial to Sippy SIP IP, no trunk registration needed'],
      ['SIP',          'SIP/TrunkName/number — uses a named chan_sip peer defined in sip.conf'],
      ['PJSIP',        'PJSIP/number@TrunkName — uses a named PJSIP endpoint defined in pjsip.conf'],
    ]),
    br(),
    p('Current deployment uses DIRECT_SIP. Sippy SIP IP: 191.101.30.107 (SB-1 softswitch).'),
    h2('7.2  /etc/asterisk/sip.conf (chan_sip — required even in DIRECT_SIP mode)'),
    code('[general]'),
    code('bindport = 5160          ; non-standard port to avoid conflict with Sippy on 5060'),
    code('bindaddr = 0.0.0.0'),
    code('transport = udp'),
    code('context = default'),
    code('disallow = all'),
    code('allow = ulaw'),
    code('allow = alaw'),
    code('allow = g729'),
    code('nat = force_rport,comedia'),
    code('externip = 159.223.32.59  ; public IP of Asterisk server'),
    code('localnet = 10.0.0.0/8'),
    code('qualify = yes'),
    code(''),
    code('; Sippy trunk (used in SIP mode only — not needed for DIRECT_SIP)'),
    code('[Sippy]'),
    code('type = peer'),
    code('host = 191.101.30.107'),
    code('port = 5060'),
    code('disallow = all'),
    code('allow = ulaw'),
    code('allow = alaw'),
    code('insecure = invite,port'),
    code('context = from-sippy'),
    code('dtmfmode = rfc2833'),
    code('qualify = yes'),
    br(),
    h2('7.3  Tech Prefix Encoding (Sippy Routing)'),
    p('When dialling through Sippy, a product/routing class prefix is prepended to the destination number. This is controlled by the SIPPY_TECH_PREFIX environment variable.'),
    br(),
    kvTable([
      ['Env var',          'SIPPY_TECH_PREFIX'],
      ['Example value',    '22211'],
      ['Effect',           'Asterisk dials 22211923219286686 — Sippy strips 4-digit product code (2221) → CLD to carrier = 1923219286686'],
      ['Digit structure',  'Digits 1,2,6,7 of trunk name encode product/routing class. Digit 3 onwards is the real E.164 number.'],
      ['Products',         '1 = First Class, 2 = Business Class, 6 = Bravo Special, 7 = Special Charlie'],
      ['SIPPY_CLI',        'Caller ID presented — matches the IP auth rule on Sippy (e.g. 2221192)'],
      ['SIPPY_SIP_IP',     '191.101.30.107 (SB-1 Sippy SIP IP)'],
    ]),
    br(),
    note('If SIPPY_TECH_PREFIX is empty, the number is dialled as-is without any prefix. In DIRECT_SIP mode, no trunk registration is needed — Asterisk dials SIP/number@191.101.30.107 directly.'),
    br(),
    pb(),

    // ── 8. Dialplan ──────────────────────────────────────────────────────────
    h1('8. Dialplan Configuration'),
    h2('8.1  /etc/asterisk/extensions.conf'),
    p('The platform uses Application: SayDigits directly in the AMI Originate action. This bypasses the dialplan entirely — no dialplan entry is required for Voice OTP calls.'),
    br(),
    p('However, the following minimal dialplan is recommended for:'),
    bullet('Handling inbound calls from Sippy (if any)'),
    bullet('Providing a fallback context for originated calls'),
    bullet('Enabling hangup context for Call Governance leg-cut operations'),
    br(),
    code('[general]'),
    code('static = yes'),
    code('writeprotect = yes'),
    code(''),
    code('[default]'),
    code('exten => _X.,1,NoOp(Unrouted call to ${EXTEN})'),
    code(' same => n,Hangup()'),
    code(''),
    code('[from-sippy]'),
    code('; Inbound calls arriving from Sippy SBC'),
    code('exten => _X.,1,NoOp(Inbound from Sippy: ${EXTEN})'),
    code(' same => n,Answer()'),
    code(' same => n,Playback(tt-allbusy)'),
    code(' same => n,Hangup()'),
    code(''),
    code('[bitsauto-otp]'),
    code('; Context for originated Voice OTP calls (SayDigits is sent via AMI,'),
    code('; so this context is only reached if SayDigits is NOT used as Application)'),
    code('exten => _X.,1,NoOp(Voice OTP to ${EXTEN} — OTP in CALLERID(name))'),
    code(' same => n,Answer()'),
    code(' same => n,SayDigits(${CALLERID(name)})'),
    code(' same => n,Hangup()'),
    br(),
    note('Current production deployment uses Application: SayDigits in the AMI Originate action — the dialplan context is not entered. This is intentional and avoids FreePBX dependency.'),
    br(),

    // ── 9. Voice OTP Flow ────────────────────────────────────────────────────
    h1('9. Voice OTP Integration'),
    h2('9.1  Call Flow'),
    p('The platform initiates OTP calls through the following sequence:'),
    br(),
    bullet('1. Platform receives POST /api/voice-otp with {to, otp, cli} parameters'),
    bullet('2. Platform opens a short-lived TCP connection to 159.223.32.59:5038'),
    bullet('3. On AMI banner, sends Login action with username=bitsauto + secret'),
    bullet('4. On successful login, sends Originate action:'),
    subbullet('Channel: SIP/<techprefix+number>@191.101.30.107  (DIRECT_SIP mode)'),
    subbullet('Application: SayDigits'),
    subbullet('Data: <OTP digits>'),
    subbullet('CallerID: "OTP Service" <CLI>'),
    subbullet('Async: true'),
    bullet('5. Waits for OriginateResponse event (not the initial queued response)'),
    bullet('6. On Response: Success / Reason: 4 → call answered successfully'),
    bullet('7. Platform records result to voice_otp_calls DB table'),
    bullet('8. Connection is torn down after outcome received'),
    br(),
    h2('9.2  AMI Originate Action (exact format sent by platform)'),
    code('Action: Originate'),
    code('Channel: SIP/22211923219286686@191.101.30.107'),
    code('Application: SayDigits'),
    code('Data: 847362'),
    code('CallerID: "OTP Service" <2221192>'),
    code('Timeout: 45000'),
    code('Async: true'),
    code('ActionID: bitsauto-1717000000000'),
    code(''),
    h2('9.3  OriginateResponse Reason Codes'),
    kvTable([
      ['Code', 'Meaning'],
      ['0',   'No such extension / number unreachable'],
      ['1',   'No answer (timeout)'],
      ['3',   'User busy / call cancelled'],
      ['4',   'Answered — SUCCESS'],
      ['5',   'No answer / alerting (not answered in time)'],
      ['7',   'Failed / Error'],
      ['8',   'Congestion'],
    ]),
    br(),
    pb(),

    // ── 10. Call Governance AMI Listener ─────────────────────────────────────
    h1('10. Call Governance — Persistent AMI Listener'),
    h2('10.1  Architecture'),
    p('Unlike Voice OTP (which uses short-lived connections), Call Governance uses a single persistent TCP connection to the AMI that is maintained for the lifetime of the server process.'),
    br(),
    kvTable([
      ['Module',         'server/services/asterisk/ami-governance.ts'],
      ['Connection',     'Persistent — reconnects every 15 seconds on disconnect'],
      ['Events handled', 'BridgeEnter, Hangup, CoreShowChannels'],
      ['Keepalive',      'Ping action every 60 seconds to detect silent disconnects'],
      ['Purpose',        'Detect live bridges so governance engine can cut vendor leg on rule match'],
    ]),
    br(),
    h2('10.2  Bridge Detection Logic'),
    p('The AMI fires BridgeEnter once per channel leg as they join a bridge. The listener accumulates legs by bridgeId until both legs are present, then emits a bridge event:'),
    bullet('channelA — A-leg (caller side, e.g. SIP/2221192-00000001)'),
    bullet('channelB — B-leg (vendor side, e.g. SIP/callntalk-00000002)'),
    br(),
    p('Call Governance rules match the vendor-leg channel using a regex pattern (e.g. /SIP\\/callntalk/) to identify which vendor connection is carrying the call. On rule trigger, the platform sends a Hangup action for channelB to disconnect only the vendor leg.'),
    br(),
    h2('10.3  Recording Path'),
    p('When a call is recorded by Asterisk (using MixMonitor), the recording file path is captured from the bridge event. Recordings are stored at:'),
    code('/var/spool/asterisk/monitor/<uniqueId>.wav'),
    p('The platform streams recordings to operators via SSH SFTP (using the ASTERISK_SSH_PASSWORD credential to open an SSH2 connection to 159.223.32.59).'),
    br(),
    h2('10.4  Active Channels Query'),
    p('The governance listener can query live active bridges via the CoreShowChannels AMI action. This is used by the Billing Check tab to correlate live calls with CDR data.'),
    br(),

    // ── 11. Service Management ────────────────────────────────────────────────
    h1('11. Service Management Commands'),
    h2('11.1  Start / Stop / Restart'),
    code('systemctl start asterisk'),
    code('systemctl stop asterisk'),
    code('systemctl restart asterisk'),
    code('systemctl status asterisk'),
    h2('11.2  Asterisk CLI Access'),
    code('asterisk -rvvvv         # connect to running Asterisk with verbosity 4'),
    code('asterisk -rx "core show version"'),
    code('asterisk -rx "sip show peers"'),
    code('asterisk -rx "manager show users"'),
    code('asterisk -rx "core show channels"'),
    code('asterisk -rx "core show uptime"'),
    h2('11.3  Reload Configuration Without Restart'),
    code('asterisk -rx "sip reload"'),
    code('asterisk -rx "dialplan reload"'),
    code('asterisk -rx "manager reload"'),
    code('asterisk -rx "module reload res_pjsip.so"'),
    h2('11.4  Log Monitoring'),
    code('tail -f /var/log/asterisk/full'),
    code('tail -f /var/log/asterisk/messages'),
    code('grep -i "error\\|warning" /var/log/asterisk/full | tail -50'),
    br(),

    // ── 12. Troubleshooting ───────────────────────────────────────────────────
    h1('12. Troubleshooting'),
    h2('12.1  AMI Connection Refused'),
    p('Symptom: Platform logs show "AMI socket error: connect ECONNREFUSED 159.223.32.59:5038"'),
    bullet('Check Asterisk is running: systemctl status asterisk'),
    bullet('Verify manager.conf has enabled = yes and bindaddr = 0.0.0.0'),
    bullet('Check firewall: ufw status | grep 5038'),
    bullet('Reload AMI: asterisk -rx "manager reload"'),
    br(),
    h2('12.2  AMI Auth Failed'),
    p('Symptom: "AMI auth failed: Authentication failed"'),
    bullet('Verify ASTERISK_AMI_SECRET env var matches the secret in manager.conf [bitsauto]'),
    bullet('Confirm the username is "bitsauto" (case-sensitive)'),
    bullet('Test manually: telnet 159.223.32.59 5038  → send Login action'),
    br(),
    h2('12.3  Voice OTP Call Never Answers (Reason 1 or 5)'),
    bullet('Verify SIPPY_SIP_IP is correct (191.101.30.107)'),
    bullet('Verify SIPPY_TECH_PREFIX is correct — wrong prefix causes Sippy to reject routing'),
    bullet('Check Sippy IP auth rule allows CLI sent by Asterisk (SIPPY_CLI value)'),
    bullet('Run: asterisk -rx "sip set debug on" and attempt a call — check SIP INVITE logs'),
    bullet('Verify chan_sip is listening: asterisk -rx "sip show settings" → check bind port is 5160'),
    br(),
    h2('12.4  Call Governance Events Not Firing'),
    p('Symptom: Governance rules not triggering even when calls match'),
    bullet('Check platform logs for "[ami-governance] Connected" and "[ami-governance] Logged in"'),
    bullet('If "[ami-governance] AMI not configured" appears — ASTERISK_AMI_SECRET env var is not set'),
    bullet('Verify Asterisk is sending BridgeEnter events: asterisk -rx "manager show events"'),
    bullet('Check vendor-leg regex pattern in the rule matches the actual channel name format'),
    code('asterisk -rx "core show channels" | grep SIP'),
    br(),
    h2('12.5  Recording Files Missing'),
    bullet('Check recordings directory exists: ls /var/spool/asterisk/monitor/'),
    bullet('Verify MixMonitor is in use for relevant calls'),
    bullet('Check ASTERISK_SSH_PASSWORD env var is set — platform uses SSH to stream files'),
    bullet('Test SSH access: ssh root@159.223.32.59'),
    br(),

    // ── 13. Backup & Restore ─────────────────────────────────────────────────
    h1('13. Backup & Restore Procedures'),
    h2('13.1  Backup Configuration Files'),
    code('tar -czf asterisk-config-backup-$(date +%Y%m%d).tar.gz /etc/asterisk/'),
    code('# Copy to safe offsite location (not on same server)'),
    code('scp asterisk-config-backup-*.tar.gz backup@offsite-server:/backups/'),
    h2('13.2  Backup Recordings'),
    code('tar -czf recordings-$(date +%Y%m%d).tar.gz /var/spool/asterisk/monitor/'),
    h2('13.3  Restore Configuration'),
    code('systemctl stop asterisk'),
    code('tar -xzf asterisk-config-backup-YYYYMMDD.tar.gz -C /'),
    code('chown -R asterisk:asterisk /etc/asterisk/'),
    code('systemctl start asterisk'),
    h2('13.4  Full Reinstall Reference'),
    p('Follow Sections 3–8 in order. After reinstalling, restore config from backup and verify:'),
    bullet('manager.conf has [bitsauto] with correct secret'),
    bullet('sip.conf has bindport = 5160'),
    bullet('Firewall rules are re-applied (Section 3.3)'),
    bullet('All env vars are re-set in Replit Secrets'),
    br(),

    // ── 14. Environment Variables Reference ──────────────────────────────────
    h1('14. Complete Environment Variables Reference'),
    p('All Asterisk-related secrets are stored in Replit Secrets (never in code). The following variables must be set for full platform integration:'),
    br(),
    kvTable([
      ['Variable',               'Purpose'],
      ['ASTERISK_HOST',          'Asterisk server IP — default 159.223.32.59'],
      ['ASTERISK_AMI_PORT',      'AMI TCP port — default 5038'],
      ['ASTERISK_AMI_USER',      'AMI username — default bitsauto'],
      ['ASTERISK_AMI_SECRET',    'AMI password — REQUIRED (set in Replit Secrets)'],
      ['ASTERISK_SSH_USER',      'SSH username for recording access — default root'],
      ['ASTERISK_SSH_PASSWORD',  'SSH password — REQUIRED for recording streaming (Replit Secrets)'],
      ['ASTERISK_CHAN_TECH',      'Channel mode: DIRECT_SIP | SIP | PJSIP — default DIRECT_SIP'],
      ['ASTERISK_TRUNK_NAME',    'Trunk name (SIP/PJSIP modes only) — default Sippy'],
      ['SIPPY_SIP_IP',           'Sippy SBC SIP IP for DIRECT_SIP mode — default 191.101.30.107'],
      ['SIPPY_CLI',              'Caller ID sent to Sippy IP auth rule (e.g. 2221192)'],
      ['SIPPY_TECH_PREFIX',      'Product prefix prepended to CLD (e.g. 22211) — empty = no prefix'],
    ]),
    br(),
    warn('Never commit these values to version control. Always use Replit Secrets (Settings → Secrets) or equivalent secret management.'),
    br(),

    // ── 15. Quick Reference Card ─────────────────────────────────────────────
    h1('15. Quick Reference Card'),
    h2('Key IPs & Ports'),
    kvTable([
      ['Asterisk server',       '159.223.32.59'],
      ['AMI port',              '5038/tcp'],
      ['SIP port (chan_sip)',   '5160/udp'],
      ['RTP media range',       '10000–20000/udp'],
      ['SSH port',              '22/tcp'],
      ['Sippy SBC SIP IP',      '191.101.30.107:5060'],
    ]),
    br(),
    h2('Most-Used Commands'),
    code('# Connect to Asterisk CLI'),
    code('asterisk -rvvvv'),
    code(''),
    code('# Check active calls'),
    code('asterisk -rx "core show channels"'),
    code(''),
    code('# Test AMI connection from CLI'),
    code('telnet 159.223.32.59 5038'),
    code('Action: Login'),
    code('Username: bitsauto'),
    code('Secret: <secret>'),
    code(''),
    code('# Restart Asterisk'),
    code('systemctl restart asterisk'),
    code(''),
    code('# Watch live logs'),
    code('tail -f /var/log/asterisk/full'),
    code(''),
    code('# SIP peer status'),
    code('asterisk -rx "sip show peers"'),
    code(''),
    code('# Reload dialplan'),
    code('asterisk -rx "dialplan reload"'),
    br(),
    note('After any sip.conf or manager.conf change, always run "sip reload" or "manager reload" in the Asterisk CLI. A full restart is only needed after module or general config changes.'),
    br(),

    // ── Footer note ───────────────────────────────────────────────────────────
    new Paragraph({
      spacing: { before: 480 },
      children: [new TextRun({ text: '— End of Document —', color: MID_GY, size: 18, italics: true })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Auto-generated by BitsAuto Platform  ·  ${new Date().toUTCString()}`, color: MID_GY, size: 16, italics: true })],
      alignment: AlignmentType.CENTER,
    }),
  ];
}
