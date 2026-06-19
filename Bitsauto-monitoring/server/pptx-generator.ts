import PptxGenJSImport from 'pptxgenjs';
// tsx ESM/CJS interop: the default export may be nested under .default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGenJS: typeof PptxGenJSImport = (PptxGenJSImport as any).default ?? PptxGenJSImport;

interface Metric { label: string; value: number; color: string; unit?: string; raw?: boolean; }

interface FeatureSlide {
  type: 'feature';
  num: string;
  color: string;
  title: string;
  tagline: string;
  how: string[];
  metrics: Metric[];
  impact: string;
}
interface CoverSlide  { type: 'cover';  title: string; subtitle: string; tagline: string; }
interface CloserSlide { type: 'closer'; title: string; points: { icon: string; text: string }[]; cta: string; }
type Slide = CoverSlide | FeatureSlide | CloserSlide;

const DARK_BG   = '05040F';
const CARD_BG   = '0F0D1F';
const BORDER    = '1E1B3A';
const TEXT_W    = 'E2E0F0';
const MUTED     = '6B6889';
const VIOLET    = '7C3AED';
const CYAN      = '06B6D4';
const EMERALD   = '10B981';
const AMBER     = 'F59E0B';

const slides: Slide[] = [
  {
    type: 'cover',
    title: 'Bitsauto VoIP Intelligence Platform',
    subtitle: 'Top 11 High-Impact Commercial Features',
    tagline: 'Built for carrier-grade operations, designed for commercial scale.',
  },
  {
    type: 'feature', num: '01', color: AMBER,
    title: 'Approval Engine',
    tagline: 'Change governance for live carrier networks',
    how: [
      'Every sensitive action — routing changes, rate card edits, IP management, DID assignments — is queued for admin review before being applied to the switch.',
      'Full before/after state is captured with reviewer identity, timestamp, and rollback capability on every approved or rejected request.',
      'Configurable per action type: create, edit, and delete can each be independently gated, giving precise control without blocking routine operations.',
    ],
    metrics: [
      { label: 'Risk Reduction',  value: 94,  color: AMBER   },
      { label: 'Audit Coverage',  value: 100, color: EMERALD },
      { label: 'Rollback Speed',  value: 88,  color: '8B5CF6' },
    ],
    impact: 'Enterprise procurement teams mandate change governance. This feature alone moves Bitsauto from "monitoring tool" to "operational platform" in a vendor evaluation.',
  },
  {
    type: 'feature', num: '02', color: 'EF4444',
    title: 'FAS / IRSF Fraud Detection',
    tagline: 'Real-time revenue protection with auto-blacklisting',
    how: [
      'Continuously analyses live CDR data to identify False Answer Supervision — calls billed as answered but with no real voice path established.',
      'IRSF pattern detection flags unusual traffic spikes to high-cost international destinations, triggering automatic CLI and IP blacklisting within seconds.',
      'Configurable sensitivity thresholds and whitelist rules prevent false positives while maintaining protection against genuine fraud vectors.',
    ],
    metrics: [
      { label: 'Fraud Detected', value: 97, color: 'EF4444' },
      { label: 'Auto-blocked',   value: 91, color: 'F97316' },
      { label: 'Revenue Saved',  value: 85, color: EMERALD  },
    ],
    impact: 'In wholesale VoIP, FAS and IRSF fraud causes direct margin loss measurable in hundreds of thousands per month. The ROI on this feature is immediate and demonstrable to a CFO.',
  },
  {
    type: 'feature', num: '03', color: EMERALD,
    title: 'BitsEye Revenue & Margin Analytics',
    tagline: 'Live drill-down from carrier KPIs to per-account profitability',
    how: [
      'Breaks down traffic, ASR, ACD, MOS scores, and route quality by client, vendor, destination, and time window — live, not batch-processed overnight.',
      'Revenue and cost data are overlaid on the same view, surfacing margin per route and per client in real time without requiring a BI tool or spreadsheet export.',
      'Drill-down from summary KPIs to individual call detail gives operations and commercial teams the same single source of truth.',
    ],
    metrics: [
      { label: 'Data Freshness',   value: 98, color: EMERALD },
      { label: 'Decision Speed',   value: 90, color: CYAN    },
      { label: 'Margin Visibility',value: 95, color: '8B5CF6'},
    ],
    impact: 'Most carriers currently run revenue analytics in spreadsheets with 24-hour lag. Replacing that with live drill-down analytics is a flagship differentiator for commercial and finance buyers.',
  },
  {
    type: 'feature', num: '04', color: '8B5CF6',
    title: 'LCR Analyser',
    tagline: 'Least-cost routing analysis with policy simulation',
    how: [
      'Compares route costs, quality scores (ASR, ACD, PDD), and coverage across all active vendor connections to identify the optimal routing path for any destination prefix.',
      'Built-in Policy Simulator lets operators test routing changes in a sandboxed environment and preview the cost and quality impact before committing to the live switch.',
      'Coverage Checker validates prefix-level route availability across all routing groups, surfacing gaps before they cause failed calls.',
    ],
    metrics: [
      { label: 'Cost Reduction',       value: 78, color: '8B5CF6' },
      { label: 'Route Coverage',       value: 96, color: EMERALD  },
      { label: 'Simulation Accuracy',  value: 92, color: AMBER    },
    ],
    impact: 'LCR optimisation directly compresses cost of goods. A 5% improvement in routing efficiency on a carrier doing $500K/month revenue translates to $25K/month in margin recovery.',
  },
  {
    type: 'feature', num: '05', color: CYAN,
    title: 'KAM Hierarchy & Account Scoping',
    tagline: 'Organisational hierarchy with enforced data boundaries',
    how: [
      'Full 6-level org tree (HOD → SVP → VP → Manager → Team Lead → KAM) with account assignments at each level — every user sees only their own scope, enforced at the API layer.',
      'KAMs are automatically assigned live traffic, balance, and CDR data for their accounts only, making accountability clear without manual filtering.',
      'Leadership views aggregate data across the full tree, giving management visibility while maintaining role discipline at the operational level.',
    ],
    metrics: [
      { label: 'Account Isolation', value: 100, color: CYAN    },
      { label: 'Accountability',    value: 93,  color: EMERALD },
      { label: 'Onboarding Speed',  value: 82,  color: AMBER   },
    ],
    impact: 'For carriers with sales teams and resellers, this replaces custom-built CRM integrations and manual account segmentation. Sales directors close faster when they can show clients their own data in isolation.',
  },
  {
    type: 'feature', num: '06', color: 'F97316',
    title: 'Multi-Switch Consolidated View',
    tagline: 'Single pane of glass across all softswitch instances',
    how: [
      'Aggregates live call data, KPIs, routing state, and alerts from multiple Sippy switch instances into a single unified dashboard — no tab switching between admin portals.',
      'Per-switch health indicators surface capacity utilisation, registration counts, and alarm states in real time, enabling cross-switch traffic balancing decisions.',
      'Historical comparison between switches identifies diverging performance patterns before they cause service degradation.',
    ],
    metrics: [
      { label: 'Ops Efficiency', value: 87, color: 'F97316' },
      { label: 'MTTR Reduction', value: 74, color: 'EF4444' },
      { label: 'Visibility',     value: 98, color: EMERALD  },
    ],
    impact: 'Carriers with geographic redundancy or backup switches currently operate multiple admin sessions. Consolidation into one view reduces NOC headcount requirements and is a strong enterprise selling point.',
  },
  {
    type: 'feature', num: '07', color: 'EC4899',
    title: 'Real-Time NOC Command View',
    tagline: 'Cinematic operations center built for 24/7 environments',
    how: [
      'Full-screen, minimal-chrome display purpose-built for large NOC monitors — live call counters, MOS gauges, ASR trend lines, and active incident ticker all in one view.',
      'Dark-room optimised layout with high-contrast colours reduces operator eye strain during extended shifts while maintaining information density.',
      'WebSocket-powered updates mean the NOC view never requires a page refresh — data streams continuously without polling artifacts or missed events.',
    ],
    metrics: [
      { label: 'Operator Reaction', value: 91, color: 'EC4899' },
      { label: 'Incident Detection',value: 96, color: 'EF4444' },
      { label: 'Uptime Confidence', value: 99, color: EMERALD  },
    ],
    impact: 'In a sales demonstration, the NOC view is the single most visually impressive feature. Buyers with physical NOC rooms respond immediately — it signals that the platform was purpose-built for serious carrier operations.',
  },
  {
    type: 'feature', num: '08', color: '14B8A6',
    title: 'GDPR Compliance Engine',
    tagline: 'Automated data retention, deletion tracking, and audit log',
    how: [
      'Configurable retention policies per data type (CDRs, alerts, fraud events, call metrics) run as an hourly background job, automatically purging data beyond the retention window.',
      'Deletion requests are tracked, processed, and logged with full audit trail — the Compliance Dashboard shows live deletion counts, policy coverage, and outstanding requests.',
      'Recording server HTTPS status, blacklist coverage, and retention compliance are aggregated into a single compliance score visible to management.',
    ],
    metrics: [
      { label: 'Policy Coverage',    value: 100, color: '14B8A6' },
      { label: 'Audit Completeness', value: 98,  color: EMERALD  },
      { label: 'Legal Risk Reduction',value: 89, color: '8B5CF6' },
    ],
    impact: 'Data protection compliance is a legal requirement in every major market. This removes the need for a separate compliance tool and reduces legal exposure — making it easy to justify the platform cost to a legal or compliance committee.',
  },
  {
    type: 'feature', num: '09', color: 'A855F7',
    title: 'Role-Based Access Control',
    tagline: 'Granular 44-feature permissions with per-user toggle control',
    how: [
      'Three-tier role system (Admin / Management / Viewer) where Admins configure exactly which of 44 platform features each Management user can access — per person, not per role.',
      'Monitoring assignments give Viewer-role users scoped access to specific accounts and data areas without exposing the full platform.',
      'All permission decisions are enforced server-side at the API layer — the UI respects permissions but the backend enforces them independently.',
    ],
    metrics: [
      { label: 'Feature Granularity',  value: 44,  color: 'A855F7', unit: ' features', raw: true },
      { label: 'Server Enforcement',   value: 100, color: EMERALD },
      { label: 'Onboarding Clarity',   value: 90,  color: CYAN   },
    ],
    impact: 'Enterprise procurement teams always ask "who can see what?" A fine-grained RBAC system supports multi-team deployments, reseller scenarios, and outsourced NOC models — all of which are standard in carrier environments.',
  },
  {
    type: 'feature', num: '10', color: '0EA5E9',
    title: 'Vendor SLA Scorecard & Billing Dispute Tracker',
    tagline: 'Vendor accountability with structured cost recovery',
    how: [
      'Automated SLA monitoring tracks ASR, ACD, and MOS per vendor connection against configured thresholds — breach events are logged with timestamp, duration, and severity for every vendor.',
      'The Billing Dispute Tracker provides a structured workflow to log, document, and track disputes through to resolution, with linked CDR evidence and timeline records.',
      'Historical SLA trend data gives procurement teams quantitative leverage in vendor negotiations — replacing informal email threads with auditable performance records.',
    ],
    metrics: [
      { label: 'SLA Visibility',       value: 97, color: '0EA5E9' },
      { label: 'Dispute Resolution',   value: 83, color: EMERALD  },
      { label: 'Negotiation Leverage', value: 91, color: AMBER    },
    ],
    impact: 'In margin-compressed wholesale VoIP, recovering costs from SLA breaches and billing disputes has a direct, calculable dollar value. Finance committees approve platforms that pay for themselves.',
  },
  {
    type: 'feature', num: '11', color: EMERALD,
    title: 'Number Intelligence & HLR Lookup',
    tagline: 'Real carrier data on any number — one click, zero guesswork',
    how: [
      'Parallel HLR + MNP API calls return live network status, current carrier, line type (Mobile/Fixed/VoIP), MCC/MNC network code, and porting status — cached 24 hours to control cost.',
      'STIR/SHAKEN attestation level, reputation score from FAS event history, CDR match count, and CDR-sourced CNAM are layered on top of the HLR result.',
      'Provider is configurable from the Number Intelligence page — supports hlrlookup.com or Telnyx; falls back to Sippy CDR data when no provider is configured.',
    ],
    metrics: [
      { label: 'Fields Populated', value: 9,  color: EMERALD, unit: ' data points', raw: true },
      { label: 'Lookup Speed',     value: 96, color: CYAN    },
      { label: 'Cache Hit Rate',   value: 88, color: '8B5CF6'},
    ],
    impact: 'Fraud investigation, CLI screening, and regulatory compliance all require knowing whether a number is real, active, and where it originates. This removes the manual carrier portal lookup and puts verified number intelligence directly in the hands of NOC and compliance teams.',
  },
  {
    type: 'closer',
    title: 'Built for the Way Carriers Actually Operate',
    points: [
      { icon: '⚡', text: 'Live data — never stale, never batched overnight' },
      { icon: '🛡️', text: 'Read-only by default — safe for production 24/7' },
      { icon: '📊', text: 'From raw CDRs to boardroom margin analytics in one platform' },
      { icon: '🔒', text: 'Compliance, governance, and audit built in — not bolted on' },
      { icon: '🌍', text: 'Multi-switch, multi-region, multi-team ready from day one' },
    ],
    cta: 'Bitsauto — Carrier Intelligence, Commercially Engineered',
  },
];

