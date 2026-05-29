import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer, SimpleField,
  NumberFormat,
} from 'docx';
import { writeFileSync } from 'fs';
import { join } from 'path';

// ── Bitsauto Brand Colour Palette ─────────────────────────────────────────────
const NAVY       = '0A1628';   // deepest background
const NAVY_MID   = '0D2040';   // table header / section banner bg
const NAVY_CARD  = '112240';   // card / info-row bg
const CYAN       = '00D4FF';   // primary accent — Bitsauto brand cyan
const CYAN_SOFT  = '38BDF8';   // secondary cyan for sub-headers
const TEAL       = '14B8A6';   // feature row labels
const GREEN      = '10B981';   // COMPLETE / success
const AMBER      = 'F59E0B';   // PARTIAL / warning
const ROSE       = 'F43F5E';   // PENDING / danger
const GOLD       = 'FFD700';   // accent numbers / tier callouts
const WHITE      = 'FFFFFF';
const LIGHT      = 'E2E8F0';   // body text
const SLATE      = 'CBD5E1';   // secondary body text
const MID        = '94A3B8';   // muted text
const DIM        = '475569';   // very muted / borders
const DIVIDER_C  = '1E3A5F';   // subtle horizontal rule colour

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

  // Tier 8 — Finance, Revenue Assurance & Platform Governance
  { tier: 8, id: 38, name: 'CDR Re-rating Engine',                       status: 'COMPLETE', notes: 'Flat-rate re-rating with scenario analysis, immutable run snapshots, revenue delta P&L comparison. Stored in cdr_rerate_runs table. Finance → Revenue Assurance nav entry.' },
  { tier: 8, id: 39, name: 'Finance Suite — Invoice Templates & Schedules', status: 'COMPLETE', notes: 'Invoice template builder, schedule engine, auto-invoice generation triggers. Wired into Finance workspace billing-ops module.' },
  { tier: 8, id: 40, name: 'Finance Suite — Credit Notes & Credit Control', status: 'COMPLETE', notes: 'Credit note issuance, credit control rule engine, per-account credit policies. Full audit trail via adjustment_ledger.' },
  { tier: 8, id: 41, name: 'Finance Suite — AI Revenue Assurance & Adjustment Ledger', status: 'COMPLETE', notes: 'AI-assisted revenue anomaly detection, adjustment ledger for all billing corrections. Covers migrations 015–018 fully wired across 4 governance modules.' },
  { tier: 8, id: 42, name: 'Platform Navigation Reorganization',          status: 'COMPLETE', notes: 'Domain-based top-nav shell with 9 domains, 29 groups (consolidated from 35), ~103 items. Removed 15 duplicates, collapsed aliases, renamed Company → Clients. WorkspaceShell tab-bar wraps 20 finance routes across 3 workspaces.' },
];

const BUG_FIXES = [
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
  'Fixed: BitsEye LIVE/DAILY/WEEKLY semantic drift — CDR accounting totals had replaced concurrent session snapshots in all entity graphs.',
  'Fixed: BitsEye LIVE+CALLS context banner claimed DAILY shows "CDR totals" — corrected to accurately describe DAILY as 72h concurrent trend.',
  'Fixed: Client Portal Total Calls=0 — global 200-record CDR cap excluded low-traffic accounts from /api/portal/view.',
  'Fixed: Sippy createAccount "Fatal error" (faultCode 501) when translation_rule format unsupported — new translation-rule strip cascade retries.',
  'Fixed: Portal Overview tab showed no live data — /api/portal/view now embeds full live call metrics in response.',
];

// ── Helper builders ───────────────────────────────────────────────────────────

function sectionBanner(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 360, after: 0 },
    shading: { type: ShadingType.SOLID, color: hex(NAVY_MID), fill: hex(NAVY_MID) },
    children: [
      new TextRun({ text: '  ' }),
      new TextRun({ text, color: CYAN, bold: true, size: 26 }),
    ],
  });
}

function sectionBannerSub(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 200 },
    shading: { type: ShadingType.SOLID, color: hex(NAVY_MID), fill: hex(NAVY_MID) },
    children: [
      new TextRun({ text: '  ' }),
      new TextRun({ text, color: SLATE, size: 18 }),
    ],
  });
}

