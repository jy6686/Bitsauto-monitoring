import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Users, TrendingUp, Wallet, ShieldAlert, SendHorizonal, FileText,
  BarChart3, HeartPulse, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, Megaphone, ArrowUpRight, MessageSquare, Activity,
  TrendingDown, Minus, Phone, Zap, Eye, AlertCircle, Shield,
  BarChart2, ArrowRight, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
// ── Types ────────────────────────────────────────────────────────────────────
interface PortfolioAccount {
  accountId: string;
  clientName: string;
  kamId: number;
  healthScore: number | null;
  fraudRisk: number | null;
  anomalyScore: number | null;
  qualityScore: number | null;
  riskIndex: number | null;
  state: string;
  trendDirection: string;
  scoreDelta24h: number;
  balanceTrend: string;
  reasons: string[];
  recommendation: any;
  activeIncidentCount: number;
  exposureRiskLevel: string;
  liveCallCount: number;
  calls24h: number;
  asr24h: number | null;
  minutes24h: number;
  avgDuration24h: number | null;
  revenue24h: number;
  updatedAt: string | null;
}

interface PortfolioResponse {
  portfolio: PortfolioAccount[];
  kamId: number | null;
  kamName: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "Send Rate",         desc: "Deliver rate sheet",      icon: SendHorizonal, href: "/clients?tab=send-rate",    color: "text-purple-400", bg: "bg-purple-500/10" },
  { label: "Commercial Notice", desc: "Broadcast announcement",  icon: Megaphone,     href: "/commercial-notifications", color: "text-amber-400",  bg: "bg-amber-500/10"  },
  { label: "WhatsApp Alert",    desc: "Send WhatsApp message",   icon: MessageSquare, href: "/whatsapp-alerts",          color: "text-green-400",  bg: "bg-green-500/10"  },
  { label: "View Invoices",     desc: "Review client billing",   icon: FileText,      href: "/invoices",                 color: "text-blue-400",   bg: "bg-blue-500/10"   },
  { label: "Account Health",    desc: "Deep health drill-down",  icon: HeartPulse,    href: "/bitseye2",                 color: "text-rose-400",   bg: "bg-rose-500/10"   },
  { label: "Traffic Analytics", desc: "CDR & ASR analysis",      icon: BarChart3,     href: "/analytics",                color: "text-cyan-400",   bg: "bg-cyan-500/10"   },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
function firstName(name: string) { return name.split(" ")[0] ?? name; }

