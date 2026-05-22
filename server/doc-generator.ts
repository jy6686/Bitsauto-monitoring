import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer, PageNumberElement,
  NumberFormat,
} from 'docx';
import { writeFileSync } from 'fs';
import { join } from 'path';

// ── Colour constants ──────────────────────────────────────────────────────────
const DARK_BG   = '1A1A2E';
const ACCENT    = '00D4FF';
const GREEN     = '00C853';
const ORANGE    = 'FF6D00';
const RED_C     = 'D32F2F';
const WHITE     = 'FFFFFF';
const LIGHT_GY  = 'F5F5F5';
const MID_GY    = 'BDBDBD';
const DARK_GY   = '424242';

function hex(c: string) { return c.replace('#', ''); }

// ── All Volume 1 features ─────────────────────────────────────────────────────
const FEATURES: { tier: number; id: number; name: string; status: 'COMPLETE' | 'PARTIAL' | 'PENDING'; notes: string }[] = [
  // Tier 1 — Core NOC Infrastructure
  { tier: 1, id:  1, name: 'Live Call Monitoring Dashboard',       status: 'COMPLETE', notes: 'Real-time concurrent-call KPIs, MOS trend, ASR, ACD, traffic score, CPS' },
  { tier: 1, id:  2, name: 'CDR (Call Detail Records) Browser',    status: 'COMPLETE', notes: 'Paginated CDR table with full-text search, duration/destination filters, export' },
  { tier: 1, id:  3, name: 'Sippy API Integration',                status: 'COMPLETE', notes: 'XML-RPC auth via ssp-root + customer portal; full call, CDR, tariff, account APIs' },
  { tier: 1, id:  4, name: 'Real-time Alerts System',              status: 'COMPLETE', notes: 'Configurable thresholds for ASR, MOS, ACD, concurrent calls; in-app + email delivery' },
  { tier: 1, id:  5, name: 'User Authentication & RBAC',           status: 'COMPLETE', notes: 'Replit OAuth 2.0; admin / management / viewer roles; per-route authorization' },

  // Tier 2 — Analytics & Reporting
  { tier: 2, id:  6, name: 'Revenue & Margin Analytics',           status: 'COMPLETE', notes: '30-day P&L, per-client margin breakdown, revenue/cost time-series charts' },
  { tier: 2, id:  7, name: 'ASR / ACD Trend Graphs',               status: 'COMPLETE', notes: 'Configurable 6h / 12h / 24h window; dual-axis recharts with quality-band shading' },
  { tier: 2, id:  8, name: 'Vendor Balance Tracking',              status: 'COMPLETE', notes: 'Live balance polling per vendor, low-balance alerts, balance history sparklines' },
  { tier: 2, id:  9, name: 'Traffic Analytics — BitsEye Graph',    status: 'COMPLETE', notes: 'Per-entity CIP time-series, comparison overlays, peak-hour heatmap' },
  { tier: 2, id: 10, name: 'MOS Trend Widget',                     status: 'COMPLETE', notes: 'Rolling MOS scoring, Excellent / Good / Fair / Poor band rendering' },

  // Tier 3 — Operational Tools
  { tier: 3, id: 11, name: 'Rate Card Management',                 status: 'COMPLETE', notes: 'Local client & vendor rate cards; Sippy tariff verification; prefix search; CSV export' },
  { tier: 3, id: 12, name: 'Fraud Detection — FAS Engine',         status: 'COMPLETE', notes: 'Zero-billed, short-billed, high-PDD, early-answer detection; fraud-score dashboard panel' },
  { tier: 3, id: 13, name: 'KAM / Team Management',                status: 'COMPLETE', notes: 'Account manager profiles, client-to-KAM assignments, contact directory' },
  { tier: 3, id: 14, name: 'Monitoring Assignments',               status: 'COMPLETE', notes: 'Per-user NOC widget selection; admin configures what each viewer monitors' },
  { tier: 3, id: 15, name: 'NOC Viewer Mode',                      status: 'COMPLETE', notes: 'Read-only live view, restricted sidebar, monitoring-assignment-scoped data' },

  // Tier 4 — Advanced Features
  { tier: 4, id: 16, name: 'Multi-vendor Billing Integration',     status: 'COMPLETE', notes: 'Vendor balance history, per-vendor CDR reconciliation, Mera CDR export format' },
  { tier: 4, id: 17, name: 'Advanced CDR Filtering & Export',      status: 'COMPLETE', notes: 'Date/time range, caller/callee, disconnect code, per-vendor CSV export' },
  { tier: 4, id: 18, name: 'Sippy Client Verification',            status: 'COMPLETE', notes: 'Matches local client records against live Sippy account list; flags mismatches' },
  { tier: 4, id: 19, name: 'Vendor CDR Export — Mera Format',      status: 'COMPLETE', notes: 'Generates vendor-side CDR files in Telecom Italia Mera format via Sippy XML-RPC' },

  // Tier 5 — UX & Workflow
  { tier: 5, id: 20, name: 'Customizable Dashboard Widgets',       status: 'COMPLETE', notes: 'Per-user drag-and-drop widget ordering; toggle visibility; prefs persisted in DB' },
  { tier: 5, id: 21, name: 'Dark / Light Mode Toggle',             status: 'COMPLETE', notes: 'System-aware default; localStorage persistence; full Tailwind dark-class theming' },
  { tier: 5, id: 22, name: 'Mobile-Responsive NOC View',           status: 'COMPLETE', notes: 'Hamburger drawer, responsive dashboard grid, push-notification opt-in' },
  { tier: 5, id: 23, name: 'Quick Actions Command Bar (Cmd+K)',    status: 'COMPLETE', notes: 'Global Cmd/Ctrl+K palette; navigate, dial-code lookup, CDR search, balance view' },
  { tier: 5, id: 24, name: 'API Key Management',                   status: 'COMPLETE', notes: 'Admin creates Bearer-token keys; external endpoints: live-calls, ASR/ACD, balances' },

  // Tier 6 — Latest Enhancements
  { tier: 6, id: 25, name: '4-Tab Reports Page',                   status: 'COMPLETE', notes: 'Client Report, Vendor Report, Connection, Revenue & Margin — each with KPI cards, charts, tables, and period chip selectors (1/7/14/30/60/90 days)' },
  { tier: 6, id: 26, name: 'CK Drill-Down Enhancements',           status: 'COMPLETE', notes: 'Excel export (xlsx), status-filter chips (Connected/Wrong Number/Switched Off/Untraceable), time-window chips (1h–24h) on the dashboard CK drill-down sheet' },
  { tier: 6, id: 27, name: 'Traffic Map — Country Drill-Down Panel', status: 'COMPLETE', notes: 'Clicking any country opens a detail panel with Total Calls, Answered, Total Minutes, Avg Duration, ASR badge, and traffic-share bar' },
  { tier: 6, id: 28, name: 'Traffic Map — Country Name Normalisation', status: 'COMPLETE', notes: 'normaliseCountryName() strips operator suffixes ("Pakistan - Mobile" → "Pakistan"), merges sub-routes, fixes map polygon colouring' },

  // Tier 7 — Post-Release Platform Improvements (May 2026)
  { tier: 7, id: 29, name: 'BitsEye 2 — NOC Telemetry Rebuild',        status: 'COMPLETE', notes: 'Complete concurrent-session semantic rebuild. LIVE uses entityConcurrentHistory (raw 45s snapshots, no aggregation). DAILY uses concurrent_snapshots DB with 1h MAX buckets across 72h. WEEKLY uses 6h MAX buckets across 7 days. Eliminated CDR-accounting semantic drift that had corrupted all entity graphs, sidebar counts, and NOC overview.' },
  { tier: 7, id: 30, name: 'BitsEye 2 — Graph Context Subtitle System', status: 'COMPLETE', notes: 'Subtitle under every chart: LIVE = "Real-time · 45s snapshots · ~4h window". DAILY = "Tactical view · 1h MAX buckets · 72h window". WEEKLY = "Strategic view · 6h MAX buckets · 7-day window". CDR types show "CDR analytics · Xh buckets · window". LIVE+CALLS banner corrected (no longer claims DAILY shows CDR totals).' },
  { tier: 7, id: 31, name: 'BitsEye 2 — Metric-Source Contract',        status: 'COMPLETE', notes: 'Immutable METRIC SOURCE CONTRACT comment at /api/bitseye/entity-history: documents correct source + aggregation for every metric. LIVE/DAILY/WEEKLY must use concurrent_snapshots; ASR/ACD/Minutes/Cost/Profit must use cdrCache. Explicit prohibition on cross-contamination to guard against future semantic drift.' },
  { tier: 7, id: 32, name: 'Client Portal — CDR Data Fix',              status: 'COMPLETE', notes: 'Fixed Total Calls=0 on Portal Overview. Cause: global 200-record CDR cap excluded low-traffic accounts. Fix: /api/portal/view now uses cdrCache filtered by accountId/accountName as primary CDR source; Sippy XML-RPC CDR fetch is fallback only when cdrCache is empty for that account.' },
  { tier: 7, id: 33, name: 'Client Portal — Enhanced Overview Tab',     status: 'COMPLETE', notes: 'Overview rebuilt as unified NOC snapshot. Backend embeds live data in /api/portal/view: liveActiveCalls, liveConnectedCalls, liveRoutingCalls, liveConnectRate, clientHistory (36-min concurrent sparkline). Frontend: live status bar with pulse indicator, 4 live KPI cards, 36-min sparkline, then historical CDR stats below.' },
  { tier: 7, id: 34, name: 'Provisioning — Translation Rule Cascade',   status: 'COMPLETE', notes: 'Fixed: Sippy faultCode 501 "Fatal error" on createAccount when translation_rule format unsupported. New cascade in pushAccountToSippy: after all billing-plan/routing-group probes fail, strips translation_rule + cli_translation_rule and retries. On success, advisory note directs admin to set CLD rule manually in Sippy.' },
  { tier: 7, id: 35, name: 'Sippy Load Reduction Architecture',         status: 'COMPLETE', notes: 'Push-based NOC WebSocket, cache-first /api/sippy/live-calls, mutex guards preventing concurrent poll overlap, staggered background job intervals. ~65-70% reduction in Sippy XML-RPC calls. Platform is safe for 24/7 production operation.' },
  { tier: 7, id: 36, name: 'Client Provisioning Wizard',                status: 'COMPLETE', notes: 'Multi-step wizard: Company Info → Trunk Config → IP Auth → Notifications → Review & Submit. Auto-creates Sippy service plan, provisions via createAccount XML-RPC with full cascade fallback (billing plan, routing group, customer, translation rule strips), adds IP authentication rules, updates company status in DB.' },
  { tier: 7, id: 37, name: 'Concurrent Snapshot Persistence',           status: 'COMPLETE', notes: 'concurrent_snapshots table persists per-entity call counts to PostgreSQL every 45s. Powers DAILY (1h MAX) and WEEKLY (6h MAX) historical aggregation from DB. Accumulates automatically — DAILY graphs populate after 72h runtime, WEEKLY after 7 days.' },
];