function heading(text: string, level: HeadingLevel, colorHex = WHITE) {
  const sz = level === HeadingLevel.HEADING_1 ? 40 : level === HeadingLevel.HEADING_2 ? 30 : 24;
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 480 : 320, after: 140 },
    children: [new TextRun({ text, color: colorHex, bold: true, size: sz })],
  });
}

function para(text: string, opts: { bold?: boolean; color?: string; size?: number; indent?: number; spacing?: number } = {}) {
  return new Paragraph({
    indent: opts.indent ? { left: opts.indent } : undefined,
    spacing: { after: opts.spacing ?? 100 },
    children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? SLATE, size: opts.size ?? 20 })],
  });
}

function bullet(text: string, color = SLATE) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 70 },
    children: [new TextRun({ text, color, size: 19 })],
  });
}

function divider() {
  return new Paragraph({
    border: { bottom: { color: DIVIDER_C, style: BorderStyle.SINGLE, size: 6 } },
    spacing: { before: 240, after: 240 },
    children: [],
  });
}

function kpiRow(items: { label: string; value: string; color?: string }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideH: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideV: { style: BorderStyle.SINGLE, size: 4, color: DIVIDER_C },
    },
    rows: [
      new TableRow({
        children: items.map(item =>
          new TableCell({
            shading: { type: ShadingType.SOLID, color: hex(NAVY_CARD), fill: hex(NAVY_CARD) },
            width: { size: Math.floor(100 / items.length), type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 20 },
                children: [new TextRun({ text: item.value, color: item.color ?? CYAN, bold: true, size: 40 })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 120 },
                children: [new TextRun({ text: item.label, color: MID, size: 17 })],
              }),
            ],
          })
        ),
      }),
    ],
  });
}

function statusColor(s: string) {
  if (s === 'COMPLETE') return GREEN;
  if (s === 'PARTIAL')  return AMBER;
  return ROSE;
}

function statusBadge(s: string): TextRun {
  const map: Record<string, string> = { COMPLETE: '✔ COMPLETE', PARTIAL: '◑ PARTIAL', PENDING: '○ PENDING' };
  return new TextRun({ text: map[s] ?? s, color: statusColor(s), bold: true, size: 18 });
}

// Page geometry: Letter (12240 twips) - 2 * 1080 (0.75" margins) = 10080 usable twips
const PAGE_DXA = 10080;
function dxa(pct: number) { return Math.round(PAGE_DXA * pct / 100); }

const COL_W = {
  num:     dxa(5),
  feature: dxa(27),
  status:  dxa(11),
  notes:   PAGE_DXA - dxa(5) - dxa(27) - dxa(11),
};

function tierBannerRow(label: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        shading: { type: ShadingType.SOLID, color: hex(NAVY_MID), fill: hex(NAVY_MID) },
        children: [new Paragraph({
          spacing: { before: 80, after: 80 },
          children: [new TextRun({ text: `  ${label}`, color: CYAN_SOFT, bold: true, size: 20 })],
        })],
      }),
    ],
  });
}