function hex(c: string) { return c.startsWith('#') ? c.slice(1) : c; }

function addBackground(slide: PptxGenJS.Slide) {
  slide.addShape('rect' as PptxGenJS.ShapeType, {
    x: 0, y: 0, w: '100%', h: '100%', fill: { color: hex(DARK_BG) },
  });
}

function addAccentBar(slide: PptxGenJS.Slide, color: string) {
  slide.addShape('rect' as PptxGenJS.ShapeType, {
    x: 0, y: 0, w: 0.06, h: '100%', fill: { color: hex(color) },
  });
}

export async function generatePlatformPresentationPptx(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';  // 13.33 × 7.5 inches
  pptx.author  = 'Bitsauto';
  pptx.company = 'Bitsauto VoIP Intelligence';
  pptx.subject = 'Top 11 Commercial Features';
  pptx.title   = 'Bitsauto VoIP Intelligence Platform';

  for (const s of slides) {
    const slide = pptx.addSlide();

    if (s.type === 'cover') {
      addBackground(slide);
      // Gradient overlay strip
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x: 0, y: 0, w: '60%', h: '100%',
        fill: { color: '1A0A3D', transparency: 30 },
      });
      // Violet accent bar
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x: 0, y: 0, w: 0.06, h: '100%', fill: { color: hex(VIOLET) },
      });
      // Badge
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x: 1, y: 1.1, w: 3.8, h: 0.35, fill: { color: '1E1040' },
        line: { color: hex(VIOLET), width: 1 }, rounding: 0.5,
      });
      slide.addText('COMMERCIAL FEATURE OVERVIEW', {
        x: 1, y: 1.1, w: 3.8, h: 0.35,
        fontSize: 8, bold: true, color: 'A78BFA', charSpacing: 3,
        align: 'center', valign: 'middle',
      });
      // Title
      slide.addText(s.title, {
        x: 0.5, y: 1.8, w: 8, h: 1.6,
        fontSize: 44, bold: true, color: 'FFFFFF',
        charSpacing: -1, lineSpacingMultiple: 1.1,
      });
      // Subtitle
      slide.addText(s.subtitle, {
        x: 0.5, y: 3.45, w: 8, h: 0.55,
        fontSize: 20, bold: true, color: 'A78BFA',
      });
      // Tagline
      slide.addText(s.tagline, {
        x: 0.5, y: 4.1, w: 7.5, h: 0.4,
        fontSize: 13, color: hex(MUTED), italic: true,
      });
      // Pills
      const pills = ['Carrier-Grade','Real-Time','Production-Safe','Enterprise-Ready'];
      const pillColors = ['7C3AED','06B6D4','10B981','F59E0B'];
      pills.forEach((p, i) => {
        const x = 0.5 + i * 2.05;
        slide.addShape('rect' as PptxGenJS.ShapeType, {
          x, y: 4.8, w: 1.9, h: 0.38,
          fill: { color: pillColors[i], transparency: 85 },
          line: { color: pillColors[i], width: 1 }, rounding: 0.5,
        });
        slide.addText(p, {
          x, y: 4.8, w: 1.9, h: 0.38,
          fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
        });
      });
      // Footer
      slide.addText('Bitsauto · Carrier Intelligence, Commercially Engineered', {
        x: 0.5, y: 6.9, w: 12.3, h: 0.35,
        fontSize: 9, color: hex(MUTED), align: 'center',
      });
      continue;
    }

    if (s.type === 'closer') {
      addBackground(slide);
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x: 0, y: 0, w: '100%', h: '100%',
        fill: { color: '1A0A3D', transparency: 50 },
      });
      slide.addText('✦', {
        x: 5.5, y: 0.5, w: 2.3, h: 0.7,
        fontSize: 28, color: hex(VIOLET), align: 'center',
      });
      slide.addText(s.title, {
        x: 1, y: 1.2, w: 11.3, h: 1.2,
        fontSize: 32, bold: true, color: 'FFFFFF',
        align: 'center', lineSpacingMultiple: 1.15,
      });
      s.points.forEach((pt, i) => {
        const y = 2.6 + i * 0.75;
        slide.addShape('rect' as PptxGenJS.ShapeType, {
          x: 1.5, y, w: 10.3, h: 0.62,
          fill: { color: hex(CARD_BG) },
          line: { color: hex(BORDER), width: 1 }, rounding: 0.2,
        });
        slide.addText(`${pt.icon}  ${pt.text}`, {
          x: 1.7, y, w: 10, h: 0.62,
          fontSize: 13, color: hex(TEXT_W), valign: 'middle',
        });
      });
      slide.addShape('line' as PptxGenJS.ShapeType, {
        x: 3, y: 6.6, w: 7.3, h: 0, line: { color: hex(BORDER), width: 1 },
      });
      slide.addText(s.cta, {
        x: 1, y: 6.7, w: 11.3, h: 0.5,
        fontSize: 11, bold: true, color: hex(VIOLET),
        align: 'center', charSpacing: 2,
      });
      continue;
    }

    // Feature slide
    addBackground(slide);
    addAccentBar(slide, s.color);

    // Left panel background
    slide.addShape('rect' as PptxGenJS.ShapeType, {
      x: 0.06, y: 0, w: 6.44, h: '100%',
      fill: { color: hex(CARD_BG) },
    });

    // Feature number (faint)
    slide.addText(s.num, {
      x: 0.3, y: 0.1, w: 2.5, h: 1.4,
      fontSize: 96, bold: true, color: hex(TEXT_W),
      transparency: 88, charSpacing: -4,
    });

    // Title
    slide.addText(s.title, {
      x: 0.3, y: 0.95, w: 6, h: 1.0,
      fontSize: 26, bold: true, color: 'FFFFFF',
      lineSpacingMultiple: 1.1,
    });

    // Tagline
    slide.addText(s.tagline, {
      x: 0.3, y: 1.95, w: 6, h: 0.42,
      fontSize: 12, italic: true, color: hex(MUTED),
    });

    // Accent divider
    slide.addShape('line' as PptxGenJS.ShapeType, {
      x: 0.3, y: 2.42, w: 6, h: 0,
      line: { color: hex(s.color), width: 1.5, transparency: 60 },
    });

    // How it works bullet points
    s.how.forEach((h, i) => {
      const y = 2.6 + i * 1.35;
      // Bullet dot
      slide.addShape('ellipse' as PptxGenJS.ShapeType, {
        x: 0.3, y: y + 0.06, w: 0.1, h: 0.1,
        fill: { color: hex(s.color) },
      });
      slide.addText(h, {
        x: 0.5, y, w: 5.9, h: 1.2,
        fontSize: 11, color: 'C4C2D8', lineSpacingMultiple: 1.55, valign: 'top',
      });
    });

    // Right panel — Metrics card
    const mx = 6.8;
    slide.addShape('rect' as PptxGenJS.ShapeType, {
      x: mx, y: 0.3, w: 6.2, h: 3.3,
      fill: { color: hex(CARD_BG) },
      line: { color: hex(BORDER), width: 1 }, rounding: 0.2,
    });
    slide.addText('PERFORMANCE INDICATORS', {
      x: mx + 0.3, y: 0.55, w: 5.6, h: 0.3,
      fontSize: 8, bold: true, color: hex(MUTED), charSpacing: 2,
    });

    s.metrics.forEach((m, i) => {
      const ry = 1.05 + i * 0.72;
      const mc = hex(m.color);
      const pct = m.raw ? Math.min((m.value / 50) * 100, 100) : m.value;
      const displayVal = m.raw ? `${m.value}${m.unit || ''}` : `${m.value}%`;

      slide.addText(m.label, {
        x: mx + 0.3, y: ry, w: 2.2, h: 0.28,
        fontSize: 10, color: hex(MUTED), valign: 'middle',
      });
      // Bar track
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x: mx + 2.6, y: ry + 0.06, w: 2.8, h: 0.16,
        fill: { color: hex(BORDER) }, rounding: 0.1,
      });
      // Bar fill
      if (pct > 0) {
        slide.addShape('rect' as PptxGenJS.ShapeType, {
          x: mx + 2.6, y: ry + 0.06, w: (2.8 * pct) / 100, h: 0.16,
          fill: { color: mc }, rounding: 0.1,
        });
      }
      slide.addText(displayVal, {
        x: mx + 5.5, y: ry, w: 1, h: 0.28,
        fontSize: 11, bold: true, color: mc, align: 'right', valign: 'middle',
      });
    });

    // Impact card
    const iy = 3.8;
    slide.addShape('rect' as PptxGenJS.ShapeType, {
      x: mx, y: iy, w: 6.2, h: 3.35,
      fill: { color: hex(s.color), transparency: 94 },
      line: { color: hex(s.color), width: 1, transparency: 70 }, rounding: 0.2,
    });
    slide.addText('DECISION-MAKING IMPACT', {
      x: mx + 0.3, y: iy + 0.25, w: 5.6, h: 0.28,
      fontSize: 8, bold: true, color: hex(s.color), charSpacing: 2,
    });
    slide.addText(s.impact, {
      x: mx + 0.3, y: iy + 0.65, w: 5.6, h: 2.5,
      fontSize: 11, color: 'C4C2D8', lineSpacingMultiple: 1.65, valign: 'top',
    });

    // Slide number badge (bottom right)
    slide.addText(`${s.num} / 11`, {
      x: 11.8, y: 7.1, w: 1.2, h: 0.3,
      fontSize: 9, color: hex(MUTED), align: 'right',
    });
  }

  // Write to a temp file and read back — more reliable than in-memory buffer across runtimes
  const { tmpdir } = await import('os');
  const { join }   = await import('path');
  const { readFile, unlink } = await import('fs/promises');
  const tmp = join(tmpdir(), `bitsauto_pptx_${Date.now()}.pptx`);
  await pptx.writeFile({ fileName: tmp });
  const data = await readFile(tmp);
  unlink(tmp).catch(() => {/* ignore */});
  return data;
}
