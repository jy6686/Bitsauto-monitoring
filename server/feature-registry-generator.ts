/**
 * Platform Feature Registry — Document Generator
 *
 * Generates a professional .docx covering every feature built from
 * project start through current session: status, depth, tables, and roadmap.
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, Header, Footer,
} from 'docx';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export const FEATURE_REGISTRY_PATH = path.join(process.cwd(), 'generated_docs', 'Bitsauto_Platform_Feature_Registry.docx');

// ── Colour palette ─────────────────────────────────────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GOLD     = 'FFD700';
const GREEN    = '10B981';
const VIOLET   = 'A855F7';
const ROSE     = 'F43F5E';
const ORANGE   = 'F97316';
const AMBER    = 'F59E0B';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E2E8F0';
const MID_GY   = 'A0AEC0';
const DARK_GY  = '4A5568';
const CYAN     = '06B6D4';
const TEAL     = '14B8A6';

// ── Helpers ───────────────────────────────────────────────────────────────────
function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 520, after: 180 },
    children: [new TextRun({ text, color: ACCENT, bold: true, size: 48 })],
  });
}
function h2(text: string, color = WHITE) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 140 },
    children: [new TextRun({ text, color, bold: true, size: 34 })],
  });
}
function h3(text: string, color = LIGHT_GY) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 100 },
    children: [new TextRun({ text, color, bold: true, size: 26 })],
  });
}
function p(text: string, opts: { bold?: boolean; color?: string; size?: number; indent?: number; italic?: boolean } = {}) {
  return new Paragraph({
    indent: opts.indent ? { left: opts.indent } : undefined,
    spacing: { after: 120 },
    children: [new TextRun({
      text,
      bold: opts.bold,
      color: opts.color ?? LIGHT_GY,
      size: opts.size ?? 22,
      italics: opts.italic,
    })],
  });
}
function bullet(text: string, color = MID_GY) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, color, size: 20 })],
  });
}
function spacer() {
  return new Paragraph({ spacing: { after: 160 }, children: [] });
}
function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 6 } },
    children: [],
  });
}
function badge(label: string, color: string) {
  return new TextRun({ text: ` ${label} `, color, bold: true, size: 18, highlight: 'none' });
}

// ── Table helpers ─────────────────────────────────────────────────────────────
function makeHeaderRow(cols: string[]) {
  return new TableRow({
    tableHeader: true,
    children: cols.map(c => new TableCell({
      shading: { fill: '1A2233' },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: c, bold: true, color: ACCENT, size: 20 })],
      })],
    })),
  });
}
function makeDataRow(cells: { text: string; color?: string }[], shade = '0F1624') {
  return new TableRow({
    children: cells.map(c => new TableCell({
      shading: { fill: shade },
      margins: { top: 70, bottom: 70, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: c.text, color: c.color ?? LIGHT_GY, size: 18 })],
      })],
    })),
  });
}
function statusColor(status: string): string {
  if (status.includes('REAL'))    return GREEN;
  if (status.includes('PARTIAL')) return AMBER;
  if (status.includes('SHELL'))   return ORANGE;
  if (status.includes('NOT'))     return ROSE;
  return MID_GY;
}

// ── Document content ──────────────────────────────────────────────────────────
export async function generateFeatureRegistryDoc(outPath: string): Promise<void> {
  const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const children: Paragraph[] = [

    // ── Cover ────────────────────────────────────────────────────────────────
    new Paragraph({
      spacing: { before: 800, after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'BITSAUTO', color: ACCENT, bold: true, size: 72 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: 'Monitoring Platform', color: WHITE, bold: true, size: 48 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: 'Full Platform Feature Registry', color: CYAN, bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: `Generated: ${now}  ·  Covers all features from project start through current session`, color: MID_GY, size: 20 })],
    }),
    divider(),

    // ── Status legend ─────────────────────────────────────────────────────────
    h1('How to Read This Document'),
    p('Each feature carries one of four status tags:'),
    spacer(),

    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: '  ✅ REAL  ', color: GREEN, bold: true, size: 22 }),
        new TextRun({ text: '  Backend engine + frontend both live, real data flowing through the system.', color: LIGHT_GY, size: 22 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: '  ⚠️ PARTIAL  ', color: AMBER, bold: true, size: 22 }),
        new TextRun({ text: '  Infrastructure exists, but intelligence or enrichment layer incomplete.', color: LIGHT_GY, size: 22 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: '  🔲 SHELL  ', color: ORANGE, bold: true, size: 22 }),
        new TextRun({ text: '  UI exists, static or near-static, 1 real data hook or fewer.', color: LIGHT_GY, size: 22 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: '  ❌ NOT BUILT  ', color: ROSE, bold: true, size: 22 }),
        new TextRun({ text: '  No page, no route, no schema — entirely absent.', color: LIGHT_GY, size: 22 }),
      ],
    }),
    divider(),

    // ── PART 1: Core Operational Platform ─────────────────────────────────────
    h1('PART 1 — Core Operational Platform'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status', 'Notes']),
        makeDataRow([{ text: 'Real-Time Dashboard' }, { text: 'dashboard.tsx' }, { text: '43' }, { text: 'REAL', color: GREEN }, { text: 'Live call counters, KPIs, alerts, widget layout' }]),
        makeDataRow([{ text: 'Live Call Monitor' }, { text: 'calls-list.tsx' }, { text: '40' }, { text: 'REAL', color: GREEN }, { text: 'Active calls table, CDR history, NOC WebSocket' }], '131929'),
        makeDataRow([{ text: 'Multi-Switch View' }, { text: 'multi-switch.tsx' }, { text: '23' }, { text: 'REAL', color: GREEN }, { text: 'Cross-switch KPIs, credential pair management' }]),
        makeDataRow([{ text: 'CDR Analytics & Reporting' }, { text: 'analytics.tsx, reports.tsx' }, { text: '19 / 20' }, { text: 'REAL', color: GREEN }, { text: '72h rolling CDR cache, CSV export, scheduled reports' }], '131929'),
        makeDataRow([{ text: 'BitsEye Drill-Down' }, { text: 'bitseye.tsx' }, { text: '54' }, { text: 'REAL', color: GREEN }, { text: 'Per-client/KAM/destination drill-down, most data-rich page' }]),
        makeDataRow([{ text: 'Revenue & Margin Analysis' }, { text: 'analytics.tsx (tab)' }, { text: '—' }, { text: 'REAL', color: GREEN }, { text: 'Cost/sell rate per destination, margin % by route' }], '131929'),
        makeDataRow([{ text: 'QoS Heatmap' }, { text: 'qos-heatmap.tsx' }, { text: '6' }, { text: 'REAL', color: GREEN }, { text: 'Hour×day MOS heatmap, mos_hourly table' }]),
        makeDataRow([{ text: 'Balance Monitor' }, { text: 'balance-monitor.tsx' }, { text: '18' }, { text: 'REAL', color: GREEN }, { text: 'Vendor prepaid balance, low-balance alerts' }], '131929'),
        makeDataRow([{ text: 'Graphs & Trends' }, { text: 'graphs.tsx' }, { text: '31' }, { text: 'REAL', color: GREEN }, { text: 'ASR/ACD/PDD/MOS time-series charts' }]),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 2: Routing & Control Plane ───────────────────────────────────────
    h1('PART 2 — Routing & Control Plane'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status', 'Notes']),
        makeDataRow([{ text: 'Routing Manager' }, { text: 'routing-manager.tsx' }, { text: '66' }, { text: 'REAL', color: GREEN }, { text: '4 sub-modules: RGs, DSets, Connections, Audit Trail' }]),
        makeDataRow([{ text: 'LCR Analyser' }, { text: 'lcr-analyser.tsx' }, { text: '5' }, { text: 'REAL', color: GREEN }, { text: 'Per-destination prefix cost/quality comparison' }], '131929'),
        makeDataRow([{ text: 'Cost Optimisation Engine' }, { text: 'cost-optimisation.tsx' }, { text: '6' }, { text: 'REAL', color: GREEN }, { text: 'Over-cost route identification, margin impact modelling' }]),
        makeDataRow([{ text: 'Automated Routing Intelligence' }, { text: 'routing-intelligence.tsx' }, { text: '12' }, { text: 'REAL', color: GREEN }, { text: 'ASR/cost/capacity threshold rules, routing_rules table' }], '131929'),
        makeDataRow([{ text: 'Call Flow Simulator' }, { text: 'call-flow-simulator.tsx' }, { text: '8' }, { text: 'REAL', color: GREEN }, { text: 'Simulates CLI/CLD routing before applying changes' }]),
        makeDataRow([{ text: 'Policy Simulator' }, { text: 'routing-manager (tab)' }, { text: '—' }, { text: 'REAL', color: GREEN }, { text: 'Impact modelling for proposed routing changes' }], '131929'),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 3: Network Monitoring ────────────────────────────────────────────
    h1('PART 3 — Network Monitoring'),

    h2('SIP Trace Viewer & Ladder Diagram', CYAN),
    p('Status: ✅ REAL — completed current session', { color: GREEN, bold: true }),
    spacer(),
    p('Two modes of operation:', { bold: true }),
    bullet('CDR Lookup mode — enter Call-ID, CLI, or CLD to reconstruct full SIP dialog from Sippy CDR timing + packet dump API'),
    bullet('Paste mode — paste raw SIP capture for immediate parsing and rendering'),
    spacer(),
    p('Ladder diagram features (built this session):', { bold: true }),
    bullet('Three-lane layout: Caller (left) | Sippy centre node | Carrier (right)'),
    bullet('Timing delta column (Δms) between each consecutive event'),
    bullet('Failure path highlighting — 4xx/5xx/6xx rows: red background + red border accent + red arrow lines'),
    bullet('PDD metric bar — colour-coded green (<2s), amber (2–5s), red (>5s) — CDR field or computed from INVITE→200 timestamps'),
    bullet('Carrier involvement inference — INVITE/BYE/ACK/1xx–2xx span both lanes; Sippy-local messages show dashed right lane'),
    bullet('Expandable raw SIP detail per event row'),
    bullet('Direct link from CDR table rows via ?callId= URL parameter'),
    spacer(),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status', 'Notes']),
        makeDataRow([{ text: 'SIP Trace Viewer + Ladder' }, { text: 'sip-trace.tsx' }, { text: '5' }, { text: 'REAL', color: GREEN }, { text: '3-lane diagram, PDD, timing deltas, failure highlighting' }]),
        makeDataRow([{ text: 'Server & Infrastructure Monitor' }, { text: 'server-monitoring.tsx' }, { text: '58' }, { text: 'REAL', color: GREEN }, { text: 'ICMP/HTTP ping, uptime, SIP OPTIONS probe' }], '131929'),
        makeDataRow([{ text: 'SBC / Media Plane Monitor' }, { text: 'sbc-monitor.tsx' }, { text: '11' }, { text: 'REAL', color: GREEN }, { text: 'SBC host health, active sessions, codec breakdown' }]),
        makeDataRow([{ text: 'RTP Analytics' }, { text: 'rtp-analytics.tsx' }, { text: '4' }, { text: 'PARTIAL', color: AMBER }, { text: 'Signalling-layer metrics only — no packet-level RTP tap' }], '131929'),
        makeDataRow([{ text: 'Traffic Map' }, { text: 'traffic-map.tsx' }, { text: '11' }, { text: 'REAL', color: GREEN }, { text: 'World map — active calls by destination country' }]),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 4: Security & Fraud ───────────────────────────────────────────────
    h1('PART 4 — Security & Fraud'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status', 'Notes']),
        makeDataRow([{ text: 'FAS / IRSF Detection' }, { text: 'fraud.tsx' }, { text: '39' }, { text: 'REAL', color: GREEN }, { text: 'Pattern analysis, fas_events, irsf_events tables' }]),
        makeDataRow([{ text: 'Auto-Blacklist' }, { text: 'firewall.tsx' }, { text: '13' }, { text: 'REAL', color: GREEN }, { text: 'Rule-based IP/CLI/prefix blocking, blacklist_rules table' }], '131929'),
        makeDataRow([{ text: 'Simbox Detection' }, { text: 'fraud.tsx (section)' }, { text: '—' }, { text: 'REAL', color: GREEN }, { text: 'SIM box scoring engine, simbox_scores table' }]),
        makeDataRow([{ text: 'Approval Engine' }, { text: 'approval-queue.tsx' }, { text: '15' }, { text: 'REAL', color: GREEN }, { text: 'Multi-role approval for all Sippy write operations' }], '131929'),
        makeDataRow([{ text: 'Signal Trace Debugger' }, { text: 'approval-queue.tsx (panel)' }, { text: '—' }, { text: 'REAL', color: GREEN }, { text: 'Per-approval execution timeline: requestedAt, execStart, execEnd, signalEval' }]),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 5: AI Ops & Intelligence ─────────────────────────────────────────
    h1('PART 5 — AI Ops & Intelligence'),

    h2('Architecture Overview', VIOLET),
    p('The AI Ops stack has three layers, all built in the current codebase:', { color: LIGHT_GY }),
    spacer(),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Layer', 'File', 'Table', 'Description']),
        makeDataRow([{ text: 'Signal Emission' }, { text: 'server/aiops/signal-mapper.ts' }, { text: 'ai_ops_events' }, { text: 'Fires on approval failures or execution latency >6s' }]),
        makeDataRow([{ text: 'Anomaly Detection' }, { text: 'Background engine' }, { text: 'anomaly_events' }, { text: 'Runs every 15 min — baselines MOS/ASR/volume, detects deviations' }], '131929'),
        makeDataRow([{ text: 'Correlation Engine' }, { text: 'server/aiops/correlation-engine.ts' }, { text: 'ai_ops_incidents' }, { text: 'Groups signals + anomalies into incidents, auto-resolves after 30min silence' }]),
      ],
    }),
    spacer(),

    p('Correlation Engine details (built this session):', { bold: true, color: VIOLET }),
    bullet('Runs at T+6 min, repeats every 5 minutes'),
    bullet('Deterministic grouping by entity (operationType) and vendor'),
    bullet('Upsert logic: existing open incidents absorb new signals'),
    bullet('Auto-resolve: no new signals for 30 minutes → incident marked resolved'),
    bullet('Routes: GET /api/aiops/incidents, POST /api/aiops/incidents/run'),
    spacer(),

    p('AI Ops UI (ai-ops.tsx — 15 hooks):', { bold: true, color: VIOLET }),
    bullet('Four tabs: All / Anomalies / Signals / Incidents'),
    bullet('Incident cards: severity badge, signal count, anomaly count, duration, active/resolved, "Run now" button'),
    spacer(),
    divider(),

    // ── PART 6: Accounts, Products & Rates ───────────────────────────────────
    h1('PART 6 — Accounts, Products & Rates'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status']),
        makeDataRow([{ text: 'Client Account Manager' }, { text: 'clients.tsx' }, { text: '87' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Vendor Connections' }, { text: 'vendors.tsx' }, { text: '21' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'Rate Cards' }, { text: 'rate-cards.tsx + rate-editor.tsx' }, { text: '41 + 11' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Products' }, { text: 'products.tsx' }, { text: '17' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'DIDs' }, { text: 'dids.tsx' }, { text: '14' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Account Names' }, { text: 'account-names.tsx' }, { text: '17' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'Billing Disputes' }, { text: 'billing-disputes.tsx' }, { text: '10' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Reseller Management' }, { text: 'reseller.tsx' }, { text: '11' }, { text: 'REAL', color: GREEN }], '131929'),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 7: Team & Access Management ─────────────────────────────────────
    h1('PART 7 — Team & Access Management'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status', 'Notes']),
        makeDataRow([{ text: 'Role-Based Access Control' }, { text: 'shared/schema.ts + routes.ts' }, { text: '—' }, { text: 'REAL', color: GREEN }, { text: '6 roles: super_admin, admin, management, team_lead, noc_operator, viewer' }]),
        makeDataRow([{ text: 'KAM Management' }, { text: 'team.tsx' }, { text: '49' }, { text: 'REAL', color: GREEN }, { text: 'HOD→SVP→VP→Manager→TeamLead→KAM org hierarchy' }], '131929'),
        makeDataRow([{ text: 'Vendor SLA Scorecard' }, { text: 'vendor-sla-scorecard.tsx' }, { text: '8' }, { text: 'REAL', color: GREEN }, { text: 'ASR/ACD/PDD/MOS trends, breach log, baselines' }]),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 8: Alerts & Notifications ────────────────────────────────────────
    h1('PART 8 — Alerts & Notifications'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status']),
        makeDataRow([{ text: 'Alert Rules Engine' }, { text: 'alerts.tsx / approval-settings.tsx' }, { text: '0 / 8' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'WhatsApp Alerts' }, { text: 'whatsapp-alerts.tsx' }, { text: '13' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'Email Centre' }, { text: 'email-centre.tsx' }, { text: '10' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Sippy Change Watcher' }, { text: 'server/routes.ts (background)' }, { text: '—' }, { text: 'REAL', color: GREEN }], '131929'),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 9: UX & Tools ────────────────────────────────────────────────────
    h1('PART 9 — User Experience & Tools'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Feature', 'Page / File', 'Hooks', 'Status']),
        makeDataRow([{ text: 'Internal Team Chat' }, { text: 'chat.tsx' }, { text: '10' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Command Palette' }, { text: 'layout-shell.tsx' }, { text: '—' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'Dark / Light Mode' }, { text: 'Global theme' }, { text: '—' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Global Fix Button System' }, { text: 'Every page' }, { text: '—' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'Dashboard Widget Prefs' }, { text: 'dashboard.tsx' }, { text: '—' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Test Call Launcher' }, { text: 'test-call.tsx' }, { text: '11' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'Test Campaigns (manual)' }, { text: 'test-campaigns.tsx' }, { text: '15' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'Tools Page' }, { text: 'tools.tsx' }, { text: '14' }, { text: 'REAL', color: GREEN }], '131929'),
        makeDataRow([{ text: 'API Keys' }, { text: 'api-keys.tsx' }, { text: '8' }, { text: 'REAL', color: GREEN }]),
        makeDataRow([{ text: 'SMS / A2P Monitor' }, { text: 'sms-monitor.tsx' }, { text: '1' }, { text: 'COMING SOON', color: AMBER }], '131929'),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 10: Roadmap document cross-reference ─────────────────────────────
    h1('PART 10 — Roadmap Feature Cross-Reference'),
    p('Status of the 9 features from the original priority document:', { color: MID_GY }),
    spacer(),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['#', 'Feature', 'Status', 'What\'s Missing']),
        makeDataRow([{ text: '1' }, { text: 'SIP Trace Viewer + Ladder Diagram' }, { text: 'REAL ✅', color: GREEN }, { text: '3-lane, PDD, deltas, failure highlighting — completed this session' }]),
        makeDataRow([{ text: '2' }, { text: 'Automated Routing Intelligence' }, { text: 'REAL ✅', color: GREEN }, { text: 'Rule engine + approval gate fully operational' }], '131929'),
        makeDataRow([{ text: '3' }, { text: 'Synthetic Call Testing (Scheduled)' }, { text: 'PARTIAL ⚠️', color: AMBER }, { text: 'Manual works; server-side scheduler + MOS regression baseline missing' }]),
        makeDataRow([{ text: '4' }, { text: 'Number Intelligence Layer' }, { text: 'PARTIAL ⚠️', color: AMBER }, { text: 'cnam/hlr/stirShaken return null — no HLR/CNAM provider wired' }], '131929'),
        makeDataRow([{ text: '5' }, { text: 'SBC / Media Plane Monitoring' }, { text: 'REAL ✅', color: GREEN }, { text: 'Signalling-layer metrics real; true RTP tap not yet' }]),
        makeDataRow([{ text: '6' }, { text: 'Client Self-Service Portal' }, { text: 'SHELL 🔲', color: ORANGE }, { text: 'UI exists; no tenant data isolation enforced' }], '131929'),
        makeDataRow([{ text: '7' }, { text: 'Reseller Management' }, { text: 'REAL ✅', color: GREEN }, { text: 'reseller_profiles table, full CRUD wired' }]),
        makeDataRow([{ text: '8' }, { text: 'Unified Communications (Teams/Zoom)' }, { text: 'NOT BUILT ❌', color: ROSE }, { text: 'No pages, routes, or schema — entirely absent' }], '131929'),
        makeDataRow([{ text: '9' }, { text: 'Compliance & Regulatory Dashboard' }, { text: 'SHELL 🔲', color: ORANGE }, { text: 'Static UI only; no STIR/SHAKEN aggregation or GDPR pipeline' }]),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 11: Database Schema ──────────────────────────────────────────────
    h1('PART 11 — Database Schema (55 Tables)'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Category', 'Tables']),
        makeDataRow([{ text: 'Core telephony' }, { text: 'calls, metrics, call_snapshots, mos_hourly' }]),
        makeDataRow([{ text: 'CDR & analytics' }, { text: 'sippy_snapshots, sippy_change_events' }], '131929'),
        makeDataRow([{ text: 'Accounts & products' }, { text: 'client_profiles, switches, rate_cards, rate_card_entries' }]),
        makeDataRow([{ text: 'Routing' }, { text: 'routing_groups_cache, destination_sets_cache, routing_rules, routing_cache_meta, connection_vendor_cache2' }], '131929'),
        makeDataRow([{ text: 'Security & fraud' }, { text: 'fas_events, fas_vendor_settings, irsf_events, blacklist_rules, simbox_scores' }]),
        makeDataRow([{ text: 'Approvals' }, { text: 'approval_requests, approval_audit_log' }], '131929'),
        makeDataRow([{ text: 'AI Ops' }, { text: 'ai_ops_events, ai_ops_incidents, anomaly_events' }]),
        makeDataRow([{ text: 'Alerts & notifications' }, { text: 'alerts, alert_rules, traffic_alerts, whatsapp_alert_log, watcher_recipients' }], '131929'),
        makeDataRow([{ text: 'Infrastructure' }, { text: 'monitored_hosts, host_outage_log, outage_log, sbc_hosts' }]),
        makeDataRow([{ text: 'Team' }, { text: 'kams, kam_accounts, user_roles, user_config' }], '131929'),
        makeDataRow([{ text: 'Quality & testing' }, { text: 'vendor_metric_baselines, sla_breach_log, test_campaigns, test_campaign_results, call_test_logs' }]),
        makeDataRow([{ text: 'Commerce' }, { text: 'billing_disputes, reseller_profiles' }], '131929'),
        makeDataRow([{ text: 'Reporting & UX' }, { text: 'scheduled_reports, dashboard_widget_prefs, fix_history' }]),
        makeDataRow([{ text: 'Comms' }, { text: 'chat_rooms, chat_messages' }], '131929'),
        makeDataRow([{ text: 'Misc' }, { text: 'settings, api_keys, product_docs, number_lookup_cache' }]),
      ],
    }),
    spacer(),
    divider(),

    // ── PART 12: What Remains to Build ───────────────────────────────────────
    h1('PART 12 — Remaining Build Roadmap'),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['Priority', 'Feature', 'Effort', 'What\'s Needed']),
        makeDataRow([{ text: '🥇 1', color: GOLD }, { text: 'Scheduled Synthetic Testing' }, { text: 'Medium' }, { text: 'Server-side cron + existing test campaign tables + baseline comparison into AI Ops' }]),
        makeDataRow([{ text: '🥈 2', color: LIGHT_GY }, { text: 'Number Intelligence Enrichment' }, { text: 'Small' }, { text: 'One external provider API (Telnyx/Neustar) to populate cnam, hlr, stirShaken' }], '131929'),
        makeDataRow([{ text: '🥉 3', color: AMBER }, { text: 'Route Decision Trace' }, { text: 'Small-Med' }, { text: 'Log which routing rule fired, which carrier was selected, and why — per call' }]),
        makeDataRow([{ text: '4', color: MID_GY }, { text: 'Client Portal Isolation' }, { text: 'Medium' }, { text: 'Role-scoped query filtering — customer role sees only their iAccount data' }], '131929'),
        makeDataRow([{ text: '5', color: MID_GY }, { text: 'Compliance Dashboard' }, { text: 'Medium' }, { text: 'STIR/SHAKEN aggregation from CDRs, GDPR retention policy engine' }]),
        makeDataRow([{ text: '6', color: MID_GY }, { text: 'Unified Communications' }, { text: 'Large' }, { text: 'Teams Direct Routing + Zoom Phone REST API — new integration module' }], '131929'),
        makeDataRow([{ text: '⏸️ Deferred', color: ORANGE }, { text: 'SMS / A2P Monitor' }, { text: '—' }, { text: 'Tagged Coming Soon — build only when SMS traffic is live in system' }]),
      ],
    }),
    spacer(),

    // ── Footer note ───────────────────────────────────────────────────────────
    divider(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new TextRun({ text: `Bitsauto Monitoring Platform  ·  Feature Registry  ·  ${now}`, color: DARK_GY, size: 18 })],
    }),
  ];

  mkdirSync(path.dirname(outPath), { recursive: true });

  const doc = new Document({
    background: { color: DARK_BG },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'Bitsauto Platform Feature Registry — Confidential', color: DARK_GY, size: 16 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `Generated ${now}  ·  Bitsauto Monitoring Platform`, color: DARK_GY, size: 16 })],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outPath, buffer);
}
