/**
 * Routing Features Plan — Document Generator
 *
 * Generates a professional .docx covering all 9 Sippy routing features:
 * 5 high-value + 2 medium-value + 2 (additional) — each with description,
 * implementation scope, Sippy API methods, and current status.
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, Header, Footer, PageBreak,
} from 'docx';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export const ROUTING_FEATURES_PATH = path.join(process.cwd(), 'generated_docs', 'Bitsauto_Routing_Features_Plan.docx');

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
      text, bold: opts.bold, color: opts.color ?? MID_GY,
      size: opts.size ?? 20, italics: opts.italic,
    })],
  });
}
function bullet(text: string, color = MID_GY, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 70 },
    children: [new TextRun({ text, color, size: 19 })],
  });
}
function blank(before = 80, after = 80) {
  return new Paragraph({ spacing: { before, after }, children: [] });
}
function divider(color = DARK_GY) {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color, space: 1 } },
    children: [],
  });
}

// Status badge text
function statusText(status: 'DONE' | 'PARTIAL' | 'PLANNED') {
  const map = { DONE: '✔ IMPLEMENTED', PARTIAL: '◑ PARTIAL', PLANNED: '○ PLANNED' };
  const col  = { DONE: GREEN, PARTIAL: AMBER, PLANNED: ROSE };
  return new TextRun({ text: map[status], color: col[status], bold: true, size: 18 });
}

// Two-column info table (label | value)
function infoTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:           { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      bottom:        { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      left:          { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      right:         { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      insideH:       { style: BorderStyle.SINGLE, size: 2, color: DARK_GY },
      insideV:       { style: BorderStyle.SINGLE, size: 2, color: DARK_GY },
    },
    rows: rows.map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            shading: { type: 'solid' as any, color: '1A2233', fill: '1A2233' },
            children: [new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [new TextRun({ text: label, color: ACCENT, bold: true, size: 18 })],
            })],
          }),
          new TableCell({
            width: { size: 78, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [new TextRun({ text: value, color: LIGHT_GY, size: 18 })],
            })],
          }),
        ],
      })
    ),
  });
}

// ── Feature definitions ────────────────────────────────────────────────────────
type FeatureTier = 'HIGH' | 'MEDIUM';
interface RoutingFeature {
  num:        number;
  tier:       FeatureTier;
  name:       string;
  tagline:    string;
  status:     'DONE' | 'PARTIAL' | 'PLANNED';
  description: string;
  whatYouSee:  string[];
  sippyApi:    string[];
  localDb:     string[];
  route:       string;
  effort:      string;
}

const FEATURES: RoutingFeature[] = [
  {
    num: 1, tier: 'HIGH',
    name: 'Routing Group Manager',
    tagline: 'Live view of all routing groups, their policies, and member connections',
    status: 'PARTIAL',
    description:
      'View all routing groups from the switch in real-time. See each group\'s assigned routing policy ' +
      '(Least Cost / Prefix Length / Route Preference / Routing Entries Order / Weighted), which accounts ' +
      'or customers are assigned to it, and which connections are its members. Currently routing group names ' +
      'are only visible inside the Call Flow Simulator — this feature gives them a dedicated management view.',
    whatYouSee: [
      'Full list of routing groups with policy badges',
      'Member connections per group (vendor name, host, protocol)',
      'Account/customer assignments per routing group',
      'On-Net routing indicator + voicemail connection',
      'Safe-to-delete flag (no account assigned)',
      'Inline search and policy filter',
    ],
    sippyApi: [
      'listRoutingGroups(name_pattern, include_members_count)',
      'listRoutingGroupMembers(i_routing_group)',
      'listAccounts(i_routing_group) — accounts assigned to this group',
    ],
    localDb: [
      'routing_groups_cache — synced every 15 min via routing-cache service',
      'connection_vendor_cache2 — used to resolve connection names',
    ],
    route: '/routing-manager',
    effort: '1–2 days (live member/account join already scaffolded)',
  },
  {
    num: 2, tier: 'HIGH',
    name: 'Destination Set Explorer',
    tagline: 'Browse all Destination Sets and their prefixes; click any prefix to run LCR',
    status: 'PARTIAL',
    description:
      'Browse every Destination Set stored on the switch and expand into the individual route prefixes inside ' +
      'each set. Click any prefix to instantly fire it through the LCR Analyser, showing which vendors cover ' +
      'that prefix and at what cost. Also highlights coverage gaps — prefixes present in one vendor\'s routes ' +
      'but missing from others, which is critical for redundancy audits.',
    whatYouSee: [
      'Tree view of Destination Sets → child prefixes',
      'Route count per set with coverage-gap indicator',
      'CLD and CLI translation rules displayed inline',
      'One-click LCR run for any prefix',
      'Gap analysis: which prefixes lack a backup vendor',
    ],
    sippyApi: [
      'listDestinationSets(name_pattern)',
      'listDestinationSetRoutes(i_destination_set)',
    ],
    localDb: [
      'destination_sets_cache — synced every 15 min',
    ],
    route: '/routing-manager → Destination Sets tab',
    effort: '2–3 days (prefix route fetch + LCR hook)',
  },
  {
    num: 3, tier: 'HIGH',
    name: 'Quality-Based Routing (QBR) Dashboard',
    tagline: 'Which connections QBR has blocked or demoted, and why',
    status: 'PLANNED',
    description:
      'Sippy\'s QBR engine continuously monitors each vendor connection on ACD, ASR, and PDD thresholds. ' +
      'When a connection falls below the configured threshold it can be demoted (lower preference) or fully blocked. ' +
      'This dashboard surfaces that data in one place: which connections are currently blocked or demoted by QBR, ' +
      'their current statistics vs the configured thresholds, the retry batch countdown timer, and one-click ' +
      'unblock actions. Right now this data is buried deep in the Sippy web portal.',
    whatYouSee: [
      'Connection health grid: ACD / ASR / PDD vs threshold (RAG status)',
      'Blocked connections list with block reason and timestamp',
      'Demoted connections with current preference position',
      'Retry batch countdown (next evaluation window)',
      'One-click unblock / reset action (admin only)',
      'Historical block/demote event log (last 7 days)',
    ],
    sippyApi: [
      'listConnections(i_vendor) — has qbr_enabled, qbr_acd_threshold etc.',
      'getConnectionStatistics(i_connection) — current ACD/ASR/PDD window',
      'listActiveCalls() — used to correlate live traffic with QBR state',
    ],
    localDb: [
      'connection_vendor_cache2 — base connection data',
      'New: qbr_events table for historical block/demote log',
    ],
    route: '/routing-manager → QBR tab (planned)',
    effort: '3–4 days',
  },
  {
    num: 4, tier: 'HIGH',
    name: 'Routing Audit Trail',
    tagline: 'Full call routing trace: Account → Routing Group → Destination Set → Connection → Result',
    status: 'PARTIAL',
    description:
      'An enhanced version of the existing Call Flow Simulator backed by live Sippy data from the routing cache. ' +
      'Shows the complete routing path for any call: which account initiated it, which routing group was resolved, ' +
      'which destination sets were evaluated, which connections were tried (in preference order), and the final ' +
      'disposition (answered / failed / failover). Acts as an audit log for regulatory compliance and dispute resolution.',
    whatYouSee: [
      'Step-by-step routing trace with timestamps',
      'Account → Routing Group resolution diagram',
      'Destination Set match (longest-prefix) highlighted',
      'Connection preference order with QBR state at call time',
      'Final result: answered on which connection, or fail reason',
      'Export as PDF for dispute resolution',
    ],
    sippyApi: [
      'getCustomerCDRs(i_account) — retrieve historical calls',
      'listRoutingGroupMembers(i_routing_group) — connection order',
    ],
    localDb: [
      'Existing CDR cache + routing_groups_cache',
    ],
    route: '/call-flow-simulator (enhanced)',
    effort: '2–3 days (extend existing Call Flow Simulator)',
  },
  {
    num: 5, tier: 'HIGH',
    name: 'Connection Coverage Map',
    tagline: 'Prefix coverage per connection inside a routing group — gaps highlighted',
    status: 'PLANNED',
    description:
      'Select a routing group and see a matrix of all prefixes covered by each member connection. ' +
      'Coverage gaps are highlighted — prefixes reachable via one connection but not another, ' +
      'which exposes single points of failure. Ideal for redundancy planning before adding or removing ' +
      'a carrier. The map also shows cost-per-prefix where rate card data is available.',
    whatYouSee: [
      'Routing group selector → member connections as columns',
      'Prefix rows with ✓ / ✗ coverage per connection',
      'Gap rows highlighted in amber (covered by < 2 connections)',
      'Cost cell populated where a matching rate card exists',
      'Export to CSV for carrier negotiation prep',
    ],
    sippyApi: [
      'listRoutingGroupMembers(i_routing_group)',
      'listDestinationSetRoutes(i_destination_set)',
    ],
    localDb: [
      'routing_groups_cache + destination_sets_cache + connection_vendor_cache2',
      'rate_cards (local) — for cost overlay',
    ],
    route: '/routing-manager → Coverage Map tab (planned)',
    effort: '3 days',
  },
  {
    num: 6, tier: 'HIGH',
    name: 'Bulk Rate / Route Uploader',
    tagline: 'Drag-and-drop CSV uploader with pre-validation diff before sending to Sippy',
    status: 'PLANNED',
    description:
      'Sippy supports bulk CSV uploads for rates, routes, and tariffs. This feature adds a drag-and-drop ' +
      'uploader inside the Rate Cards page that pre-validates the file format client-side, shows a live diff ' +
      'of what will change (new prefixes, updated rates, removed routes) before any data is sent to the switch, ' +
      'and then submits via the Sippy bulk import API. Reduces the risk of accidental rate misconfigurations.',
    whatYouSee: [
      'Drop zone (CSV / XLSX) on Rate Cards page',
      'Instant column detection and format validation',
      'Diff table: Added / Changed / Removed rows with colour coding',
      'Confirm dialog with row count summary before upload',
      'Upload progress bar and per-row result report',
    ],
    sippyApi: [
      'addRate / updateRate / deleteRate (per-row XML-RPC)',
      'importRates(file) — if bulk endpoint supported by switch version',
    ],
    localDb: [
      'rate_cards — local store updated on successful upload',
    ],
    route: '/rate-cards → Import button (planned)',
    effort: '3–4 days',
  },
  {
    num: 7, tier: 'MEDIUM',
    name: 'On-Net Routing Viewer',
    tagline: 'Which routing groups have On-Net calling, their scope and voicemail config',
    status: 'PLANNED',
    description:
      'Sippy supports on-net routing — direct account-to-account calls that bypass the PSTN. ' +
      'This viewer shows which routing groups have on-net routing enabled, the on-net scope ' +
      '(All Accounts / Same Customer / Customer + Sub-customers), the designated on-net connection, ' +
      'and whether voicemail is configured. Currently this requires digging through each routing group ' +
      'in the Sippy portal.',
    whatYouSee: [
      'Filtered list of routing groups with on-net enabled',
      'On-net scope badge (All / Customer / Customer+Sub)',
      'On-net connection name + host',
      'Voicemail connection (if configured)',
      'LRN lookup enabled indicator',
    ],
    sippyApi: [
      'listRoutingGroups(include_members_count) — fields: disable_onnet_routing, onnet_scope, onnet_i_connection',
    ],
    localDb: [
      'routing_groups_cache (raw_json contains all on-net fields)',
    ],
    route: '/routing-manager → On-Net tab (planned)',
    effort: '1 day (data already in routing cache raw_json)',
  },
  {
    num: 8, tier: 'MEDIUM',
    name: 'Routing Policy Simulator',
    tagline: 'Show how route order changes under each of the four routing policies',
    status: 'PLANNED',
    description:
      'For a given destination number, simulate how the vendor preference order would differ if the routing ' +
      'group used each of the four Sippy routing policies: Least Cost, Prefix Length, Route Preference, ' +
      'and Routing Entries Order. Useful for planning policy changes before applying them — no changes are ' +
      'made to the switch.',
    whatYouSee: [
      'Destination number input + routing group selector',
      'Four columns (one per policy) showing ranked connections',
      'Colour delta — connections that move up/down vs current policy',
      'Cost column populated from rate card where available',
      'Read-only — no changes are sent to Sippy',
    ],
    sippyApi: [
      'listRoutingGroupMembers(i_routing_group)',
      'listDestinationSetRoutes(i_destination_set)',
    ],
    localDb: [
      'routing_groups_cache + destination_sets_cache + rate_cards',
    ],
    route: '/tools?tab=routing-policy-simulator (planned)',
    effort: '2 days (pure frontend simulation on cached data)',
  },
  {
    num: 9, tier: 'MEDIUM',
    name: 'Prefix Coverage Checker (Bulk)',
    tagline: 'Upload a list of numbers and see which ones have a route and at what cost',
    status: 'PLANNED',
    description:
      'An expanded version of the existing Route Tester that handles dozens of destination numbers at once. ' +
      'Upload or paste a list of numbers (one per line or CSV), and get back a table showing: which numbers ' +
      'have a matching route, which vendor would handle them, at what rate, and whether a backup connection ' +
      'exists. Ideal for pre-launch route audits and SLA checks before a new destination goes live.',
    whatYouSee: [
      'Paste area or file upload (up to 500 numbers)',
      'Per-number table: Matched Prefix / Vendor / Rate / Backup',
      'Unroutable numbers highlighted in red',
      'Single-vendor coverage (no backup) in amber',
      'Export to CSV / XLSX',
    ],
    sippyApi: [
      'listDestinationSetRoutes(i_destination_set) — prefix matching done locally',
    ],
    localDb: [
      'destination_sets_cache + connection_vendor_cache2 + rate_cards',
    ],
    route: '/tools?tab=prefix-checker (planned)',
    effort: '2 days (bulk LCR prefix match on cached data)',
  },
];

// ── Summary table ──────────────────────────────────────────────────────────────
function summaryTable(): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: ['#', 'Feature', 'Tier', 'Status', 'Route / Location'].map(label =>
      new TableCell({
        shading: { type: 'solid' as any, color: '0D2040', fill: '0D2040' },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 80 },
          children: [new TextRun({ text: label, color: ACCENT, bold: true, size: 18 })],
        })],
      })
    ),
  });

  const rows = FEATURES.map(f =>
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(f.num), color: GOLD, bold: true, size: 18 })],
          })],
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: f.name, color: WHITE, bold: true, size: 18 })],
          })],
        }),
        new TableCell({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: f.tier,
              color: f.tier === 'HIGH' ? ACCENT : AMBER,
              bold: true, size: 18,
            })],
          })],
        }),
        new TableCell({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [statusText(f.status)],
          })],
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: f.route, color: MID_GY, size: 17 })],
          })],
        }),
      ],
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:     { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      bottom:  { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      left:    { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      right:   { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      insideH: { style: BorderStyle.SINGLE, size: 2, color: DARK_GY },
      insideV: { style: BorderStyle.SINGLE, size: 2, color: DARK_GY },
    },
    rows: [headerRow, ...rows],
  });
}

// ── Main generator ─────────────────────────────────────────────────────────────
export async function generateRoutingFeaturesDoc(outputPath: string): Promise<void> {
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const children: (Paragraph | Table)[] = [];

  // Cover
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: 'BITSAUTO MONITORING PLATFORM', color: ACCENT, bold: true, size: 56 })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: 'Sippy Routing Features — Implementation Plan', color: GOLD, bold: true, size: 36 })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, color: MID_GY, size: 20 })],
    }),
    divider(ACCENT),
    blank(),
    p('This document covers all 9 routing features recommended for the Bitsauto Monitoring Platform. ' +
      'Features 1–6 are high-value (Sippy API fully supports them). Features 7–9 are medium-value. ' +
      'The platform\'s local routing cache (synced every 15 minutes from the Sippy XML-RPC API) powers ' +
      'most features without adding load to the live switch.', { color: LIGHT_GY, size: 21 }),
    blank(),
  );

  // Legend
  children.push(
    h2('Legend'),
    bullet('✔ IMPLEMENTED — feature is live in the platform', GREEN),
    bullet('◑ PARTIAL — scaffolding or cache exists; UI/logic to complete', AMBER),
    bullet('○ PLANNED — not yet started; effort estimate provided', ROSE),
    blank(),
  );

  // Summary table
  children.push(
    h2('Summary — All 9 Features'),
    blank(40, 80),
    summaryTable(),
    blank(),
    divider(),
  );

  // ── Feature sections ─────────────────────────────────────────────────────────
  const tierColors = { HIGH: ACCENT, MEDIUM: AMBER };
  let currentTier: FeatureTier | null = null;

  for (const f of FEATURES) {
    if (f.tier !== currentTier) {
      currentTier = f.tier;
      children.push(
        blank(200, 100),
        new Paragraph({
          spacing: { before: 0, after: 120 },
          children: [
            new TextRun({ text: `── ${f.tier === 'HIGH' ? 'HIGH VALUE' : 'MEDIUM VALUE'} FEATURES ──`, color: tierColors[f.tier], bold: true, size: 22 }),
          ],
        }),
      );
    }

    // Feature header
    children.push(
      blank(160, 60),
      new Paragraph({
        spacing: { before: 0, after: 100 },
        children: [
          new TextRun({ text: `${f.num}. `, color: GOLD, bold: true, size: 38 }),
          new TextRun({ text: f.name, color: WHITE, bold: true, size: 38 }),
          new TextRun({ text: '  ' }),
          statusText(f.status),
        ],
      }),
      p(f.tagline, { italic: true, color: ACCENT, size: 22 }),
      blank(40, 40),
    );

    // Info table
    children.push(
      infoTable([
        ['Tier',    f.tier === 'HIGH' ? 'High Value — Sippy API fully supports it' : 'Medium Value'],
        ['Status',  f.status === 'DONE' ? 'Implemented' : f.status === 'PARTIAL' ? 'Partially implemented — cache exists' : 'Planned'],
        ['Route',   f.route],
        ['Effort',  f.effort],
      ]),
      blank(60, 80),
    );

    // Description
    children.push(
      h3('Description'),
      p(f.description, { color: LIGHT_GY }),
      blank(40, 40),
    );

    // What you see
    children.push(h3('What Users See'));
    for (const line of f.whatYouSee) children.push(bullet(line));
    children.push(blank(40, 40));

    // Sippy API
    children.push(h3('Sippy API Methods Used'));
    for (const line of f.sippyApi) children.push(bullet(line, CYAN));
    children.push(blank(40, 40));

    // Local DB
    children.push(h3('Local Database / Cache'));
    for (const line of f.localDb) children.push(bullet(line, VIOLET));
    children.push(divider());
  }

  // ── Architecture note ─────────────────────────────────────────────────────
  children.push(
    blank(200, 80),
    h1('Routing Cache Architecture'),
    p('All 9 routing features share a common foundation: the Routing Cache Service ' +
      '(server/routing-cache.ts). This service polls the Sippy XML-RPC API every 15 minutes ' +
      'and stores routing data in the local PostgreSQL database. Features query the local DB — ' +
      'never the live switch — keeping switch load to a minimum.', { color: LIGHT_GY, size: 21 }),
    blank(),
    h2('Cache Tables'),
    bullet('routing_groups_cache — all routing groups with policy, on-net fields, member count', ACCENT),
    bullet('destination_sets_cache — all destination sets with translation rules and route count', ACCENT),
    bullet('connection_vendor_cache2 — all vendor connections with host, protocol, blocked flag', ACCENT),
    bullet('routing_cache_meta — last sync timestamp, status, row counts', ACCENT),
    blank(),
    h2('Sync Lifecycle'),
    bullet('Server start: first sync fires 10 seconds after boot (Sippy session warm-up)', GREEN),
    bullet('Periodic sync: every 15 minutes via setInterval', GREEN),
    bullet('Manual sync: POST /api/routing-cache/sync (admin only) — forces immediate refresh', GREEN),
    bullet('Status: GET /api/routing-cache/status — returns last_sync_at, counts, any error', GREEN),
    blank(),
    h2('UI Entry Point'),
    p('Settings → Administration → Routing Cache (/routing-manager)', { color: ACCENT }),
    p('Three tabs: Routing Groups | Destination Sets | Connections', { color: MID_GY }),
    blank(200, 100),
    divider(ACCENT),
    blank(80, 80),
    p(`Document generated by Bitsauto Monitoring Platform  ·  ${new Date().toLocaleString()}`, { color: DARK_GY, size: 17, italic: true }),
  );

  const doc = new Document({
    creator: 'Bitsauto Monitoring Platform',
    title: 'Sippy Routing Features — Implementation Plan',
    description: 'All 9 routing features: descriptions, Sippy API methods, local DB tables, status and effort.',
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: 'BITSAUTO MONITORING  ·  Routing Features Plan', color: DARK_GY, size: 16 }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Confidential — Internal Use Only  ·  ', color: DARK_GY, size: 16 }),
              new TextRun({ text: `Generated ${new Date().toLocaleDateString('en-GB')}`, color: DARK_GY, size: 16 }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outputPath, buffer);
}