function featureTable(features: typeof FEATURES, groupByTier = false): Table {
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
        shading: { type: ShadingType.SOLID, color: hex(NAVY), fill: hex(NAVY) },
        width: { size: width, type: WidthType.DXA },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 100, after: 100 },
          children: [
            new TextRun({ text: '  ' }),
            new TextRun({ text: label, bold: true, color: CYAN, size: 19 }),
          ],
        })],
      })
    ),
  });

  const tierLabels = ['', 'Core NOC Infrastructure', 'Analytics & Reporting', 'Operational Tools', 'Advanced Features', 'UX & Workflow', 'Latest Enhancements', 'Post-Release Improvements (May 2026)'];

  const dataRows: TableRow[] = [];
  let lastTier = -1;

  for (const f of features) {
    if (groupByTier && f.tier !== lastTier) {
      lastTier = f.tier;
      dataRows.push(tierBannerRow(`Tier ${f.tier} — ${tierLabels[f.tier]}`));
    }

    const isEven = dataRows.filter(r => !(r as any)._isBanner).length % 2 === 0;
    const rowBg  = isEven ? NAVY_CARD : NAVY_MID;

    dataRows.push(new TableRow({
      children: [
        new TableCell({
          width: { size: COL_W.num, type: WidthType.DXA },
          shading: { type: ShadingType.SOLID, color: hex(rowBg), fill: hex(rowBg) },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [new TextRun({ text: String(f.id), color: GOLD, bold: true, size: 18 })],
          })],
        }),
        new TableCell({
          width: { size: COL_W.feature, type: WidthType.DXA },
          shading: { type: ShadingType.SOLID, color: hex(rowBg), fill: hex(rowBg) },
          children: [new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({ text: f.name, color: WHITE, bold: true, size: 18 })],
          })],
        }),
        new TableCell({
          width: { size: COL_W.status, type: WidthType.DXA },
          shading: { type: ShadingType.SOLID, color: hex(rowBg), fill: hex(rowBg) },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [statusBadge(f.status)],
          })],
        }),
        new TableCell({
          width: { size: COL_W.notes, type: WidthType.DXA },
          shading: { type: ShadingType.SOLID, color: hex(rowBg), fill: hex(rowBg) },
          children: [new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({ text: f.notes, color: SLATE, size: 17 })],
          })],
        }),
      ],
    }));
  }

  return new Table({
    width: { size: PAGE_DXA, type: WidthType.DXA },
    borders: {
      top:     { style: BorderStyle.SINGLE, size: 4, color: DIVIDER_C },
      bottom:  { style: BorderStyle.SINGLE, size: 4, color: DIVIDER_C },
      left:    { style: BorderStyle.SINGLE, size: 4, color: DIVIDER_C },
      right:   { style: BorderStyle.SINGLE, size: 4, color: DIVIDER_C },
      insideH: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER_C },
      insideV: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER_C },
    },
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

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullet-list',
        levels: [{ level: 0, format: NumberFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DIVIDER_C } },
              spacing: { after: 120 },
              children: [
                new TextRun({ text: 'BITSAUTO MONITORING PLATFORM', color: CYAN, bold: true, size: 17 }),
                new TextRun({ text: '   ·   Platform Status Report   ·   ', color: DIM, size: 17 }),
                new TextRun({ text: dateStr, color: MID, size: 17 }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: { top: { style: BorderStyle.SINGLE, size: 6, color: DIVIDER_C } },
              spacing: { before: 120 },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Bitsauto Monitoring Platform  ·  Confidential — Internal Use Only  ·  Page ', color: DIM, size: 16 }),
                new SimpleField('PAGE'),
              ],
            }),
          ],
        }),
      },
      children: [

        // ── COVER ──────────────────────────────────────────────────────────────
        new Paragraph({
          spacing: { before: 240, after: 60 },
          children: [
            new TextRun({ text: 'BITSAUTO', color: CYAN, bold: true, size: 72 }),
            new TextRun({ text: '  MONITORING PLATFORM', color: WHITE, bold: true, size: 72 }),
          ],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: 'Platform Implementation Status Report', color: GOLD, bold: true, size: 40 })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: `Volume 1  ·  May 2026 Edition`, color: CYAN_SOFT, bold: true, size: 24 })],
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: `Generated: ${dateStr} at ${timeStr}`, color: MID, size: 19 })],
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: 'Sippy Softswitch — Full NOC, Analytics, Billing & Fraud Detection Suite', color: SLATE, size: 19 })],
        }),
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: CYAN } },
          spacing: { before: 200, after: 400 },
          children: [],
        }),

        // ── KPI SUMMARY CARDS ──────────────────────────────────────────────────
        kpiRow([
          { label: 'Total Features',  value: String(FEATURES.length),    color: CYAN  },
          { label: 'Complete',        value: String(complete),            color: GREEN },
          { label: 'Partial',         value: String(partial),             color: AMBER },
          { label: 'Completion Rate', value: `${Math.round(complete / FEATURES.length * 100)}%`, color: GOLD },
        ]),
        new Paragraph({ spacing: { after: 320 }, children: [] }),

        // ── EXECUTIVE SUMMARY ──────────────────────────────────────────────────
        sectionBanner('EXECUTIVE SUMMARY'),
        sectionBannerSub('Platform overview and delivery status'),

        para(
          `The Bitsauto Monitoring Platform is fully implemented across 7 delivery tiers, covering ${FEATURES.length} production features. ` +
          'The platform delivers real-time NOC monitoring, concurrent-session telemetry (BitsEye 2), revenue analytics, fraud detection ' +
          '(FAS/IRSF), rate-card management, KAM tooling, AI Ops incident correlation, Routing Intelligence, Client Self-Service Portal, ' +
          'mobile responsiveness, API key access, and a fully customisable widget dashboard.',
          { color: LIGHT, size: 21, spacing: 160 }
        ),
        para(
          'Tiers 1–6 represent the original Volume 1 scope. Tier 7 documents post-release improvements and architectural hardening ' +
          'applied in May 2026, including the BitsEye 2 telemetry rebuild, Sippy Load Reduction Architecture (~65-70% call reduction), ' +
          'and the Client Provisioning Wizard.',
          { color: SLATE, size: 20, spacing: 200 }
        ),

        para('Delivery breakdown:', { bold: true, color: WHITE, size: 20 }),
        bullet(`✔  Complete: ${complete} of ${FEATURES.length} features (${Math.round(complete / FEATURES.length * 100)}%)`, GREEN),
        ...(partial ? [bullet(`◑  Partial: ${partial} features`, AMBER)]  : []),
        ...(pending ? [bullet(`○  Pending: ${pending} features`, ROSE)]   : []),

        divider(),

        // ── TIER 7 UPDATE NOTE ─────────────────────────────────────────────────
        sectionBanner('TIER 7 — POST-RELEASE IMPROVEMENTS (MAY 2026)'),
        sectionBannerSub('Features and fixes implemented after the original Volume 1 documentation'),

        new Paragraph({ spacing: { after: 120 }, children: [] }),
        bullet('#29 — BitsEye 2: NOC Telemetry Rebuild — concurrent-session semantic correctness, LIVE / DAILY / WEEKLY modes', CYAN),
        bullet('#30 — BitsEye 2: Graph Context Subtitle System — per-chart semantic subtitle labels', CYAN),
        bullet('#31 — BitsEye 2: Metric-Source Contract — immutable data-source rules enforced in code comments', CYAN),
        bullet('#32 — Client Portal: CDR Data Fix — Total Calls=0 resolved via per-account cdrCache', CYAN),
        bullet('#33 — Client Portal: Enhanced Overview Tab — live KPI cards, pulse indicator, 36-min sparkline', CYAN),
        bullet('#34 — Provisioning: Translation Rule Cascade — createAccount "Fatal error" bypass via strip-and-retry', CYAN),
        bullet('#35 — Sippy Load Reduction Architecture — ~65-70% XML-RPC call reduction (push, cache, mutex, stagger)', CYAN),
        bullet('#36 — Client Provisioning Wizard — multi-step guided new-account setup with full cascade fallback', CYAN),
        bullet('#37 — Concurrent Snapshot Persistence — concurrent_snapshots DB table for DAILY / WEEKLY graph history', CYAN),

        divider(),

        // ── BUG FIXES ─────────────────────────────────────────────────────────
        sectionBanner('BUG FIXES APPLIED'),
        sectionBannerSub('All resolved defects across the full delivery period'),

        new Paragraph({ spacing: { after: 120 }, children: [] }),
        ...BUG_FIXES.map(b => bullet(b)),

        divider(),

        // ── FULL FEATURE MATRIX ────────────────────────────────────────────────
        sectionBanner('FULL FEATURE MATRIX'),
        sectionBannerSub('All 37 features across 7 tiers — grouped by tier'),

        new Paragraph({ spacing: { after: 180 }, children: [] }),
        featureTable(FEATURES, true),
        new Paragraph({ spacing: { after: 400 }, children: [] }),

        // ── FOOTER NOTE ────────────────────────────────────────────────────────
        new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: CYAN } },
          spacing: { before: 0, after: 100 },
          children: [],
        }),
        para('All features are implemented against the Sippy Softswitch platform. No VOS-3000 or generic SBC targets are in scope for Volume 1.', { color: DIM, size: 17 }),
        para(`This document was auto-generated by the Bitsauto Monitoring Platform on ${dateStr} at ${timeStr}.`, { color: DIM, size: 17 }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) writeFileSync(outputPath, buffer);
  return buffer;
}