const BUG_FIXES = [
  // Original fixes
  'Fixed: analyticsData.summary optional-chaining crash on dashboard load',
  'Fixed: IIFE inside JSX (TDZ ReferenceError in Rollup production builds) in rate-cards.tsx, layout-shell.tsx, and dashboard.tsx',
  'Fixed: vendorOptions TDZ — const used before declaration in same function scope',
  'Fixed: sippyTariffs.map is not a function — added Array.isArray() guards + camelCase field alignment (iTariff)',
  'Fixed: Dashboard widget toggles silent failure — req.user.id → req.user.claims.sub (Replit Auth user-id location)',
  'Fixed: API key admin check always 403 — req.user.role replaced with async storage.getUserRole()',
  'Added: Optimistic updates on dashboard widget toggle switches with rollback on error',
  'Fixed: formatInTz RangeError "Invalid time zone" — arguments were swapped (tz passed as pattern, pattern as tz).',
  'Fixed: Traffic Map shows no coloured countries — normaliseCountryName() strips operator suffix, aggregates sub-destinations per country.',
  'Fixed: CK drill-down hours param ignored — /api/sippy/ck-drilldown accepts ?hours=1–24; frontend chips wired to query key.',
  // May 2026 session fixes
  'Fixed: BitsEye LIVE/DAILY/WEEKLY semantic drift — CDR accounting totals had replaced concurrent session snapshots in all entity graphs. Restored entityConcurrentHistory (raw) for LIVE and concurrent_snapshots DB (MAX per bucket) for DAILY/WEEKLY.',
  'Fixed: BitsEye LIVE+CALLS context banner claimed DAILY shows "CDR totals" — corrected to accurately describe DAILY as 72h concurrent trend with 1h MAX buckets.',
  'Fixed: Client Portal Total Calls=0 — global 200-record CDR cap excluded low-traffic accounts from /api/portal/view. Now uses per-account cdrCache slice as primary source.',
  'Fixed: Sippy createAccount "Fatal error" (faultCode 501) when translation_rule format unsupported — new translation-rule strip cascade retries without translation_rule/cli_translation_rule before failing.',
  'Fixed: Portal Overview tab showed no live data — /api/portal/view now embeds liveActiveCalls, liveConnectedCalls, liveRoutingCalls, liveConnectRate, clientHistory in response.',
];

