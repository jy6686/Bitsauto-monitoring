import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer,
  NumberFormat, PageBreak,
} from 'docx';
import { writeFileSync } from 'fs';

// ── Colour palette (matches existing docs) ─────────────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GREEN    = '00C853';
const ORANGE   = 'FF6D00';
const RED_C    = 'D32F2F';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E8E8E8';
const MID_GY   = 'BDBDBD';
const DARK_GY  = '424242';
const PANEL_BG = '161B22';
const PUSH_BG  = '1A2E1A';
const FETCH_BG = '0D1B2E';

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_DXA = 9360;
function w(pct: number) { return Math.round(PAGE_DXA * pct / 100); }

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function h3(text: string, color = LIGHT_GY) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 260, after: 80 },
    children: [new TextRun({ text, color, bold: true, size: 24 })],
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
function spacer(after = 200) {
  return new Paragraph({ spacing: { after }, children: [] });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function divider() {
  return new Paragraph({
    border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 4 } },
    spacing: { before: 240, after: 240 },
    children: [],
  });
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

// ── Fetch/Push badge paragraph ─────────────────────────────────────────────────
function fetchLabel() {
  return new Paragraph({
    spacing: { before: 140, after: 60 },
    children: [
      new TextRun({ text: '▼ FETCH FROM SIPPY', color: '38BDF8', bold: true, size: 20 }),
    ],
  });
}
function pushLabel() {
  return new Paragraph({
    spacing: { before: 140, after: 60 },
    children: [
      new TextRun({ text: '▲ PUSH TO SIPPY', color: GREEN, bold: true, size: 20 }),
    ],
  });
}
function noPush() {
  return new Paragraph({
    spacing: { before: 100, after: 100 },
    children: [
      new TextRun({ text: '✗ Nothing pushed — this page is read-only.', color: DARK_GY, size: 19, italics: true }),
    ],
  });
}

