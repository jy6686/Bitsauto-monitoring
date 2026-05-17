import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Bell, Mail, MessageSquare, AlertTriangle, CheckCircle2,
  Clock, ArrowRight, ShieldAlert, Activity, Info, Zap,
  BellOff, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUTC } from "@/lib/date-utils";
import { useAlerts } from "@/hooks/use-alerts";
import { Badge } from "@/components/ui/badge";

// ── Channel card ────────────────────────────────────────────────────────────

function ChannelCard({
  icon: Icon,
  iconColor,
  bgColor,
  borderColor,
  title,
  description,
  href,
  badge,
  badgeVariant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  title: string;
  description: string;
  href: string;
  badge?: string | number;
  badgeVariant?: "default" | "destructive" | "outline";
}) {
  return (
    <Link href={href}
      className={cn(
        "group flex items-start gap-4 rounded-xl border p-5 transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lg cursor-pointer",
        borderColor,
      )}
      data-testid={`card-notif-channel-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", bgColor)}>
        <Icon className={cn("w-5 h-5", iconColor)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm">{title}</p>
          {badge !== undefined && (
            <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 h-4">
              {badge}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-0.5" />
    </Link>
  );
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
      severity === "critical"
        ? "text-rose-400 border-rose-500/30 bg-rose-500/10"
        : "text-amber-400 border-amber-500/30 bg-amber-500/10"
    )}>
      {severity}
    </span>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function NotificationCentrePage() {
  const { data: alerts, isLoading: alertsLoading } = useAlerts();
  const { data: incidents } = useQuery<{ incidents: any[] }>({
    queryKey: ["/api/incidents"],
    refetchInterval: 60_000,
  });

  const activeAlerts  = (alerts ?? []).filter((a: any) => !a.resolved);
  const recentAlerts  = [...(alerts ?? [])].reverse().slice(0, 10);
  const openIncidents = (incidents?.incidents ?? []).filter((i: any) => i.status === "open").length;

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Notification Centre</h2>
            {activeAlerts.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                {activeAlerts.length} Active
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            All notification channels and live system alerts in one place.
          </p>
        </div>
      </div>

      {/* ── Summary strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Alerts",    value: activeAlerts.length,          color: activeAlerts.length > 0 ? "text-rose-400" : "text-muted-foreground", icon: AlertTriangle },
          { label: "Open Incidents",   value: openIncidents,                color: openIncidents > 0 ? "text-amber-400" : "text-muted-foreground",  icon: ShieldAlert   },
          { label: "Total Alerts",     value: alerts?.length ?? 0,          color: "text-foreground",                                                icon: Bell          },
          { label: "Resolved",         value: (alerts?.length ?? 0) - activeAlerts.length, color: "text-emerald-400", icon: CheckCircle2 },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Notification Channels ───────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          Notification Channels
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <ChannelCard
            icon={Mail}
            iconColor="text-blue-400"
            bgColor="bg-blue-500/10"
            borderColor="border-blue-500/20 hover:border-blue-500/40 bg-card"
            title="Email Notifications"
            description="Compose and send balance alerts, threshold warnings, and custom messages to client accounts via email."
            href="/email-centre"
          />
          <ChannelCard
            icon={MessageSquare}
            iconColor="text-green-400"
            bgColor="bg-green-500/10"
            borderColor="border-green-500/20 hover:border-green-500/40 bg-card"
            title="WhatsApp Alerts"
            description="Configure and send real-time WhatsApp notifications for critical events to your team or clients."
            href="/whatsapp-alerts"
          />
          <ChannelCard
            icon={Bell}
            iconColor="text-amber-400"
            bgColor="bg-amber-500/10"
            borderColor="border-amber-500/20 hover:border-amber-500/40 bg-card"
            title="System Alerts"
            description="View all threshold breach alerts, system warnings, and active incidents generated by the platform."
            href="/alerts"
            badge={activeAlerts.length > 0 ? activeAlerts.length : undefined}
            badgeVariant="destructive"
          />
          <ChannelCard
            icon={Activity}
            iconColor="text-violet-400"
            bgColor="bg-violet-500/10"
            borderColor="border-violet-500/20 hover:border-violet-500/40 bg-card"
            title="Alert Rules & Monitoring"
            description="Configure monitoring rules, alert thresholds, and automated detection settings per switch."
            href="/server-monitoring?tab=alert-rules"
          />
        </div>
      </div>

      {/* ── Recent Alerts Feed ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Recent Alerts
          </h3>
          <Link href="/alerts" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
            View all <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        {alertsLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl border border-border/40 bg-card animate-pulse" />
            ))}
          </div>
        ) : recentAlerts.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-card/50 py-12 flex flex-col items-center gap-3 text-center">
            <BellOff className="w-8 h-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No alerts yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">System alerts will appear here when thresholds are breached.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {recentAlerts.map((alert: any) => (
              <div
                key={alert.id}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                  alert.resolved
                    ? "border-border/30 bg-card/40"
                    : alert.severity === "critical"
                    ? "border-rose-500/20 bg-rose-500/5"
                    : "border-amber-500/20 bg-amber-500/5"
                )}
                data-testid={`alert-row-${alert.id}`}
              >
                {alert.resolved ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className={cn(
                    "w-4 h-4 flex-shrink-0 mt-0.5",
                    alert.severity === "critical" ? "text-rose-400" : "text-amber-400"
                  )} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium leading-snug">
                      {alert.type?.split("_").join(" ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </span>
                    {!alert.resolved && <SeverityBadge severity={alert.severity} />}
                    {alert.resolved && (
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Resolved</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{alert.message}</p>
                </div>
                <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 mt-0.5 font-mono whitespace-nowrap">
                  {alert.createdAt ? formatUTC(new Date(alert.createdAt), "MMM d, HH:mm") : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-indigo-300">Configure alert delivery</p>
          <p className="text-xs text-muted-foreground mt-1">
            To receive alerts via email or WhatsApp, assign alert emails to accounts in{" "}
            <Link href="/email-centre" className="text-indigo-400 hover:underline">Email Centre</Link>
            {" "}and configure WhatsApp webhook settings in{" "}
            <Link href="/whatsapp-alerts" className="text-indigo-400 hover:underline">WhatsApp Alerts</Link>.
          </p>
        </div>
      </div>

    </div>
  );
}