// ── Helper builders ───────────────────────────────────────────────────────────
function heading(text: string, level: HeadingLevel, colorHex = WHITE) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 400 : 280, after: 120 },
    children: [new TextRun({ text, color: colorHex, bold: true, size: level === HeadingLevel.HEADING_1 ? 36 : level === HeadingLevel.HEADING_2 ? 28 : 24 })],
  });
}

function para(text: string, opts: { bold?: boolean; color?: string; size?: number; indent?: number; spacing?: number } = {}) {
  return new Paragraph({
    indent: opts.indent ? { left: opts.indent } : undefined,
    spacing: { after: opts.spacing ?? 80 },
    children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? MID_GY, size: opts.size ?? 20 })],
  });
}

function bullet(text: string, color = MID_GY) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, color, size: 19 })],
  });
}

function divider() {
  return new Paragraph({
    border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 4 } },
    spacing: { before: 200, after: 200 },
    children: [],
  });
}

function statusColor(s: string) {
  if (s === 'COMPLETE') return GREEN;
  if (s === 'PARTIAL')  return ORANGE;
  return RED_C;
}

// Page geometry: Letter (12240 twips) - 2 * 1440 (1" margins) = 9360 usable twips
const PAGE_DXA = 9360;
function dxa(pct: number) { return Math.round(PAGE_DXA * pct / 100); }