// ── 3-column summary table ─────────────────────────────────────────────────────
function summaryTable(rows: { page: string; fetchItems: string; pushItems: string }[]) {
  const COL_PAGE  = w(22);
  const COL_FETCH = w(44);
  const COL_PUSH  = w(34);
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({ width: { size: COL_PAGE,  type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG }, children: [new Paragraph({ children: [new TextRun({ text: 'Page / Feature', color: ACCENT, bold: true, size: 18 })] })] }),
      new TableCell({ width: { size: COL_FETCH, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG }, children: [new Paragraph({ children: [new TextRun({ text: 'Fetches from Sippy', color: '38BDF8', bold: true, size: 18 })] })] }),
      new TableCell({ width: { size: COL_PUSH,  type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG }, children: [new Paragraph({ children: [new TextRun({ text: 'Writes to Sippy', color: GREEN, bold: true, size: 18 })] })] }),
    ],
  });
  const dataRows = rows.map((r, i) =>
    new TableRow({
      children: [
        new TableCell({ width: { size: COL_PAGE,  type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: i % 2 === 0 ? '0D1117' : '111820', color: i % 2 === 0 ? '0D1117' : '111820' }, children: [new Paragraph({ children: [new TextRun({ text: r.page, color: WHITE, bold: true, size: 18 })] })] }),
        new TableCell({ width: { size: COL_FETCH, type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: i % 2 === 0 ? '0D1117' : '111820', color: i % 2 === 0 ? '0D1117' : '111820' }, children: [new Paragraph({ children: [new TextRun({ text: r.fetchItems, color: MID_GY, size: 17 })] })] }),
        new TableCell({ width: { size: COL_PUSH,  type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: i % 2 === 0 ? '0D1117' : '111820', color: i % 2 === 0 ? '0D1117' : '111820' }, children: [new Paragraph({ children: [new TextRun({ text: r.pushItems, color: r.pushItems.startsWith('✗') ? DARK_GY : GREEN, size: 17 })] })] }),
      ],
    })
  );
  return new Table({
    width: { size: PAGE_DXA, type: WidthType.DXA },
    borders: {
      top:          { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      bottom:       { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      left:         { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      right:        { style: BorderStyle.SINGLE, size: 4, color: DARK_GY },
      insideH:      { style: BorderStyle.SINGLE, size: 2, color: DARK_GY },
      insideV:      { style: BorderStyle.SINGLE, size: 2, color: DARK_GY },
    },
    rows: [headerRow, ...dataRows],
  });
}

// ── Page-level data-flow block ─────────────────────────────────────────────────
interface PageFlow {
  title: string;
  description: string;
  fetch: string[];
  push: string[] | null;   // null = read-only
  notes?: string[];
  warnings?: string[];
}

function pageFlowBlock(flow: PageFlow): Paragraph[] {
  const out: Paragraph[] = [
    h2(flow.title),
    p(flow.description, { size: 20 }),
    spacer(60),
    fetchLabel(),
    ...flow.fetch.map(f => bullet(f, '38BDF8')),
    spacer(60),
    pushLabel(),
  ];
  if (!flow.push || flow.push.length === 0) {
    out.push(noPush());
  } else {
    out.push(...flow.push.map(f => bullet(f, GREEN)));
  }
  if (flow.notes?.length) {
    out.push(spacer(60));
    out.push(...flow.notes.map(n => note(n)));
  }
  if (flow.warnings?.length) {
    out.push(...flow.warnings.map(w => warn(w)));
  }
  out.push(spacer(120));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA: All page-level Sippy data flows
// This array is the single source of truth — edit here to update the document.
// ═══════════════════════════════════════════════════════════════════════════════
const PAGE_FLOWS: PageFlow[] = [
  {
    title: '1. Dashboard  (/)',
    description: 'The primary NOC view. Refreshes automatically every 15 seconds. All data flows are read-only polling — nothing is changed on the switch.',
    fetch: [
      'getCountersStats (call_control) — total active call count and CPS',
      'getMonitoringGraphData(acd_asr) — ASR % and ACD time-series (1–24 h window)',
      'getMonitoringGraphData(cps_total) — Calls-Per-Second time-series',
      'getSippyActiveCalls — per-call detail (CLI, CLD, start time, MOS) for the live calls table',
      'getAccountCDRs / getCustomerCDRs — last ~600 CDRs across all accounts; used to compute Revenue, CK Ratio (Connected / Wrong Number / Switched Off / Untraceable), Fraud Score, and Avg MOS',
      'listVendors — vendor balance snapshots (every 60 s, 2-hour rolling window); used for cost calculation via balance-delta method',
      'listAccounts — account ID → name mapping cache (refreshed every 30 min)',
      'TCP port probe to switch IP — raw socket check (not an XML-RPC call); verifies reachability',
    ],
    push: null,
  },
  {
    title: '2. CDR Browser  (/cdrs)',
    description: 'Search and export historical call records from Sippy. All operations are read-only.',
    fetch: [
      'getAccountCDRs / getCustomerCDRs — CDRs matching your filter: date range, CLI, CLD, account, call type (answered/unanswered/all), direction (origination/termination)',
      'Results are cached locally, enriched with country detection (dial-code prefix matching), FAS flag, and trunk class',
    ],
    push: null,
    notes: ['CSV export is generated locally from the cached CDR data — no Sippy API call is made during export.'],
  },
  {
    title: '3. Graphs  (/graphs)',
    description: 'KAM overview, Client Traffic Pulse cards, MOS trending, and Traffic Alert Log.',
    fetch: [
      'getSippyActiveCalls — live concurrent call count per account (every 15 s); used for Client Traffic Pulse cards and KAM live call overlays',
      'getMonitoringGraphData(bandwidth_total) — RTP bandwidth usage (shown on the Bandwidth tab of Server Monitoring)',
    ],
    push: null,
  },
  {
    title: '4. Traffic Map  (/traffic-map)',
    description: 'Interactive world choropleth map showing call distribution by destination country.',
    fetch: [
      'Uses local CDR cache only — country is extracted from the CDR "country" field or derived via dial-code prefix lookup',
      'No live Sippy API call is triggered on page load',
    ],
    push: null,
  },
  {
    title: '5. Analytics — Revenue  (/analytics)',
    description: '30-day P&L breakdown by client and vendor.',
    fetch: [
      'Local CDR cache — already collected by background poller; no new Sippy call on page load',
      'Vendor balance history — already collected by the 60-second background poller',
    ],
    push: null,
  },
  {
    title: '6. BitsEye Drill-Down Analytics  (/bitseye)',
    description: 'Hierarchical Country → KAM → Destination traffic analytics with per-entity AreaCharts. All data is read-only.',
    fetch: [
      'getAccountCDRs / getCustomerCDRs — CDR cache is the data source; per-entity metrics (calls, ASR, ACD, trend %) are computed from cached CDRs grouped by account, vendor, destination country, or KAM',
      'getSippyActiveCalls — live concurrent call count per entity (shown in the KPI strip on each entity card)',
      'listAccounts — account ID → name mapping from cache',
    ],
    push: null,
    notes: [
      'Country data is derived from CDR destination (CLD) numbers via dial-code prefix matching. If no CDRs are cached, the Countries grid will be empty.',
      'Drill-down flow: Countries → View KAMs → View Destinations. Back button and breadcrumb trail enable reverse navigation without page reload.',
    ],
  },
  {
    title: '7. Rate Cards  (/rate-cards)',
    description: 'Manage local client and vendor rate schedules. Optional sync to Sippy tariffs.',
    fetch: [
      'getTariffsList / listTariffs — list of all tariffs on Sippy (for the "Compare with Sippy tariff" dropdown)',
      'getRateList — prefix rates from a specific Sippy tariff (for side-by-side comparison with your local rate card)',
    ],
    push: [
      'setRateEntry — writes a single prefix/rate entry into the selected Sippy tariff (on explicit user action)',
      'deleteRateEntry — removes a rate from a Sippy tariff',
      'createTariff — creates a new tariff on Sippy (if "Sync to Sippy" option chosen)',
      'updateTariff — modifies tariff name or currency on Sippy',
      'deleteTariff — deletes an entire tariff from Sippy',
    ],
    notes: ['Rate card data itself is stored locally in the platform database. Sippy sync is an optional explicit action — it is never triggered automatically.'],
  },
  {
    title: '8. Fraud Detection  (/fraud)',
    description: 'FAS engine, IRSF scanner, and auto-blacklist rules. All analysis is local.',
    fetch: [
      'Local CDR cache only — no live Sippy call on page load',
      'FAS engine: detects zero-billed, short-billed, high-PDD, and early-answer calls',
      'IRSF scanner: flags CDRs matching 35+ high-risk international prefixes (Somalia, Congo, Cuba, etc.)',
      'Blacklist: prefix, IP, and account block rules stored in the local database',
    ],
    push: null,
    notes: ['Blacklist rules are local to this platform. They do not automatically configure any block in Sippy. You must apply blocks in Sippy manually if needed.'],
  },
  {
    title: '9. Alerts  (/alerts)',
    description: 'Alert feed and threshold configuration. Alert evaluation runs in the background.',
    fetch: [
      'Alert engine re-uses live metrics already being polled (active calls, ASR, ACD, vendor balances) — no separate Sippy call on page load',
    ],
    push: null,
    notes: ['Alert thresholds, email config, and WhatsApp config are all stored locally. No threshold values are pushed to Sippy.'],
  },
  {
    title: '10. LCR Analyser  (/lcr-analyser)',
    description: 'Least-Cost Routing analysis across all vendor rate cards for any destination number.',
    fetch: [
      'Local rate card data only (stored in the platform database)',
      'No live Sippy API call is made — analysis is entirely local',
    ],
    push: null,
  },
  {
    title: '11. Call Flow Simulator  (/call-flow-simulator)',
    description: '7-step routing simulation trace. No real call is placed — Sippy state is never changed.',
    fetch: [
      'getAccountInfo — balance, credit limit, current routing group for the selected account (Step 2)',
      'listRoutingGroupMembers — vendor connections in the routing group (Step 5)',
      'Local rate cards (from DB) — used for sell-rate lookup (Step 4) and LCR analysis (Step 6)',
    ],
    push: null,
    notes: ['This is a simulation only. Sippy is queried to read routing config but no call is placed and no configuration is changed.'],
  },
  {
    title: '12. Cost Optimisation Engine  (/cost-optimisation)',
    description: '9-rule AI-assisted analysis of CDR and rate card data. Advisory only.',
    fetch: [
      'Local CDR cache — already collected; no new Sippy call on page load',
      'Local rate card data — vendor rates stored in the platform database',
    ],
    push: null,
    notes: ['Recommendations are advisory. No configuration changes are pushed to Sippy from this page.'],
  },
  {
    title: '13. Multi-Switch Consolidated View  (/multi-switch)',
    description: 'Aggregate monitoring dashboard across multiple Sippy softswitch instances.',
    fetch: [
      'getCountersStats (call_control.getCountersStats) — active calls, ASR, ACD per switch (every 30 s)',
      'getSippyActiveCalls — per-switch live call detail',
      'TCP connectivity test — raw socket check when user clicks "Test Connection"',
    ],
    push: null,
    notes: ['Secondary switch credentials are stored in the local database only — nothing is written to any Sippy instance from this page.'],
  },
  {
    title: '14. Server Monitoring  (/server-monitoring)',
    description: 'Six-tab monitoring suite: Reachability, RTP Bandwidth, Disk & Memory, Carrier ASR, SIP Trunk Health, SIP Registration Storm.',
    fetch: [
      'TCP port probe (every 30 s) — raw socket check to switch IP; not an XML-RPC call',
      'getMonitoringGraphData(bandwidth_total) — RTP bandwidth chart on the Bandwidth tab',
      'getSippyActiveCalls — active call count used by the Reachability tab',
      'SIP OPTIONS probe (every 60 s) — raw TCP check to switch IP port 5060',
      'Per-host TCP probe (every 60 s) — for additional monitored hosts in the host outage table',
    ],
    push: null,
  },
  {
    title: '15. Clients — Sippy Accounts tab  (/clients)',
    description: 'View, provision, and manage Sippy customer accounts. This page has the most extensive Sippy write operations.',
    fetch: [
      'listAccounts — full account list with status, balance, and routing group',
      'getRegistrationStatus — SIP registration state per account (Registered / Not Registered)',
      'listAuthRules — IP authentication rules per account',
      'getLowBalance — low-balance alert threshold per account',
      'getAccountInfo — full account detail when editing',
      'listRoutingGroups — for the routing group picker in the New Account wizard',
      'getTariffs / getBillingPlans — for tariff and billing plan pickers in the wizard',
    ],
    push: [
      'createAccount — full 4-step wizard → new account pushed to Sippy with credentials, IPs, codec, SIP config, billing, credit limit, and balance',
      'updateAccount — modifies account settings (name, codec, routing group, CLI/CLD translation, etc.)',
      'deleteAccount — permanently removes an account from Sippy',
      'addAuthRule — adds an IP authentication rule to an account',
      'updateAuthRule — modifies an existing IP auth rule (IP address, protocol)',
      'deleteAuthRule — removes an IP auth rule from an account',
      'setSippyLowBalance — sets the balance alert threshold on Sippy for the account',
      'blockAccount / unblockAccount — toggles account suspension on Sippy',
      'accountAddFunds — credits balance to an account',
      'accountCredit / accountDebit — manual balance adjustments with audit trail',
      'addHotDial / updateHotDial / deleteHotDial — speed-dial entries per account',
      'addCliMapping / updateCliMapping / deleteCliMapping — CLI translation rules',
      'addSmartDial / updateSmartDial / deleteSmartDial — DID routing entries',
      'updateFollowMeOptions / addFollowMeEntry / updateFollowMeEntry / deleteFollowMeEntry — Follow-Me call forwarding',
      'addPostAuthRule / updatePostAuthRule / deletePostAuthRule — post-authentication routing rules',
      'createTrunk / updateTrunk / deleteTrunk — SIP trunk management',
      'createTrunkConnection / updateTrunkConnection / deleteTrunkConnection — trunk connection configuration',
      'billingRun — triggers a manual billing cycle for the account',
    ],
    warnings: ['deleteAccount is permanent and cannot be undone. Always confirm with the customer before removing a Sippy account.'],
  },
  {
    title: '16. Clients — Vendors tab  (/clients)',
    description: 'View and manage vendor carrier accounts and their outbound connections.',
    fetch: [
      'listVendors — all vendor accounts with current balances',
      'getVendorConnectionsList — connections per vendor (IP, port, codec, qmon fields)',
      'getVendorConnectionInfo — full connection detail when editing a connection',
    ],
    push: [
      'createVendorConnection — adds a new outbound carrier connection to Sippy',
      'updateVendorConnection — modifies connection parameters (IP, port, codec, CPS limits)',
      'deleteVendorConnection — permanently removes a vendor connection from Sippy',
      'vendorAddFunds — tops up a vendor account balance',
      'vendorCredit / vendorDebit — manual balance adjustment with notes and audit trail',
    ],
  },
  {
    title: '17. Clients — Customers tab  (/clients)',
    description: 'View and manage Sippy reseller/sub-customer records.',
    fetch: [
      'listCustomers — full reseller/sub-customer list',
      'getCustomerInfo — customer detail when opening the edit panel',
    ],
    push: [
      'createCustomer — creates a new sub-customer record on Sippy',
      'updateCustomer — modifies customer details (name, email, credit limit)',
      'deleteCustomer — permanently removes a customer from Sippy',
      'blockCustomer / unblockCustomer — toggles customer suspension',
      'setSippyLowBalance (customer) — sets balance alert threshold for a customer',
      'customerAddFunds / customerCredit / customerDebit — balance adjustments with audit trail',
    ],
  },
  {
    title: '18. Team & KAM  (/team)',
    description: 'User role management and Key Account Manager assignment.',
    fetch: [
      'listAccounts — to populate the "Assign Sippy Accounts to KAM" account picker dropdown',
      'getSippyActiveCalls — live call count overlaid per KAM managed account list',
    ],
    push: null,
    notes: ['KAM records, client assignments, and role changes are stored in the local platform database only. Nothing is written to Sippy from this page.'],
  },
  {
    title: '19. Test Call Launcher  (/test-call)',
    description: 'Initiate a real 2-way test call through Sippy to verify routing end-to-end.',
    fetch: [
      'listAccounts — to populate the billing account picker dropdown',
    ],
    push: [
      'make2WayCallback (Sippy doc 107448) — initiates a real 2-leg call on the switch: Sippy dials the CLI leg first, waits for answer, then connects to CLD. Returns a call ID on success.',
      'disconnectCall — hangs up an active call (via the Disconnect button in the Dashboard live calls table)',
    ],
    notes: ['make2WayCallback causes a real call to be placed and billed against the selected account. Use a test account with limited credit for safety.'],
    warnings: ['Clicking Launch initiates a live call immediately. Ensure both CLI and CLD are correct before submitting.'],
  },
  {
    title: '20. API Keys  (/api-keys)',
    description: 'Manage Bearer-token API keys for external system integration.',
    fetch: ['Nothing — keys are stored in and served from the local platform database.'],
    push: null,
    notes: ['External API keys grant access to the platform own REST API (live-calls, ASR/ACD, vendor balances). They do not grant direct access to Sippy.'],
  },
  {
    title: '21. WhatsApp Push Alerts  (/whatsapp)',
    description: 'Configure WhatsApp Business API push notification channel for critical alerts.',
    fetch: ['Nothing — configuration is stored locally in the platform database.'],
    push: null,
    notes: ['The platform sends messages TO WhatsApp via the configured API. It does not interact with Sippy from this page.'],
  },
  {
    title: '22. Settings  (/settings)',
    description: 'All system configuration: Sippy credentials, alert thresholds, email SMTP, SNMP, and documentation downloads.',
    fetch: [
      'connectSippy — called when you click "Connect" to validate credentials and establish the XML-RPC session',
      'listAccounts — called after successful connect to verify the credential pair works end-to-end',
    ],
    push: null,
    notes: ['All settings (credentials, thresholds, SMTP, SNMP) are stored in the local platform database. Sippy itself is not configured from this page.'],
  },
];

// ── Summary table rows ────────────────────────────────────────────────────────
const SUMMARY_ROWS = [
  { page: 'Dashboard',             fetchItems: 'Live calls, ASR/ACD/CPS, CDRs, vendor balances', pushItems: '✗ Read-only' },
  { page: 'CDR Browser',           fetchItems: 'CDRs (filtered by date, CLI, CLD, account)', pushItems: '✗ Read-only' },
  { page: 'Graphs',                fetchItems: 'Live calls per account, RTP bandwidth', pushItems: '✗ Read-only' },
  { page: 'Traffic Map',           fetchItems: 'Local CDR cache (no live call)', pushItems: '✗ Read-only' },
  { page: 'Analytics',             fetchItems: 'Local CDR cache + vendor balance history', pushItems: '✗ Read-only' },
  { page: 'BitsEye',               fetchItems: 'Live calls + CDR cache per entity', pushItems: '✗ Read-only' },
  { page: 'Rate Cards',            fetchItems: 'Tariff list + rates from Sippy', pushItems: 'Rates, tariffs (on explicit sync)' },
  { page: 'Fraud Detection',       fetchItems: 'Local CDR cache only', pushItems: '✗ Read-only' },
  { page: 'Alerts',                fetchItems: 'Re-uses existing live metric polls', pushItems: '✗ Read-only' },
  { page: 'LCR Analyser',          fetchItems: 'Local rate cards only', pushItems: '✗ Read-only' },
  { page: 'Call Flow Simulator',   fetchItems: 'Account info, routing group members', pushItems: '✗ Read-only (simulation)' },
  { page: 'Cost Optimisation',     fetchItems: 'Local CDR cache + rate cards', pushItems: '✗ Read-only' },
  { page: 'Multi-Switch View',     fetchItems: 'Live calls + counters per switch', pushItems: '✗ Read-only' },
  { page: 'Server Monitoring',     fetchItems: 'TCP probe + bandwidth + SIP OPTIONS', pushItems: '✗ Read-only' },
  { page: 'Clients — Accounts',    fetchItems: 'Account list, reg status, auth rules, balances', pushItems: 'Account CRUD, auth rules, balance, trunks' },
  { page: 'Clients — Vendors',     fetchItems: 'Vendor list + connections', pushItems: 'Connection CRUD, balance adjustments' },
  { page: 'Clients — Customers',   fetchItems: 'Customer list', pushItems: 'Customer CRUD, balance adjustments' },
  { page: 'Team & KAM',            fetchItems: 'Account list (for assignment), live calls', pushItems: '✗ Read-only' },
  { page: 'Test Call Launcher',    fetchItems: 'Account list', pushItems: 'Initiates real call, disconnects call' },
  { page: 'API Keys',              fetchItems: 'Local DB only', pushItems: '✗ Read-only' },
  { page: 'WhatsApp Alerts',       fetchItems: 'Local DB only', pushItems: '✗ Read-only' },
  { page: 'Settings',              fetchItems: 'Connection validation only', pushItems: '✗ Read-only' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateSippyDataflowDoc(outputPath?: string): Promise<Buffer> {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const doc = new Document({
    numbering: { config: [] },
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', color: MID_GY },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          size:   { width: 12240, height: 15840 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 4 } },
              children: [new TextRun({ text: 'VoIP Watcher Platform  —  Sippy Softswitch Data Flow Reference', color: DARK_GY, size: 16 })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              border: { top: { color: DARK_GY, style: BorderStyle.SINGLE, size: 4 } },
              children: [
                new TextRun({ text: 'Confidential — Internal Use Only  |  Auto-generated: ', color: DARK_GY, size: 16 }),
                new TextRun({ text: `${dateStr}`, color: DARK_GY, size: 16 }),
              ],
            }),
          ],
        }),
      },
      children: [
        // ── Cover ──────────────────────────────────────────────────────────────
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 1200, after: 160 },
          shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG },
          children: [new TextRun({ text: 'VoIP Watcher Platform', color: ACCENT, bold: true, size: 56 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: 'Sippy Softswitch — Data Flow Reference', color: WHITE, bold: true, size: 38 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'What each platform screen fetches from and writes back to Sippy', color: MID_GY, size: 22 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: `Generated: ${dateStr} at ${timeStr}`, color: DARK_GY, size: 18 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'Audience: NOC Engineers, Developers, IT Administrators', color: DARK_GY, size: 18 })],
        }),
        pageBreak(),

        // ── Introduction ───────────────────────────────────────────────────────
        h1('Introduction'),
        p('This document maps every sidebar menu item in VoIP Watcher to its exact Sippy Softswitch data interactions — specifically:', { size: 21 }),
        spacer(60),
        bullet('Which Sippy XML-RPC methods are called to fetch data (READ operations)', '38BDF8'),
        bullet('Which Sippy XML-RPC methods are called to write or modify data (WRITE operations)', GREEN),
        spacer(80),
        p('Key architecture principle: ALL Sippy API calls are made server-side. The browser never communicates with Sippy directly. The platform backend proxies every request, validates credentials, and handles retry logic transparently.', { size: 20 }),
        spacer(80),
        note('This document is auto-generated from the platform\'s active route definitions. It is regenerated on server startup and whenever the "Update" button is clicked in Settings → Documentation Downloads. It always reflects the currently deployed version of the platform.'),
        spacer(80),
        h2('Credential Model'),
        p('Two Sippy credential pairs are used, tried in order:', { size: 20 }),
        bullet('API Admin (ssp-root) — used first. Has access to all XML-RPC admin operations including account provisioning, tariff management, and vendor operations.', WHITE),
        bullet('Portal (customer username) — fallback if admin pair returns 401/403. Has read-only access to CDRs and account info for the authenticated customer.', MID_GY),
        spacer(80),
        warn('If credentials are swapped in Settings (admin stored in portal field or vice versa), the platform automatically detects the 401/403 and retries with the other pair. Both fields are tried before an error is returned.'),
        pageBreak(),

        // ── Summary Table ──────────────────────────────────────────────────────
        h1('Quick Reference — All Pages'),
        p('The table below summarises what every page fetches from and writes to Sippy. Pages marked ✗ Read-only never modify any data on the switch.', { size: 21 }),
        spacer(100),
        summaryTable(SUMMARY_ROWS),
        pageBreak(),

        // ── Per-page detail ────────────────────────────────────────────────────
        h1('Per-Page Detailed Data Flow'),
        p('Each section below describes the exact Sippy XML-RPC methods invoked by that page or background process, with context on when and why each call is made.', { size: 21 }),
        spacer(100),

        ...PAGE_FLOWS.flatMap((flow, i) => [
          ...pageFlowBlock(flow),
          ...(i < PAGE_FLOWS.length - 1 && (i + 1) % 3 === 0 ? [pageBreak()] : [divider()]),
        ]),

        pageBreak(),

        // ── Background Processes ───────────────────────────────────────────────
        h1('Background Processes'),
        p('The following Sippy interactions happen automatically in the background, independent of any user navigating to a specific page.', { size: 21 }),
        spacer(100),

        h2('A.  Vendor Balance Poller  (every 60 s)'),
        fetchLabel(),
        bullet('listVendors — fetches all vendor accounts with current balances', '38BDF8'),
        spacer(60),
        noPush(),
        p('Stores timestamped balance snapshots in a 2-hour rolling in-memory window. The revenue calculation uses balance delta (T−90 min → T−30 min) to derive actual vendor cost — the only reliable method without admin portal access.', { size: 20, indent: 360 }),
        spacer(140),

        h2('B.  CDR Cache Refresh  (every 30 min, or on-demand)'),
        fetchLabel(),
        bullet('getAccountCDRs / getCustomerCDRs — up to 500 CDRs per account, last 48 hours', '38BDF8'),
        bullet('listAccounts — refreshes account ID → name mapping cache', '38BDF8'),
        bullet('getVendorConnectionsList — refreshes vendor name/ID mapping cache', '38BDF8'),
        spacer(60),
        noPush(),
        p('The cached CDRs are the data source for: Dashboard revenue/CK stats, BitsEye analytics, Revenue Analytics, Fraud Detection, Cost Optimisation, and Traffic Map.', { size: 20, indent: 360 }),
        spacer(140),

        h2('C.  Sippy Change Watcher  (every 5 min)'),
        fetchLabel(),
        bullet('listAuthRules — detects IP auth rule additions, removals, or changes', '38BDF8'),
        bullet('listAccounts — detects new or removed client accounts', '38BDF8'),
        bullet('listVendors / getVendorConnectionsList — detects new or removed vendor connections', '38BDF8'),
        spacer(60),
        noPush(),
        p('Compares current state against the previous snapshot stored in the sippy_snapshots table. Sends an admin email alert on any detected change. No false-positives on server restart (state is persisted in DB).', { size: 20, indent: 360 }),
        spacer(140),

        h2('D.  Traffic Drop Detector  (every 5 min)'),
        fetchLabel(),
        bullet('getSippyActiveCalls — per-client live call count', '38BDF8'),
        spacer(60),
        noPush(),
        p('Compares each client\'s current call count against its 60-minute peak. If traffic drops more than 50% or goes to zero, an email and WhatsApp alert is sent. 30-minute cooldown per client prevents alert storms. Events are stored in the traffic_alerts table.', { size: 20, indent: 360 }),
        spacer(140),

        h2('E.  SIP OPTIONS Monitor  (every 60 s)'),
        fetchLabel(),
        bullet('TCP probe to switch IP port 5060 — raw socket check, not XML-RPC', '38BDF8'),
        spacer(60),
        noPush(),
        p('Results cached in the sipOptionsCache Map. Exposed via the SIP Trunk Health tab in Server Monitoring. Triggers an alert if a trunk goes unreachable.', { size: 20, indent: 360 }),

        pageBreak(),

        // ── Glossary ───────────────────────────────────────────────────────────
        h1('Sippy XML-RPC Method Glossary'),
        p('All Sippy API calls in VoIP Watcher use XML-RPC over HTTP/HTTPS with HTTP Digest authentication (RFC-2617). The table below lists every method referenced in this document with its Sippy documentation reference.', { size: 20 }),
        spacer(100),
        new Table({
          width: { size: PAGE_DXA, type: WidthType.DXA },
          borders: { top: { style: BorderStyle.SINGLE, size: 4, color: DARK_GY }, bottom: { style: BorderStyle.SINGLE, size: 4, color: DARK_GY }, left: { style: BorderStyle.SINGLE, size: 4, color: DARK_GY }, right: { style: BorderStyle.SINGLE, size: 4, color: DARK_GY }, insideH: { style: BorderStyle.SINGLE, size: 2, color: DARK_GY }, insideV: { style: BorderStyle.SINGLE, size: 2, color: DARK_GY } },
          rows: [
            new TableRow({ tableHeader: true, children: [
              new TableCell({ width: { size: w(36), type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG }, children: [new Paragraph({ children: [new TextRun({ text: 'XML-RPC Method', color: ACCENT, bold: true, size: 18 })] })] }),
              new TableCell({ width: { size: w(36), type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG }, children: [new Paragraph({ children: [new TextRun({ text: 'Purpose', color: WHITE, bold: true, size: 18 })] })] }),
              new TableCell({ width: { size: w(28), type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: PANEL_BG, color: PANEL_BG }, children: [new Paragraph({ children: [new TextRun({ text: 'Sippy Doc Reference', color: MID_GY, bold: true, size: 18 })] })] }),
            ]}),
            ...([
              ['listAccounts',              'List all SIP accounts',                                           '107322'],
              ['getRegistrationStatus',     'Check SIP registration state of an account',                     '107366'],
              ['listAuthRules / add / update / delete', 'IP authentication rule CRUD',                        '107336'],
              ['getLowBalance / setSippyLowBalance', 'Get/set balance alert threshold',                       '107444'],
              ['createAccount',             'Provision a new SIP account',                                     '107312+'],
              ['updateAccount',             'Modify account settings',                                         '107312+'],
              ['deleteAccount',             'Permanently remove an account',                                   '107312+'],
              ['blockAccount / unblockAccount', 'Toggle account suspension',                                   '107312+'],
              ['accountAddFunds / accountCredit / accountDebit', 'Account balance operations',                 '107440'],
              ['listVendors',               'List all vendor accounts with balances',                          'Sippy Admin API'],
              ['getVendorConnectionsList',  'List connections for a vendor',                                   '107435'],
              ['createVendorConnection',    'Add a new outbound carrier connection',                           '107435'],
              ['updateVendorConnection',    'Modify a carrier connection',                                     '107435'],
              ['deleteVendorConnection',    'Remove a carrier connection',                                     '107435'],
              ['vendorAddFunds / vendorCredit / vendorDebit', 'Vendor balance operations',                     '151210'],
              ['getAccountCDRs',            'Fetch CDRs for a specific SIP account',                          '107367'],
              ['getCustomerCDRs',           'Fetch CDRs for a customer/reseller',                             '107429'],
              ['getSippyActiveCalls',       'List currently active calls on the switch',                       '107462'],
              ['getCountersStats',          'Real-time counters: active calls, ASR, ACD, CPS',                'call_control'],
              ['getMonitoringGraphData',    'Time-series data for ACD/ASR/CPS/bandwidth charts',               'Monitoring API'],
              ['getTariffsList / listTariffs', 'List tariffs on Sippy',                                       'Billing API'],
              ['getRateList / setRateEntry / deleteRateEntry', 'Rate prefix CRUD within a tariff',            'Billing API'],
              ['listRoutingGroups / listRoutingGroupMembers', 'Routing group and member lookup',               'Routing API'],
              ['getAccountInfo',            'Full account detail including balance and routing group',          '107322'],
              ['make2WayCallback',          'Initiate a 2-leg test call (CLI leg → switch → CLD leg)',         '107448'],
              ['disconnectCall / disconnectAccount / disconnectCustomer', 'Hang up active call(s)',            'call_control'],
              ['listCustomers',             'List sub-customers / resellers',                                   '150644'],
              ['createCustomer / updateCustomer / deleteCustomer', 'Sub-customer CRUD',                       '150644'],
              ['customerAddFunds / customerCredit / customerDebit', 'Customer balance operations',             '150644'],
              ['createTrunk / updateTrunk / deleteTrunk', 'SIP trunk management',                             '3000116551'],
              ['createTrunkConnection / updateTrunkConnection / deleteTrunkConnection', 'Trunk connection CRUD', '3000116552'],
            ] as [string, string, string][]).map(([method, purpose, ref], i) =>
              new TableRow({ children: [
                new TableCell({ width: { size: w(36), type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: i % 2 === 0 ? DARK_BG : '111820', color: i % 2 === 0 ? DARK_BG : '111820' }, children: [new Paragraph({ children: [new TextRun({ text: method, color: '38BDF8', size: 17 })] })] }),
                new TableCell({ width: { size: w(36), type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: i % 2 === 0 ? DARK_BG : '111820', color: i % 2 === 0 ? DARK_BG : '111820' }, children: [new Paragraph({ children: [new TextRun({ text: purpose, color: MID_GY, size: 17 })] })] }),
                new TableCell({ width: { size: w(28), type: WidthType.DXA }, shading: { type: ShadingType.SOLID, fill: i % 2 === 0 ? DARK_BG : '111820', color: i % 2 === 0 ? DARK_BG : '111820' }, children: [new Paragraph({ children: [new TextRun({ text: ref, color: DARK_GY, size: 17 })] })] }),
              ]})
            ),
          ],
        }),

        spacer(200),
        divider(),
        p(`This document was auto-generated by VoIP Watcher on ${dateStr} at ${timeStr}. It is regenerated on server startup and on demand via Settings → Documentation Downloads.`, { color: DARK_GY, size: 17, italic: true }),
        p('VoIP Watcher Platform — Confidential. For internal use only.', { color: DARK_GY, size: 17, italic: true }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  if (outputPath) writeFileSync(outputPath, buffer);
  return buffer;
}

export const SIPPY_DATAFLOW_PATH = '/tmp/VoIP_Watcher_Sippy_Dataflow.docx';
