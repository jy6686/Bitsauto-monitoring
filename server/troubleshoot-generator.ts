import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer,
  NumberFormat, PageBreak, SimpleField,
} from 'docx';
import { writeFileSync } from 'fs';

// ── Colour palette ─────────────────────────────────────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GREEN    = '00C853';
const ORANGE   = 'FF6D00';
const RED      = 'FF3333';
const YELLOW   = 'FFD600';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E8E8E8';
const MID_GY   = 'BDBDBD';
const DARK_GY  = '424242';
const PANEL_BG = '161B22';

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
function fix(text: string) {
  return new Paragraph({
    indent: { left: 360 },
    spacing: { after: 100 },
    border: { left: { color: GREEN, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({ text: `FIX APPLIED: ${text}`, color: GREEN, size: 18, italics: true })],
  });
}
function codeBlock(text: string) {
  return new Paragraph({
    shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG },
    spacing: { after: 100 },
    indent: { left: 360 },
    children: [new TextRun({ text, color: GREEN, size: 17 })],
  });
}

function defTable(rows: [string, string][], headerLabel = '', keyPct = 30) {
  const keyW = w(keyPct);
  const valW = PAGE_DXA - keyW;
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

function issueTable(rows: { id: string; title: string; severity: string; status: string; fix: string }[]) {
  const cols = [8, 35, 12, 12, 33];
  const colW = cols.map(c => w(c));
  const hdrRow = new TableRow({
    tableHeader: true,
    children: ['ID', 'Issue Title', 'Severity', 'Status', 'Resolution Summary'].map((t, i) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, fill: DARK_BG, color: DARK_BG },
        width: { size: colW[i], type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: ACCENT, size: 17 })] })],
      })
    ),
  });
  const dataRows = rows.map(r => {
    const sevColor = r.severity === 'Critical' ? RED : r.severity === 'High' ? ORANGE : YELLOW;
    const statColor = r.status === 'Resolved' ? GREEN : ORANGE;
    return new TableRow({
      children: [
        new TableCell({ width: { size: colW[0], type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: r.id, color: MID_GY, size: 17, bold: true })] })] }),
        new TableCell({ width: { size: colW[1], type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: r.title, color: LIGHT_GY, size: 17 })] })] }),
        new TableCell({ width: { size: colW[2], type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: r.severity, color: sevColor, size: 17, bold: true })] })] }),
        new TableCell({ width: { size: colW[3], type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: r.status, color: statColor, size: 17, bold: true })] })] }),
        new TableCell({ width: { size: colW[4], type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: r.fix, color: MID_GY, size: 17 })] })] }),
      ],
    });
  });
  return new Table({ width: { size: PAGE_DXA, type: WidthType.DXA }, rows: [hdrRow, ...dataRows] });
}

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