function stateConfig(state: string) {
  switch (state) {
    case "at_risk":  return { label: "At Risk",  color: "text-rose-400",   bg: "bg-rose-500/10",    border: "border-rose-500/20",    dot: "bg-rose-400"    };
    case "degraded": return { label: "Degraded", color: "text-orange-400", bg: "bg-orange-500/10",  border: "border-orange-500/20",  dot: "bg-orange-400"  };
    case "watch":    return { label: "Watch",    color: "text-amber-400",  bg: "bg-amber-500/10",   border: "border-amber-500/20",   dot: "bg-amber-400"   };
    case "healthy":  return { label: "Healthy",  color: "text-emerald-400",bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-400" };
    default:         return { label: "Unknown",  color: "text-slate-400",  bg: "bg-slate-500/10",   border: "border-slate-500/20",   dot: "bg-slate-400"   };
  }
}

function scoreColor(score: number | null) {
  if (score === null) return "text-muted-foreground/40";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-rose-400";
}

function scoreBarColor(score: number | null) {
  if (score === null) return "bg-slate-500/30";
  if (score >= 80) return "bg-emerald-400";
  if (score >= 60) return "bg-amber-400";
  if (score >= 40) return "bg-orange-400";
  return "bg-rose-400";
}

function TrendIcon({ dir, delta }: { dir: string; delta: number }) {
  if (dir === "improving" || delta > 0) return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (dir === "declining"  || delta < 0) return <TrendingDown className="h-3 w-3 text-rose-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground/40" />;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScorePill({ label, value, max = 100 }: { label: string; value: number | null; max?: number }) {
  const pct = value !== null ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">{label}</span>
        <span className={cn("text-[10px] font-bold tabular-nums", scoreColor(value))}>
          {value !== null ? value : "—"}
        </span>
      </div>
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", scoreBarColor(value))} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── 1: Account Health Card ───────────────────────────────────────────────────
function AccountHealthCard({ account, onClick, selected }: {
  account: PortfolioAccount;
  onClick: () => void;
  selected: boolean;
}) {
  const cfg = stateConfig(account.state);
  const hasLive = account.liveCallCount > 0;

  return (
    <button
      onClick={onClick}
      data-testid={`account-health-card-${account.accountId}`}
      className={cn(
        "w-full text-left rounded-2xl border transition-all duration-150 p-4 space-y-3",
        selected
          ? "border-purple-500/30 bg-purple-500/[0.05] shadow-sm"
          : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.11]"
      )}
    >
      {/* Row 1: Name + state badge + live pill */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", cfg.dot)} />
            <p className="text-sm font-semibold text-foreground truncate">{account.clientName}</p>
          </div>
          <p className="text-[10px] text-muted-foreground/40 pl-3.5">ID: {account.accountId}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasLive && (
            <span className="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              {account.liveCallCount} live
            </span>
          )}
          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide", cfg.bg, cfg.color, `border ${cfg.border}`)}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Row 2: Health score bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">Health score</span>
          <div className="flex items-center gap-1">
            <TrendIcon dir={account.trendDirection} delta={account.scoreDelta24h} />
            <span className={cn("text-sm font-bold tabular-nums", scoreColor(account.healthScore))}>
              {account.healthScore ?? "—"}
            </span>
            {account.scoreDelta24h !== 0 && (
              <span className={cn("text-[9px] font-medium", account.scoreDelta24h > 0 ? "text-emerald-400" : "text-rose-400")}>
                {account.scoreDelta24h > 0 ? "+" : ""}{account.scoreDelta24h}
              </span>
            )}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", scoreBarColor(account.healthScore))}
            style={{ width: `${account.healthScore ?? 0}%` }}
          />
        </div>
      </div>

      {/* Row 3: Signal mini-scores */}
      <div className="grid grid-cols-3 gap-2">
        <ScorePill label="Quality"  value={account.qualityScore} />
        <ScorePill label="Fraud↓"   value={account.fraudRisk !== null ? 100 - account.fraudRisk : null} />
        <ScorePill label="Anomaly↓" value={account.anomalyScore !== null ? 100 - account.anomalyScore : null} />
      </div>

      {/* Row 4: Reasons (if unhealthy) */}
      {account.reasons.length > 0 && account.state !== "healthy" && (
        <div className="space-y-0.5">
          {account.reasons.slice(0, 2).map((r, i) => (
            <p key={i} className="text-[10px] text-muted-foreground/50 flex items-start gap-1">
              <AlertCircle className="h-3 w-3 text-amber-400/70 flex-shrink-0 mt-px" />
              {r}
            </p>
          ))}
        </div>
      )}
    </button>
  );
}

// ── 2: Traffic Intelligence Panel (per-account) ──────────────────────────────
function TrafficPanel({ account }: { account: PortfolioAccount }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-cyan-400" /> Traffic · 24h
        </h3>
        {account.liveCallCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-semibold text-blue-300">
            <Phone className="h-3 w-3" />
            {account.liveCallCount} live now
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Calls",    value: account.calls24h.toLocaleString(), icon: Phone,      color: "text-purple-400"  },
          { label: "ASR",            value: account.asr24h !== null ? `${account.asr24h}%` : "—", icon: BarChart2, color: account.asr24h !== null ? (account.asr24h >= 50 ? "text-emerald-400" : account.asr24h >= 30 ? "text-amber-400" : "text-rose-400") : "text-muted-foreground/40" },
          { label: "Minutes",        value: account.minutes24h > 0 ? `${account.minutes24h.toLocaleString()} min` : "—", icon: Clock, color: "text-blue-400" },
          { label: "Avg Duration",   value: account.avgDuration24h !== null ? `${account.avgDuration24h}s` : "—", icon: Activity, color: "text-cyan-400" },
        ].map(item => {
          const I = item.icon;
          return (
            <div key={item.label} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <I className={cn("h-3.5 w-3.5 flex-shrink-0", item.color)} />
                <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">{item.label}</span>
              </div>
              <p className="text-lg font-bold text-foreground tabular-nums">{item.value}</p>
            </div>
          );
        })}
      </div>
      {account.revenue24h > 0 && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/15">
          <span className="text-xs text-muted-foreground/60">24h Revenue</span>
          <span className="text-sm font-bold text-emerald-400 tabular-nums">${account.revenue24h.toFixed(2)}</span>
        </div>
      )}
      {account.calls24h === 0 && (
        <div className="flex flex-col items-center justify-center py-4 text-center gap-1">
          <Activity className="h-5 w-5 text-muted-foreground/20" />
          <p className="text-xs text-muted-foreground/40">No calls in the last 24 hours</p>
        </div>
      )}
    </div>
  );
}

