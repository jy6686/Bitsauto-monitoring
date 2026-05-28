import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, TrendingUp, Wallet, ShieldAlert, SendHorizonal, FileText, BarChart3, HeartPulse, AlertTriangle, CheckCircle2, Clock, ChevronRight, Megaphone, ArrowUpRight, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortal } from "@/context/portal-context";
import { useAuth } from "@/hooks/use-auth";

interface StatCard {
  label:   string;
  value:   string | number;
  sub?:    string;
  icon:    React.ComponentType<{ className?: string }>;
  color:   string;
  href?:   string;
  trend?:  "up" | "down" | "neutral";
}

interface QuickAction {
  label: string;
  desc:  string;
  icon:  React.ComponentType<{ className?: string }>;
  href:  string;
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Send Rate",          desc: "Deliver rate sheet to client",   icon: SendHorizonal, href: "/clients?tab=send-rate",     color: "text-purple-400" },
  { label: "Commercial Notice",  desc: "Broadcast announcement",         icon: Megaphone,     href: "/commercial-notifications",  color: "text-amber-400"  },
  { label: "WhatsApp Alert",     desc: "Send WhatsApp message",          icon: MessageSquare, href: "/whatsapp-alerts",           color: "text-green-400"  },
  { label: "View Invoices",      desc: "Review client billing",          icon: FileText,      href: "/invoices",                  color: "text-blue-400"   },
  { label: "Account Health",     desc: "BitsEye2 drill-down",            icon: HeartPulse,    href: "/bitseye2",                  color: "text-rose-400"   },
  { label: "View Reports",       desc: "Traffic analytics summary",      icon: BarChart3,     href: "/reports",                   color: "text-cyan-400"   },
];