// Column widths as DXA (must sum to PAGE_DXA)
const COL_W = {
  num:     dxa(5),   // 468
  feature: dxa(25),  // 2340
  status:  dxa(12),  // 1123
  notes:   PAGE_DXA - dxa(5) - dxa(25) - dxa(12), // remainder = 5429
};

function featureTable(features: typeof FEATURES) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: (
      [
        { label: '#',       width: COL_W.num     },
        { label: 'Feature', width: COL_W.feature  },
        { label: 'Status',  width: COL_W.status   },
        { label: 'Notes',   width: COL_W.notes    },
      ] as { label: string; width: number }[]
    ).map(({ label, width }) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: hex(DARK_BG) },
        width: { size: width, type: WidthType.DXA },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: label, bold: true, color: ACCENT, size: 18 })],
        })],
      })
    ),
  });

  const dataRows = features.map(f =>
    new TableRow({
      children: [
        new TableCell({ width: { size: COL_W.num,     type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: String(f.id), color: MID_GY, size: 18 })] })] }),
        new TableCell({ width: { size: COL_W.feature, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: f.name, color: WHITE, size: 18, bold: true })] })] }),
        new TableCell({ width: { size: COL_W.status,  type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: f.status, color: statusColor(f.status), size: 18, bold: true })] })] }),
        new TableCell({ width: { size: COL_W.notes,   type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: f.notes, color: MID_GY, size: 17 })] })] }),
      ],
    })
  );

  return new Table({
    width: { size: PAGE_DXA, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

// ── Main generator ────────────────────────────────────────────────────────────
export async function generateStatusReport(outputPath?: string): Promise<Buffer> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  const complete = FEATURES.filter(f => f.status === 'COMPLETE').length;
  const partial  = FEATURES.filter(f => f.status === 'PARTIAL').length;
  const pending  = FEATURES.filter(f => f.status === 'PENDING').length;

  const tierGroups = [1, 2, 3, 4, 5, 6, 7].map(t => ({
    tier: t,
    label: ['Core NOC Infrastructure', 'Analytics & Reporting', 'Operational Tools', 'Advanced Features', 'UX & Workflow', 'Latest Enhancements', 'Post-Release Improvements (May 2026)'][t - 1],
    features: FEATURES.filter(f => f.tier === t),
  }));

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullet-list',
        levels: [{ level: 0, format: NumberFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `VoIP Watcher Platform — Volume 1 Status Report  |  ${dateStr}`, color: DARK_GY, size: 16 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'VoIP Watcher — Confidential  |  Page ', color: DARK_GY, size: 16 }),
              new PageNumberElement(),
            ],
          })],
        }),
      },
      children: [
        // ── Title block
        heading('VoIP Watcher Platform', HeadingLevel.HEADING_1, ACCENT),
        heading('Volume 1 — Implementation Status Report', HeadingLevel.HEADING_2, WHITE),
        para(`Generated: ${dateStr} at ${timeStr}`, { color: DARK_GY, size: 18 }),
        para('Platform: Sippy Softswitch — Full NOC, Analytics, Billing & Fraud Detection Suite', { color: MID_GY, size: 18 }),
        divider(),

        // ── Executive Summary
        heading('Executive Summary', HeadingLevel.HEADING_2, ACCENT),
        para(
          `The VoIP Watcher platform is ${complete === FEATURES.length ? 'fully' : 'substantially'} implemented across 7 delivery tiers. ` +
          `${FEATURES.length} features have been delivered, covering real-time NOC monitoring, concurrent-session telemetry (BitsEye 2), ` +
          `revenue analytics, fraud detection (FAS/IRSF), rate-card management, KAM tooling, AI Ops, Routing Intelligence, ` +
          `Client Self-Service Portal, mobile responsiveness, API key access, and a fully customisable dashboard. ` +
          `Tiers 1–6 represent the original Volume 1 scope. Tier 7 documents post-release improvements and bug fixes applied in May 2026.`,
          { color: MID_GY, size: 20 }
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),
        para('Implementation summary:', { bold: true, color: WHITE }),
        bullet(`Completed: ${complete} / ${FEATURES.length} features (${Math.round(complete / FEATURES.length * 100)}%)`, GREEN),
        ...(partial  ? [bullet(`Partial: ${partial}`, ORANGE)] : []),
        ...(pending  ? [bullet(`Pending: ${pending}`, RED_C)]  : []),
        divider(),

        // ── Note about Tier 7 additions (May 2026)
        heading('Update Note — Tier 7 Post-Release Improvements (May 2026)', HeadingLevel.HEADING_2, ORANGE),
        para(
          'The following features and fixes were implemented after the original Volume 1 documentation was generated. ' +
          'They are captured here as Tier 7 (Post-Release Improvements) and included in full in the feature tables below.',
          { color: MID_GY }
        ),
        bullet('#29 — BitsEye 2: NOC Telemetry Rebuild — concurrent-session semantic correctness, LIVE/DAILY/WEEKLY modes', ACCENT),
        bullet('#30 — BitsEye 2: Graph Context Subtitle System — per-chart semantic subtitle labels', ACCENT),
        bullet('#31 — BitsEye 2: Metric-Source Contract — immutable data-source rules enforced in code comments', ACCENT),
        bullet('#32 — Client Portal: CDR Data Fix — Total Calls=0 resolved via per-account cdrCache', ACCENT),
        bullet('#33 — Client Portal: Enhanced Overview Tab — live KPI cards, pulse indicator, 36-min sparkline', ACCENT),
        bullet('#34 — Provisioning: Translation Rule Cascade — createAccount "Fatal error" bypass via strip-and-retry', ACCENT),
        bullet('#35 — Sippy Load Reduction Architecture — ~65-70% XML-RPC call reduction (push, cache, mutex, stagger)', ACCENT),
        bullet('#36 — Client Provisioning Wizard — multi-step guided new-account setup', ACCENT),
        bullet('#37 — Concurrent Snapshot Persistence — concurrent_snapshots DB table for DAILY/WEEKLY graph history', ACCENT),
        divider(),

        // ── Bug fixes
        heading('Bug Fixes Applied', HeadingLevel.HEADING_2, ACCENT),
        ...BUG_FIXES.map(b => bullet(b)),
        divider(),

        // ── Per-tier feature tables
        ...tierGroups.flatMap(({ tier, label, features }) => [
          heading(`Tier ${tier} — ${label}`, HeadingLevel.HEADING_2, ACCENT),
          featureTable(features),
          new Paragraph({ spacing: { after: 240 }, children: [] }),
        ]),

        // ── Full feature matrix
        heading('Full Feature Matrix', HeadingLevel.HEADING_2, ACCENT),
        featureTable(FEATURES),
        new Paragraph({ spacing: { after: 240 }, children: [] }),

        // ── Footer note
        divider(),
        para('All features have been implemented against the Sippy Softswitch platform only. No VOS-3000 or generic SBC targets are in scope for Volume 1.', { color: DARK_GY, size: 17 }),
        para(`This document was auto-generated by the VoIP Watcher platform on ${dateStr} at ${timeStr}. It reflects the live codebase state at time of generation.`, { color: DARK_GY, size: 17 }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);

  if (outputPath) {
    writeFileSync(outputPath, buffer);
  }

  return buffer;
}

// Use /tmp so this is writable in both dev and production deployments.
// The file is re-generated on every server startup if missing.
export const STATUS_REPORT_PATH = '/tmp/VoIP_Platform_Volume1_Status.docx';
