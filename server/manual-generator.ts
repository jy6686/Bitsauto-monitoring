import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer, PageNumberElement,
  NumberFormat, PageBreak,
} from 'docx';
import { writeFileSync } from 'fs';
import { join } from 'path';

// ── Colour palette ─────────────────────────────────────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GREEN    = '00C853';
const ORANGE   = 'FF6D00';
const RED_C    = 'D32F2F';
const PURPLE   = '9C27B0';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E8E8E8';
const MID_GY   = 'BDBDBD';
const DARK_GY  = '424242';
const PANEL_BG = '161B22';

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
    children: [new TextRun({ text: `ℹ  ${text}`, color: ACCENT, size: 18, italics: true })],
  });
}
function warn(text: string) {
  return new Paragraph({
    indent: { left: 360 },
    spacing: { after: 100 },
    border: { left: { color: ORANGE, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({ text: `⚠  ${text}`, color: ORANGE, size: 18, italics: true })],
  });
}

// ── Simple 2-column definition table ─────────────────────────────────────────
function defTable(rows: [string, string][], headerLabel = '') {
  const hdr = headerLabel
    ? [new TableRow({
        tableHeader: true,
        children: [headerLabel, ''].map(h => new TableCell({
          shading: { type: ShadingType.SOLID, color: DARK_BG },
          width: { size: h === headerLabel ? 30 : 70, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: ACCENT, size: 18 })] })],
        })),
      })]
    : [];
  const dataRows = rows.map(([k, v]) =>
    new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.SOLID, color: PANEL_BG },
          width: { size: 30, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, color: WHITE, size: 18 })] })],
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: v, color: MID_GY, size: 18 })] })],
        }),
      ],
    })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [...hdr, ...dataRows] });
}

// ── Role access matrix ────────────────────────────────────────────────────────
function roleMatrix(rows: { feature: string; admin: string; mgmt: string; viewer: string }[]) {
  const tick = '✔';
  const cross = '—';
  function cell(text: string, head = false) {
    return new TableCell({
      shading: head ? { type: ShadingType.SOLID, color: DARK_BG } : undefined,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text,
          bold: head,
          color: head ? ACCENT : text === tick ? GREEN : text === cross ? DARK_GY : WHITE,
          size: 18,
        })],
      })],
    });
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Feature / Page', 'Admin', 'Management', 'Viewer'].map(h => cell(h, true)),
  });
  const dataRows = rows.map(r =>
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.feature, color: LIGHT_GY, size: 18 })] })] }),
        new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.admin, color: r.admin === tick ? GREEN : DARK_GY, size: 18 })] })] }),
        new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.mgmt, color: r.mgmt === tick ? GREEN : DARK_GY, size: 18 })] })] }),
        new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.viewer, color: r.viewer === tick ? GREEN : DARK_GY, size: 18 })] })] }),
      ],
    })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
}

// ── Flowchart (linear, horizontal steps) ────────────────────────────────────
function flowChart(steps: { label: string; detail?: string }[], title: string) {
  const elems: any[] = [];
  elems.push(h3(title));
  // Each step as a shaded box, with arrows between
  const stepCells = steps.flatMap((s, i) => {
    const box = new TableCell({
      shading: { type: ShadingType.SOLID, color: PANEL_BG },
      width: { size: Math.floor(90 / steps.length), type: WidthType.PERCENTAGE },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.label, bold: true, color: ACCENT, size: 18 })] }),
        ...(s.detail ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.detail, color: MID_GY, size: 16, italics: true })] })] : []),
      ],
    });
    if (i < steps.length - 1) {
      const arrow = new TableCell({
        width: { size: Math.floor(10 / (steps.length - 1)), type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '→', color: ACCENT, size: 22, bold: true })] })],
      });
      return [box, arrow];
    }
    return [box];
  });
  elems.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: stepCells })],
  }));
  elems.push(spacer(120));
  return elems;
}

// ── Vertical flowchart ───────────────────────────────────────────────────────
function vFlow(steps: { label: string; detail?: string; color?: string }[], title: string) {
  const elems: any[] = [h3(title)];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    elems.push(new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        children: [new TableCell({
          shading: { type: ShadingType.SOLID, color: PANEL_BG },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.label, bold: true, color: s.color ?? ACCENT, size: 20 })] }),
            ...(s.detail ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.detail, color: MID_GY, size: 17, italics: true })] })] : []),
          ],
        })],
      })],
    }));
    if (i < steps.length - 1) {
      elems.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: '↓', color: DARK_GY, size: 22 })] }));
    }
  }
  elems.push(spacer(160));
  return elems;
}