// ── 3: Recommendation Panel ──────────────────────────────────────────────────
function RecommendationPanel({ account }: { account: PortfolioAccount }) {
  const rec = account.recommendation;
  const cfg = stateConfig(account.state);

  if (!rec) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 flex flex-col items-center justify-center gap-2 min-h-[120px]">
        <Shield className="h-5 w-5 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground/40 text-center">No recommendation computed yet</p>
      </div>
    );
  }

  const urgencyColor: Record<string, string> = {
    immediate: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    today:     "text-amber-400 bg-amber-500/10 border-amber-500/20",
    monitor:   "text-blue-400 bg-blue-500/10 border-blue-500/20",
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-400" /> Recommended action
        </h3>
        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide", urgencyColor[rec.urgency] ?? "text-slate-400 bg-slate-500/10 border-slate-500/20")}>
          {rec.urgency}
        </span>
      </div>
      <p className="text-sm font-medium text-foreground leading-snug">{rec.primaryAction}</p>
      {rec.actionReason?.length > 0 && (
        <div className="space-y-1">
          {rec.actionReason.slice(0, 3).map((r: string, i: number) => (
            <p key={i} className="text-[10px] text-muted-foreground/50 flex items-start gap-1.5">
              <span className="text-purple-400 mt-px">·</span> {r}
            </p>
          ))}
        </div>
      )}
      {rec.confidence !== undefined && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wide">Confidence</span>
          <div className="flex-1 h-1 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-purple-400/60" style={{ width: `${rec.confidence}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground/50">{rec.confidence}%</span>
        </div>
      )}
    </div>
  );
}

// ── 4: Activity Feed item ────────────────────────────────────────────────────
function ActivityFeedItem({ account }: { account: PortfolioAccount }) {
  const cfg = stateConfig(account.state);
  const events: { icon: React.ComponentType<any>; color: string; text: string; time?: string }[] = [];

  if (account.activeIncidentCount > 0) {
    events.push({ icon: AlertTriangle, color: "text-rose-400", text: `${account.activeIncidentCount} active incident${account.activeIncidentCount > 1 ? "s" : ""}` });
  }
  if (account.state === "at_risk" || account.state === "degraded") {
    events.push({ icon: ShieldAlert, color: "text-orange-400", text: `Account flagged: ${cfg.label}` });
  }
  if (account.balanceTrend === "dropping") {
    events.push({ icon: TrendingDown, color: "text-amber-400", text: "Balance trending down" });
  }
  if (account.trendDirection === "declining" && account.scoreDelta24h < -5) {
    events.push({ icon: TrendingDown, color: "text-rose-400", text: `Health dropped ${Math.abs(account.scoreDelta24h)} pts in 24h` });
  }
  if (account.liveCallCount > 0) {
    events.push({ icon: Phone, color: "text-blue-400", text: `${account.liveCallCount} call${account.liveCallCount > 1 ? "s" : ""} active right now` });
  }
  if (account.asr24h !== null && account.asr24h < 25 && account.calls24h > 10) {
    events.push({ icon: BarChart2, color: "text-amber-400", text: `Low ASR: ${account.asr24h}% (24h)` });
  }
  if (events.length === 0) {
    events.push({ icon: CheckCircle2, color: "text-emerald-400", text: "No alerts — account is healthy" });
  }

  return (
    <div className={cn("rounded-xl border px-3 py-2.5 space-y-1.5 transition-colors", cfg.border, account.state === "healthy" ? "bg-transparent" : "bg-white/[0.01]")}>
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", cfg.dot)} />
        <span className="text-xs font-semibold text-foreground truncate flex-1">{account.clientName}</span>
        {account.updatedAt && (
          <span className="text-[9px] text-muted-foreground/30 flex-shrink-0">
            {new Date(account.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {events.map((ev, i) => {
        const Ico = ev.icon;
        return (
          <div key={i} className="flex items-center gap-1.5 pl-3.5">
            <Ico className={cn("h-3 w-3 flex-shrink-0", ev.color)} />
            <span className="text-[10px] text-muted-foreground/60">{ev.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function KamDashboardPage() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const { data: portfolioData, isLoading: portfolioLoading, refetch: refetchPortfolio, dataUpdatedAt } = useQuery<PortfolioResponse>({
    queryKey: ["/api/kam/portfolio"],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: liveCallsRaw = [] } = useQuery<any>({
    queryKey: ["/api/sippy/live-calls"],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: invoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
    staleTime: 5 * 60_000,
  });

  const { data: disputes = [] } = useQuery<any[]>({
    queryKey: ["/api/billing-disputes"],
    staleTime: 5 * 60_000,
  });

  const portfolio  = portfolioData?.portfolio ?? [];
  const kamName    = portfolioData?.kamName;
  const totalLive  = Array.isArray(liveCallsRaw) ? liveCallsRaw.length : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);
  const openInvoices = Array.isArray(invoices) ? invoices.filter((i: any) => i.status === "sent" || i.status === "overdue").length : 0;
  const openDisputes = Array.isArray(disputes) ? disputes.filter((d: any) => d.status === "open").length : 0;

  const atRisk    = portfolio.filter(a => a.state === "at_risk" || a.state === "degraded");
  const onWatch   = portfolio.filter(a => a.state === "watch");
  const healthy   = portfolio.filter(a => a.state === "healthy");
  const avgHealth = portfolio.length > 0
    ? Math.round(portfolio.reduce((s, a) => s + (a.healthScore ?? 0), 0) / portfolio.length)
    : null;

  const selectedAccount = portfolio.find(a => a.accountId === selectedAccountId) ?? portfolio[0] ?? null;

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col h-full min-h-0">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold uppercase tracking-widest text-purple-400">KAM Portal</span>
                {kamName && <span className="text-xs text-muted-foreground/40">· {kamName}</span>}
              </div>
              <h1 className="text-xl font-bold text-foreground">
                Good {getGreeting()}, {firstName(user?.name ?? user?.login ?? "there")}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">{today}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refetchPortfolio()}
                data-testid="button-refresh-portfolio"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05] transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
              <Link href="/clients">
                <div
                  data-testid="button-view-all-accounts"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 hover:bg-purple-500/15 transition-colors text-xs font-medium"
                >
                  <Users className="h-3.5 w-3.5" />
                  All Accounts
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* ── Body: scrollable ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
          <div className="px-6 py-5 space-y-6">

            {/* ── Portfolio KPI strip ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {[
                {
                  label: "Managed Accounts", value: portfolio.length, icon: Users,
                  color: "text-purple-400", bg: "bg-purple-500/10", href: "/clients",
                  sub: portfolio.length > 0 ? `${healthy.length} healthy` : undefined,
                },
                {
                  label: "Portfolio Health", value: avgHealth !== null ? avgHealth : "—", icon: HeartPulse,
                  color: scoreColor(avgHealth), bg: "bg-white/[0.04]", href: undefined,
                  sub: avgHealth !== null ? (avgHealth >= 80 ? "Strong" : avgHealth >= 60 ? "Fair" : "Needs attention") : undefined,
                },
                {
                  label: "At Risk", value: atRisk.length, icon: ShieldAlert,
                  color: atRisk.length > 0 ? "text-rose-400" : "text-emerald-400",
                  bg: atRisk.length > 0 ? "bg-rose-500/10" : "bg-emerald-500/10",
                  href: undefined,
                  sub: onWatch.length > 0 ? `${onWatch.length} on watch` : "None on watch",
                },
                {
                  label: "Live Calls", value: totalLive, icon: TrendingUp,
                  color: "text-blue-400", bg: "bg-blue-500/10", href: "/calls",
                  sub: "Across portfolio",
                },
                {
                  label: "Open Invoices", value: openInvoices, icon: FileText,
                  color: openInvoices > 0 ? "text-cyan-400" : "text-emerald-400",
                  bg: openInvoices > 0 ? "bg-cyan-500/10" : "bg-emerald-500/10",
                  href: "/invoices",
                  sub: openInvoices > 0 ? "Awaiting payment" : "All settled",
                },
                {
                  label: "Open Disputes", value: openDisputes, icon: AlertTriangle,
                  color: openDisputes > 0 ? "text-amber-400" : "text-emerald-400",
                  bg: openDisputes > 0 ? "bg-amber-500/10" : "bg-emerald-500/10",
                  href: "/billing-disputes",
                  sub: openDisputes > 0 ? "Need resolution" : "None open",
                },
              ].map(card => {
                const I = card.icon;
                const inner = (
                  <div
                    key={card.label}
                    data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className="group relative p-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide leading-none mb-1.5">{card.label}</p>
                        <p className={cn("text-2xl font-bold tabular-nums leading-none", card.color)}>{card.value}</p>
                        {card.sub && <p className="text-[10px] text-muted-foreground/40 mt-1.5 leading-none">{card.sub}</p>}
                      </div>
                      <div className={cn("p-2 rounded-xl flex-shrink-0", card.bg)}>
                        <I className={cn("h-4 w-4", card.color)} />
                      </div>
                    </div>
                    {card.href && <ArrowUpRight className="absolute bottom-3 right-3 h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />}
                  </div>
                );
                return card.href ? <Link key={card.label} href={card.href}>{inner}</Link> : <div key={card.label}>{inner}</div>;
              })}
            </div>

            {/* ── Quick Actions ────────────────────────────────────────────── */}
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">Quick Actions</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                {QUICK_ACTIONS.map(action => {
                  const I = action.icon;
                  return (
                    <Link key={action.label} href={action.href}>
                      <div
                        data-testid={`action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                        className="group p-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all cursor-pointer text-center"
                      >
                        <div className={cn("flex justify-center mb-2 p-2 rounded-xl mx-auto w-fit", action.bg)}>
                          <I className={cn("h-4 w-4", action.color)} />
                        </div>
                        <p className="text-xs font-medium text-foreground leading-tight">{action.label}</p>
                        <p className="text-[9px] text-muted-foreground/40 mt-0.5 leading-tight">{action.desc}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* ── Main 3-column panel ──────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  Account Health Board
                </h2>
                {dataUpdatedAt > 0 && (
                  <span className="text-[9px] text-muted-foreground/30">
                    Updated {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>

              {portfolioLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-6 w-6 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                </div>
              ) : portfolio.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-dashed border-white/[0.07]">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                    <Users className="h-5 w-5 text-muted-foreground/20" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground/50">No accounts in portfolio</p>
                    <p className="text-xs text-muted-foreground/30 mt-1">Assign accounts in Team → KAM Management</p>
                  </div>
                  <Link href="/team">
                    <div className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors mt-1">
                      Go to Team Management <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                  {/* LEFT: Account Health Cards */}
                  <div className="space-y-2.5 lg:col-span-1">
                    {portfolio.map(account => (
                      <AccountHealthCard
                        key={account.accountId}
                        account={account}
                        onClick={() => setSelectedAccountId(account.accountId === selectedAccountId ? null : account.accountId)}
                        selected={account.accountId === (selectedAccount?.accountId)}
                      />
                    ))}
                  </div>

                  {/* CENTER + RIGHT: Detail panels for selected account */}
                  {selectedAccount && (
                    <div className="lg:col-span-2 space-y-4">
                      {/* Account name header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", stateConfig(selectedAccount.state).dot)} />
                          <h3 className="text-sm font-semibold text-foreground">{selectedAccount.clientName}</h3>
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide", stateConfig(selectedAccount.state).bg, stateConfig(selectedAccount.state).color, `border-${stateConfig(selectedAccount.state).border}`)}>
                            {stateConfig(selectedAccount.state).label}
                          </span>
                        </div>
                        <Link href={`/account?id=${selectedAccount.accountId}`}>
                          <span className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors">
                            Full profile <Eye className="h-3 w-3" />
                          </span>
                        </Link>
                      </div>

                      {/* Health score detail */}
                      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 mb-4">
                          <HeartPulse className="h-3.5 w-3.5 text-rose-400" /> Health Signals
                        </h3>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                          <ScorePill label="Overall Health"  value={selectedAccount.healthScore} />
                          <ScorePill label="Quality Score"   value={selectedAccount.qualityScore} />
                          <ScorePill label="Fraud Risk ↓"    value={selectedAccount.fraudRisk !== null ? 100 - selectedAccount.fraudRisk : null} />
                          <ScorePill label="Anomaly Score ↓" value={selectedAccount.anomalyScore !== null ? 100 - selectedAccount.anomalyScore : null} />
                        </div>
                        {selectedAccount.reasons.length > 0 && (
                          <div className="mt-4 space-y-1.5 border-t border-white/[0.05] pt-3">
                            <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wide mb-2">Active signals</p>
                            {selectedAccount.reasons.map((r, i) => (
                              <p key={i} className="text-xs text-muted-foreground/60 flex items-start gap-1.5">
                                <AlertCircle className="h-3 w-3 text-amber-400/70 flex-shrink-0 mt-px" /> {r}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Traffic + Recommendation side-by-side */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <TrafficPanel account={selectedAccount} />
                        <RecommendationPanel account={selectedAccount} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Activity Feed ────────────────────────────────────────────── */}
            {portfolio.length > 0 && (
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-3">
                  Portfolio Activity Feed
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {portfolio.map(account => (
                    <ActivityFeedItem key={account.accountId} account={account} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Quick links ──────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.05]">
              {[
                { label: "CDR Viewer",       href: "/cdrs"            },
                { label: "ASR / ACD",         href: "/asr-acd"         },
                { label: "Traffic Analytics", href: "/analytics"       },
                { label: "Rate History",      href: "/tariff-versions" },
                { label: "Credit Notes",      href: "/credit-notes"    },
                { label: "BitsEye2",          href: "/bitseye2"        },
              ].map(link => (
                <Link key={link.label} href={link.href}>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-foreground transition-colors px-2.5 py-1 rounded-full border border-white/[0.07] hover:border-white/[0.12]">
                    {link.label}
                    <ChevronRight className="h-3 w-3 opacity-50" />
                  </div>
                </Link>
              ))}
            </div>

          </div>
        </div>
      </div>
  );
}
