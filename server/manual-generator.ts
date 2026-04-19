import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer,
  NumberFormat, PageBreak, SimpleField,
} from 'docx';
import { writeFileSync } from 'fs';
import { join } from 'path';

// ── Colour palette ─────────────────────────────────────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GREEN    = '00C853';
const ORANGE   = 'FF6D00';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E8E8E8';
const MID_GY   = 'BDBDBD';
const DARK_GY  = '424242';
const PANEL_BG = '161B22';

// ── Page geometry (Letter, 1" margins each side) ───────────────────────────────
// Usable width = 12240 - 2 * 1440 = 9360 twips
const PAGE_DXA = 9360;
function w(pct: number) { return Math.round(PAGE_DXA * pct / 100); }

// ── Helpers ────────────────────────────────────────────────────────────────────
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
    spacing: { after: 100 },
    children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? MID_GY, size: opts.size ?? 20, italics: opts.italic })],
  });
}
function bullet(text: string, color = MID_GY, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 70 },
    children: [new TextRun({ text, color, size: 19 })],
  });
}
function divider() {
  return new Paragraph({
    border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 4 } },
    spacing: { before: 240, after: 240 },
    children: [],
  });
}
function spacer(after = 200) {
  return new Paragraph({ spacing: { after }, children: [] });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function note(text: string) {
  return new Paragraph({
    indent: { left: 360 },
    spacing: { after: 100 },
    border: { left: { color: ACCENT, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({ text: `NOTE: ${text}`, color: ACCENT, size: 18, italics: true })],
  });
}
function warn(text: string) {
  return new Paragraph({
    indent: { left: 360 },
    spacing: { after: 100 },
    border: { left: { color: ORANGE, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({ text: `WARNING: ${text}`, color: ORANGE, size: 18, italics: true })],
  });
}

// ── 2-column definition table ─────────────────────────────────────────────────
// Uses DXA widths (valid OOXML). keyPct = percentage width of key column.
function defTable(rows: [string, string][], headerLabel = '', keyPct = 30) {
  const keyW  = w(keyPct);
  const valW  = PAGE_DXA - keyW;
  const hdr = headerLabel
    ? [new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            shading: { type: ShadingType.SOLID, fill: DARK_BG, color: DARK_BG },
            width: { size: keyW, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: headerLabel, bold: true, color: ACCENT, size: 18 })] })],
          }),
          new TableCell({
            shading: { type: ShadingType.SOLID, fill: DARK_BG, color: DARK_BG },
            width: { size: valW, type: WidthType.DXA },
            children: [new Paragraph({ children: [] })],
          }),
        ],
      })]
    : [];
  const dataRows = rows.map(([k, v]) =>
    new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG },
          width: { size: keyW, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, color: WHITE, size: 18 })] })],
        }),
        new TableCell({
          width: { size: valW, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: v, color: MID_GY, size: 18 })] })],
        }),
      ],
    })
  );
  return new Table({
    width: { size: PAGE_DXA, type: WidthType.DXA },
    rows: [...hdr, ...dataRows],
  });
}

// ── Role access matrix ────────────────────────────────────────────────────────
function roleMatrix(rows: { feature: string; admin: string; mgmt: string; viewer: string }[]) {
  const cols = [55, 15, 15, 15]; // percentages — must sum to 100
  const colW = cols.map(c => w(c));

  function hdrCell(text: string, colWidth: number) {
    return new TableCell({
      shading: { type: ShadingType.SOLID, fill: DARK_BG, color: DARK_BG },
      width: { size: colWidth, type: WidthType.DXA },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, color: ACCENT, size: 18 })],
      })],
    });
  }
  function dataCell(text: string, colWidth: number, color = WHITE) {
    return new TableCell({
      width: { size: colWidth, type: WidthType.DXA },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, color, size: 18 })],
      })],
    });
  }

  const yes = 'Yes';
  const no  = '-';

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      hdrCell('Feature / Page', colW[0]),
      hdrCell('Admin',      colW[1]),
      hdrCell('Management', colW[2]),
      hdrCell('Viewer',     colW[3]),
    ],
  });
  const dataRows = rows.map(r =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: colW[0], type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: r.feature, color: LIGHT_GY, size: 18 })] })],
        }),
        dataCell(r.admin,  colW[1], r.admin  === yes ? GREEN : DARK_GY),
        dataCell(r.mgmt,   colW[2], r.mgmt   === yes ? GREEN : DARK_GY),
        dataCell(r.viewer, colW[3], r.viewer  === yes ? GREEN : DARK_GY),
      ],
    })
  );
  return new Table({
    width: { size: PAGE_DXA, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

// ── Flow diagram (numbered vertical steps) ───────────────────────────────────
// Represents a flow as a numbered list with shaded step boxes — avoids
// complex column-width maths that can produce invalid OOXML.
function flowDiagram(steps: { label: string; detail?: string }[], title: string): Paragraph[] {
  const elems: Paragraph[] = [h3(title)];
  steps.forEach((s, i) => {
    elems.push(new Paragraph({
      spacing: { before: 80, after: 4 },
      shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG },
      indent: { left: 180, hanging: 180 },
      children: [
        new TextRun({ text: `Step ${i + 1}:  `, color: ACCENT, bold: true, size: 20 }),
        new TextRun({ text: s.label, color: WHITE, bold: true, size: 20 }),
        ...(s.detail ? [new TextRun({ text: `  —  ${s.detail}`, color: MID_GY, size: 18, italics: true })] : []),
      ],
    }));
    if (i < steps.length - 1) {
      elems.push(new Paragraph({
        spacing: { after: 4 },
        indent: { left: 360 },
        children: [new TextRun({ text: '|', color: DARK_GY, size: 16 })],
      }));
    }
  });
  elems.push(spacer(160));
  return elems;
}

// ── Keyboard shortcut table ───────────────────────────────────────────────────
function shortcutTable(shortcuts: [string, string][]) {
  const keyW = w(35);
  const actW = PAGE_DXA - keyW;
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, fill: DARK_BG, color: DARK_BG },
        width: { size: keyW, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: 'Shortcut', bold: true, color: ACCENT, size: 18 })] })],
      }),
      new TableCell({
        shading: { type: ShadingType.SOLID, fill: DARK_BG, color: DARK_BG },
        width: { size: actW, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: 'Action', bold: true, color: ACCENT, size: 18 })] })],
      }),
    ],
  });
  const rows = shortcuts.map(([k, v]) => new TableRow({
    children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG },
        width: { size: keyW, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: k, color: WHITE, size: 18, bold: true })] })],
      }),
      new TableCell({
        width: { size: actW, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: v, color: MID_GY, size: 18 })] })],
      }),
    ],
  }));
  return new Table({ width: { size: PAGE_DXA, type: WidthType.DXA }, rows: [headerRow, ...rows] });
}