// ── Keyboard shortcut table ───────────────────────────────────────────────────
function shortcutTable(shortcuts: [string, string][]) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Shortcut', 'Action'].map(h => new TableCell({
      shading: { type: ShadingType.SOLID, color: DARK_BG },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: ACCENT, size: 18 })] })],
    })),
  });
  const rows = shortcuts.map(([k, v]) => new TableRow({
    children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, color: PANEL_BG },
        width: { size: 35, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: k, color: WHITE, size: 18, bold: true })] })],
      }),
      new TableCell({
        width: { size: 65, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: v, color: MID_GY, size: 18 })] })],
      }),
    ],
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] });
}

// ── Master document builder ───────────────────────────────────────────────────
export async function generateUserManual(outputPath?: string): Promise<Buffer> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const tick = '✔';
  const cross = '—';

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullet-list',
        levels: [
          { level: 0, format: NumberFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
          { level: 1, format: NumberFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } },
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
              new PageNumberElement(),
            ],
          })],
        }),
      },

      children: [

        // ════════════════════════════════════════════════════════
        // COVER PAGE
        // ════════════════════════════════════════════════════════
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

        // ════════════════════════════════════════════════════════
        // TABLE OF CONTENTS (manual — docx lib has no auto-ToC)
        // ════════════════════════════════════════════════════════
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

        // ════════════════════════════════════════════════════════
        // 1. INTRODUCTION
        // ════════════════════════════════════════════════════════
        h1('1. Introduction & Platform Overview'),
        p('VoIP Watcher is a real-time Network Operations Centre (NOC) monitoring and analytics platform built exclusively for the Sippy Softswitch. It gives NOC engineers, Key Account Managers, and management a single pane of glass to monitor call quality, detect fraud, manage billing, and operate the softswitch — without needing to log into the Sippy admin portal directly.', { size: 21 }),
        spacer(100),
        h2('What this platform covers'),
        bullet('Real-time concurrent call monitoring, MOS, ASR, ACD, PDD, CPS, and traffic quality scoring'),
        bullet('CDR search, filtering, and export in multiple formats'),
        bullet('Revenue & margin analytics, vendor balance tracking, and P&L reporting'),
        bullet('Fraud detection via the FAS (False Answer Supervision) engine'),
        bullet('Rate card management (local + Sippy tariff verification)'),
        bullet('Alert engine with configurable thresholds and email notifications'),
        bullet('Team and KAM management with client-to-account-manager assignment'),
        bullet('Test Call Launcher — originate a real call from the UI to test routing'),
        bullet('API key management for external system integration'),
        bullet('Customisable dashboard with drag-and-drop widgets per user'),
        bullet('Dark/light mode, mobile-responsive layout, and a Cmd+K command palette'),
        spacer(100),
        note('This platform is scoped to Sippy Softswitch only. No other softswitch targets (VOS-3000, FreeSWITCH, etc.) are supported.'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 2. SYSTEM ARCHITECTURE
        // ════════════════════════════════════════════════════════
        h1('2. System Architecture'),
        p('VoIP Watcher is a full-stack web application with the following layers:', { size: 21 }),
        spacer(80),
        defTable([
          ['Frontend', 'React + Vite + TailwindCSS — runs in the browser, communicates with the backend over a REST API'],
          ['Backend', 'Express + TypeScript — handles authentication, Sippy API calls, business logic, and data persistence'],
          ['Database', 'PostgreSQL via Drizzle ORM — stores users, settings, CDR cache, rate cards, alert config, KAMs, API keys, test call logs, widget preferences'],
          ['Sippy Link', 'XML-RPC over HTTP/HTTPS — two credential sets: ssp-root (admin API) and portal username (customer portal). All Sippy calls are proxied through the backend.'],
          ['Auth', 'Replit OpenID Connect (OAuth 2.0) — all routes protected; role stored in the users table'],
        ]),
        spacer(180),
        ...flowChart([
          { label: 'Browser', detail: 'React UI' },
          { label: 'Express API', detail: 'Port 5000' },
          { label: 'PostgreSQL', detail: 'Drizzle ORM' },
          { label: 'Sippy XML-RPC', detail: 'ssp-root / portal' },
        ], 'Data Flow — Frontend to Sippy'),
        note('All Sippy credentials are stored server-side only. The frontend never receives or stores passwords.'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 3. RBAC
        // ════════════════════════════════════════════════════════
        h1('3. Role-Based Access Control (RBAC)'),
        p('Every user is assigned one of three roles. The role is set by an Administrator in the Team page. The role controls which pages and actions are available.', { size: 21 }),
        spacer(100),
        defTable([
          ['Admin', 'Full access to all pages and settings. Can manage users, configure Sippy, create API keys, set alert thresholds, and download all reports.'],
          ['Management', 'Access to operational and analytics pages. Cannot access system settings, user management, or API key management.'],
          ['Viewer', 'Read-only NOC view. Sees only the widgets and data assigned to them by an Admin via Monitoring Assignments.'],
        ], 'Role'),
        spacer(180),
        h2('Feature Access Matrix'),
        roleMatrix([
          { feature: 'Dashboard (Live Calls, KPIs)',      admin: tick, mgmt: tick, viewer: tick },
          { feature: 'CDR Browser',                        admin: tick, mgmt: tick, viewer: tick },
          { feature: 'Analytics / Revenue',               admin: tick, mgmt: tick, viewer: cross },
          { feature: 'Rate Card Management',              admin: tick, mgmt: tick, viewer: cross },
          { feature: 'Fraud Detection (FAS)',             admin: tick, mgmt: tick, viewer: cross },
          { feature: 'Alerts — View',                     admin: tick, mgmt: tick, viewer: tick },
          { feature: 'Alerts — Configure Thresholds',     admin: tick, mgmt: cross, viewer: cross },
          { feature: 'Team & KAM Management',             admin: tick, mgmt: cross, viewer: cross },
          { feature: 'Test Call Launcher',                admin: tick, mgmt: tick, viewer: cross },
          { feature: 'API Key Management',                admin: tick, mgmt: cross, viewer: cross },
          { feature: 'Settings (Sippy, email, SNMP)',     admin: tick, mgmt: cross, viewer: cross },
          { feature: 'Monitoring Assignments (assign)',   admin: tick, mgmt: cross, viewer: cross },
          { feature: 'Download Reports',                  admin: tick, mgmt: cross, viewer: cross },
        ]),
        spacer(100),
        warn('Changing a user\'s role takes effect immediately on their next page load. If a user is currently logged in, they may need to refresh.'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 4. GETTING STARTED
        // ════════════════════════════════════════════════════════
        h1('4. Getting Started'),
        h2('4.1  Logging In'),
        p('VoIP Watcher uses Replit authentication. Users log in via their Replit account — no separate password is required.', { size: 21 }),
        spacer(80),
        ...vFlow([
          { label: 'Open the platform URL in your browser' },
          { label: 'Click "Sign in with Replit"', detail: 'You are redirected to Replit OAuth' },
          { label: 'Authorise the application', detail: 'Grant the requested permissions' },
          { label: 'Redirected back to the Dashboard', detail: 'First login creates your user record; an Admin must assign your role.' },
        ], 'Login Flow'),
        note('First-time users have no role assigned and see only a limited view. Ask your Administrator to assign your role in the Team page.'),
        spacer(100),
        h2('4.2  First-Time Admin Setup'),
        bullet('Log in as the first user — you are automatically assigned Admin role.'),
        bullet('Go to Settings → Sippy Connection and enter your credentials (portal URL, portal username, API admin username and passwords).'),
        bullet('Click "Connect to Sippy" — the status indicator turns green when connected.'),
        bullet('Go to Settings → Alert Thresholds and configure your ASR, MOS, ACD, and call-count limits.'),
        bullet('Go to Settings → Email Notifications and enter your Gmail SMTP credentials for alert emails.'),
        bullet('Go to Team & KAM to invite and assign roles to your team members.'),
        spacer(100),
        h2('4.3  Navigation'),
        p('The left sidebar lists all available pages. Items visible depend on your role. Collapse the sidebar using the arrow icon at the bottom left. On mobile, the sidebar opens via the hamburger menu.', { size: 20 }),
        spacer(80),
        p('Sidebar navigation structure:', { bold: true, color: WHITE }),
        bullet('Dashboard — live call KPIs and widget grid'),
        bullet('CDR Browser — historical call records'),
        bullet('Live Calls — active call list (same as Dashboard live section)'),
        bullet('Analytics — revenue, ASR/ACD trends, BitsEye traffic graph, traffic map'),
        bullet('Graphs — KAM overview, client traffic pulse, traffic alert log'),
        bullet('Rate Cards — local rate management + Sippy tariff comparison'),
        bullet('Fraud Detection — FAS engine results and scoring'),
        bullet('Alerts — alert list and threshold configuration'),
        bullet('Team & KAM — user roles and KAM assignments'),
        bullet('Test Call — launch a real call via Sippy'),
        bullet('API Keys — external Bearer-token API management'),
        bullet('Settings — all system configuration'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 5. DASHBOARD
        // ════════════════════════════════════════════════════════
        h1('5. Dashboard — Live Call Monitoring'),
        p('The Dashboard is the primary NOC view. It refreshes automatically every 15 seconds by polling the Sippy API for live call data.', { size: 21 }),
        spacer(80),
        h2('5.1  KPI Cards'),
        p('At the top of the Dashboard are the key performance indicator cards:', { size: 20 }),
        defTable([
          ['Concurrent Calls', 'Total active calls on the switch right now'],
          ['ASR (%)', 'Answer Seizure Ratio — percentage of call attempts that connected successfully'],
          ['ACD (s)', 'Average Call Duration in seconds — a measure of traffic quality'],
          ['CPS', 'Calls Per Second — origination rate'],
          ['PDD (ms)', 'Post-Dial Delay — time from dial to ringing'],
          ['MOS', 'Mean Opinion Score — voice quality metric (1–5; ≥4.0 = Excellent)'],
          ['Traffic Score', 'Composite quality score combining ASR, ACD, and MOS into a single 0–100 rating'],
          ['Fraud Score', 'FAS engine composite risk score — higher = more suspicious activity detected'],
        ]),
        spacer(160),
        h2('5.2  Widget Grid'),
        p('Below the KPI cards is a customisable widget grid. Each user can toggle widgets on/off and drag them to their preferred position. Changes are saved per-user in the database.', { size: 20 }),
        spacer(80),
        p('Available widgets:', { bold: true, color: WHITE }),
        bullet('Live Call Quality — real-time MOS, jitter, latency, packet loss per active call'),
        bullet('ASR / ACD Trend — line chart of answer rate and call duration over the selected window'),
        bullet('Revenue Overview — 30-day income vs cost vs margin'),
        bullet('Vendor Balances — current balance per vendor with low-balance indicator'),
        bullet('FAS Fraud Score — FAS engine fraud panel with zero-bill and short-bill counts'),
        bullet('Active Alerts — list of firing alert conditions'),
        bullet('Traffic Map Preview — mini world map of destination traffic'),
        bullet('Recent CDRs — last 20 call records inline'),
        spacer(80),
        p('To customise widgets:', { bold: true, color: WHITE }),
        bullet('Click the slider icon (⊟) in the top-right of the Dashboard to open the widget panel'),
        bullet('Toggle any widget on or off using the switch'),
        bullet('Drag widget cards by their header to reorder'),
        bullet('Changes are saved automatically'),
        spacer(100),
        h2('5.3  Live Calls Table'),
        p('The lower section of the Dashboard shows the currently active calls with caller, callee, MOS score, call start time, and a link to the call detail page. Hover over a number to reveal the click-to-call icon — clicking it pre-fills the Test Call Launcher.', { size: 20 }),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 6. CDR BROWSER
        // ════════════════════════════════════════════════════════
        h1('6. CDR (Call Detail Records) Browser'),
        p('The CDR Browser lets you search, filter, and export historical call records retrieved from Sippy. Records are cached locally for fast access.', { size: 21 }),
        spacer(80),
        h2('6.1  Filters'),
        defTable([
          ['Date Range', 'Select preset (Last 1h, 6h, 24h, 7d, 30d) or enter a custom UTC start/end date'],
          ['Caller / Callee', 'Free-text filter on the CLI (caller) or CLD (callee) number'],
          ['Account', 'Filter by a specific Sippy customer account'],
          ['Disconnect Code', 'Filter by SIP response code (e.g. 200, 486, 404)'],
          ['Duration', 'Filter: all calls, answered only (>0s), or unanswered (0s)'],
          ['Direction', 'Origination or termination leg'],
        ]),
        spacer(160),
        h2('6.2  Export'),
        bullet('Click the Export button to download the currently filtered CDRs as a CSV file.'),
        bullet('For Mera-format export (vendor CDR reconciliation), use the Sippy → Vendor CDR Export menu in Settings.'),
        spacer(100),
        h2('6.3  Click-to-Call from CDR'),
        p('Every row in the CDR table has a hover phone icon next to the caller and callee numbers. Clicking it opens the Test Call Launcher pre-filled with those numbers.', { size: 20 }),
        note('This is useful for retesting a failed call — simply click the icon on the failed CDR row and hit Launch.'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 7. ANALYTICS
        // ════════════════════════════════════════════════════════
        h1('7. Analytics & Reporting'),
        h2('7.1  Revenue & Margin Analytics'),
        p('Found in Analytics → Revenue. Shows a 30-day rolling P&L breakdown:', { size: 20 }),
        bullet('Total revenue vs total cost vs margin'),
        bullet('Per-client margin table with colour-coded profitability'),
        bullet('Revenue and cost time-series chart'),
        bullet('Margin percentage trend'),
        spacer(100),
        h2('7.2  ASR / ACD Trend Graphs'),
        p('Found in the Graphs page. Dual-axis recharts plot of answer rate (%) and average duration (s) over a configurable time window (6h / 12h / 24h). Quality band shading highlights periods below acceptable thresholds.', { size: 20 }),
        spacer(100),
        h2('7.3  BitsEye Traffic Graph'),
        p('Per-entity concurrent-call time-series. Switch between Clients, Vendors, and All. Choose ordering by traffic volume or entity name. Supports multi-line overlay comparison.', { size: 20 }),
        spacer(100),
        h2('7.4  Traffic Map'),
        p('An interactive Leaflet world choropleth map showing destination traffic distribution by country. Based on CDR country codes. Features include:', { size: 20 }),
        bullet('Hover country tooltips showing call count and % of total'),
        bullet('Top-10 destinations sidebar'),
        bullet('Time range selector (3h / 6h / 12h / 24h / 48h / 72h)'),
        bullet('Dark CartoDB tile layer optimised for NOC displays'),
        spacer(100),
        h2('7.5  Vendor Balance Tracking'),
        p('Live balance for each configured vendor account on Sippy, refreshed every polling cycle. Low-balance alerts are triggered when a vendor drops below the configured threshold.', { size: 20 }),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 8. RATE CARDS
        // ════════════════════════════════════════════════════════
        h1('8. Rate Card Management'),
        p('Rate Cards allow you to manage your client-facing and vendor-facing rate schedules locally within the platform, and optionally compare them against the tariffs configured in Sippy.', { size: 21 }),
        spacer(80),
        h2('8.1  Creating a Rate Card'),
        bullet('Go to Rate Cards → click "New Rate Card"'),
        bullet('Enter a name and select type: Client or Vendor'),
        bullet('Add prefixes with their per-minute rate, currency, and description'),
        bullet('Optionally select a Sippy tariff to compare against — mismatches are highlighted'),
        spacer(100),
        h2('8.2  Prefix Search'),
        p('Use the search box within a rate card to filter prefixes. Dial-code lookup enriches each prefix with its country and destination name automatically.', { size: 20 }),
        spacer(100),
        h2('8.3  Export'),
        p('Each rate card can be exported as a CSV file containing all prefixes and rates. Use for sharing with clients or reconciliation.', { size: 20 }),
        note('Rate card data is stored locally in the VoIP Watcher database. It is not pushed back to Sippy.'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 9. FRAUD DETECTION
        // ════════════════════════════════════════════════════════
        h1('9. Fraud Detection — FAS Engine'),
        p('The FAS (False Answer Supervision) engine analyses recent CDRs for patterns associated with fraudulent traffic. It runs automatically on every data refresh.', { size: 21 }),
        spacer(80),
        h2('9.1  Detection Categories'),
        defTable([
          ['Zero-Billed Calls', 'Connected calls (200 OK) with zero billable duration — typical of FAS termination fraud'],
          ['Short-Billed Calls', 'Calls with a very short billed duration (< 6 seconds) relative to actual duration'],
          ['High PDD', 'Calls with Post-Dial Delay > 10 seconds — may indicate quality issues or simulated alerting'],
          ['Early Answer', 'Calls answered in < 1 second — characteristic of FAS/SPIT injection'],
        ]),
        spacer(160),
        h2('9.2  Fraud Score'),
        p('The Fraud Score (0–100) is a composite metric shown on the Dashboard FAS widget. A score above 60 is considered high-risk. Scores above 80 trigger an alert.', { size: 20 }),
        spacer(100),
        h2('9.3  Responding to FAS Alerts'),
        ...vFlow([
          { label: 'FAS alert fires (high fraud score)' },
          { label: 'Open Fraud Detection page', detail: 'Review zero-billed and short-billed call lists' },
          { label: 'Identify affected vendor/route', detail: 'Check which connections have the most anomalies' },
          { label: 'Check Sippy vendor settings', detail: 'Disable or re-route the suspect vendor' },
          { label: 'Monitor CDRs for improvement', detail: 'Fraud score should drop within next refresh cycle' },
        ], 'FAS Response Workflow'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 10. ALERTS
        // ════════════════════════════════════════════════════════
        h1('10. Alerts System'),
        p('The Alerts system monitors key metrics against administrator-configured thresholds. When a threshold is breached, an alert is created and (optionally) an email notification is sent.', { size: 21 }),
        spacer(80),
        h2('10.1  Configurable Thresholds'),
        defTable([
          ['Minimum ASR (%)', 'Alert fires if ASR drops below this percentage'],
          ['Minimum MOS', 'Alert fires if MOS drops below this value (e.g. 3.5)'],
          ['Minimum ACD (s)', 'Alert fires if average call duration drops below this threshold'],
          ['Maximum Concurrent Calls', 'Alert fires if concurrent calls exceed this limit (capacity protection)'],
          ['Low Vendor Balance', 'Alert fires if any vendor balance drops below the configured minimum'],
          ['Fraud Score', 'Alert fires when FAS composite score exceeds the limit'],
          ['Traffic Drop', 'Alert fires when a client\'s concurrent calls drop >50% vs the 60-minute peak'],
        ]),
        spacer(160),
        h2('10.2  Alert Lifecycle'),
        ...vFlow([
          { label: 'Metric crosses threshold', detail: 'Detected on next polling cycle' },
          { label: 'Alert record created', detail: 'Stored in DB with severity, metric, and value' },
          { label: 'In-app notification shown', detail: 'Red badge on Alerts nav item' },
          { label: 'Email sent (if configured)', detail: 'Gmail SMTP via Settings' },
          { label: 'Alert auto-resolves', detail: 'When metric returns to acceptable range' },
        ], 'Alert Lifecycle'),
        spacer(100),
        h2('10.3  Viewing Alerts'),
        p('Go to Alerts in the sidebar. The list shows all active and recently resolved alerts with severity (Critical / Warning / Info), the metric that triggered it, and when it occurred.', { size: 20 }),
        note('Alerts are also summarised on the Dashboard Active Alerts widget. Admins can configure thresholds in Settings → Alert Configuration.'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 11. TEAM & KAM MANAGEMENT
        // ════════════════════════════════════════════════════════
        h1('11. Team & KAM Management'),
        h2('11.1  Managing Users'),
        p('Admins assign roles to users from the Team page. Users must have logged in at least once before they can be assigned a role (their account is created on first login).', { size: 20 }),
        bullet('Navigate to Team & KAM'),
        bullet('Find the user in the list (or use Quick Assign Role form)'),
        bullet('Select their role: Admin, Management, or Viewer'),
        bullet('Click Assign — the change takes effect immediately'),
        spacer(100),
        h2('11.2  Key Account Managers (KAMs)'),
        p('KAMs are team members responsible for managing specific client accounts. The KAM management system allows you to:', { size: 20 }),
        bullet('Create KAM profiles with contact information'),
        bullet('Assign one or more Sippy client accounts to each KAM'),
        bullet('View a live call count overlay per KAM on the Graphs page'),
        bullet('See which KAM is responsible for a client in alert and CDR views'),
        spacer(100),
        h2('11.3  Monitoring Assignments (for Viewers)'),
        p('Viewers see only the data they are assigned to monitor. Admins configure this in Settings → Monitoring Assignments:', { size: 20 }),
        bullet('Select which dashboard widgets the viewer can see'),
        bullet('Optionally restrict CDR and live-call views to specific accounts'),
        bullet('Assignments are saved per-viewer and applied on their next login'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 12. TEST CALL LAUNCHER
        // ════════════════════════════════════════════════════════
        h1('12. Test Call Launcher'),
        p('The Test Call Launcher allows NOC engineers and management to originate a real call via the Sippy switch directly from the browser — without logging into the Sippy admin portal.', { size: 21 }),
        spacer(80),
        warn('This sends a real call origination request to the live Sippy switch. Use internal test extensions or agreed test numbers to avoid unintended charges.'),
        spacer(100),
        h2('12.1  Launching a Call'),
        ...vFlow([
          { label: 'Navigate to Test Call in the sidebar' },
          { label: 'Enter the From (CLI) number', detail: 'E.164 format (e.g. +441234567890) or local format' },
          { label: 'Enter the To (CLD) number', detail: 'The number to dial' },
          { label: 'Select a Billing Account (optional)', detail: 'Routes the call through that account\'s tariff' },
          { label: 'Enter a Billing Code (optional)', detail: 'Tags the call for reconciliation' },
          { label: 'Click Launch Call', detail: 'Request sent to Sippy makeCall XML-RPC endpoint' },
          { label: 'Result displayed', detail: 'Success: call ID shown. Error: fault code and message shown.' },
        ], 'Test Call Flow'),
        spacer(100),
        h2('12.2  Call History'),
        p('All test calls are logged in the Recent Test Calls table at the bottom of the page. Each entry shows:', { size: 20 }),
        defTable([
          ['Time', 'Timestamp when the call was launched'],
          ['From (CLI)', 'Caller number entered'],
          ['To (CLD)', 'Called number entered'],
          ['Account', 'Sippy account ID used (if any)'],
          ['Call ID', 'The call ID returned by Sippy on success'],
          ['Status', 'Success or Error'],
          ['Message', 'Sippy\'s response message or fault description'],
        ]),
        spacer(160),
        h2('12.3  Click-to-Call from CDR and Live Calls'),
        p('In both the CDR Browser and the Dashboard live calls table, hovering over a caller or callee number reveals a phone icon. Clicking it navigates to the Test Call Launcher with the CLI and CLD pre-filled from that call record — enabling rapid retesting.', { size: 20 }),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 13. API KEY MANAGEMENT
        // ════════════════════════════════════════════════════════
        h1('13. API Key Management'),
        p('Admins can create Bearer-token API keys that allow external systems (dashboards, monitoring tools, scripts) to query key platform endpoints without logging in.', { size: 21 }),
        spacer(80),
        h2('13.1  Creating an API Key'),
        bullet('Go to API Keys in the sidebar (Admin only)'),
        bullet('Click "Create New API Key"'),
        bullet('Enter a label (e.g. "External NOC Dashboard")'),
        bullet('The key is generated and displayed once — copy and store it securely'),
        bullet('The key cannot be retrieved again after the dialog is closed'),
        spacer(100),
        h2('13.2  Available External Endpoints'),
        defTable([
          ['GET /api/ext/live-calls', 'Current active calls on the switch'],
          ['GET /api/ext/asr-acd', 'Current ASR and ACD metrics'],
          ['GET /api/ext/vendor-balances', 'All vendor balance snapshots'],
        ]),
        spacer(160),
        p('Include the key in the Authorization header:', { bold: true, color: WHITE }),
        new Paragraph({
          shading: { type: ShadingType.SOLID, color: PANEL_BG },
          spacing: { after: 100 },
          children: [new TextRun({ text: 'Authorization: Bearer YOUR_API_KEY_HERE', color: GREEN, size: 18, font: 'Courier New' })],
        }),
        spacer(100),
        h2('13.3  Revoking a Key'),
        p('In the API Keys page, click the delete (trash) icon next to a key to revoke it immediately. Any system using that key will receive 401 Unauthorized from that point on.', { size: 20 }),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 14. SETTINGS & CONFIGURATION
        // ════════════════════════════════════════════════════════
        h1('14. Settings & Configuration'),
        p('All system configuration is in the Settings page (Admin only). Settings are grouped into panels:', { size: 21 }),
        spacer(80),
        h2('14.1  Sippy Connection'),
        defTable([
          ['Portal URL', 'Base URL of the Sippy customer portal (e.g. https://switch.example.com)'],
          ['Portal Username', 'Customer portal login — used for CDR and account queries'],
          ['Portal Password', 'Portal password — stored encrypted server-side'],
          ['API Admin Username', 'ssp-root or similar Sippy XML-RPC admin user'],
          ['API Admin Password', 'Admin password — stored encrypted server-side'],
        ]),
        spacer(160),
        p('Click Connect to Sippy to test and activate the connection. The status badge turns green when connected.', { size: 20 }),
        spacer(100),
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
        p('The Settings page includes a Documentation Downloads section where all platform documents can be downloaded as .docx files:', { size: 20 }),
        bullet('Volume 1 Status Report — implementation status of all 24 Volume 1 features'),
        bullet('Feature Roadmap — the full platform feature roadmap'),
        bullet('Extended Features Vol II — proposed Tier 2 & Tier 3 feature proposals'),
        bullet('API Reference — all 200+ REST endpoints across 21 categories'),
        bullet('User Manual — this document (regenerated on demand)'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 15. PROCESS FLOWS
        // ════════════════════════════════════════════════════════
        h1('15. Process Flows'),

        ...flowChart([
          { label: 'Log in', detail: 'Replit OAuth' },
          { label: 'Dashboard', detail: 'Review KPIs' },
          { label: 'Alert fires?', detail: 'Check alert badge' },
          { label: 'Investigate', detail: 'CDR / Live Calls' },
          { label: 'Resolve', detail: 'Update Sippy or escalate' },
        ], '15.1  NOC Shift Workflow'),

        ...flowChart([
          { label: 'Metric breach detected', detail: 'Next poll cycle' },
          { label: 'Alert created', detail: 'Stored in DB' },
          { label: 'Badge shown', detail: 'Sidebar count' },
          { label: 'Email sent', detail: 'If SMTP configured' },
          { label: 'Metric recovers', detail: 'Alert auto-resolves' },
        ], '15.2  Alert Trigger & Resolution Flow'),

        ...flowChart([
          { label: 'Open CDR', detail: 'Find failed call' },
          { label: 'Click ☎ icon', detail: 'On caller/callee' },
          { label: 'Test Call page', detail: 'Pre-filled numbers' },
          { label: 'Launch Call', detail: 'Sippy makeCall' },
          { label: 'Verify result', detail: 'Check call ID / error' },
        ], '15.3  Click-to-Call Retest Workflow'),

        ...flowChart([
          { label: 'FAS Score > 60', detail: 'On dashboard' },
          { label: 'Open FAS page', detail: 'View anomalies' },
          { label: 'Identify vendor', detail: 'Filter by vendor' },
          { label: 'Block in Sippy', detail: 'Via Sippy admin' },
          { label: 'Monitor score', detail: 'Should drop next cycle' },
        ], '15.4  Fraud Detection Response Workflow'),

        ...vFlow([
          { label: 'New team member joins' },
          { label: 'Admin creates Replit account for user (or user self-registers)' },
          { label: 'User logs in once to create their account record' },
          { label: 'Admin goes to Team & KAM → assigns role (Admin / Management / Viewer)' },
          { label: 'If Viewer: Admin configures Monitoring Assignments for that user' },
          { label: 'User refreshes — new role and page access applied' },
        ], '15.5  Onboarding a New Team Member'),

        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 16. KEYBOARD SHORTCUTS
        // ════════════════════════════════════════════════════════
        h1('16. Keyboard Shortcuts & Quick Actions'),
        shortcutTable([
          ['Cmd + K  /  Ctrl + K', 'Open the Command Bar — search for any page, dial code, or action'],
          ['Esc', 'Close the Command Bar or any open dialog'],
          ['↑ / ↓', 'Navigate Command Bar results'],
          ['Enter', 'Select the highlighted Command Bar result'],
          ['Cmd + ,  /  Ctrl + ,', 'Jump directly to Settings (when Command Bar is open)'],
        ]),
        spacer(160),
        h2('Command Bar Actions'),
        p('The Command Bar (Cmd+K) provides instant access to:', { size: 20 }),
        bullet('All sidebar navigation links'),
        bullet('Dial-code lookup — type a number to identify country and carrier'),
        bullet('CDR search — type "cdr <number>" to search for a specific call'),
        bullet('Vendor balance quick view'),
        bullet('Dark/light mode toggle'),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 17. TROUBLESHOOTING
        // ════════════════════════════════════════════════════════
        h1('17. Troubleshooting & FAQ'),
        defTable([
          [
            'Sippy connection shows "Disconnected"',
            'Check portal URL, username, and password in Settings → Sippy Connection. Ensure the switch is reachable on HTTPS and the XML-RPC port is not firewalled. Click "Connect to Sippy" to retry.',
          ],
          [
            'No CDRs showing',
            'Verify the Sippy connection is active. Check the date range filter — the default is "Last 24 hours". If the connection is new, wait for the next CDR cache refresh (runs every 5 minutes).',
          ],
          [
            'Dashboard KPIs all show zero',
            'There may be no active calls on the switch. KPIs pull from the live Sippy call list. Verify by checking the Sippy admin portal directly.',
          ],
          [
            'Alert emails not being received',
            'Go to Settings → Email Notifications, verify Gmail credentials, and click "Send Test Email". Check your spam folder. Make sure the Gmail app password (not your main password) is used.',
          ],
          [
            'Test call fails with "Fault"',
            'The Sippy API returned an XML-RPC fault. Common causes: invalid CLI format (use E.164), the account ID does not exist, or the switch has no route for the CLD. Check the fault message in the result card.',
          ],
          [
            'User cannot see certain pages',
            'Their role may be Viewer. Ask an Admin to change their role in Team & KAM. Role changes take effect on next page refresh.',
          ],
          [
            'Dashboard widgets not saving position',
            'Widget preferences are saved per-user. If you are logged in on multiple tabs, changes in one tab may conflict with another. Refresh after making changes.',
          ],
          [
            'Traffic map shows no data',
            'The traffic map uses CDR country codes. Ensure CDRs are being fetched and contain valid country data. Try extending the time range selector.',
          ],
        ]),
        pageBreak(),

        // ════════════════════════════════════════════════════════
        // 18. GLOSSARY
        // ════════════════════════════════════════════════════════
        h1('18. Glossary'),
        defTable([
          ['ASR', 'Answer Seizure Ratio — the percentage of call attempts that result in a successful connection (200 OK)'],
          ['ACD', 'Average Call Duration — mean duration of connected calls in seconds'],
          ['CPS', 'Calls Per Second — the rate at which new call attempts are arriving on the switch'],
          ['PDD', 'Post-Dial Delay — time in milliseconds between the initial INVITE and the first 180 Ringing response'],
          ['MOS', 'Mean Opinion Score — a numerical measure of voice call quality on a scale from 1 (worst) to 5 (best)'],
          ['FAS', 'False Answer Supervision — a fraud technique where calls are answered immediately with silence to bill the originator without delivering a real connection'],
          ['CLI', 'Calling Line Identification — the caller\'s phone number (A-number, From)'],
          ['CLD', 'Called Line Destination — the destination phone number being dialled (B-number, To)'],
          ['KAM', 'Key Account Manager — a team member responsible for managing a portfolio of client accounts'],
          ['CDR', 'Call Detail Record — a record produced by the switch for each call leg, containing routing, duration, billing, and quality data'],
          ['XML-RPC', 'A remote procedure call protocol using XML over HTTP, used by the Sippy Softswitch API'],
          ['NOC', 'Network Operations Centre — the team and facility responsible for real-time monitoring and management of telecom infrastructure'],
          ['RBAC', 'Role-Based Access Control — a security model where system access is granted based on the user\'s assigned role'],
          ['SNMP', 'Simple Network Management Protocol — used to collect hardware-level performance metrics from network equipment'],
          ['Sippy', 'Sippy Software — the Class 4 VoIP softswitch platform that VoIP Watcher is integrated with'],
        ]),
        spacer(200),
        divider(),
        p(`This document was auto-generated by VoIP Watcher on ${dateStr} at ${timeStr}. It is updated automatically when new features are added to the platform.`, { color: DARK_GY, size: 17, italic: true }),
        p('VoIP Watcher Platform — Confidential. For internal use only.', { color: DARK_GY, size: 17, italic: true }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) writeFileSync(outputPath, buffer);
  return buffer;
}

export const USER_MANUAL_PATH = join(process.cwd(), 'attached_assets', 'VoIP_Watcher_User_Manual.docx');