export const STATUS_REPORT_PATH = '/tmp/VoIP_Platform_Volume1_Status.docx';

// ── Platform Feature Status Report (Department-Categorised) ───────────────────

const DEPT_SECTIONS: { dept: string; desc: string; color: string; ids: number[] }[] = [
  {
    dept: 'NOC',
    desc: 'Network Operations Center — real-time call monitoring, alerting, concurrent-session telemetry & mobile NOC view',
    color: GREEN,
    ids: [1, 4, 22, 29, 30, 31, 37],
  },
  {
    dept: 'Finance & Billing',
    desc: 'Revenue analytics, vendor balance tracking, rate card management, multi-vendor billing integration, CDR re-rating & finance governance suite',
    color: AMBER,
    ids: [6, 8, 11, 16, 38, 39, 40, 41],
  },
  {
    dept: 'Commercial',
    desc: 'KAM management, NOC viewer mode, monitoring assignments, client portal & client provisioning wizard',
    color: CYAN_SOFT,
    ids: [13, 14, 15, 32, 33, 36],
  },
  {
    dept: 'Fraud & Security',
    desc: 'Role-based access control, FAS fraud detection engine & API key management / external access control',
    color: ROSE,
    ids: [5, 12, 24],
  },
  {
    dept: 'Analytics',
    desc: 'CDR browser, ASR/ACD trend graphs, BitsEye traffic analytics, MOS widget, reports, traffic map & command bar',
    color: GOLD,
    ids: [2, 7, 9, 10, 17, 18, 19, 23, 25, 26, 27, 28],
  },
  {
    dept: 'Engineering',
    desc: 'Sippy XML-RPC integration, dashboard widgets, dark/light mode, translation rule cascade, load reduction architecture & platform navigation reorganization',
    color: TEAL,
    ids: [3, 20, 21, 34, 35, 42],
  },
];