// ── Main generator ─────────────────────────────────────────────────────────────
export async function generateTroubleshootGuide(outputPath?: string): Promise<Buffer> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

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
            children: [new TextRun({ text: `VoIP Watcher Platform — Troubleshooting & Issue Log  |  ${dateStr}`, color: DARK_GY, size: 16 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { color: DARK_GY, style: BorderStyle.SINGLE, size: 2 } },
            children: [
              new TextRun({ text: 'VoIP Watcher — Internal Reference  |  Page ', color: DARK_GY, size: 16 }),
              new SimpleField('PAGE'),
            ],
          })],
        }),
      },

      children: [

        // ════════════════════════════════════════════════════
        // COVER
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
          children: [new TextRun({ text: 'Troubleshooting Guide & Issue Log', color: WHITE, bold: true, size: 48 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: 'Resolved Issues · Root-Cause Analysis · Diagnostic Procedures · Fix Flowcharts', color: MID_GY, size: 24, italics: true })],
        }),
        spacer(300),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: `Generated: ${dateStr} at ${timeStr}`, color: DARK_GY, size: 20 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Audience: Platform Developers, NOC Engineers, IT Administrators', color: DARK_GY, size: 20 })],
        }),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // TABLE OF CONTENTS
        // ════════════════════════════════════════════════════
        h1('Table of Contents'),
        ...([
          ['1', 'Resolved Issues Summary (Index)'],
          ['2', 'Critical Issue Deep Dives'],
          ['3', 'Server Startup Diagnostic Procedure'],
          ['4', 'Sippy Connection Troubleshooting'],
          ['5', 'Authentication & Role Issues'],
          ['6', 'CDR Cache & Data Issues'],
          ['7', 'Vite / Frontend Startup Issues'],
          ['8', 'Database & Migration Issues'],
          ['9', 'Background Job & Polling Issues'],
          ['10', 'Deployment & Production Checklist'],
          ['11', 'Common API Error Reference'],
          ['12', 'Preventive Maintenance Procedures'],
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
        // 1. RESOLVED ISSUES SUMMARY
        // ════════════════════════════════════════════════════
        h1('1. Resolved Issues Summary'),
        p('The following table lists all previously encountered and resolved issues. Each entry includes a unique ID, severity classification, current status, and a brief fix summary. Detailed root-cause analysis is provided in Section 2 for critical issues.', { size: 21 }),
        spacer(120),
        issueTable([
          {
            id: 'ISS-001',
            title: 'Server never opens port 5000 — startup hangs indefinitely',
            severity: 'Critical',
            status: 'Resolved',
            fix: 'ReferenceError on undefined `isAuthenticated` in P&L route caused registerRoutes() to reject before httpServer.listen() was reached. Fixed by replacing isAuthenticated with requireRole().',
          },
          {
            id: 'ISS-002',
            title: 'Vite dev server blocks port binding — createViteServer() hangs',
            severity: 'Critical',
            status: 'Resolved',
            fix: 'Moved httpServer.listen() before setupVite() call. Wrapped Vite init in fire-and-forget IIFE so port opens before Vite plugin network calls complete.',
          },
          {
            id: 'ISS-003',
            title: 'Replit OIDC discovery hangs on getOidcConfig() — blocks setupAuth()',
            severity: 'High',
            status: 'Resolved',
            fix: 'Wrapped await setupAuth(app) in Promise.race() with a 6-second timeout. If OIDC discovery is unreachable, startup continues. App uses its own requireRole() auth independently.',
          },
          {
            id: 'ISS-004',
            title: 'isAuthenticated used as middleware in P&L route but never imported',
            severity: 'Critical',
            status: 'Resolved',
            fix: 'server/routes.ts line 11082: replaced isAuthenticated with (req, res, next) => requireRole([\'admin\', \'management\'], req, res, next). isAuthenticated is not imported in routes.ts and must never be used directly in routes.',
          },
          {
            id: 'ISS-005',
            title: 'Background jobs run but server port never opens — misleading log output',
            severity: 'High',
            status: 'Resolved',
            fix: 'Root cause was ISS-001/ISS-004. Background jobs (setInterval) were registered before the crash line, so they continued running in the event loop even after the async function rejected. Port never opened because listen() was never called.',
          },
          {
            id: 'ISS-006',
            title: 'P&L report scraper — flexible column detection needed for Sippy portal HTML',
            severity: 'Medium',
            status: 'Resolved',
            fix: 'scrapeProfitLossReport() in sippy.ts uses flexible column detection: maps header text patterns (Date/Calls/Duration/Revenue/Cost/Profit/Margin) rather than fixed column indices. Handles both /profit_loss_report.php (root admin) and /c1/profit_loss_report.php (customer).',
          },
          {
            id: 'ISS-007',
            title: 'ASR/ACD scrape — portal date format mismatch causes zero results',
            severity: 'Medium',
            status: 'Resolved',
            fix: 'formatSippyPortalDate() produces "HH:MM:SS.000 GMT Day Mon DD YYYY" — matches Sippy portal\'s expected date_start/date_end format. Using ISO format causes empty results.',
          },
          {
            id: 'ISS-008',
            title: 'Credential swap — XML-RPC admin creds stored in portal fields and vice versa',
            severity: 'High',
            status: 'Resolved',
            fix: 'Applied credential swap-aware pattern: portalUser = apiAdminUsername || portalUsername, adminUser = portalUsername || apiAdminUsername. Both credential pairs are tried on connection; the successful one is promoted. Applied consistently in smartSippyConnect() and all affected routes.',
          },
          {
            id: 'ISS-009',
            title: 'CDR cache fallback — API returns empty CDRs on some endpoint combinations',
            severity: 'Medium',
            status: 'Resolved',
            fix: 'CDR routes try getAccountCDRs (XML-RPC) first, fall back to portal scrape if empty. Cache holds 72h of data (~7,500 records), refreshes every 5 minutes. Cache fallback prevents data gaps during Sippy polling issues.',
          },
          {
            id: 'ISS-010',
            title: 'Multi-switch lastSyncAt never updated after consolidated poll',
            severity: 'Low',
            status: 'Resolved',
            fix: 'GET /api/switches/consolidated writes lastSyncAt + lastSyncStatus back to each secondary switch DB record after each poll. POST /api/switches/:id/test also updates these fields.',
          },
          {
            id: 'ISS-011',
            title: 'registerRoutes async function never resolves despite background jobs running',
            severity: 'Critical',
            status: 'Resolved',
            fix: 'Caused by ISS-004. ReferenceError on isAuthenticated caused the async function promise to reject. background jobs (setInterval) registered before the crash point kept the event loop alive, masking the failure.',
          },
          {
            id: 'ISS-012',
            title: 'WhatsApp alert delivery log missing WA Sent badge in Alerts table',
            severity: 'Low',
            status: 'Resolved',
            fix: 'getWhatsappAlertLogs() added to IStorage. Route GET /api/whatsapp/logs returns last 200 delivery records. WhatsApp alerts page renders the log with sent/failed counts.',
          },
        ]),
        spacer(200),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 2. CRITICAL ISSUE DEEP DIVES
        // ════════════════════════════════════════════════════
        h1('2. Critical Issue Deep Dives'),

        // ISS-001 + ISS-004
        h2('2.1  ISS-001 / ISS-004 — Server Startup Failure (ReferenceError on isAuthenticated)'),
        p('Classification: Critical — Production Impact: Server port 5000 never opened. Platform completely unavailable.', { color: RED, bold: true }),
        spacer(80),
        h3('Root Cause'),
        p('The P&L report route in server/routes.ts was added with isAuthenticated as the second middleware argument. isAuthenticated is a named export from server/replit_integrations/auth/replitAuth.ts but was NOT imported in server/routes.ts. JavaScript throws a ReferenceError when evaluating the route registration expression:', { size: 20 }),
        codeBlock('app.get("/api/analytics/pnl", isAuthenticated, async (req, res) => {  // isAuthenticated = undefined → ReferenceError'),
        spacer(80),
        p('This ReferenceError caused the async registerRoutes() function\'s Promise to reject immediately. The outer IIFE in server/index.ts awaits registerRoutes() — when it rejects, the IIFE exits without ever reaching httpServer.listen(). Port 5000 is never bound.', { size: 20 }),
        spacer(80),
        h3('Why Background Jobs Still Ran'),
        p('setInterval() calls in registerRoutes() that were registered BEFORE line 11082 (the crash line) had already been submitted to the Node.js event loop. A rejected async function does not cancel timers already registered. These timers continued firing every 60/120 seconds, making the process appear healthy in logs while the port was never open.', { size: 20 }),
        spacer(80),
        h3('Fix Applied'),
        fix('Replaced isAuthenticated middleware with requireRole inline lambda — matching the pattern used by every other route in routes.ts:'),
        codeBlock('app.get("/api/analytics/pnl", (req: any, res, next) => requireRole([\'admin\', \'management\'], req, res, next), async (req, res) => {'),
        spacer(80),
        warn('RULE: Never use isAuthenticated directly in routes.ts — it is not imported there. Always use the requireRole() function defined locally within registerRoutes(). The only correct middleware pattern is: (req: any, res, next) => requireRole([\'admin\'], req, res, next)'),
        spacer(100),

        // ISS-002 / ISS-003
        h2('2.2  ISS-002 / ISS-003 — Vite and OIDC Discovery Blocking Port Bind'),
        p('Classification: High — Production Impact: Server port opened only after Vite and OIDC discovery complete (could be 30–120+ seconds). Replit workflow timeout kills the process before the port opens.', { color: ORANGE, bold: true }),
        spacer(80),
        h3('Root Cause — Vite Plugin Hang (ISS-002)'),
        p('The original server/index.ts sequenced: await setupVite() THEN httpServer.listen(). setupVite() internally calls createViteServer() which loads vite.config.ts. vite.config.ts has top-level await import("@replit/vite-plugin-cartographer") — this plugin makes a network call to Replit infrastructure that can hang for 30+ seconds in degraded environments.', { size: 20 }),
        spacer(80),
        h3('Root Cause — OIDC Discovery Hang (ISS-003)'),
        p('setupAuth(app) in replitAuth.ts calls: const config = await getOidcConfig() which calls client.discovery(new URL("https://replit.com/oidc"), process.env.REPL_ID). The openid-client discovery() function uses native fetch() with no timeout. If Replit\'s OIDC server is slow or unreachable, this hangs indefinitely.', { size: 20 }),
        spacer(80),
        h3('Fix Applied — server/index.ts'),
        fix('Moved httpServer.listen() before any Vite or OIDC initialisation. Wrapped the entire Vite setup in a fire-and-forget IIFE:'),
        codeBlock('httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => log("serving on port " + port));\n(async () => { const { setupVite } = await import("./vite"); await setupVite(httpServer, app); })();'),
        spacer(80),
        h3('Fix Applied — server/routes.ts'),
        fix('Wrapped setupAuth(app) in a Promise.race() with a 6-second timeout:'),
        codeBlock('await Promise.race([\n  setupAuth(app),\n  new Promise<void>((_, reject) => setTimeout(() => reject(new Error("OIDC discovery timed out")), 6000))\n]);'),
        spacer(100),
        note('The app\'s authentication does NOT depend on Replit OIDC. All route protection uses requireRole() with session-based credentials stored in PostgreSQL. The Replit OIDC routes (/api/login, /api/callback) are supplementary and not required for core operation.'),
        spacer(80),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 3. SERVER STARTUP DIAGNOSTIC PROCEDURE
        // ════════════════════════════════════════════════════
        h1('3. Server Startup Diagnostic Procedure'),
        p('Use this procedure when the server fails to open port 5000. Follow each diagnostic step in order.', { size: 21 }),
        spacer(100),
        ...flowDiagram([
          { label: 'Check workflow logs', detail: 'Look for [startup] registerRoutes starting... — if missing, tsx compilation failed. Check for TypeScript errors.' },
          { label: 'Check for ReferenceError or TypeError', detail: 'Search logs for "Unhandled rejection" immediately after registerRoutes starting. The error message identifies the crash line.' },
          { label: 'Check for [startup] registerRoutes complete', detail: 'If this line is MISSING, registerRoutes() rejected. Find the cause: undefined variable, unresolved await, or thrown exception.' },
          { label: 'Check for [startup] calling httpServer.listen', detail: 'If missing, the code never reached listen(). The async IIFE rejected before listen().' },
          { label: 'Check for serving on port 5000', detail: 'If listen was called but this is missing, the bind failed. Check for EADDRINUSE (zombie process on port 5000).' },
          { label: 'Check for Vite dev server ready', detail: 'If missing, Vite initialisation failed. This is non-fatal — APIs work but frontend may not load.' },
          { label: 'Check for [vite] connected in browser console', detail: 'Confirms HMR websocket is established. If missing, frontend cannot receive live updates.' },
        ], '3.1  Server Startup Diagnostic Flowchart'),

        h2('3.2  Key Startup Log Sequence (Healthy)'),
        defTable([
          ['[db] Safe migrations applied.',               'DB schema synced. Always first.'],
          ['[startup] registerRoutes starting...',        'registerRoutes() entered. setupAuth() called.'],
          ['[auth] Replit OIDC setup skipped (if any)',   'OIDC timeout fired — non-fatal. Server continues.'],
          ['[sippy-watcher] Starting...',                 'Change detection watcher initialised.'],
          ['[startup] registerRoutes complete',           'All routes registered. Promise resolved.'],
          ['serving on port 5000',                        'httpServer.listen() callback fired. Port open.'],
          ['[startup] Sippy credentials found...',        'Auto-connect initiated (fire-and-forget).'],
          ['[startup] Sippy auto-connected: Connected', 'XML-RPC session established.'],
          ['Vite dev server ready',                       'Vite finished initialising (may be seconds later).'],
          ['[vite] connected. (browser)',                 'HMR websocket established. UI fully functional.'],
        ]),
        spacer(100),
        h2('3.3  Startup Failure Signatures'),
        defTable([
          ['registerRoutes starting... then silence',
           'registerRoutes() rejected (ISS-001/ISS-004 pattern). Check for Unhandled rejection in next 2 lines. Fix: find undefined variable in route registration.'],
          ['registerRoutes complete but no port 5000',
           'listen() call was reached but bind failed. Most likely EADDRINUSE from zombie process. Kill the old process or wait for OS to release the port.'],
          ['Port 5000 open but frontend 404',
           'Vite failed to initialise. Check for Vite-specific errors after serving on port 5000. APIs work — only frontend static serving is broken.'],
          ['[auth] Replit OIDC setup skipped (non-fatal)',
           'Normal — OIDC discovery timed out in 6 seconds. All app functionality is unaffected. Replit /api/login endpoint may return 500 but the app uses its own auth.'],
          ['isAuthenticated is not defined',
           'Critical pattern — a route uses isAuthenticated middleware which is not imported. Find the route and replace with requireRole() lambda.'],
        ], 'Signature', 40),
        spacer(100),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 4. SIPPY CONNECTION TROUBLESHOOTING
        // ════════════════════════════════════════════════════
        h1('4. Sippy Connection Troubleshooting'),
        p('The platform maintains a live Sippy session for API calls. Connection issues are the most common source of data gaps.', { size: 21 }),
        spacer(80),
        h2('4.1  Credential Architecture'),
        p('There are TWO separate credential pairs for Sippy — they serve different purposes and are commonly swapped in the settings fields:', { size: 20 }),
        defTable([
          ['API Admin Username / Password',  'XML-RPC admin credentials. Used for: listActiveCalls, getCountersStats, makeCall, tariff management. Typically: ssp-root with its API password (set in Sippy → My Preferences → Allow API Calls). This is NOT the web portal login password.'],
          ['Portal Username / Password',     'Web portal (HTTP) credentials. Used for: CDR scraping, P&L report scraping, ASR/ACD reports from portal pages. Typically: RTST-1 or similar customer portal account. Password is the portal login password.'],
          ['Admin Web Password (optional)',  'Separate web portal login password for the admin account, if different from the XML-RPC API password. Used when portal session uses ssp-root as the portal login rather than the customer account.'],
        ]),
        spacer(120),
        h2('4.2  Credential Swap Pattern (ISS-008)'),
        p('In production, the credentials are often saved in swapped fields (API Admin creds in Portal fields and vice versa). The platform handles this automatically via the swap-aware pattern:', { size: 20 }),
        codeBlock('portalUser = settings.apiAdminUsername || settings.portalUsername || ""\nadminUser  = settings.portalUsername  || settings.apiAdminUsername || ""'),
        spacer(80),
        note('smartSippyConnect() tries BOTH credential pairs in both roles and uses the combination that successfully authenticates. The successful pair is stored in the active session.'),
        spacer(100),
        h2('4.3  Connection Troubleshooting Flowchart'),
        ...flowDiagram([
          { label: 'Settings page shows "Disconnected"', detail: 'Sippy session is not active' },
          { label: 'Verify Portal URL format', detail: 'Must be https://IP or https://hostname — no trailing slash. No /c1/ path.' },
          { label: 'Try both credential pairs', detail: 'Portal user in API Admin fields, API Admin user in Portal fields. The swap is very common in production.' },
          { label: 'Click Connect to Sippy', detail: 'This triggers smartSippyConnect() which tries all combinations' },
          { label: 'Check server logs for smartSippyConnect result', detail: 'Look for [startup] Sippy auto-connected or [startup] Sippy auto-connect failed' },
          { label: 'If still failing: verify network reachability', detail: 'The server must be able to reach the Sippy IP on port 443 or the configured HTTPS port' },
          { label: 'If XML-RPC fails but portal works: check API password', detail: 'In Sippy: My Preferences → Allow API Calls. The API password shown there is the XML-RPC password (not the web login).' },
        ], ''),
        spacer(100),
        h2('4.4  Sippy Session Modes'),
        defTable([
          ['xmlrpc',  'Full XML-RPC API mode. Provides live calls, KPIs, CDRs via API. Requires API admin credentials and the Allow API Calls permission.'],
          ['portal',  'Portal scrape mode. Used as fallback when XML-RPC fails. Scrapes portal HTML pages. Slower but works with only portal credentials.'],
          ['mixed',   'Some endpoints use XML-RPC, others use portal scrape. Common when API admin creds work but customer portal is also authenticated separately.'],
        ]),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 5. AUTHENTICATION & ROLE ISSUES
        // ════════════════════════════════════════════════════
        h1('5. Authentication & Role Issues'),
        h2('5.1  How Authentication Works'),
        p('VoIP Watcher uses session-based authentication stored in PostgreSQL. Users log in via Replit OAuth. After login, their user record is created in the users table. An Admin assigns them a role (admin / management / viewer). The role is checked on every API call via requireRole().', { size: 20 }),
        spacer(80),
        h2('5.2  requireRole() Pattern — Critical Rule'),
        warn('NEVER use isAuthenticated directly in routes.ts as middleware. It is not imported there. The correct pattern for ALL route protection in routes.ts is:'),
        codeBlock('app.get(\'/api/some/route\', (req: any, res, next) => requireRole([\'admin\', \'management\'], req, res, next), async (req, res) => {\n  // handler\n});'),
        spacer(80),
        defTable([
          ['requireRole([\'admin\'])',                   'Admin-only access. Use for: settings, user management, API key management, document regeneration.'],
          ['requireRole([\'admin\', \'management\'])',   'Admin and management access. Use for: analytics, rate cards, LCR, cost optimisation, test call, CDRs.'],
          ['requireRole([\'admin\', \'management\', \'viewer\'])', 'All authenticated users. Use for: dashboard, alerts view, basic call data.'],
        ], 'Role Array', 45),
        spacer(80),
        h2('5.3  Common Auth Issues'),
        defTable([
          ['401 Unauthorized on all API calls', 'User is not logged in or session expired. Refresh the browser — redirected to login. Check session table in DB for expired records.'],
          ['403 Forbidden on specific routes', 'User is logged in but their role is insufficient. Admin must update role in Team page. Role change takes effect on next request.'],
          ['User stuck with no role after first login', 'First login creates the user record with no role. An Admin must assign the role via Team & KAM. The new user should see a minimal "no access" state.'],
          ['isAuthenticated is not defined (error)', 'A route is using isAuthenticated as middleware but it is not imported in routes.ts. Replace with requireRole() lambda. This causes server startup to fail (ISS-004).'],
        ], 'Issue', 35),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 6. CDR CACHE & DATA ISSUES
        // ════════════════════════════════════════════════════
        h1('6. CDR Cache & Data Issues'),
        h2('6.1  CDR Cache Architecture'),
        p('CDRs are cached in memory (cdrCache Map) with a 72-hour sliding window. The cache holds ~7,500 records and refreshes every 5 minutes. The cache is populated from two sources in priority order:', { size: 20 }),
        bullet('Primary: XML-RPC getAccountCDRs / getCustomerCDRs (faster, structured data)', WHITE),
        bullet('Fallback: Portal HTML scrape (/c1/cdr_list.php) when XML-RPC returns empty', MID_GY),
        spacer(80),
        defTable([
          ['Cache size',          '~7,500 records (configurable via MAX_CDR_CACHE_SIZE constant)'],
          ['Cache window',        '72 hours rolling (CDRs older than 72h are evicted)'],
          ['Refresh interval',    'Every 5 minutes (CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000)'],
          ['First load delay',    'Cache is empty on fresh start. First 500 records load within ~2 minutes.'],
          ['[cdr-cache] log',     'Each refresh cycle logs: "+N new records, total=N"'],
        ]),
        spacer(100),
        h2('6.2  CDR Data Issues'),
        defTable([
          ['No CDRs in browser after fresh start',
           'Cache is warming up. Wait 2-5 minutes for the first batch. Look for [cdr-cache] +500 new records in server logs. The cache fills incrementally — each cycle adds 500 more records.'],
          ['CDR timestamps seem wrong / off by hours',
           'Sippy returns UTC timestamps. The platform displays them in UTC. If your portal is configured for a local timezone, there may be a presentation mismatch. All filters and comparisons use UTC internally.'],
          ['CDR filter returns zero results for known calls',
           'Check the date range — default is Last 24 hours. Extend to Last 7 days. Also check: are CDRs older than 72h? They will have been evicted from cache. Use the Sippy admin portal for older records.'],
          ['P&L report shows no data for date range',
           'P&L data comes from portal scrape of /profit_loss_report.php. Verify: (1) portal session is active, (2) the selected date range has traffic, (3) portalUsername is a valid customer account (not ssp-root). The scraper tries both /profit_loss_report.php (admin) and /c1/profit_loss_report.php (customer).'],
        ], 'Issue', 38),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 7. VITE / FRONTEND STARTUP ISSUES
        // ════════════════════════════════════════════════════
        h1('7. Vite / Frontend Startup Issues'),
        h2('7.1  Vite Initialisation Is Non-Blocking'),
        p('As of the ISS-002 fix, Vite initialisation is fire-and-forget. The server port opens immediately. Vite may take 5-30 seconds to complete initialisation. During this window:', { size: 20 }),
        bullet('Backend API routes (/api/*) are fully operational immediately', GREEN),
        bullet('Frontend pages may return a blank page or "connecting..." for a few seconds', YELLOW),
        bullet('Once Vite is ready, the browser console shows [vite] connected.', GREEN),
        spacer(80),
        h2('7.2  Vite Plugin Issues'),
        defTable([
          ['@replit/vite-plugin-cartographer',  'Replit-provided cartographer plugin. Makes a network call to Replit infrastructure during initialisation. May hang in degraded environments. This is why Vite init is fire-and-forget.'],
          ['@replit/vite-plugin-runtime-error-modal', 'Error modal overlay in development. Does not affect production.'],
          ['vite.config.ts changes',            'Do NOT modify vite.config.ts unless absolutely necessary. The existing config handles all path aliases, plugins, and port configuration.'],
        ]),
        spacer(80),
        h2('7.3  Frontend 404 After Port Opens'),
        ...flowDiagram([
          { label: 'Confirm API is working', detail: 'Test: curl http://localhost:5000/api/auth/user — should return 401 (not 404)' },
          { label: 'Check Vite dev server ready in server logs', detail: 'If not present, Vite is still initialising — wait 30 seconds' },
          { label: 'Check browser console for [vite] errors', detail: 'Network errors, module resolution failures, or plugin errors will appear here' },
          { label: 'Hard refresh browser (Ctrl+Shift+R)', detail: 'Clears stale cached module graph' },
          { label: 'Check vite.config.ts for recent changes', detail: 'If vite.config.ts was modified recently, revert if broken' },
        ], ''),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 8. DATABASE & MIGRATION ISSUES
        // ════════════════════════════════════════════════════
        h1('8. Database & Migration Issues'),
        h2('8.1  Safe Migration System'),
        p('The platform uses runSafeMigrations() in server/db.ts — called at every startup before routes are registered. Migrations are idempotent (safe to run multiple times).', { size: 20 }),
        spacer(80),
        defTable([
          ['runSafeMigrations()',   'Runs ALTER TABLE IF NOT EXISTS ADD COLUMN IF NOT EXISTS statements. Adds new columns without dropping existing data. Never changes column types.'],
          ['[db] Safe migrations applied.',  'Log line confirming migrations ran successfully. Always the first meaningful log line.'],
          ['drizzle.config.ts',    'Drizzle ORM configuration — do not modify. Uses DATABASE_URL environment variable.'],
          ['npm run db:push',      'Syncs Drizzle schema to database. Run after schema.ts changes. Use --force if push is blocked.'],
        ]),
        spacer(80),
        h2('8.2  Common Database Issues'),
        defTable([
          ['Sessions table missing',
           'The sessions table is created by connect-pg-simple. If missing: run CREATE TABLE sessions (...) or restart the server after running npm run db:push.'],
          ['Column does not exist error',
           'A new column was added to schema.ts but the migration hasn\'t run. Restart the server (runSafeMigrations() will add it) or run npm run db:push manually.'],
          ['Duplicate key errors on insert',
           'An insert is attempting to create a record with an ID that already exists. Check for duplicate data seeding or race conditions in background jobs.'],
          ['DATABASE_URL not set',
           'Server will fail to connect to PostgreSQL. Check Replit Secrets panel for DATABASE_URL. Format: postgresql://user:pass@host:5432/dbname'],
        ], 'Issue', 35),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 9. BACKGROUND JOB & POLLING ISSUES
        // ════════════════════════════════════════════════════
        h1('9. Background Job & Polling Issues'),
        h2('9.1  Background Jobs Overview'),
        defTable([
          ['listActiveCalls',         'Every 5 s — XML-RPC poll for live call list. Log: [Sippy] listActiveCalls returned N active calls'],
          ['getCountersStats',        'Every 5 s — ASR/ACD/CPS KPI stats. Aggregated from counter snapshots.'],
          ['vendor-balance',          'Every 60 s — getAccountBalance for each vendor connection. Log: [vendor-balance] snapshot #N'],
          ['connectionVendorCache',   'Every 120 s (2 min) — refreshes the IP→vendor mapping cache. Log: [routes] connectionVendorCache refreshed: N entries'],
          ['accountCache',            'Every 120 s — refreshes the account ID→name mapping. Log: [routes] accountCache refreshed: N accounts'],
          ['CDR cache',               'Every 5 min — fetches new CDRs and appends to memory cache. Log: [cdr-cache] +N new records, total=N'],
          ['FAS engine',              'Every 5 min — analyses CDR cache for FAS anomalies. Log: [fas-bg] Saved N new FAS events'],
          ['Sippy change watcher',    'Every 5 min — detects account/vendor/IP changes vs previous snapshot'],
          ['Monitoring server',       'Every 60 s — TCP SIP OPTIONS probe to monitoredIp'],
          ['Multi-switch consolidated', 'Every 30 s (when page is open) — polls all secondary switches'],
        ]),
        spacer(100),
        h2('9.2  Background Job Issues'),
        defTable([
          ['No vendor-balance logs after 60s',
           'Sippy session disconnected. The balance poller requires an active session. Check for [monitoring] Sippy server DOWN log lines. Reconnect via Settings.'],
          ['accountCache shows 0 accounts',
           'Sippy API returned empty list or connection failed during refresh. Check Sippy session status. listAccounts() requires admin credentials.'],
          ['CDR cache grows but never shrinks',
           'Expected behaviour — cache evicts records older than 72h. If memory grows unbounded, check CDR volume — high-traffic switches with >10K CDRs/hour may exceed cache limits.'],
          ['FAS engine saves 0 events repeatedly',
           'Normal when no FAS anomalies present. The engine only saves when patterns are detected (zero-billed, short-billed, early-answer). Not an error.'],
          ['connectionVendorCache shows 268 instead of 1595',
           'First refresh after startup has partial data (268 = first batch). Full load (1595) appears on second refresh cycle. This is expected ISS-005 clarification.'],
        ], 'Issue', 40),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 10. DEPLOYMENT & PRODUCTION CHECKLIST
        // ════════════════════════════════════════════════════
        h1('10. Deployment & Production Checklist'),
        p('Use this checklist before deploying or after major changes. All items must pass before declaring the platform production-ready.', { size: 21 }),
        spacer(100),
        h2('10.1  Pre-Deployment Checks'),
        bullet('[ ] Server starts within 30 seconds and port 5000 opens (check Replit workflow logs)', WHITE),
        bullet('[ ] "[startup] registerRoutes complete — proceeding to listen" appears in logs', WHITE),
        bullet('[ ] "serving on port 5000" appears in logs', WHITE),
        bullet('[ ] No ReferenceError or TypeError in startup logs', WHITE),
        bullet('[ ] Sippy auto-connected successfully (check for [startup] Sippy auto-connected: Connected)', WHITE),
        bullet('[ ] Vite dev server ready (or static files served in production)', WHITE),
        bullet('[ ] Login page loads in browser', WHITE),
        bullet('[ ] API health check passes: GET /api/auth/user returns 401 (not 500)', WHITE),
        bullet('[ ] No isAuthenticated references in routes.ts (grep to verify)', WHITE),
        bullet('[ ] All new routes use requireRole() lambda pattern', WHITE),
        spacer(100),
        h2('10.2  Post-Deployment Verification'),
        bullet('[ ] Dashboard live calls load within 10 seconds of login', WHITE),
        bullet('[ ] CDR Browser shows records (may need 2-5 min on first start)', WHITE),
        bullet('[ ] Analytics tabs: Overview, By Client, By Destination, Worst Routes, P&L Report all render', WHITE),
        bullet('[ ] Settings page loads without errors — Sippy connection shows Connected', WHITE),
        bullet('[ ] Documentation Downloads: all 7 documents download successfully', WHITE),
        bullet('[ ] Vendor balance snapshot appears in logs after 60 seconds', WHITE),
        bullet('[ ] BitsEye Countries grid populates after CDR cache warms up', WHITE),
        bullet('[ ] WhatsApp Alerts page renders (even if not configured)', WHITE),
        bullet('[ ] Multi-Switch View shows primary switch', WHITE),
        spacer(100),
        h2('10.3  Secrets Required in Production'),
        defTable([
          ['DATABASE_URL',    'PostgreSQL connection string. Required for all data storage.'],
          ['SESSION_SECRET',  'Express session secret. Must be a long random string. Required for login sessions.'],
          ['REPL_ID',         'Replit application ID. Auto-set by Replit environment. Used for OIDC auth.'],
          ['ISSUER_URL',      'OIDC issuer (default: https://replit.com/oidc). Auto-set by Replit.'],
        ]),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 11. COMMON API ERROR REFERENCE
        // ════════════════════════════════════════════════════
        h1('11. Common API Error Reference'),
        defTable([
          ['401 Unauthorized',         'Not logged in or session expired. Re-login. Check requireRole() is applied to the route.'],
          ['403 Forbidden',            'Logged in but insufficient role. Check user role in Team page. Verify requireRole() array includes the user\'s role.'],
          ['503 Sippy not configured', 'Settings not saved or Sippy session not connected. Go to Settings and save credentials, then connect.'],
          ['500 OIDC discovery timed out', 'Non-fatal. Replit OIDC was unreachable during startup. App function is not affected. Retry after restart if /api/login is needed.'],
          ['500 Failed to scrape',     'Portal scrape failed. Check: (1) portal session active, (2) portal URL correct, (3) HTML structure of Sippy portal page unchanged.'],
          ['404 File not found (download)', 'Document .docx file missing from /tmp/. Use Settings > Documentation Downloads > Update button to regenerate.'],
          ['XML-RPC Fault 403',        'Sippy returned authentication failure. Check credentials — especially if API password vs web password is confused.'],
          ['XML-RPC Fault 404',        'Resource not found in Sippy. Account ID, connection ID, or tariff ID may be incorrect.'],
          ['EADDRINUSE port 5000',     'A previous process is still running on port 5000. Kill it or wait for OS to release. Check for zombie processes.'],
          ['ReferenceError: X is not defined', 'A variable is used in routes.ts but not imported. Most commonly isAuthenticated. Fix: add import or replace with requireRole().'],
        ], 'Error / Code', 30),
        spacer(100),
        pageBreak(),

        // ════════════════════════════════════════════════════
        // 12. PREVENTIVE MAINTENANCE PROCEDURES
        // ════════════════════════════════════════════════════
        h1('12. Preventive Maintenance Procedures'),
        h2('12.1  Before Adding a New Route'),
        bullet('Check that requireRole() is used — never isAuthenticated — for route protection', WHITE),
        bullet('Test: restart the server after adding the route and verify "registerRoutes complete" appears in logs', WHITE),
        bullet('If route uses portal scraping: test with both /profit_loss_report.php and /c1/ variants', WHITE),
        bullet('If route uses CDR data: test with empty cache (first start) and warm cache', WHITE),
        spacer(80),
        h2('12.2  Checking for the isAuthenticated Trap'),
        p('Before every deployment, run this check to ensure no routes use the undefined isAuthenticated variable:', { size: 20 }),
        codeBlock('grep -n "isAuthenticated" server/routes.ts'),
        p('Expected result: zero matches. Any match that is NOT in a comment is a critical bug that will prevent the server from starting.', { size: 20, color: RED }),
        spacer(80),
        h2('12.3  Monthly Maintenance Tasks'),
        bullet('Regenerate all documentation downloads via Settings > Documentation Downloads', WHITE),
        bullet('Review CDR cache hit rate — if cache.size is consistently at max, increase MAX_CDR_CACHE_SIZE', WHITE),
        bullet('Check vendor balance history — flag any vendors with consistently zero balance (may be inactive)', WHITE),
        bullet('Review FAS engine event log — tune thresholds if false positives are high', WHITE),
        bullet('Verify Sippy connection credentials still work after any Sippy software updates', WHITE),
        bullet('Check PostgreSQL database size — CDR records and alert logs accumulate over time', WHITE),
        spacer(200),
        divider(),
        p(`This document was auto-generated by VoIP Watcher on ${dateStr} at ${timeStr}. Regenerate it after resolving new issues using Settings > Documentation Downloads > Update Troubleshooting Guide.`, { color: DARK_GY, size: 17, italic: true }),
        p('VoIP Watcher Platform — Internal Reference. Do not distribute externally.', { color: DARK_GY, size: 17, italic: true }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) writeFileSync(outputPath, buffer);
  return buffer;
}

export const TROUBLESHOOT_GUIDE_PATH = '/tmp/VoIP_Watcher_Troubleshooting_Guide.docx';
