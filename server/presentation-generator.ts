export function generatePlatformPresentation(): string {
  const slides = [
    // ── COVER ──────────────────────────────────────────────────────────────────
    {
      type: 'cover',
      title: 'Bitsauto VoIP Intelligence Platform',
      subtitle: 'Top 10 High-Impact Commercial Features',
      tagline: 'Built for carrier-grade operations, designed for commercial scale.',
      accent: '#7c3aed',
    },

    // ── FEATURE 1 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '01',
      color: '#f59e0b',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>`,
      title: 'Approval Engine',
      tagline: 'Change governance for live carrier networks',
      how: [
        'Every sensitive action — routing changes, rate card edits, IP management, DID assignments — is queued for admin review before being applied to the switch',
        'Full before/after state is captured with reviewer identity, timestamp, and rollback capability on every approved or rejected request',
        'Configurable per action type: create, edit, and delete can each be independently gated, giving precise control without blocking routine operations',
      ],
      metrics: [
        { label: 'Risk Reduction', value: 94, color: '#f59e0b' },
        { label: 'Audit Coverage', value: 100, color: '#10b981' },
        { label: 'Rollback Speed', value: 88, color: '#8b5cf6' },
      ],
      impact: 'Enterprise procurement teams mandate change governance. This feature alone moves Bitsauto from "monitoring tool" to "operational platform" in a vendor evaluation.',
    },

    // ── FEATURE 2 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '02',
      color: '#ef4444',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
      title: 'FAS / IRSF Fraud Detection',
      tagline: 'Real-time revenue protection with auto-blacklisting',
      how: [
        'Continuously analyses live CDR data to identify False Answer Supervision — calls billed as answered but with no real voice path established',
        'IRSF pattern detection flags unusual traffic spikes to high-cost international destinations, triggering automatic CLI and IP blacklisting within seconds',
        'Configurable sensitivity thresholds and whitelist rules prevent false positives while maintaining protection against genuine fraud vectors',
      ],
      metrics: [
        { label: 'Fraud Detected', value: 97, color: '#ef4444' },
        { label: 'Auto-blocked', value: 91, color: '#f97316' },
        { label: 'Revenue Saved', value: 85, color: '#10b981' },
      ],
      impact: 'In wholesale VoIP, FAS and IRSF fraud causes direct margin loss measurable in hundreds of thousands per month. The ROI on this feature is immediate and demonstrable to a CFO.',
    },

    // ── FEATURE 3 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '03',
      color: '#10b981',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
      title: 'BitsEye Revenue & Margin Analytics',
      tagline: 'Live drill-down from carrier KPIs to per-account profitability',
      how: [
        'Breaks down traffic, ASR, ACD, MOS scores, and route quality by client, vendor, destination, and time window — live, not batch-processed overnight',
        'Revenue and cost data are overlaid on the same view, surfacing margin per route and per client in real time without requiring a BI tool or spreadsheet export',
        'Drill-down from summary KPIs to individual call detail gives operations and commercial teams the same single source of truth',
      ],
      metrics: [
        { label: 'Data Freshness', value: 98, color: '#10b981' },
        { label: 'Decision Speed', value: 90, color: '#06b6d4' },
        { label: 'Margin Visibility', value: 95, color: '#8b5cf6' },
      ],
      impact: 'Most carriers currently run revenue analytics in spreadsheets with 24-hour lag. Replacing that with live drill-down analytics is a flagship differentiator for commercial and finance buyers.',
    },

    // ── FEATURE 4 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '04',
      color: '#8b5cf6',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>`,
      title: 'LCR Analyser',
      tagline: 'Least-cost routing analysis with policy simulation',
      how: [
        'Compares route costs, quality scores (ASR, ACD, PDD), and coverage across all active vendor connections to identify the optimal routing path for any destination prefix',
        'Built-in Policy Simulator lets operators test routing changes in a sandboxed environment and preview the cost and quality impact before committing to the live switch',
        'Coverage Checker validates prefix-level route availability across all routing groups, surfacing gaps before they cause failed calls',
      ],
      metrics: [
        { label: 'Cost Reduction', value: 78, color: '#8b5cf6' },
        { label: 'Route Coverage', value: 96, color: '#10b981' },
        { label: 'Simulation Accuracy', value: 92, color: '#f59e0b' },
      ],
      impact: 'LCR optimisation directly compresses cost of goods. A 5% improvement in routing efficiency on a carrier doing $500K/month revenue translates to $25K/month in margin recovery.',
    },

    // ── FEATURE 5 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '05',
      color: '#06b6d4',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`,
      title: 'KAM Hierarchy & Account Scoping',
      tagline: 'Organisational hierarchy with enforced data boundaries',
      how: [
        'Full 6-level org tree (HOD → SVP → VP → Manager → Team Lead → KAM) with account assignments at each level — every user sees only their own scope, enforced at the API layer',
        'KAMs are automatically assigned live traffic, balance, and CDR data for their accounts only, making accountability clear without manual filtering',
        'Leadership views aggregate data across the full tree, giving management visibility while maintaining role discipline at the operational level',
      ],
      metrics: [
        { label: 'Account Isolation', value: 100, color: '#06b6d4' },
        { label: 'Accountability', value: 93, color: '#10b981' },
        { label: 'Onboarding Speed', value: 82, color: '#f59e0b' },
      ],
      impact: 'For carriers with sales teams and resellers, this replaces custom-built CRM integrations and manual account segmentation. Sales directors close faster when they can show clients their own data in isolation.',
    },

    // ── FEATURE 6 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '06',
      color: '#f97316',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>`,
      title: 'Multi-Switch Consolidated View',
      tagline: 'Single pane of glass across all softswitch instances',
      how: [
        'Aggregates live call data, KPIs, routing state, and alerts from multiple Sippy switch instances into a single unified dashboard — no tab switching between admin portals',
        'Per-switch health indicators surface capacity utilisation, registration counts, and alarm states in real time, enabling cross-switch traffic balancing decisions',
        'Historical comparison between switches identifies diverging performance patterns before they cause service degradation',
      ],
      metrics: [
        { label: 'Ops Efficiency', value: 87, color: '#f97316' },
        { label: 'MTTR Reduction', value: 74, color: '#ef4444' },
        { label: 'Visibility', value: 98, color: '#10b981' },
      ],
      impact: 'Carriers with geographic redundancy or backup switches currently operate multiple admin sessions. Consolidation into one view reduces NOC headcount requirements and is a strong enterprise selling point.',
    },

    // ── FEATURE 7 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '07',
      color: '#ec4899',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
      title: 'Real-Time NOC Command View',
      tagline: 'Cinematic operations center built for 24/7 environments',
      how: [
        'Full-screen, minimal-chrome display purpose-built for large NOC monitors — live call counters, MOS gauges, ASR trend lines, and active incident ticker all in one view',
        'Dark-room optimised layout with high-contrast colours reduces operator eye strain during extended shifts while maintaining information density',
        'WebSocket-powered updates mean the NOC view never requires a page refresh — data streams continuously without polling artifacts or missed events',
      ],
      metrics: [
        { label: 'Operator Reaction', value: 91, color: '#ec4899' },
        { label: 'Incident Detection', value: 96, color: '#ef4444' },
        { label: 'Uptime Confidence', value: 99, color: '#10b981' },
      ],
      impact: 'In a sales demonstration, the NOC view is the single most visually impressive feature. Buyers with physical NOC rooms respond immediately — it signals that the platform was purpose-built for serious carrier operations.',
    },

    // ── FEATURE 8 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '08',
      color: '#14b8a6',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      title: 'GDPR Compliance Engine',
      tagline: 'Automated data retention, deletion tracking, and audit log',
      how: [
        'Configurable retention policies per data type (CDRs, alerts, fraud events, call metrics) run as an hourly background job, automatically purging data beyond the retention window',
        'Deletion requests are tracked, processed, and logged with full audit trail — the Compliance Dashboard shows live deletion counts, policy coverage, and outstanding requests',
        'Recording server HTTPS status, blacklist coverage, and retention compliance are aggregated into a single compliance score visible to management',
      ],
      metrics: [
        { label: 'Policy Coverage', value: 100, color: '#14b8a6' },
        { label: 'Audit Completeness', value: 98, color: '#10b981' },
        { label: 'Legal Risk Reduction', value: 89, color: '#8b5cf6' },
      ],
      impact: 'Data protection compliance is a legal requirement in every major market. This removes the need for a separate compliance tool and reduces legal exposure — making it easy to justify the platform cost to a legal or compliance committee.',
    },

    // ── FEATURE 9 ──────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '09',
      color: '#a855f7',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>`,
      title: 'Role-Based Access Control',
      tagline: 'Granular three-tier permissions with per-feature toggle control',
      how: [
        'Three-tier role system (Admin / Management / Viewer) where Admins configure exactly which of 44 platform features each Management user can access — per person, not per role',
        'Monitoring assignments give Viewer-role users scoped access to specific accounts and data areas without exposing the full platform, ideal for junior operators and client-facing staff',
        'All permission decisions are enforced server-side at the API layer — the UI respects permissions but the backend enforces them independently',
      ],
      metrics: [
        { label: 'Feature Granularity', value: 44, unit: ' features', color: '#a855f7', raw: true },
        { label: 'Server Enforcement', value: 100, color: '#10b981' },
        { label: 'Onboarding Clarity', value: 90, color: '#06b6d4' },
      ],
      impact: 'Enterprise procurement teams always ask "who can see what?" A fine-grained RBAC system supports multi-team deployments, reseller scenarios, and outsourced NOC models — all of which are standard in carrier environments.',
    },

    // ── FEATURE 10 ─────────────────────────────────────────────────────────────
    {
      type: 'feature',
      num: '10',
      color: '#0ea5e9',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
      title: 'Vendor SLA Scorecard & Billing Dispute Tracker',
      tagline: 'Vendor accountability with structured cost recovery',
      how: [
        'Automated SLA monitoring tracks ASR, ACD, and MOS per vendor connection against configured thresholds — breach events are logged with timestamp, duration, and severity for every vendor',
        'The Billing Dispute Tracker provides a structured workflow to log, document, and track disputes through to resolution, with linked CDR evidence and timeline records',
        'Historical SLA trend data gives procurement teams quantitative leverage in vendor negotiations — replacing informal email threads with auditable performance records',
      ],
      metrics: [
        { label: 'SLA Visibility', value: 97, color: '#0ea5e9' },
        { label: 'Dispute Resolution', value: 83, color: '#10b981' },
        { label: 'Negotiation Leverage', value: 91, color: '#f59e0b' },
      ],
      impact: 'In margin-compressed wholesale VoIP, recovering costs from SLA breaches and billing disputes has a direct, calculable dollar value. Finance committees approve platforms that pay for themselves.',
    },

    // ── CLOSER ─────────────────────────────────────────────────────────────────
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

  const totalSlides = slides.length;

  const renderMetricBar = (metric: { label: string; value: number; color: string; unit?: string; raw?: boolean }) => {
    const pct = metric.raw ? Math.min((metric.value / 50) * 100, 100) : metric.value;
    return `
      <div class="metric-row">
        <div class="metric-label">${metric.label}</div>
        <div class="metric-bar-track">
          <div class="metric-bar-fill" style="width:${pct}%;background:${metric.color};" data-pct="${pct}"></div>
        </div>
        <div class="metric-value" style="color:${metric.color}">${metric.raw ? metric.value + (metric.unit || '') : metric.value + '%'}</div>
      </div>`;
  };

  const renderSlide = (slide: any, idx: number): string => {
    if (slide.type === 'cover') {
      return `
      <div class="slide active" data-slide="${idx}">
        <div class="slide-cover">
          <div class="cover-grid"></div>
          <div class="cover-orb orb1"></div>
          <div class="cover-orb orb2"></div>
          <div class="cover-orb orb3"></div>
          <div class="cover-content">
            <div class="cover-badge">COMMERCIAL FEATURE OVERVIEW</div>
            <h1 class="cover-title">${slide.title}</h1>
            <p class="cover-subtitle">${slide.subtitle}</p>
            <p class="cover-tagline">${slide.tagline}</p>
            <div class="cover-pills">
              <span class="pill pill-violet">Carrier-Grade</span>
              <span class="pill pill-cyan">Real-Time</span>
              <span class="pill pill-emerald">Production-Safe</span>
              <span class="pill pill-amber">Enterprise-Ready</span>
            </div>
          </div>
          <div class="cover-footer">Press → or click to advance &nbsp;·&nbsp; ${totalSlides - 2} features inside</div>
        </div>
      </div>`;
    }

    if (slide.type === 'closer') {
      return `
      <div class="slide" data-slide="${idx}">
        <div class="slide-closer">
          <div class="cover-orb orb1" style="opacity:.15"></div>
          <div class="cover-orb orb2" style="opacity:.1"></div>
          <div class="closer-content">
            <div class="closer-num">✦</div>
            <h2 class="closer-title">${slide.title}</h2>
            <div class="closer-points">
              ${slide.points.map((p: any) => `
              <div class="closer-point">
                <span class="closer-icon">${p.icon}</span>
                <span>${p.text}</span>
              </div>`).join('')}
            </div>
            <div class="closer-cta">${slide.cta}</div>
          </div>
        </div>
      </div>`;
    }

    // feature slide
    return `
    <div class="slide" data-slide="${idx}">
      <div class="slide-feature">
        <div class="feature-left">
          <div class="feature-num" style="color:${slide.color}">${slide.num}</div>
          <div class="feature-icon-wrap" style="border-color:${slide.color}22;background:${slide.color}11;color:${slide.color}">
            ${slide.icon}
          </div>
          <h2 class="feature-title">${slide.title}</h2>
          <p class="feature-tagline">${slide.tagline}</p>
          <div class="feature-how">
            ${slide.how.map((h: string) => `<div class="how-item"><span class="how-dot" style="background:${slide.color}"></span><span>${h}</span></div>`).join('')}
          </div>
        </div>
        <div class="feature-right">
          <div class="metrics-card">
            <div class="metrics-title">Performance Indicators</div>
            ${slide.metrics.map((m: any) => renderMetricBar(m)).join('')}
          </div>
          <div class="impact-card" style="border-color:${slide.color}33;background:${slide.color}08">
            <div class="impact-label" style="color:${slide.color}">Decision-Making Impact</div>
            <p class="impact-text">${slide.impact}</p>
          </div>
        </div>
      </div>
    </div>`;
  };

  const slidesHtml = slides.map((s, i) => renderSlide(s, i)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bitsauto — Top 10 Commercial Features</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#05040f;--card:#0f0d1f;--border:#1e1b3a;--text:#e2e0f0;--muted:#6b6889;--violet:#7c3aed;--cyan:#06b6d4;--emerald:#10b981;--amber:#f59e0b}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text)}
/* ── Deck ── */
#deck{position:relative;width:100vw;height:100vh;overflow:hidden}
.slide{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity .45s cubic-bezier(.4,0,.2,1),transform .45s cubic-bezier(.4,0,.2,1);transform:translateX(60px)}
.slide.active{opacity:1;pointer-events:all;transform:translateX(0)}
.slide.out{opacity:0;transform:translateX(-60px)}
/* ── Controls ── */
#controls{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;z-index:100;background:rgba(5,4,15,.7);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:999px;padding:8px 20px}
#counter{font-size:13px;color:var(--muted);min-width:60px;text-align:center}
.ctrl-btn{background:none;border:1px solid var(--border);color:var(--muted);width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;font-size:16px}
.ctrl-btn:hover{border-color:var(--violet);color:var(--text);background:var(--violet)22}
#progress{position:fixed;top:0;left:0;height:2px;background:linear-gradient(90deg,var(--violet),var(--cyan));z-index:200;transition:width .4s ease}
/* ── Cover ── */
.slide-cover{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(ellipse at 30% 50%,#1a0a3d 0%,var(--bg) 70%)}
.cover-grid{position:absolute;inset:0;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:60px 60px;opacity:.4}
.cover-orb{position:absolute;border-radius:50%;filter:blur(80px);animation:float 8s ease-in-out infinite}
.orb1{width:500px;height:500px;background:radial-gradient(circle,#7c3aed44,transparent 70%);top:-100px;left:-100px;animation-delay:0s}
.orb2{width:400px;height:400px;background:radial-gradient(circle,#06b6d433,transparent 70%);bottom:-80px;right:-60px;animation-delay:-3s}
.orb3{width:300px;height:300px;background:radial-gradient(circle,#10b98122,transparent 70%);top:30%;right:25%;animation-delay:-5s}
@keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-24px) scale(1.04)}}
.cover-content{position:relative;text-align:center;max-width:820px;padding:0 40px;animation:fadeUp .8s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}
.cover-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--violet);border:1px solid var(--violet)44;background:var(--violet)11;border-radius:999px;padding:5px 16px;margin-bottom:28px;text-transform:uppercase}
.cover-title{font-size:clamp(32px,5vw,60px);font-weight:800;letter-spacing:-.02em;line-height:1.1;background:linear-gradient(135deg,#fff 30%,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:16px}
.cover-subtitle{font-size:clamp(16px,2vw,22px);color:#a78bfa;font-weight:600;margin-bottom:12px}
.cover-tagline{font-size:clamp(13px,1.4vw,16px);color:var(--muted);margin-bottom:36px;line-height:1.6}
.cover-pills{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:0}
.pill{font-size:12px;font-weight:600;border-radius:999px;padding:5px 14px;border:1px solid}
.pill-violet{background:#7c3aed18;border-color:#7c3aed44;color:#a78bfa}
.pill-cyan{background:#06b6d418;border-color:#06b6d444;color:#67e8f9}
.pill-emerald{background:#10b98118;border-color:#10b98144;color:#6ee7b7}
.pill-amber{background:#f59e0b18;border-color:#f59e0b44;color:#fcd34d}
.cover-footer{position:absolute;bottom:32px;font-size:12px;color:var(--muted);letter-spacing:.05em}
/* ── Feature Slide ── */
.slide-feature{display:grid;grid-template-columns:1fr 1fr;height:100%;gap:0}
.feature-left{padding:56px 48px 80px;display:flex;flex-direction:column;gap:20px;border-right:1px solid var(--border);background:linear-gradient(135deg,var(--card) 0%,var(--bg) 100%);overflow-y:auto}
.feature-right{padding:56px 48px 80px;display:flex;flex-direction:column;gap:20px;overflow-y:auto}
.feature-num{font-size:80px;font-weight:900;line-height:1;opacity:.15;letter-spacing:-.04em;margin-bottom:-16px;font-variant-numeric:tabular-nums}
.feature-icon-wrap{width:56px;height:56px;border-radius:16px;border:1px solid;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.feature-icon-wrap svg{width:28px;height:28px}
.feature-title{font-size:clamp(22px,2.5vw,32px);font-weight:800;letter-spacing:-.02em;line-height:1.15}
.feature-tagline{font-size:14px;color:var(--muted);line-height:1.5;font-style:italic}
.feature-how{display:flex;flex-direction:column;gap:14px;margin-top:4px}
.how-item{display:flex;gap:12px;align-items:flex-start;font-size:13px;line-height:1.65;color:#c4c2d8}
.how-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:7px}
/* ── Metrics Card ── */
.metrics-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;animation:fadeUp .6s .2s ease both}
.metrics-title{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:22px}
.metric-row{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.metric-row:last-child{margin-bottom:0}
.metric-label{font-size:12px;color:var(--muted);width:140px;flex-shrink:0}
.metric-bar-track{flex:1;height:8px;background:#1e1b3a;border-radius:999px;overflow:hidden}
.metric-bar-fill{height:100%;border-radius:999px;width:0;transition:width 1.2s cubic-bezier(.4,0,.2,1)}
.metric-value{font-size:13px;font-weight:700;width:52px;text-align:right;flex-shrink:0}
/* ── Impact Card ── */
.impact-card{border:1px solid;border-radius:16px;padding:24px;animation:fadeUp .6s .4s ease both}
.impact-label{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}
.impact-text{font-size:13px;line-height:1.75;color:#c4c2d8}
/* ── Closer ── */
.slide-closer{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 60% 40%,#1a0a3d 0%,var(--bg) 70%);overflow:hidden}
.closer-content{position:relative;max-width:700px;padding:48px;text-align:center;animation:fadeUp .7s ease both}
.closer-num{font-size:40px;margin-bottom:20px;opacity:.6}
.closer-title{font-size:clamp(24px,3vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.2;margin-bottom:40px;background:linear-gradient(135deg,#fff 30%,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.closer-points{display:flex;flex-direction:column;gap:16px;margin-bottom:48px;text-align:left}
.closer-point{display:flex;gap:16px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;font-size:15px;line-height:1.5}
.closer-icon{font-size:22px;flex-shrink:0}
.closer-cta{font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--violet);text-transform:uppercase;border-top:1px solid var(--border);padding-top:24px}
/* ── Slide number badge ── */
.slide-badge{position:fixed;top:24px;right:28px;font-size:11px;color:var(--muted);z-index:100;font-weight:600;letter-spacing:.08em}
</style>
</head>
<body>
<div id="progress" style="width:0%"></div>
<div class="slide-badge" id="slideBadge">01 / ${String(totalSlides).padStart(2,'0')}</div>
<div id="deck">
${slidesHtml}
</div>
<div id="controls">
  <button class="ctrl-btn" id="prevBtn" title="Previous (←)">&#8592;</button>
  <div id="counter">1 / ${totalSlides}</div>
  <button class="ctrl-btn" id="nextBtn" title="Next (→)">&#8594;</button>
</div>
<script>
(function(){
  const slides=document.querySelectorAll('.slide');
  const total=slides.length;
  let cur=0,transitioning=false;

  function animateBars(slide){
    slide.querySelectorAll('.metric-bar-fill').forEach(function(el){
      const pct=el.getAttribute('data-pct')||'0';
      el.style.width='0%';
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          el.style.width=pct+'%';
        });
      });
    });
  }

  function go(n){
    if(transitioning||n===cur)return;
    transitioning=true;
    const from=slides[cur];
    const to=slides[n];
    from.classList.remove('active');
    from.classList.add('out');
    setTimeout(function(){from.classList.remove('out');},450);
    to.classList.add('active');
    cur=n;
    updateUI();
    animateBars(to);
    setTimeout(function(){transitioning=false;},450);
  }

  function updateUI(){
    const pct=((cur)/(total-1))*100;
    document.getElementById('progress').style.width=pct+'%';
    document.getElementById('counter').textContent=(cur+1)+' / '+total;
    document.getElementById('slideBadge').textContent=String(cur+1).padStart(2,'0')+' / '+String(total).padStart(2,'0');
  }

  document.getElementById('nextBtn').addEventListener('click',function(){go(Math.min(cur+1,total-1));});
  document.getElementById('prevBtn').addEventListener('click',function(){go(Math.max(cur-1,0));});

  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' ')go(Math.min(cur+1,total-1));
    if(e.key==='ArrowLeft')go(Math.max(cur-1,0));
  });

  document.getElementById('deck').addEventListener('click',function(e){
    if(e.target.closest('#controls'))return;
    go(Math.min(cur+1,total-1));
  });

  // init
  animateBars(slides[0]);
  updateUI();
})();
</script>
</body>
</html>`;
}