function metaLine(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: `${label}  `, color: MID, size: 19, bold: true }),
      new TextRun({ text: value, color: SLATE, size: 19 }),
    ],
  });
}

export async function generatePlatformStatusReport(outputPath?: string): Promise<Buffer> {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  const featureById = new Map(FEATURES.map(f => [f.id, f]));
  const totalLive   = FEATURES.filter(f => f.status === 'COMPLETE').length;

  function statusRun(s: string): TextRun {
    if (s === 'COMPLETE') return new TextRun({ text: '  ✓ LIVE',    color: GREEN,     size: 17, bold: true });
    if (s === 'PARTIAL')  return new TextRun({ text: '  ◑ PARTIAL', color: AMBER,     size: 17, bold: true });
    return                       new TextRun({ text: '  ○ PLANNED', color: ROSE,      size: 17, bold: true });
  }

  const deptChildren: Paragraph[] = [];

  for (const { dept, desc, color, ids } of DEPT_SECTIONS) {
    const features = ids.flatMap(id => { const f = featureById.get(id); return f ? [f] : []; });
    const liveCount = features.filter(f => f.status === 'COMPLETE').length;

    deptChildren.push(
      // Department header banner
      new Paragraph({
        spacing: { before: 440, after: 0 },
        shading: { type: ShadingType.SOLID, color: hex(NAVY_MID), fill: hex(NAVY_MID) },
        children: [
          new TextRun({ text: '  ' }),
          new TextRun({ text: dept.toUpperCase(), color, bold: true, size: 27 }),
          new TextRun({ text: `   ${liveCount} / ${features.length} LIVE`, color: MID, size: 18 }),
        ],
      }),
      new Paragraph({
        spacing: { before: 0, after: 180 },
        shading: { type: ShadingType.SOLID, color: hex(NAVY_MID), fill: hex(NAVY_MID) },
        children: [
          new TextRun({ text: '  ' }),
          new TextRun({ text: desc, color: SLATE, size: 17 }),
        ],
      }),
      // Feature rows
      ...features.flatMap(f => [
        new Paragraph({
          spacing: { before: 100, after: 20 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: `[${String(f.id).padStart(2, '0')}]  `, color: DIM, size: 18, bold: true }),
            new TextRun({ text: f.name, color: WHITE, size: 19, bold: true }),
            statusRun(f.status),
          ],
        }),
        new Paragraph({
          spacing: { before: 0, after: 100 },
          indent: { left: 560 },
          children: [new TextRun({ text: f.notes, color: SLATE, size: 17 })],
        }),
      ]),
    );
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullet-list',
        levels: [{ level: 0, format: NumberFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DIVIDER_C } },
            spacing: { after: 100 },
            children: [
              new TextRun({ text: 'BITSAUTO', color: CYAN, bold: true, size: 17 }),
              new TextRun({ text: '   ·   VoIP Monitoring Platform   ·   Feature Status Report   ·   ', color: DIM, size: 17 }),
              new TextRun({ text: dateStr, color: MID, size: 17 }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 6, color: DIVIDER_C } },
            spacing: { before: 100 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Bitsauto VoIP Monitoring Platform  ·  Confidential — Internal Use Only  ·  Page ', color: DIM, size: 16 }),
              new SimpleField('PAGE'),
            ],
          })],
        }),
      },
      children: [

        // ── COVER ──────────────────────────────────────────────────────────────
        new Paragraph({
          spacing: { before: 560, after: 80 },
          children: [new TextRun({ text: 'BITSAUTO', color: CYAN, bold: true, size: 104 })],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: 'VoIP Monitoring Platform', color: WHITE, bold: true, size: 56 })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: 'Department-Categorised Implementation Status & Roadmap Report', color: SLATE, size: 30 })],
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: 'NOC  ·  Finance & Billing  ·  Commercial  ·  Fraud & Security  ·  Analytics  ·  Engineering', color: CYAN_SOFT, size: 22 })],
        }),
        divider(),
        metaLine('Report Date:', dateStr),
        metaLine('Platform:', 'Sippy Softswitch / VoIP NOC Dashboard'),
        metaLine('App URL:', 'https://vo-ip-watcher--junaid70.replit.app'),
        metaLine('Stack:', 'React 18 + Vite + Express + PostgreSQL (Drizzle ORM) + Replit Auth OIDC'),
        metaLine('Prepared by:', 'BitsAuto Engineering'),
        metaLine('Classification:', 'Internal — Confidential'),
        divider(),

        // ── SUMMARY ────────────────────────────────────────────────────────────
        sectionBanner('IMPLEMENTATION SUMMARY'),
        sectionBannerSub(`${totalLive} of ${FEATURES.length} features LIVE across 6 departments  ·  Generated ${dateStr} at ${timeStr}`),
        new Paragraph({
          spacing: { before: 220, after: 120 },
          children: [
            new TextRun({ text: `${totalLive}`, color: GREEN, bold: true, size: 56 }),
            new TextRun({ text: '  features LIVE   ', color: MID, size: 26 }),
            new TextRun({ text: `${FEATURES.length - totalLive}`, color: AMBER, bold: true, size: 56 }),
            new TextRun({ text: '  in development', color: MID, size: 26 }),
          ],
        }),
        para('All features are tracked by department below. Each entry shows the feature name, implementation status, and technical notes.', { color: SLATE }),

        // ── DEPARTMENT SECTIONS ────────────────────────────────────────────────
        ...deptChildren,

        // ── BUG FIXES ──────────────────────────────────────────────────────────
        sectionBanner('BUG FIXES & PLATFORM IMPROVEMENTS'),
        sectionBannerSub('Resolved issues and quality improvements shipped alongside feature work'),
        ...BUG_FIXES.map(fix => bullet(fix)),

        // ── CLOSING ────────────────────────────────────────────────────────────
        divider(),
        para(`This report was auto-generated by the Bitsauto Monitoring Platform on ${dateStr} at ${timeStr}.`, { color: DIM, size: 17 }),
        para('All features are implemented against the Sippy Softswitch platform. Classification: Internal — Confidential.', { color: DIM, size: 17 }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) writeFileSync(outputPath, buffer);
  return buffer;
}

export const PLATFORM_STATUS_REPORT_PATH = '/tmp/BitsAuto_Platform_Feature_Status.docx';