// ── Master document builder ───────────────────────────────────────────────────
export async function generateUserManual(outputPath?: string): Promise<Buffer> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const yes = 'Yes';
  const no  = '-';

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullet-list',
        levels: [
          { level: 0, format: NumberFormat.BULLET, text: 'o', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
          { level: 1, format: NumberFormat.BULLET, text: '-', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } },
        ],
      }],
    },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 2 } },
            children: [new TextRun({ text: `VoIP Watcher Platform — User Manual  |  ${dateStr}`, color: DARK_GY, size: 16 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { color: DARK_GY, style: BorderStyle.SINGLE, size: 2 } },
            children: [
              new TextRun({ text: 'VoIP Watcher — Confidential  |  Page ', color: DARK_GY, size: 16 }),
              new SimpleField('PAGE'),
            ],
          })],
        }),
      },

      children: [

        // ════════════════════════════════════════════════════
        // COVER PAGE
        // ════════════════════════════════════════════════════
        spacer(600),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: 'VoIP Watcher Platform', color: ACCENT, bold: true, size: 72 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'User Manual', color: WHITE, bold: true, size: 48 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: 'Sippy Softswitch NOC & Operations Guide', color: MID_GY, size: 26, italics: true })],
        }),
        spacer(300),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: `Version: Volume 1 + Volume 2  |  Generated: ${dateStr} at ${timeStr}`, color: DARK_GY, size: 20 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Audience: NOC Operators, KAMs, Management, IT Administrators', color: DARK_GY, size: 20 })],
        }),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // TABLE OF CONTENTS
        // ════════════════════════════════════════════════════
        h1('Table of Contents'),
        ...([
          ['1', 'Introduction & Platform Overview'],
          ['2', 'System Architecture'],
          ['3', 'Role-Based Access Control (RBAC)'],
          ['4', 'Getting Started'],
          ['5', 'Dashboard — Live Call Monitoring'],
          ['6', 'CDR (Call Detail Records) Browser'],
          ['7', 'Analytics & Reporting'],
          ['8', 'Rate Card Management'],
          ['9', 'Fraud Detection — FAS Engine'],
          ['10', 'Alerts System'],
          ['11', 'Team & KAM Management'],
          ['12', 'Test Call Launcher'],
          ['13', 'API Key Management'],
          ['14', 'Settings & Configuration'],
          ['15', 'Process Flows'],
          ['16', 'Keyboard Shortcuts & Quick Actions'],
          ['17', 'Troubleshooting & FAQ'],
          ['18', 'Glossary'],
        ] as [string, string][]).map(([n, t]) =>
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: `${n}.  `, color: ACCENT, bold: true, size: 20 }),
              new TextRun({ text: t, color: MID_GY, size: 20 }),
            ],
          })
        ),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 1. INTRODUCTION
        // ════════════════════════════════════════════════════
        h1('1. Introduction & Platform Overview'),
        p('VoIP Watcher is a real-time Network Operations Centre (NOC) monitoring and analytics platform built exclusively for the Sippy Softswitch. It gives NOC engineers, Key Account Managers, and management a single pane of glass to monitor call quality, detect fraud, manage billing, and operate the softswitch — without needing to log into the Sippy admin portal directly.', { size: 21 }),
        spacer(100),
        h2('What this platform covers'),
        bullet('Real-time concurrent call monitoring, MOS, ASR, ACD, PDD, CPS, and traffic quality scoring'),
        bullet('CDR search, filtering, and export in multiple formats'),
        bullet('Revenue and margin analytics, vendor balance tracking, and P&L reporting'),
        bullet('BitsEye Drill-Down Analytics — hierarchical Country → KAM → Destination traffic analysis with interactive charts'),
        bullet('Fraud detection via the FAS (False Answer Supervision) engine and IRSF prefix scanner'),
        bullet('Auto-blacklist with prefix/IP/account blocking rules'),
        bullet('Rate card management (local and Sippy tariff verification)'),
        bullet('Alert engine with configurable thresholds, email notifications, and WhatsApp push alerts'),
        bullet('Team and KAM management with client-to-account-manager assignment'),
        bullet('Test Call Launcher — originate a real call from the UI to test routing'),
        bullet('LCR Analyser — least-cost routing ranked table across all vendor rate cards'),
        bullet('Call Flow Simulator — full 7-step routing trace without placing a real call'),
        bullet('Cost Optimisation Engine — 9 rule-based recommendations with savings estimates'),
        bullet('Multi-Switch Consolidated View — aggregate monitoring across multiple Sippy instances'),
        bullet('API key management for external system integration'),
        bullet('Customisable dashboard with drag-and-drop widgets per user'),
        bullet('Dark/light mode, mobile-responsive layout, and a Cmd+K command palette'),
        spacer(100),
        note('This platform is scoped to Sippy Softswitch only. No other softswitch targets (VOS-3000, FreeSWITCH, etc.) are supported.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 2. SYSTEM ARCHITECTURE
        // ════════════════════════════════════════════════════
        h1('2. System Architecture'),
        p('VoIP Watcher is a full-stack web application with the following layers:', { size: 21 }),
        spacer(80),
        defTable([
          ['Frontend',   'React + Vite + TailwindCSS — runs in the browser, communicates with the backend over a REST API'],
          ['Backend',    'Express + TypeScript — handles authentication, Sippy API calls, business logic, and data persistence'],
          ['Database',   'PostgreSQL via Drizzle ORM — stores users, settings, CDR cache, rate cards, alert config, KAMs, API keys, test call logs, and widget preferences'],
          ['Sippy Link', 'XML-RPC over HTTP/HTTPS — two credential sets: ssp-root (admin API) and portal username (customer portal). All Sippy calls are proxied through the backend.'],
          ['Auth',       'Replit OpenID Connect (OAuth 2.0) — all routes protected; role stored in the users table'],
        ]),
        spacer(180),
        h3('Data Flow: Browser to Sippy'),
        ...flowDiagram([
          { label: 'Browser (React UI)', detail: 'User actions trigger API calls' },
          { label: 'Express API Server (Port 5000)', detail: 'Validates auth and role, runs business logic' },
          { label: 'PostgreSQL Database', detail: 'Cached CDRs, settings, preferences' },
          { label: 'Sippy XML-RPC Endpoint', detail: 'ssp-root / portal credentials used server-side' },
        ], ''),
        note('All Sippy credentials are stored server-side only. The browser never receives or stores passwords.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 3. RBAC
        // ════════════════════════════════════════════════════
        h1('3. Role-Based Access Control (RBAC)'),
        p('Every user is assigned one of three roles. The role is set by an Administrator in the Team page. The role controls which pages and actions are available.', { size: 21 }),
        spacer(100),
        defTable([
          ['Admin',      'Full access to all pages and settings. Can manage users, configure Sippy, create API keys, set alert thresholds, and download all reports.'],
          ['Management', 'Access to operational and analytics pages. Cannot access system settings, user management, or API key management.'],
          ['Viewer',     'Read-only NOC view. Sees only the widgets and data assigned to them by an Admin via Monitoring Assignments.'],
        ], 'Role'),
        spacer(180),
        h2('Feature Access Matrix'),
        roleMatrix([
          { feature: 'Dashboard (Live Calls, KPIs)',       admin: yes, mgmt: yes, viewer: yes },
          { feature: 'CDR Browser',                         admin: yes, mgmt: yes, viewer: yes },
          { feature: 'Analytics / Revenue',                 admin: yes, mgmt: yes, viewer: no  },
          { feature: 'BitsEye Drill-Down Analytics',        admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Traffic Map',                         admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Rate Card Management',                admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Fraud Detection (FAS + IRSF)',        admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Alerts — View',                       admin: yes, mgmt: yes, viewer: yes },
          { feature: 'Alerts — Configure Thresholds',       admin: yes, mgmt: no,  viewer: no  },
          { feature: 'LCR Analyser',                        admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Call Flow Simulator',                 admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Cost Optimisation Engine',            admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Multi-Switch Consolidated View',      admin: yes, mgmt: yes, viewer: no  },
          { feature: 'Team & KAM Management',               admin: yes, mgmt: no,  viewer: no  },
          { feature: 'Test Call Launcher',                  admin: yes, mgmt: yes, viewer: no  },
          { feature: 'API Key Management',                  admin: yes, mgmt: no,  viewer: no  },
          { feature: 'WhatsApp Alert Configuration',        admin: yes, mgmt: no,  viewer: no  },
          { feature: 'Settings (Sippy, email, SNMP)',       admin: yes, mgmt: no,  viewer: no  },
          { feature: 'Monitoring Assignments (assign)',      admin: yes, mgmt: no,  viewer: no  },
          { feature: 'Download Reports',                    admin: yes, mgmt: no,  viewer: no  },
        ]),
        spacer(100),
        warn('Changing a user\'s role takes effect immediately on their next page load. If a user is currently logged in, they may need to refresh.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 4. GETTING STARTED
        // ════════════════════════════════════════════════════
        h1('4. Getting Started'),
        h2('4.1  Logging In'),
        p('VoIP Watcher uses Replit authentication. Users log in via their Replit account — no separate password is required.', { size: 21 }),
        spacer(80),
        ...flowDiagram([
          { label: 'Open the platform URL in your browser' },
          { label: 'Click "Sign in with Replit"', detail: 'You are redirected to Replit OAuth' },
          { label: 'Authorise the application',   detail: 'Grant the requested permissions' },
          { label: 'Redirected back to the Dashboard', detail: 'First login creates your user record; an Admin must assign your role.' },
        ], 'Login Flow'),
        note('First-time users have no role assigned and see only a limited view. Ask your Administrator to assign your role in the Team page.'),
        spacer(100),
        h2('4.2  First-Time Admin Setup'),
        bullet('Log in as the first user — you are automatically assigned Admin role.'),
        bullet('Go to Settings and enter your Sippy credentials (portal URL, portal username, API admin username and passwords).'),
        bullet('Click "Connect to Sippy" — the status indicator turns green when connected.'),
        bullet('Go to Settings > Alert Configuration and set your ASR, MOS, ACD, and call-count thresholds.'),
        bullet('Go to Settings > Email Notifications and enter your Gmail SMTP credentials for alert emails.'),
        bullet('Go to Team & KAM to invite and assign roles to your team members.'),
        spacer(100),
        h2('4.3  Navigation'),
        p('The left sidebar lists all available pages. Items visible depend on your role. Collapse the sidebar using the arrow icon at the bottom left. On mobile, the sidebar opens via the hamburger menu.', { size: 20 }),
        spacer(80),
        bullet('Dashboard — live call KPIs and widget grid'),
        bullet('CDR Browser — historical call records with filters and CSV export'),
        bullet('Analytics — revenue, ASR/ACD trends, and traffic map'),
        bullet('BitsEye — drill-down traffic analytics: Countries → KAMs → Destinations'),
        bullet('Graphs — KAM overview, client traffic pulse, MOS trending, traffic alert log'),
        bullet('Rate Cards — local rate management and Sippy tariff comparison'),
        bullet('Fraud Detection — FAS engine, IRSF scanner, and auto-blacklist'),
        bullet('Alerts — alert list and threshold configuration'),
        bullet('LCR Analyser — cheapest-route finder across all vendor rate cards'),
        bullet('Call Flow Simulator — end-to-end routing trace (no real call placed)'),
        bullet('Cost Optimisation — AI-assisted route and margin improvement recommendations'),
        bullet('Multi-Switch View — aggregate dashboard across multiple Sippy instances'),
        bullet('Test Call — launch a real call via Sippy'),
        bullet('API Keys — external Bearer-token API management'),
        bullet('WhatsApp Alerts — configure WhatsApp push notification channel'),
        bullet('Settings — all system configuration'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 5. DASHBOARD
        // ════════════════════════════════════════════════════
        h1('5. Dashboard — Live Call Monitoring'),
        p('The Dashboard is the primary NOC view. It refreshes automatically every 15 seconds by polling the Sippy API for live call data.', { size: 21 }),
        spacer(80),
        h2('5.1  KPI Cards'),
        defTable([
          ['Concurrent Calls', 'Total active calls on the switch right now'],
          ['ASR (%)',          'Answer Seizure Ratio — percentage of call attempts that connected successfully'],
          ['ACD (s)',          'Average Call Duration in seconds — a measure of traffic quality'],
          ['CPS',             'Calls Per Second — origination rate'],
          ['PDD (ms)',         'Post-Dial Delay — time from dial to ringing'],
          ['MOS',             'Mean Opinion Score — voice quality metric (1-5; 4.0+ = Excellent)'],
          ['Traffic Score',   'Composite quality score combining ASR, ACD, and MOS into a single 0-100 rating'],
          ['Fraud Score',     'FAS engine composite risk score — higher = more suspicious activity detected'],
        ]),
        spacer(160),
        h2('5.2  Widget Grid'),
        p('Below the KPI cards is a customisable widget grid. Each user can toggle widgets on/off and drag them to their preferred position. Changes are saved per-user in the database.', { size: 20 }),
        spacer(80),
        bullet('Live Call Quality — real-time MOS, jitter, latency, packet loss per active call'),
        bullet('ASR / ACD Trend — line chart of answer rate and call duration over the selected window'),
        bullet('Revenue Overview — 30-day income vs cost vs margin'),
        bullet('Vendor Balances — current balance per vendor with low-balance indicator'),
        bullet('FAS Fraud Score — FAS engine fraud panel with zero-bill and short-bill counts'),
        bullet('Active Alerts — list of firing alert conditions'),
        bullet('Traffic Map Preview — mini world map of destination traffic'),
        bullet('Recent CDRs — last 20 call records inline'),
        spacer(80),
        p('To customise widgets: click the slider icon in the top-right of the Dashboard to open the widget panel, toggle switches to show/hide, and drag cards by their header to reorder. Changes are saved automatically.', { size: 20 }),
        spacer(100),
        h2('5.3  Live Calls Table'),
        p('The lower section of the Dashboard shows currently active calls with caller, callee, MOS score, call start time, and a link to the call detail page. Hover over a number to reveal the click-to-call icon — clicking it pre-fills the Test Call Launcher.', { size: 20 }),
        spacer(100),
        h2('5.4  CK Drill-Down Sheet'),
        p('Clicking any client row in the live calls table opens the CK Drill-Down side sheet. This provides a detailed breakdown for that client over a selectable time window.', { size: 20 }),
        spacer(80),
        h3('Status Filter Chips'),
        p('Filter calls by disposition using the chip bar at the top of the sheet:', { size: 20 }),
        bullet('Connected — answered calls with billable duration'),
        bullet('Wrong Number — calls disconnected with code 404/484'),
        bullet('Switched Off — calls routed to unavailable/offline destination'),
        bullet('Untraceable — calls that failed with unknown or unresolvable destination'),
        spacer(80),
        h3('Time Window Chips'),
        p('Select how far back to pull data: 1h / 2h / 3h / 6h / 12h / 24h. The backend fetches CDRs for exactly that many hours, and the query cache refreshes whenever the chip selection changes.', { size: 20 }),
        spacer(80),
        h3('Excel Export'),
        p('The Export button in the sheet header downloads the currently visible drill-down data as an Excel (.xlsx) file, including all status, number, and duration columns.', { size: 20 }),
        note('The Export button uses the xlsx library to build the workbook in-browser — no server round-trip is required for the download.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 6. CDR BROWSER
        // ════════════════════════════════════════════════════
        h1('6. CDR (Call Detail Records) Browser'),
        p('The CDR Browser lets you search, filter, and export historical call records retrieved from Sippy. Records are cached locally for fast access.', { size: 21 }),
        spacer(80),
        h2('6.1  Filters'),
        defTable([
          ['Date Range',       'Select preset (Last 1h, 6h, 24h, 7d, 30d) or enter a custom UTC start/end date'],
          ['Caller / Callee',  'Free-text filter on the CLI (caller) or CLD (callee) number'],
          ['Account',          'Filter by a specific Sippy customer account'],
          ['Disconnect Code',  'Filter by SIP response code (e.g. 200, 486, 404)'],
          ['Duration',         'Filter: all calls, answered only (>0s), or unanswered (0s)'],
          ['Direction',        'Origination or termination leg'],
        ]),
        spacer(160),
        h2('6.2  Export'),
        bullet('Click the Export button to download the currently filtered CDRs as a CSV file.'),
        bullet('For Mera-format export (vendor CDR reconciliation), use Settings > Vendor CDR Export.'),
        spacer(100),
        h2('6.3  Click-to-Call from CDR'),
        p('Every row in the CDR table has a hover phone icon next to the caller and callee numbers. Clicking it opens the Test Call Launcher pre-filled with those numbers.', { size: 20 }),
        note('This is useful for retesting a failed call — simply click the icon on the failed CDR row and hit Launch.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 7. ANALYTICS
        // ════════════════════════════════════════════════════
        h1('7. Analytics & Reporting'),
        h2('7.1  4-Tab Reports Page'),
        p('The Reports page (/reports) provides four dedicated analytics tabs, each with its own KPI cards, charts, and data table. Period is selected using chip buttons (1 / 7 / 14 / 30 / 60 / 90 days).', { size: 20 }),
        spacer(80),
        defTable([
          ['Client Report',       'Per-client breakdown: total calls, answered, ASR, ACD, total minutes. Bar chart of top-10 clients by call volume. Chip selector for period.'],
          ['Vendor Report',       'Per-vendor termination stats: calls, ASR, ACD, cost per minute. Highlights underperforming routes.'],
          ['Connection',          'Per-SIP-connection quality metrics: calls, ASR, PDD, failed call count.'],
          ['Revenue & Margin',    '4 KPI cards (Revenue, Cost, Profit, Avg Margin %). Revenue-vs-Cost bar chart for top-10 clients. Client margin breakdown table with colour badges. Vendor cost share with progress bars.'],
        ]),
        spacer(100),
        h2('7.2  Revenue & Margin Analytics (Legacy)'),
        p('Also accessible from Analytics > Revenue. Shows a 30-day rolling P&L breakdown:', { size: 20 }),
        bullet('Total revenue vs total cost vs margin'),
        bullet('Per-client margin table with colour-coded profitability'),
        bullet('Revenue and cost time-series chart'),
        bullet('Margin percentage trend'),
        spacer(100),
        h2('7.3  ASR / ACD Trend Graphs'),
        p('Dual-axis recharts plot of answer rate (%) and average duration (s) over a configurable time window (6h / 12h / 24h). Quality band shading highlights periods below acceptable thresholds.', { size: 20 }),
        spacer(100),
        h2('7.4  BitsEye Drill-Down Analytics'),
        p('BitsEye is a hierarchical traffic analytics module accessible from the sidebar under the BarChart icon. It provides Country → KAM → Destination drill-down navigation driven entirely by URL parameters and in-page controls — no separate sidebar tree is required.', { size: 20 }),
        spacer(80),
        h3('Sidebar Entry Points'),
        defTable([
          ['Countries',      'Grid of all destination countries derived from CDR dialled numbers. Shows concurrent calls, today\'s total, trend %, ASR, and ACD per country.'],
          ['Clients',        'All client entities (Sippy accounts) with individual AreaChart cards.'],
          ['Vendors',        'All vendor connections with per-vendor traffic and quality charts.'],
          ['Destinations',   'All destination prefixes/routes. Includes a Country filter dropdown to scope without drilling from Countries.'],
          ['KAMs',           'All Key Account Managers. Each card shows aggregated traffic for the KAM\'s managed client accounts.'],
          ['KAM (specific)', 'Click a KAM name from the Team page or use ?view=kam&kamId=N to open a single KAM\'s dedicated view.'],
        ]),
        spacer(140),
        h3('Drill-Down Flow'),
        ...flowDiagram([
          { label: 'Open BitsEye → Countries',           detail: 'Grid of all countries with KPI strip per card' },
          { label: 'Click "View KAMs →" on a country card', detail: 'Breadcrumb updates: Countries > [Country]. KAMs filtered to those handling traffic for this country.' },
          { label: 'Click "View Destinations →" on a KAM card', detail: 'Breadcrumb: Countries > [Country] > [KAM]. Destinations scoped to this KAM\'s managed accounts.' },
          { label: 'Click Back ← in the top bar',        detail: 'Returns to the previous level in the breadcrumb trail.' },
          { label: 'Click any breadcrumb segment',        detail: 'Jumps directly to that level without stepping back one-by-one.' },
        ], 'BitsEye Drill-Down Navigation'),
        spacer(120),
        h3('Sub-Navigation Tabs'),
        p('Each level has an Aggregated / All toggle in the sub-navigation strip:', { size: 20 }),
        bullet('Aggregated — shows one combined chart summing all entities at that level'),
        bullet('All — shows a grid of individual entity cards, one per client / vendor / KAM / destination'),
        spacer(80),
        p('On the Destinations view, a Country dropdown appears in the sub-nav strip for direct country scoping without requiring a Countries drill-down.', { size: 20 }),
        spacer(100),
        h3('Entity Card Layout'),
        p('Each entity card contains:', { size: 20 }),
        bullet('KPI strip — Concurrent Calls, Today\'s Total, Trend %, ASR, ACD'),
        bullet('Daily Chart — AreaChart of Total Calls vs Connected Calls over the last 24 hours (violet / sky colour pair)'),
        bullet('Weekly Chart — AreaChart of the last 7 days (amber / teal colour pair)'),
        bullet('Stats Table — daily and weekly summary: Total, Connected, Failed, Avg Duration, ASR — displayed in a rounded card with colour swatches and monospace numbers'),
        spacer(100),
        note('Country data is derived from CDR destination (CLD) numbers via dial-code prefix matching. If CDRs contain no dialled numbers, the Countries grid will be empty. Data populates as calls are processed.'),
        spacer(100),
        h2('7.5  Traffic Map'),
        p('An interactive Leaflet world map showing destination traffic distribution by country. Countries are colour-coded by traffic share percentage (violet for heavy, cyan for light). Time range selector: 3h / 6h / 12h / 24h / 48h / 72h.', { size: 20 }),
        spacer(80),
        h3('Country Drill-Down Panel'),
        p('Clicking any country in the sidebar list or directly on a map polygon opens a detail panel below the map showing:', { size: 20 }),
        bullet('Total Calls — raw call count and percentage share of all traffic in the period'),
        bullet('Answered Calls — connected calls with colour-coded ASR badge (green ≥70%, amber 50-70%, red <50%)'),
        bullet('Total Minutes — formatted as hours and minutes (e.g. "2h 15m") with raw minutes shown below'),
        bullet('Avg Duration — average per-call duration for answered calls'),
        bullet('Traffic Share Bar — gradient progress bar showing relative volume'),
        spacer(80),
        note('Country data is normalised on the backend — "Pakistan - Mobile", "Pakistan - PTCL", and "Pakistan Fixed" are all aggregated into the single Pakistan bucket before map rendering. This ensures accurate country-level totals.'),
        spacer(100),
        h2('7.6  Vendor Balance Tracking'),
        p('Live balance for each configured vendor account on Sippy, refreshed every polling cycle. Low-balance alerts trigger when a vendor drops below the configured threshold.', { size: 20 }),
        spacer(100),
        h2('7.7  P&L Report'),
        p('Found under Analytics > P&L Report. Provides a date-range profit-and-loss breakdown scraped directly from the Sippy operator portal (/profit_loss_report.php). The report shows:', { size: 20 }),
        bullet('Four KPI cards: Total Revenue, Total Cost, Gross Profit, and Avg Margin %'),
        bullet('P&L Area Chart — revenue vs cost vs profit plotted over each day in the selected range'),
        bullet('Daily Breakdown Table — per-day rows with date, calls, total duration, revenue, cost, profit, and margin %'),
        spacer(80),
        defTable([
          ['Date Range',   'Select start and end dates. Supports any range; defaults to the last 30 days.'],
          ['Revenue',      'Total billed revenue collected from customer accounts for calls in the range.'],
          ['Cost',         'Interconnect / wholesale cost paid to vendors for the same calls.'],
          ['Profit',       'Revenue minus cost. Displayed in the chart as the filled area between the two lines.'],
          ['Margin %',     'Profit as a percentage of revenue. Colour-coded: green (>20%), amber (5-20%), red (<5%).'],
        ]),
        spacer(80),
        note('P&L data is retrieved by scraping the Sippy operator portal HTML — not via XML-RPC. Ensure the Portal Username and Password are valid portal login credentials, not the API admin credentials. If the report shows no data, verify the portal session is active and the selected date range has traffic.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 8. RATE CARDS
        // ════════════════════════════════════════════════════
        h1('8. Rate Card Management'),
        p('Rate Cards allow you to manage client-facing and vendor-facing rate schedules locally within the platform, and compare them against the tariffs configured in Sippy.', { size: 21 }),
        spacer(80),
        bullet('Go to Rate Cards and click "New Rate Card"'),
        bullet('Enter a name and select type: Client or Vendor'),
        bullet('Add prefixes with their per-minute rate, currency, and description'),
        bullet('Optionally select a Sippy tariff to compare against — mismatches are highlighted'),
        bullet('Export each rate card as CSV for sharing with clients or reconciliation'),
        spacer(100),
        note('Rate card data is stored locally in the VoIP Watcher database. It is not pushed back to Sippy.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 9. FRAUD DETECTION
        // ════════════════════════════════════════════════════
        h1('9. Fraud Detection — FAS Engine'),
        p('The FAS (False Answer Supervision) engine analyses recent CDRs for patterns associated with fraudulent traffic. It runs automatically on every data refresh.', { size: 21 }),
        spacer(80),
        h2('9.1  Detection Categories'),
        defTable([
          ['Zero-Billed Calls',  'Connected calls (200 OK) with zero billable duration — typical of FAS termination fraud'],
          ['Short-Billed Calls', 'Calls with very short billed duration (< 6 seconds) relative to actual duration'],
          ['High PDD',           'Calls with Post-Dial Delay > 10 seconds — may indicate quality issues or simulated alerting'],
          ['Early Answer',       'Calls answered in < 1 second — characteristic of FAS/SPIT injection'],
        ]),
        spacer(160),
        h2('9.2  Fraud Score'),
        p('The Fraud Score (0-100) is a composite metric shown on the Dashboard FAS widget. A score above 60 is considered high-risk. Scores above 80 trigger an alert.', { size: 20 }),
        spacer(100),
        h2('9.3  Responding to FAS Alerts'),
        ...flowDiagram([
          { label: 'FAS alert fires (high fraud score)' },
          { label: 'Open Fraud Detection page',          detail: 'Review zero-billed and short-billed call lists' },
          { label: 'Identify affected vendor or route',  detail: 'Check which connections have the most anomalies' },
          { label: 'Disable or re-route the suspect vendor in Sippy' },
          { label: 'Monitor CDRs for improvement',       detail: 'Fraud score should drop within next refresh cycle' },
        ], 'FAS Response Workflow'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 10. ALERTS
        // ════════════════════════════════════════════════════
        h1('10. Alerts System'),
        p('The Alerts system monitors key metrics against administrator-configured thresholds. When a threshold is breached, an alert is created and optionally an email notification is sent.', { size: 21 }),
        spacer(80),
        h2('10.1  Configurable Thresholds'),
        defTable([
          ['Minimum ASR (%)',        'Alert fires if ASR drops below this percentage'],
          ['Minimum MOS',            'Alert fires if MOS drops below this value (e.g. 3.5)'],
          ['Minimum ACD (s)',        'Alert fires if average call duration drops below this threshold'],
          ['Max Concurrent Calls',   'Alert fires if concurrent calls exceed this limit (capacity protection)'],
          ['Low Vendor Balance',     'Alert fires if any vendor balance drops below the configured minimum'],
          ['Fraud Score',            'Alert fires when FAS composite score exceeds the limit'],
          ['Traffic Drop',           'Alert fires when a client\'s calls drop >50% vs the 60-minute peak'],
        ]),
        spacer(160),
        h2('10.2  Alert Lifecycle'),
        ...flowDiagram([
          { label: 'Metric crosses threshold',     detail: 'Detected on next polling cycle' },
          { label: 'Alert record created',         detail: 'Stored in DB with severity, metric, and value' },
          { label: 'In-app notification shown',    detail: 'Red badge on Alerts nav item' },
          { label: 'Email sent if SMTP configured' },
          { label: 'Alert auto-resolves',          detail: 'When metric returns to acceptable range' },
        ], 'Alert Lifecycle'),
        note('Admins configure thresholds in Settings > Alert Configuration. Changes take effect on the next polling cycle.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 11. TEAM & KAM
        // ════════════════════════════════════════════════════
        h1('11. Team & KAM Management'),
        h2('11.1  Managing Users'),
        bullet('Navigate to Team & KAM'),
        bullet('Find the user in the list or use the Quick Assign Role form'),
        bullet('Select their role: Admin, Management, or Viewer'),
        bullet('Click Assign — the change takes effect on their next page load'),
        spacer(100),
        h2('11.2  Key Account Managers (KAMs)'),
        bullet('Create KAM profiles with contact information'),
        bullet('Assign one or more Sippy client accounts to each KAM'),
        bullet('View a live call count overlay per KAM on the Graphs page'),
        bullet('See which KAM is responsible for a client in alert and CDR views'),
        spacer(100),
        h2('11.3  Monitoring Assignments (for Viewers)'),
        bullet('In Settings > Monitoring Assignments, select which dashboard widgets the viewer can see'),
        bullet('Optionally restrict CDR and live-call views to specific accounts'),
        bullet('Assignments are saved per-viewer and applied on their next login'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 12. TEST CALL LAUNCHER
        // ════════════════════════════════════════════════════
        h1('12. Test Call Launcher'),
        p('The Test Call Launcher allows NOC engineers and management to originate a real call via the Sippy switch directly from the browser — without logging into the Sippy admin portal.', { size: 21 }),
        spacer(80),
        warn('This sends a real call origination request to the live Sippy switch. Use internal test extensions or agreed test numbers to avoid unintended charges.'),
        spacer(100),
        h2('12.1  Launching a Call'),
        ...flowDiagram([
          { label: 'Navigate to Test Call in the sidebar' },
          { label: 'Enter the From (CLI) number',    detail: 'E.164 format (e.g. +441234567890) or local format' },
          { label: 'Enter the To (CLD) number',      detail: 'The destination number to dial' },
          { label: 'Select a Billing Account (optional)', detail: 'Routes the call through that account\'s tariff' },
          { label: 'Enter a Billing Code (optional)', detail: 'Tags the call for reconciliation' },
          { label: 'Click Launch Call',              detail: 'Request sent to Sippy makeCall XML-RPC endpoint' },
          { label: 'Result displayed',               detail: 'Success: call ID shown. Error: fault code and message shown.' },
        ], 'Test Call Flow'),
        spacer(100),
        h2('12.2  Call History'),
        p('All test calls are logged in the Recent Test Calls table at the bottom of the page with: timestamp, CLI, CLD, account used, call ID, status, and Sippy response message.', { size: 20 }),
        spacer(100),
        h2('12.3  Click-to-Call from CDR and Live Calls'),
        p('In both the CDR Browser and the Dashboard live calls table, hovering over a caller or callee number reveals a phone icon. Clicking it navigates to the Test Call Launcher with the CLI and CLD pre-filled — enabling rapid retesting.', { size: 20 }),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 13. API KEYS
        // ════════════════════════════════════════════════════
        h1('13. API Key Management'),
        p('Admins can create Bearer-token API keys that allow external systems to query key platform endpoints without a user login.', { size: 21 }),
        spacer(80),
        bullet('Go to API Keys in the sidebar (Admin only) and click "Create New API Key"'),
        bullet('Enter a label (e.g. "External NOC Dashboard")'),
        bullet('The key is generated and displayed once — copy and store it securely'),
        bullet('The key cannot be retrieved again after the dialog is closed'),
        spacer(100),
        h2('13.1  Available External Endpoints'),
        defTable([
          ['GET /api/ext/live-calls',      'Current active calls on the switch'],
          ['GET /api/ext/asr-acd',         'Current ASR and ACD metrics'],
          ['GET /api/ext/vendor-balances', 'All vendor balance snapshots'],
        ]),
        spacer(160),
        p('Usage: Include the key in the Authorization header:', { bold: true, color: WHITE }),
        new Paragraph({
          shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG },
          spacing: { after: 100 },
          children: [new TextRun({ text: 'Authorization: Bearer YOUR_API_KEY_HERE', color: GREEN, size: 18 })],
        }),
        spacer(100),
        p('To revoke a key: click the delete icon next to it in the API Keys page. Any system using that key will immediately receive 401 Unauthorized.', { size: 20 }),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 14. SETTINGS
        // ════════════════════════════════════════════════════
        h1('14. Settings & Configuration'),
        p('All system configuration is in the Settings page (Admin only). Settings are grouped into panels:', { size: 21 }),
        spacer(80),
        h2('14.1  Sippy Connection'),
        defTable([
          ['Portal URL',          'Base URL of the Sippy customer portal (e.g. https://switch.example.com)'],
          ['Portal Username',     'Customer portal login — used for CDR and account queries'],
          ['Portal Password',     'Portal password — stored encrypted server-side'],
          ['API Admin Username',  'ssp-root or similar Sippy XML-RPC admin user'],
          ['API Admin Password',  'Admin password — stored encrypted server-side'],
        ]),
        spacer(160),
        h2('14.2  Alert Thresholds'),
        p('Configure numeric thresholds for each alert type. Changes take effect on the next polling cycle.', { size: 20 }),
        spacer(100),
        h2('14.3  Email Notifications'),
        p('Enter Gmail SMTP credentials (email address + app password) to enable alert email delivery. A test email can be sent to verify configuration.', { size: 20 }),
        spacer(100),
        h2('14.4  SNMP'),
        p('Optional SNMP polling for hardware-level metrics (jitter, latency, packet loss) from the switch host. Configure the host IP, port (default 161), and community string.', { size: 20 }),
        spacer(100),
        h2('14.5  Documentation Downloads'),
        p('The Settings page includes a Documentation Downloads section where all platform documents can be downloaded as .docx files. Each document can be regenerated on demand using the Update button in the section header:', { size: 20 }),
        bullet('User Manual — this document (click "Update Manual" to rebuild with latest features)'),
        bullet('Sippy Dataflow Reference — per-page breakdown of every Sippy API call and write operation'),
        bullet('Troubleshooting Guide — all resolved issues, root-cause analyses, diagnostic flowcharts, and fix procedures (click "Update Troubleshooting Guide" to rebuild)'),
        bullet('Volume 1 Status Report — implementation status of all 24 Volume 1 features'),
        bullet('Feature Roadmap — the full platform feature roadmap'),
        bullet('Extended Features Vol II — proposed Tier 2 and Tier 3 feature proposals'),
        bullet('API Reference — all 200+ REST endpoints across 21 categories'),
        spacer(100),
        h2('14.6  WhatsApp Push Alerts'),
        p('The platform supports real-time push notifications via WhatsApp. When a critical alert fires (traffic drop, fraud threshold, low balance, or custom rule), a WhatsApp message is sent immediately to the configured recipients — no app or browser required on the NOC operator\'s device.', { size: 20 }),
        spacer(80),
        defTable([
          ['WhatsApp API Provider', 'Configure your WhatsApp Business API endpoint (e.g. WABA, Twilio, or direct API URL)'],
          ['API Token / Key',       'Authentication token for the WhatsApp messaging API — stored encrypted server-side'],
          ['Recipient Numbers',     'One or more mobile numbers in international format (e.g. +923001234567) that receive alerts'],
          ['Alert Types',           'Toggle which alert categories trigger a WhatsApp message: traffic drop, fraud, vendor balance, custom threshold'],
          ['Message Template',      'Customise the alert message format. Variables: {alert_type}, {metric}, {value}, {timestamp}'],
        ]),
        spacer(120),
        bullet('WhatsApp alerts are sent in addition to (not instead of) email alerts'),
        bullet('A test message button is available to verify connectivity before going live'),
        bullet('Delivery receipts are logged in the Alerts table with a "WA Sent" badge'),
        spacer(80),
        note('WhatsApp Business API credentials must be obtained from your API provider. The platform does not bundle any messaging quota.'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 15. PROCESS FLOWS
        // ════════════════════════════════════════════════════
        h1('15. Process Flows'),
        ...flowDiagram([
          { label: 'Log in',          detail: 'Replit OAuth' },
          { label: 'Dashboard',       detail: 'Review KPIs and active alerts' },
          { label: 'Alert fired?',    detail: 'Check alert badge on sidebar' },
          { label: 'Investigate',     detail: 'Drill into CDR Browser or Live Calls' },
          { label: 'Resolve',         detail: 'Update Sippy settings or escalate' },
        ], '15.1  NOC Shift Workflow'),

        ...flowDiagram([
          { label: 'Metric crosses threshold', detail: 'On next poll cycle' },
          { label: 'Alert created',            detail: 'Stored in DB' },
          { label: 'Badge shown',              detail: 'Sidebar count increments' },
          { label: 'Email sent',               detail: 'If SMTP configured' },
          { label: 'Metric recovers',          detail: 'Alert auto-resolves' },
        ], '15.2  Alert Trigger & Resolution Flow'),

        ...flowDiagram([
          { label: 'Open CDR Browser',       detail: 'Find the failed call record' },
          { label: 'Click phone icon',       detail: 'Hover over caller or callee number' },
          { label: 'Test Call page opens',   detail: 'Numbers pre-filled from CDR' },
          { label: 'Click Launch Call',      detail: 'Sippy makeCall API called' },
          { label: 'Review result',          detail: 'Check call ID or error message' },
        ], '15.3  Click-to-Call Retest Workflow'),

        ...flowDiagram([
          { label: 'FAS Score exceeds 60',   detail: 'Shown on dashboard panel' },
          { label: 'Open Fraud Detection',   detail: 'Review anomaly list' },
          { label: 'Identify vendor',        detail: 'Filter by vendor/connection' },
          { label: 'Block in Sippy',         detail: 'Via Sippy admin portal' },
          { label: 'Monitor score',          detail: 'Should drop on next refresh' },
        ], '15.4  Fraud Detection Response Workflow'),

        ...flowDiagram([
          { label: 'New team member joins' },
          { label: 'User logs in once to create their account record' },
          { label: 'Admin opens Team & KAM and assigns their role' },
          { label: 'If Viewer: Admin configures Monitoring Assignments for that user' },
          { label: 'User refreshes — new role and page access applied' },
        ], '15.5  Onboarding a New Team Member'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 16. KEYBOARD SHORTCUTS
        // ════════════════════════════════════════════════════
        h1('16. Keyboard Shortcuts & Quick Actions'),
        shortcutTable([
          ['Cmd + K  /  Ctrl + K', 'Open the Command Bar — search for any page, dial code, or action'],
          ['Esc',                  'Close the Command Bar or any open dialog'],
          ['Up / Down arrow keys', 'Navigate Command Bar results'],
          ['Enter',                'Select the highlighted Command Bar result'],
        ]),
        spacer(160),
        h2('Command Bar Actions'),
        bullet('All sidebar navigation links'),
        bullet('Dial-code lookup — type a number to identify country and carrier'),
        bullet('CDR search — type "cdr <number>" to search for a specific call'),
        bullet('Vendor balance quick view'),
        bullet('Dark/light mode toggle'),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 17. TROUBLESHOOTING
        // ════════════════════════════════════════════════════
        h1('17. Troubleshooting & FAQ'),
        defTable([
          ['Sippy connection shows "Disconnected"',
           'Check portal URL, username, and password in Settings. Ensure the switch is reachable on HTTPS and the XML-RPC port is not firewalled. Click "Connect to Sippy" to retry.'],
          ['No CDRs showing',
           'Verify the Sippy connection is active. Check the date range filter — the default is Last 24 hours. If the connection is new, wait for the next CDR cache refresh (runs every 5 minutes).'],
          ['Dashboard KPIs all show zero',
           'There may be no active calls on the switch. KPIs pull from the live Sippy call list. Verify by checking the Sippy admin portal directly.'],
          ['Alert emails not received',
           'Go to Settings > Email Notifications, verify Gmail credentials, and click "Send Test Email". Check your spam folder. Make sure the Gmail app password (not your main password) is used.'],
          ['Test call fails with "Fault"',
           'The Sippy API returned an XML-RPC fault. Common causes: invalid CLI format (use E.164), the account ID does not exist, or the switch has no route for the CLD. Check the fault message in the result card.'],
          ['User cannot see certain pages',
           'Their role may be Viewer. Ask an Admin to change their role in Team & KAM. Role changes take effect on next page refresh.'],
          ['Dashboard widgets not saving',
           'Widget preferences are saved per-user. If logged in on multiple tabs, changes may conflict. Refresh after making changes.'],
          ['Traffic map shows no data',
           'The traffic map uses CDR country codes. Ensure CDRs are being fetched and contain valid country data. Try extending the time range selector.'],
        ], 'Problem', 30),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 18. GLOSSARY
        // ════════════════════════════════════════════════════
        h1('18. Glossary'),
        defTable([
          ['ASR',     'Answer Seizure Ratio — the percentage of call attempts that result in a successful connection (200 OK)'],
          ['ACD',     'Average Call Duration — mean duration of connected calls in seconds'],
          ['CPS',     'Calls Per Second — the rate at which new call attempts arrive on the switch'],
          ['PDD',     'Post-Dial Delay — time in milliseconds between the initial INVITE and the first 180 Ringing response'],
          ['MOS',     'Mean Opinion Score — a numerical measure of voice call quality on a scale from 1 (worst) to 5 (best)'],
          ['FAS',     'False Answer Supervision — a fraud technique where calls are answered immediately with silence to bill the originator without delivering a real connection'],
          ['CLI',     'Calling Line Identification — the caller\'s phone number (A-number, From)'],
          ['CLD',     'Called Line Destination — the destination phone number being dialled (B-number, To)'],
          ['KAM',     'Key Account Manager — a team member responsible for managing a portfolio of client accounts'],
          ['CDR',     'Call Detail Record — a record produced by the switch for each call leg, containing routing, duration, billing, and quality data'],
          ['XML-RPC', 'A remote procedure call protocol using XML over HTTP, used by the Sippy Softswitch API'],
          ['NOC',     'Network Operations Centre — the team and facility responsible for real-time monitoring and management of telecom infrastructure'],
          ['RBAC',    'Role-Based Access Control — a security model where system access is granted based on the user\'s assigned role'],
          ['SNMP',    'Simple Network Management Protocol — used to collect hardware-level performance metrics from network equipment'],
          ['Sippy',     'Sippy Software — the Class 4 VoIP softswitch platform that VoIP Watcher is integrated with'],
          ['BitsEye',   'The drill-down traffic analytics module. Hierarchical Country → KAM → Destination navigation with per-entity charts and KPIs.'],
          ['LCR',       'Least-Cost Routing — the practice of routing calls through the cheapest available carrier that meets quality requirements'],
          ['IRSF',      'International Revenue Share Fraud — a fraud type where attackers route traffic to premium-rate numbers in high-cost countries to earn a revenue share'],
          ['KPI',       'Key Performance Indicator — a measurable value used to evaluate success. In VoIP: ASR, ACD, PDD, MOS, concurrent calls.'],
          ['FAS Score', 'A composite 0-100 fraud risk score computed by the FAS engine from CDR anomaly counts. Above 80 triggers an alert.'],
          ['WhatsApp Alert', 'A push notification sent via the WhatsApp Business API to configured recipient numbers when a critical threshold is breached.'],
          ['Aggregated View', 'BitsEye display mode that sums all entities at the current level into a single combined AreaChart, giving a holistic traffic view.'],
          ['Drill-Down', 'BitsEye navigation pattern: starting at a high-level entity (country) and progressively clicking through to more specific levels (KAM → Destination).'],
          ['Breadcrumb', 'The navigation path shown at the top of the BitsEye content area, e.g. Countries > Pakistan > KAM-Name. Clicking any segment jumps to that level.'],
        ], 'Term', 20),
        spacer(200),
        divider(),
        p(`This document was auto-generated by VoIP Watcher on ${dateStr} at ${timeStr}. Regenerate it after adding new features using Settings > Documentation Downloads > Update Manual.`, { color: DARK_GY, size: 17, italic: true }),
        p('VoIP Watcher Platform — Confidential. For internal use only.', { color: DARK_GY, size: 17, italic: true }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) writeFileSync(outputPath, buffer);
  return buffer;
}

// Use /tmp so this is writable in both dev and production deployments.
// The file is re-generated on every server startup if missing.
export const USER_MANUAL_PATH = '/tmp/VoIP_Watcher_User_Manual.docx';