function StatCardItem({ card }: { card: StatCard }) {
  const Icon = card.icon;
  const inner = (
    <div
      data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g,"-")}`}
      className={cn(
        "group relative p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] transition-all",
        card.href && "cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{card.label}</p>
          <p className="text-2xl font-bold mt-0.5 text-foreground">{card.value}</p>
          {card.sub && <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>}
        </div>
        <div className={cn("p-2 rounded-lg bg-white/[0.04] flex-shrink-0", card.color)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {card.href && (
        <ArrowUpRight className="absolute bottom-3 right-3 h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      )}
    </div>
  );
  return card.href ? <Link href={card.href}>{inner}</Link> : inner;
}

export default function KamDashboardPage() {
  const { user } = useAuth();
  const { portalConfig } = usePortal();

  const { data: kamAccounts } = useQuery<any[]>({
    queryKey: ["/api/kam/accounts"],
    staleTime: 60_000,
  });

  const { data: liveCallsRaw } = useQuery<any>({
    queryKey: ["/api/sippy/live-calls"],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: balances } = useQuery<any[]>({
    queryKey: ["/api/sippy/low-balance-accounts"],
    staleTime: 5 * 60_000,
  });

  const { data: invoices } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
    staleTime: 5 * 60_000,
  });

  const { data: disputes } = useQuery<any[]>({
    queryKey: ["/api/billing-disputes"],
    staleTime: 5 * 60_000,
  });

  const totalAccounts = kamAccounts?.length ?? 0;
  const liveCount     = Array.isArray(liveCallsRaw) ? liveCallsRaw.length
                      : (liveCallsRaw?.calls?.length ?? liveCallsRaw?.count ?? 0);
  const lowBalance    = Array.isArray(balances) ? balances.length : 0;
  const openInvoices  = Array.isArray(invoices)  ? invoices.filter((i: any) => i.status === "sent" || i.status === "overdue").length : 0;
  const openDisputes  = Array.isArray(disputes)  ? disputes.filter((d: any) => d.status === "open").length : 0;

  const STATS: StatCard[] = [
    { label: "Managed Accounts", value: totalAccounts,  icon: Users,       color: "text-purple-400", href: "/clients"  },
    { label: "Live Calls",        value: liveCount,      icon: TrendingUp,  color: "text-blue-400",   href: "/calls"    },
    { label: "Low Balance",       value: lowBalance,     icon: Wallet,      color: "text-amber-400",  href: "/balance",
      sub: lowBalance > 0 ? "Require attention" : "All clear",
      trend: lowBalance > 0 ? "down" : "up" },
    { label: "Open Invoices",     value: openInvoices,   icon: FileText,    color: "text-cyan-400",   href: "/invoices"  },
    { label: "Open Disputes",     value: openDisputes,   icon: ShieldAlert, color: "text-rose-400",   href: "/billing-disputes",
      sub: openDisputes > 0 ? "Needs resolution" : "None open" },
  ];

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-purple-400">KAM Portal</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Good {getGreeting()}, {firstName(user?.name ?? user?.login ?? "there")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{today}</p>
        </div>
        <Link href="/clients">
          <div
            data-testid="button-view-all-accounts"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 hover:bg-purple-500/15 transition-colors text-sm font-medium"
          >
            <Users className="h-4 w-4" />
            <span>All Accounts</span>
          </div>
        </Link>
      </div>

      {/* KPI Grid */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Portfolio Overview</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {STATS.map(card => <StatCardItem key={card.label} card={card} />)}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <Link key={action.label} href={action.href}>
                <div
                  data-testid={`action-${action.label.toLowerCase().replace(/\s+/g,"-")}`}
                  className="group p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all cursor-pointer text-center"
                >
                  <div className={cn("flex justify-center mb-2", action.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-foreground leading-tight">{action.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{action.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Health Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attention Required */}
        <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Attention Required
          </h3>
          {lowBalance > 0 && (
            <HealthSignal icon={Wallet} color="text-amber-400" bg="bg-amber-500/10"
              label={`${lowBalance} account${lowBalance > 1 ? "s" : ""} with low balance`}
              action={{ label: "View", href: "/balance" }} />
          )}
          {openDisputes > 0 && (
            <HealthSignal icon={ShieldAlert} color="text-rose-400" bg="bg-rose-500/10"
              label={`${openDisputes} open dispute${openDisputes > 1 ? "s" : ""}`}
              action={{ label: "Review", href: "/billing-disputes" }} />
          )}
          {openInvoices > 0 && (
            <HealthSignal icon={FileText} color="text-blue-400" bg="bg-blue-500/10"
              label={`${openInvoices} invoice${openInvoices > 1 ? "s" : ""} awaiting payment`}
              action={{ label: "View", href: "/invoices" }} />
          )}
          {lowBalance === 0 && openDisputes === 0 && openInvoices === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Portfolio is healthy</span>
            </div>
          )}
        </div>

        {/* Managed Accounts Summary */}
        <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-purple-400" /> Managed Accounts
            </h3>
            <Link href="/clients">
              <span className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-0.5">
                View all <ChevronRight className="h-3 w-3" />
              </span>
            </Link>
          </div>
          {Array.isArray(kamAccounts) && kamAccounts.length > 0 ? (
            <div className="space-y-1.5">
              {kamAccounts.slice(0, 6).map((ka: any, i: number) => (
                <div key={ka.id ?? i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                  <span className="text-sm text-foreground truncate">{ka.clientName ?? `Account ${ka.iAccount}`}</span>
                  <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                    <Clock className="h-3 w-3 inline mr-1 opacity-50" />
                    Active
                  </span>
                </div>
              ))}
              {kamAccounts.length > 6 && (
                <Link href="/clients">
                  <div className="text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors cursor-pointer">
                    +{kamAccounts.length - 6} more accounts
                  </div>
                </Link>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No accounts assigned yet.</p>
          )}
        </div>
      </div>

      {/* Links row */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.05]">
        {[
          { label: "CDR Viewer",     href: "/cdrs"                   },
          { label: "ASR / ACD",      href: "/asr-acd"                },
          { label: "Traffic Analytics", href: "/analytics"           },
          { label: "Rate History",   href: "/tariff-versions"        },
          { label: "Credit Notes",   href: "/credit-notes"           },
        ].map(link => (
          <Link key={link.label} href={link.href}>
            <div className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-full border border-white/[0.07] hover:border-white/[0.12]">
              {link.label}
              <ChevronRight className="h-3 w-3 opacity-50" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HealthSignal({ icon: Icon, color, bg, label, action }: {
  icon:   React.ComponentType<{ className?: string }>;
  color:  string;
  bg:     string;
  label:  string;
  action: { label: string; href: string };
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-2">
        <div className={cn("p-1 rounded", bg)}>
          <Icon className={cn("h-3.5 w-3.5", color)} />
        </div>
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <Link href={action.href}>
        <span className="text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium">
          {action.label}
        </span>
      </Link>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}
