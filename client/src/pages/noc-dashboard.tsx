import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity, AlertTriangle, CheckCircle2, Phone, Wifi,
  Radio, Shield, Eye, ShieldCheck, TrendingUp, TrendingDown,
  Minus, BrainCircuit, Siren, Maximize2, Minimize, Moon, Sun,
  ArrowRight, RefreshCw, AlertOctagon, GitBranch, Network,
  ChevronRight, Clock, Zap, ChevronDown, ChevronUp, ExternalLink,
  PlayCircle, Loader2, AlertCircle, BarChart2, Sparkles, Wallet, Lock, Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useNocWebSocket, type RollbackFailureAlert, type ApprovalExpiredEvent } from "@/hooks/use-noc-ws";
import { X, WrenchIcon } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SslCertStatusEntry {
  certId: string;
  subject: string;
  issuer?: string;
  expiresAt: string;
  daysRemaining: number;
  status: 'ok' | 'warning' | 'critical' | 'expired';
  source: 'sippy_api' | 'tls_probe';
  autoRenew: boolean;
  checkedAt: string;
}

interface SslStatusResponse {
  certs: SslCertStatusEntry[];
  checkedAt: string | null;
}

interface LiveSummary { totalActiveCalls: number; connected?: boolean; }

interface CarrierScore {
  id: number; carrierId: string; carrierName: string;
  stabilityScore: number | null; rollingAsr: number | null;
  avgPddMs: number | null; trend: string | null;
  sampleCount: number; failureRate: number | null;
}

interface IncidentRow {
  id: number; severity: string; title: string; status: string;
  entityName?: string | null; incidentType?: string;
  type?: string; openedAt?: string; updatedAt?: string;
}

interface NocIncidentRow {
  id: number; severity: string; title: string; status: string;
  entityName?: string | null; type: string;
  openedAt: string; updatedAt: string;
  assigneeName?: string | null;
}

interface Recommendation {
  accountId: string; accountName?: string; priority?: number;
  urgency?: string; action?: string; reason?: string; dominantSignal?: string;
}

interface AlertRow { id: number; severity: string; resolved: boolean; acknowledgedAt: string | null; }

interface CapWarning {
  accountId: string;
  accountName: string;
  capType: string;
  currentValue: number;
  limitValue: number;
  utilisationPct: number;
  severity: "warning" | "critical";
  triggeredAt: string;
}

interface CapAlertsResponse {
  warnings: CapWarning[];
  lastSyncedAt: string | null;
  total: number;
  critical: number;
  sippyBaseUrl: string | null;
}

interface StripRecommendation {
  id: string;
  action: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  expectedImpact: string;
  currentVendor?: string;
  targetVendor?: string;
  reasons: string[];
  source_mode?: "ai_enhanced" | "rule_based";
  simulate: { asrDelta: null; stabilityDelta: null; projectedAsr: null; projectedStability: null };
}

interface CopilotSummary {
  hasAlerts: boolean;
  criticalCount: number;
  degradedCount: number;
  fraudEvents: number;
  topAction: string | null;
  topSignal: string | null;
  topRecommendation: StripRecommendation | null;
  totalCarriers: number;
  generatedAt: string;
}

// ── Strip Quick-Apply Modal ─────────────────────────────────────────────────────

const RISK_LABEL: Record<string, string> = {
  low: "Low Risk", medium: "Medium Risk", high: "High Risk",
};
const RISK_CLS: Record<string, string> = {
  low:    "bg-green-500/10 text-green-400 border-green-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  high:   "bg-red-500/10 text-red-400 border-red-500/30",
};

function StripQuickApplyModal({
  rec,
  onConfirm,
  onCancel,
  isPending,
  executionEnabled,
}: {
  rec: StripRecommendation;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  executionEnabled: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isPending ? onCancel : undefined}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative z-10 w-full max-w-md rounded-2xl border border-violet-500/30 bg-card shadow-2xl overflow-hidden"
        data-testid="strip-apply-modal"
      >
        <div className="bg-gradient-to-r from-violet-500/10 to-cyan-500/5 border-b border-violet-500/20 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
              <PlayCircle className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Apply Routing Action</h3>
              <p className="text-[11px] text-muted-foreground">Confirm the recommended action from the Copilot strip</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg bg-muted/50 border border-border px-3.5 py-3">
            <p className="text-xs font-semibold text-foreground leading-snug">{rec.action}</p>
            {rec.currentVendor && (
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">Carrier: {rec.currentVendor}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border", RISK_CLS[rec.risk])}>
              {RISK_LABEL[rec.risk]}
            </span>
            {rec.source_mode === "ai_enhanced" ? (
              <span
                data-testid="strip-source-mode-badge-ai"
                className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border bg-violet-500/10 text-violet-400 border-violet-500/30"
              >
                <Sparkles className="h-2.5 w-2.5" />
                AI
              </span>
            ) : (
              <span
                data-testid="strip-source-mode-badge-rules"
                className="flex items-center gap-1 text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded border bg-amber-500/10 text-amber-500 border-amber-500/30"
              >
                <Network className="h-2.5 w-2.5" />
                Rules
              </span>
            )}
            <span className="text-[10px] text-muted-foreground font-mono">
              Confidence: <span className="font-semibold text-foreground">{rec.confidence}%</span>
            </span>
          </div>

          <div className="flex items-start gap-2 text-xs rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-3 py-2">
            <BarChart2 className="h-3.5 w-3.5 text-cyan-500 flex-shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{rec.expectedImpact}</span>
          </div>

          {/* Execution mode notice */}
          {executionEnabled ? (
            <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2">
              <span className="font-bold uppercase tracking-widest text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">LIVE</span>
              <span>Execution gate is open — this will write directly to Sippy and confirm via re-read.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
              <span className="font-bold uppercase tracking-widest text-[10px] bg-amber-500/20 border border-amber-500/30 text-amber-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">DRY-RUN</span>
              <span>Audit-ledger only. Set <code className="font-mono">C2_EXECUTION_ENABLED=true</code> to enable live writes.</span>
            </div>
          )}
        </div>

        <div className="px-5 pb-4 flex items-center justify-end gap-2.5">
          <button
            data-testid="strip-modal-cancel"
            onClick={onCancel}
            disabled={isPending}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            data-testid="strip-modal-confirm"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {isPending ? "Applying…" : "Confirm & Apply"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Approval Expired Banner ─────────────────────────────────────────────────────

function ApprovalExpiredBanner({
  events,
  onDismiss,
}: {
  events: ApprovalExpiredEvent[];
  onDismiss: (expiredAt: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="flex-shrink-0 flex flex-col gap-1 px-3 py-2 bg-orange-950/60 border-b border-orange-700/60">
      {events.map((evt) => (
        <motion.div
          key={`${evt.actionId}-${evt.expiredAt}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          data-testid={`approval-expired-banner-${evt.actionId}`}
          className="flex items-start gap-2.5 rounded-lg border border-orange-600/50 bg-orange-900/40 px-3 py-2"
        >
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
            </span>
            <Clock className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest text-orange-300 bg-orange-500/20 border border-orange-500/30 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                APPROVAL EXPIRED
              </span>
              <span className="text-[11px] font-semibold text-orange-200 font-mono">
                Action #{evt.actionId} — {evt.accountName}
              </span>
              <span className="text-[10px] font-bold uppercase font-mono bg-red-500/10 border border-red-500/20 text-red-400 px-1 py-0.5 rounded">
                {evt.actionType}
              </span>
            </div>
            <p className="text-[11px] text-orange-300/80 mt-0.5 leading-snug">
              Requested by {evt.requestedByName} — auto-rejected after {evt.ttlMinutes}m TTL with no second operator action.
            </p>
          </div>
          <button
            data-testid={`approval-expired-dismiss-${evt.actionId}`}
            onClick={() => onDismiss(evt.expiredAt)}
            className="flex-shrink-0 p-1 rounded hover:bg-orange-700/40 text-orange-400 hover:text-orange-200 transition-colors"
            aria-label="Dismiss approval expired alert"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

// ── SSL Certificate Expiry Banner ────────────────────────────────────────────

function SslCertExpiryBanner({
  certs,
  onDismiss,
}: {
  certs: SslCertStatusEntry[];
  onDismiss: (certId: string) => void;
}) {
  const alertCerts = certs.filter(c => c.status !== 'ok');
  if (alertCerts.length === 0) return null;
  return (
    <div className="flex-shrink-0 flex flex-col gap-1 px-3 py-2 bg-amber-950/50 border-b border-amber-700/50">
      {alertCerts.map(cert => {
        const isExpired  = cert.status === 'expired';
        const isCritical = cert.status === 'critical';
        const bg   = isExpired || isCritical ? "bg-red-950/70 border-red-700/60"  : "bg-amber-950/60 border-amber-700/50";
        const icon = isExpired || isCritical ? "text-red-400" : "text-amber-400";
        const badge = isExpired
          ? "bg-red-500/20 text-red-300 border-red-500/30"
          : isCritical
          ? "bg-red-500/20 text-red-300 border-red-500/30"
          : "bg-amber-500/20 text-amber-300 border-amber-500/30";
        const label = isExpired ? "EXPIRED" : isCritical ? "CRITICAL" : "EXPIRING SOON";
        const expiryStr = cert.daysRemaining < 0
          ? `Expired ${Math.abs(cert.daysRemaining)} day(s) ago`
          : `${cert.daysRemaining} day(s) remaining`;
        return (
          <motion.div
            key={cert.certId}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn("flex items-start gap-3 rounded px-3 py-2 border", bg)}
            data-testid={`ssl-cert-banner-${cert.certId}`}
          >
            <Lock className={cn("h-3.5 w-3.5 flex-shrink-0 mt-0.5", icon)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border font-mono flex-shrink-0", badge)}>
                  SSL {label}
                </span>
                <span className="text-[11px] font-semibold text-slate-200 font-mono truncate">
                  {cert.subject}
                </span>
                {cert.autoRenew && (
                  <span className="text-[10px] font-mono bg-blue-500/10 border border-blue-500/20 text-blue-400 px-1 py-0.5 rounded flex-shrink-0">
                    Let's Encrypt
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: isExpired || isCritical ? '#fca5a5' : '#fcd34d' }}>
                <span>{expiryStr} · Expires {new Date(cert.expiresAt).toLocaleDateString()}</span>
                <a
                  href="/?fix=open"
                  data-testid={`ssl-cert-fix-link-${cert.certId}`}
                  onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent('open-fix-button')); }}
                  className="underline underline-offset-2 hover:opacity-80 transition-opacity flex-shrink-0"
                >
                  View in Fix Button →
                </a>
              </p>
            </div>
            <button
              data-testid={`ssl-cert-dismiss-${cert.certId}`}
              onClick={() => onDismiss(cert.certId)}
              className={cn("flex-shrink-0 p-1 rounded transition-colors", isExpired || isCritical ? "hover:bg-red-700/40 text-red-400 hover:text-red-200" : "hover:bg-amber-700/40 text-amber-400 hover:text-amber-200")}
              aria-label="Dismiss SSL certificate alert"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Rollback Failure Banner ─────────────────────────────────────────────────────

function RollbackFailureBanner({
  alerts,
  onDismiss,
}: {
  alerts: RollbackFailureAlert[];
  onDismiss: (occurredAt: string) => void;
}) {
  if (alerts.length === 0) return null;
  return (
    <div className="flex-shrink-0 flex flex-col gap-1 px-3 py-2 bg-red-950/60 border-b border-red-700/60">
      {alerts.map((alert) => (
        <motion.div
          key={alert.occurredAt}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          data-testid={`rollback-failure-banner-${alert.actionId}`}
          className="flex items-start gap-2.5 rounded-lg border border-red-600/50 bg-red-900/40 px-3 py-2"
        >
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            <WrenchIcon className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-300 bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                {alert.manualRequired ? "MANUAL ACTION REQUIRED" : "ROLLBACK FAILED"}
              </span>
              <span className="text-[11px] font-semibold text-red-200 font-mono">
                Action #{alert.actionId} — {alert.accountName}
              </span>
            </div>
            <p className="text-[11px] text-red-300/80 mt-0.5 leading-snug line-clamp-2">{alert.errorMessage}</p>
            <p className="text-[10px] text-red-400/60 mt-0.5 font-mono">
              {alert.manualRequired
                ? "The route/block change must be manually reverted in Sippy — automatic reversal is not available for this action type."
                : "Sippy write failed. Live routing state may not match the expected state. Check connectivity and retry."}
              {" "}Check the <strong className="text-red-300">NOC Incidents</strong> log for full details.
            </p>
          </div>
          <button
            data-testid={`rollback-failure-dismiss-${alert.actionId}`}
            onClick={() => onDismiss(alert.occurredAt)}
            className="flex-shrink-0 p-1 rounded hover:bg-red-700/40 text-red-400 hover:text-red-200 transition-colors"
            aria-label="Dismiss rollback failure alert"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}

// ── Copilot Alert Strip ─────────────────────────────────────────────────────────

function formatAgo(isoString: string, now: number): string {
  const diff = Math.floor((now - new Date(isoString).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

const COPILOT_INTERVAL_S = 5 * 60;

function formatNextIn(isoString: string, now: number): string {
  const elapsed = Math.floor((now - new Date(isoString).getTime()) / 1000);
  const remaining = Math.max(0, COPILOT_INTERVAL_S - elapsed);
  if (remaining === 0) return "refreshing…";
  if (remaining < 60) return `${remaining}s`;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function nextInOverdueSecs(isoString: string, now: number): number {
  const elapsed = Math.floor((now - new Date(isoString).getTime()) / 1000);
  return Math.max(0, elapsed - COPILOT_INTERVAL_S);
}

function nextInColorClass(overdueSecs: number): string {
  if (overdueSecs >= 90) return "text-red-400";
  if (overdueSecs >= 30) return "text-amber-400";
  return "";
}

function CopilotAlertStrip({
  summary,
  canApply,
  onQuickApply,
}: {
  summary: CopilotSummary | undefined;
  canApply: boolean;
  onQuickApply: (rec: StripRecommendation) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [flashKey, setFlashKey] = useState(0);
  const prevGeneratedAt = useRef<string | undefined>(undefined);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!summary) return;
    if (
      prevGeneratedAt.current !== undefined &&
      prevGeneratedAt.current !== summary.generatedAt
    ) {
      setFlashKey(k => k + 1);
    }
    prevGeneratedAt.current = summary.generatedAt;
  }, [summary?.generatedAt]);

  if (!summary) return null;

  const ageLabel    = formatAgo(summary.generatedAt, now);
  const nextInLabel = formatNextIn(summary.generatedAt, now);
  const overdueSecs = nextInOverdueSecs(summary.generatedAt, now);
  const nextInCls   = nextInColorClass(overdueSecs);

  if (!summary.hasAlerts) {
    return (
      <div
        data-testid="copilot-quiet-strip"
        className="relative flex-shrink-0 border-b border-slate-800/50 bg-slate-900/20 flex items-center gap-2 px-4 py-1.5 overflow-hidden"
      >
        {flashKey > 0 && (
          <motion.div
            key={`flash-quiet-${flashKey}`}
            data-testid="copilot-flash-overlay"
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.0, ease: "easeOut" }}
            style={{ backgroundColor: "rgba(99,202,183,0.18)" }}
          />
        )}
        <BrainCircuit className="h-3 w-3 text-slate-600 flex-shrink-0" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-600">
          AI Copilot
        </span>
        <span className="text-slate-700 flex-shrink-0">·</span>
        <CheckCircle2 className="h-3 w-3 text-emerald-600/70 flex-shrink-0" />
        <span className="text-[10px] font-mono text-emerald-600/70">All carriers healthy</span>
        <span className="ml-auto text-[10px] font-mono text-slate-600 tabular-nums" data-testid="copilot-last-updated">
          Updated {ageLabel}
          <span className="text-slate-700"> / next in </span>
          <span data-testid="copilot-next-refresh" className={cn("transition-colors duration-500", nextInCls || "text-slate-600")}>{nextInLabel}</span>
        </span>
      </div>
    );
  }

  const isCritical = summary.criticalCount > 0;
  const borderColor = isCritical ? "border-red-500/40" : "border-amber-500/40";
  const bgColor     = isCritical ? "bg-red-500/8"      : "bg-amber-500/8";
  const iconColor   = isCritical ? "text-red-400"       : "text-amber-400";
  const badgeCls    = isCritical
    ? "bg-red-500/20 text-red-300 border-red-500/40"
    : "bg-amber-500/20 text-amber-300 border-amber-500/40";
  const alertLabel  = isCritical ? "CRITICAL" : "WARNING";

  const totalAlerts = summary.criticalCount + summary.degradedCount;

  return (
    <AnimatePresence>
      <motion.div
        key="copilot-strip"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25 }}
        className={cn(
          "relative flex-shrink-0 border-b flex flex-col overflow-hidden",
          borderColor, bgColor,
        )}
        data-testid="copilot-alert-strip"
      >
        {flashKey > 0 && (
          <motion.div
            key={`flash-alert-${flashKey}`}
            data-testid="copilot-flash-overlay"
            className="absolute inset-0 pointer-events-none z-10"
            initial={{ opacity: 0.7 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.0, ease: "easeOut" }}
            style={{
              backgroundColor: isCritical
                ? "rgba(239,68,68,0.22)"
                : "rgba(234,179,8,0.18)",
            }}
          />
        )}
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-2">
          {isCritical
            ? <Pulse color="red" size={1} />
            : <Pulse color="amber" size={1} />
          }
          <BrainCircuit className={cn("h-3.5 w-3.5 flex-shrink-0", iconColor)} />
          <span className={cn("text-[10px] font-bold uppercase tracking-widest flex-shrink-0", iconColor)}>
            Copilot Alerts
          </span>

          <span className={cn(
            "text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border flex-shrink-0",
            badgeCls,
          )}>
            {alertLabel}
          </span>

          {totalAlerts > 0 && (
            <span className={cn("text-[10px] font-mono font-bold flex-shrink-0", iconColor)}>
              {totalAlerts} carrier{totalAlerts > 1 ? "s" : ""}
            </span>
          )}

          {summary.topSignal && (
            <>
              <span className="text-slate-700 flex-shrink-0">·</span>
              <span className="text-[11px] text-slate-300 truncate flex-1 min-w-0">
                {summary.topSignal}
              </span>
            </>
          )}

          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            <span
              data-testid="copilot-last-updated"
              className="text-[10px] font-mono text-slate-500 tabular-nums"
            >
              Updated {ageLabel}
              <span className="text-slate-600"> / next in </span>
              <span data-testid="copilot-next-refresh" className={cn("transition-colors duration-500", nextInCls || "text-slate-500")}>{nextInLabel}</span>
            </span>
            <Link href="/route-intelligence?tab=copilot">
              <a
                data-testid="copilot-strip-open-intel"
                className={cn(
                  "flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-1 rounded border transition-all",
                  isCritical
                    ? "border-red-500/40 text-red-400 hover:bg-red-500/20"
                    : "border-amber-500/40 text-amber-400 hover:bg-amber-500/20",
                )}
              >
                <ExternalLink className="h-2.5 w-2.5" />
                Route Intelligence
              </a>
            </Link>
            <button
              data-testid="copilot-strip-collapse"
              onClick={() => setCollapsed(v => !v)}
              className="p-1 rounded hover:bg-slate-800/60 text-slate-500 hover:text-slate-300 transition-colors"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronUp className="h-3.5 w-3.5" />
              }
            </button>
          </div>
        </div>

        {/* Expandable action row */}
        <AnimatePresence>
          {!collapsed && summary.topAction && (
            <motion.div
              key="strip-body"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="px-4 pb-2"
            >
              <div className="flex items-center gap-2 pl-6">
                <ArrowRight className={cn("h-3 w-3 flex-shrink-0", iconColor)} />
                <span className="text-[11px] text-slate-300 font-mono leading-snug flex-1">
                  {summary.topAction}
                </span>
                {canApply && summary.topRecommendation && (
                  <button
                    data-testid="copilot-strip-quick-apply"
                    onClick={() => onQuickApply(summary.topRecommendation!)}
                    className={cn(
                      "flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded border transition-all flex-shrink-0",
                      isCritical
                        ? "border-red-500/50 text-red-300 bg-red-500/15 hover:bg-red-500/30"
                        : "border-amber-500/50 text-amber-300 bg-amber-500/15 hover:bg-amber-500/30",
                    )}
                    title="Apply this recommendation directly from the NOC strip"
                  >
                    <PlayCircle className="h-2.5 w-2.5" />
                    Apply
                  </button>
                )}
              </div>
              {summary.fraudEvents > 3 && (
                <div className="flex items-center gap-1.5 pl-6 mt-1">
                  <Shield className="h-3 w-3 text-rose-400 flex-shrink-0" />
                  <span className="text-[10px] text-rose-400 font-mono">
                    {summary.fraudEvents} fraud events in last 24h
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────────────────

function Pulse({ color = "green", size = 2 }: { color?: "green" | "amber" | "red"; size?: number }) {
  const c = {
    green: ["bg-green-500", "bg-green-400"],
    amber: ["bg-amber-500", "bg-amber-400"],
    red:   ["bg-red-500",   "bg-red-400"],
  }[color];
  return (
    <span className="relative inline-flex">
      <motion.span
        className={cn("absolute rounded-full", c[1])}
        style={{ width: size * 4, height: size * 4, top: 0, left: 0 }}
        animate={{ scale: [1, 2.5, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
      />
      <span className={cn("relative rounded-full", c[0])} style={{ width: size * 4, height: size * 4 }} />
    </span>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-xs text-slate-400 tabular-nums tracking-widest">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

function KpiChip({ label, value, color, pulse, icon: Icon }: {
  label: string; value: string | number; color: string;
  pulse?: "green" | "amber" | "red"; icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900/60 border border-slate-700/50 backdrop-blur-sm">
      {pulse && <Pulse color={pulse} size={1} />}
      {Icon && !pulse && <Icon className={cn("h-3 w-3 flex-shrink-0", color)} />}
      <span className={cn("font-mono text-sm font-bold tabular-nums", color)}>{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">{label}</span>
    </div>
  );
}

const SEV_CONFIG: Record<string, { bg: string; border: string; dot: string; text: string }> = {
  critical: { bg: "bg-red-500/10",    border: "border-red-500/30",   dot: "bg-red-500",    text: "text-red-400"    },
  high:     { bg: "bg-orange-500/10", border: "border-orange-500/30",dot: "bg-orange-500", text: "text-orange-400" },
  medium:   { bg: "bg-amber-500/10",  border: "border-amber-500/30", dot: "bg-amber-500",  text: "text-amber-400"  },
  low:      { bg: "bg-blue-500/10",   border: "border-blue-500/30",  dot: "bg-blue-400",   text: "text-blue-400"   },
};

const STATUS_BADGE: Record<string, string> = {
  open:          "bg-red-500/20 text-red-400 border-red-500/30",
  investigating: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  active:        "bg-red-500/20 text-red-400 border-red-500/30",
  mitigated:     "bg-blue-500/20 text-blue-400 border-blue-500/30",
  resolved:      "bg-green-500/20 text-green-400 border-green-500/30",
};

function timeAgo(ts: string | undefined): string {
  if (!ts) return "";
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function IncidentFeedRow({ inc, onInvestigate }: {
  inc: IncidentRow | NocIncidentRow;
  onInvestigate?: (id: number) => void;
}) {
  const sev = SEV_CONFIG[inc.severity] ?? SEV_CONFIG.medium;
  const ts = (inc as any).openedAt ?? (inc as any).updatedAt;
  const incType = (inc as any).type ?? (inc as any).incidentType ?? "incident";
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn("flex items-start gap-2.5 px-3 py-2 rounded-md border text-xs", sev.bg, sev.border)}
    >
      <span className={cn("w-2 h-2 rounded-full flex-shrink-0 mt-1", sev.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={cn("text-[10px] uppercase font-bold font-mono", sev.text)}>
            {inc.severity}
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-[10px] text-slate-500 font-mono truncate">
            {incType.replace(/_/g, " ")}
          </span>
        </div>
        <p className="text-slate-200 font-medium leading-tight truncate">{inc.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {inc.entityName && (
            <span className="text-[10px] text-slate-500 truncate">{inc.entityName}</span>
          )}
          <span className="text-[10px] text-slate-600 ml-auto flex-shrink-0">{timeAgo(ts)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <span className={cn(
          "text-[9px] uppercase font-bold font-mono px-1.5 py-0.5 rounded border",
          STATUS_BADGE[inc.status] ?? "bg-slate-700/40 text-slate-400 border-slate-600/30",
        )}>
          {inc.status}
        </span>
        {onInvestigate && (
          <button
            data-testid={`noc-investigate-${inc.id}`}
            onClick={() => onInvestigate(inc.id)}
            className="p-1 rounded hover:bg-amber-500/20 text-slate-500 hover:text-amber-400 transition-colors"
            title="Investigate"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function stabilityColor(score: number | null): "green" | "amber" | "red" {
  if (score == null || score < 45) return "red";
  if (score < 70) return "amber";
  return "green";
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (trend === "improving") return <TrendingUp className="h-3.5 w-3.5 text-green-400" />;
  if (trend === "degrading")  return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-slate-500" />;
}

const URGENCY_CONFIG: Record<string, { label: string; color: string }> = {
  immediate: { label: "IMMED", color: "bg-red-500/20 text-red-400 border-red-500/30"    },
  today:     { label: "TODAY", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  monitor:   { label: "MONIT", color: "bg-slate-700/40 text-slate-400 border-slate-600/30" },
};

const INCIDENT_TICKER_ITEMS = [
  "All nominal — monitoring 24/7",
];

function IncidentTicker({ incidents }: { incidents: IncidentRow[] }) {
  const active = incidents.filter(i => i.status === "active" || i.status === "open");
  if (active.length === 0) return (
    <div className="flex items-center gap-2 text-green-500 text-[11px] font-mono">
      <CheckCircle2 className="h-3.5 w-3.5" />
      All systems nominal — {incidents.length} incidents monitored
    </div>
  );
  return (
    <div className="flex items-center gap-3 overflow-hidden">
      <span className="text-[10px] font-bold uppercase tracking-widest text-red-500 flex-shrink-0 flex items-center gap-1.5">
        <Pulse color="red" size={1} /> LIVE
      </span>
      <div className="overflow-hidden flex-1">
        <motion.div
          className="flex gap-8 whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear", repeatType: "loop" }}
        >
          {[...active, ...active].map((inc, i) => (
            <span key={`${inc.id}-${i}`} className={cn(
              "text-[11px] font-mono flex-shrink-0",
              inc.severity === "critical" ? "text-red-400" : "text-amber-400",
            )}>
              [{inc.severity.toUpperCase()}] {inc.title}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { href: "/noc-incidents",      label: "Incident Cmd", icon: AlertOctagon, color: "text-red-400"     },
  { href: "/route-intelligence", label: "Route Intel",  icon: GitBranch,    color: "text-cyan-400"    },
  { href: "/alerts",             label: "Alerts",       icon: AlertTriangle,color: "text-amber-400"   },
  { href: "/fraud",              label: "Fraud",        icon: Siren,        color: "text-rose-400"    },
  { href: "/analytics",         label: "Analytics",    icon: Activity,     color: "text-violet-400"  },
  { href: "/noc-command",       label: "NOC Classic",  icon: Network,      color: "text-slate-400"   },
];

export default function NocDashboardPage() {
  const [fullscreen, setFullscreen] = useState(false);
  const [stripModalRec, setStripModalRec] = useState<StripRecommendation | null>(null);
  const [rollbackAlerts, setRollbackAlerts] = useState<RollbackFailureAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [expiredApprovals, setExpiredApprovals] = useState<ApprovalExpiredEvent[]>([]);
  const [dismissedExpiry, setDismissedExpiry] = useState<Set<string>>(new Set());
  const [dismissedSslCerts, setDismissedSslCerts] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { isManagement } = useAuth();
  const { lastRollbackFailure, lastApprovalExpired } = useNocWebSocket();

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => { document.documentElement.classList.remove('dark'); };
  }, []);

  useEffect(() => {
    if (!lastRollbackFailure) return;
    if (dismissedAlerts.has(lastRollbackFailure.occurredAt)) return;
    setRollbackAlerts(prev => {
      if (prev.some(a => a.occurredAt === lastRollbackFailure.occurredAt)) return prev;
      return [lastRollbackFailure, ...prev];
    });
  }, [lastRollbackFailure]);

  useEffect(() => {
    if (!lastApprovalExpired) return;
    const key = `${lastApprovalExpired.actionId}-${lastApprovalExpired.expiredAt}`;
    if (dismissedExpiry.has(key)) return;
    setExpiredApprovals(prev => {
      if (prev.some(e => e.actionId === lastApprovalExpired.actionId && e.expiredAt === lastApprovalExpired.expiredAt)) return prev;
      return [lastApprovalExpired, ...prev];
    });
  }, [lastApprovalExpired]);

  const { data: liveSummary } = useQuery<LiveSummary>({
    queryKey: ["/api/sippy/live-calls"],
    refetchInterval: 12_000,
  });

  const { data: scores = [] } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 45_000,
  });

  const { data: incidents = [], isFetching: incFetching } = useQuery<IncidentRow[]>({
    queryKey: ["/api/incidents"],
    refetchInterval: 25_000,
  });

  const { data: nocIncidentRows = [] } = useQuery<NocIncidentRow[]>({
    queryKey: ["/api/noc/incidents"],
    refetchInterval: 25_000,
  });

  const { data: alerts = [] } = useQuery<AlertRow[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 20_000,
  });

  const { data: recommendations = [] } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    refetchInterval: 90_000,
  });

  const { data: balAlertData } = useQuery<{ alerts: any[] }>({
    queryKey: ["/api/noc/balance-alerts"],
    refetchInterval: 5 * 60_000,
  });
  const balAlerts = balAlertData?.alerts ?? [];
  const criticalBalAlerts = balAlerts.filter(a => a.severity === "critical");
  const urgentBalAlerts   = balAlerts.filter(a => a.severity === "urgent");

  const { data: capAlerts, isFetching: capFetching, refetch: refetchCaps } = useQuery<CapAlertsResponse>({
    queryKey: ["/api/noc/cap-alerts"],
    refetchInterval: 30_000,
  });

  const { data: copilotSummary } = useQuery<CopilotSummary>({
    queryKey: ["/api/ai/route-copilot/summary"],
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: execModeData } = useQuery<{ enabled: boolean; mode: string }>({
    queryKey: ["/api/ai/route-copilot/execution-mode"],
    staleTime: 30_000,
  });
  const executionEnabled = execModeData?.enabled ?? false;

  const { data: sslStatusData } = useQuery<SslStatusResponse>({
    queryKey: ["/api/system/ssl-status"],
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
    staleTime: 20 * 60 * 1000,
  });
  const visibleSslCerts = (sslStatusData?.certs ?? []).filter(
    c => c.status !== 'ok' && !dismissedSslCerts.has(c.certId)
  );

  const investigateMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("PATCH", `/api/noc/incidents/${id}/status`, { status: "investigating" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents"] }),
  });

  const stripApplyMutation = useMutation<
    { success: boolean; actionId: number; mode: string; status: string; sippyNote: string },
    Error,
    StripRecommendation
  >({
    mutationFn: (rec) =>
      apiRequest("POST", "/api/ai/route-copilot/apply", {
        recommendation: rec,
        source_mode: rec.source_mode ?? "rule_based",
      })
        .then(r => r.json())
        .then(data => {
          if (!data.success) throw new Error(data.error ?? "Apply failed");
          return data;
        }),
    onSuccess: (data) => {
      setStripModalRec(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/route-copilot/summary"] });
      toast({
        title: data.mode === "executed" ? "Routing action applied" : "Action recorded (dry-run)",
        description: data.sippyNote ?? `Action #${data.actionId} logged to audit ledger.`,
      });
    },
    onError: (err) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  const showLowBalanceStrip = (criticalBalAlerts.length + urgentBalAlerts.length) > 0;

  const activeCalls       = liveSummary?.totalActiveCalls ?? 0;
  const allActiveInc      = [
    ...incidents.filter(i => i.status === "active" || i.status === "open"),
    ...nocIncidentRows.filter(i => i.status === "open" || i.status === "investigating"),
  ].sort((a, b) => {
    const sOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (sOrder[a.severity] ?? 4) - (sOrder[b.severity] ?? 4);
  });
  const openAlerts        = alerts.filter(a => !a.resolved);
  const avgAsr            = scores.length ? (scores.reduce((s, c) => s + (c.rollingAsr ?? 0), 0) / scores.filter(c => c.rollingAsr != null).length || 0) : null;
  const avgPdd            = scores.length ? (scores.reduce((s, c) => s + (c.avgPddMs ?? 0), 0) / scores.filter(c => c.avgPddMs != null).length || 0) : null;
  const avgStab           = scores.length ? (scores.reduce((s, c) => s + (c.stabilityScore ?? 0), 0) / scores.filter(c => c.stabilityScore != null).length || 0) : null;
  const carrierOutages    = scores.filter(s => (s.stabilityScore ?? 100) < 45).length;
  const criticalIncidents = allActiveInc.filter(i => i.severity === "critical").length;

  const toggleFs = () => {
    if (!fullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
    setFullscreen(v => !v);
  };

  return (
    <div className={cn(
      "bg-[#060a12] text-slate-100 min-h-screen flex flex-col font-mono",
      fullscreen && "fixed inset-0 z-[9999]",
    )}>

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 border-b border-slate-800/80 bg-[#080d18] px-4 py-2 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1">
            <Pulse color="green" size={1} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              BITSAUTO NOC
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden border border-slate-800 rounded px-3 py-1.5 bg-slate-900/40">
          <IncidentTicker incidents={incidents} />
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <LiveClock />
          <button
            data-testid="noc-dash-fullscreen"
            onClick={toggleFs}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          >
            {fullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="flex-shrink-0 border-b border-slate-800/60 bg-[#070b16] px-4 py-2 flex flex-wrap items-center gap-2">
        <KpiChip
          label="CALLS"
          value={activeCalls}
          color={activeCalls > 0 ? "text-cyan-400" : "text-slate-500"}
          pulse={activeCalls > 0 ? "green" : undefined}
          icon={Phone}
        />
        <KpiChip
          label="ASR"
          value={avgAsr != null ? `${avgAsr.toFixed(1)}%` : "—"}
          color={avgAsr == null ? "text-slate-500" : avgAsr < 35 ? "text-red-400" : avgAsr < 55 ? "text-amber-400" : "text-green-400"}
          icon={Activity}
        />
        <KpiChip
          label="FAIL"
          value={scores.length ? `${(scores.reduce((s, c) => s + (c.failureRate ?? 0), 0) / scores.filter(c => c.failureRate != null).length || 0).toFixed(1)}%` : "—"}
          color="text-slate-300"
          icon={Zap}
        />
        <KpiChip
          label="PDD"
          value={avgPdd != null ? `${avgPdd.toFixed(0)}ms` : "—"}
          color={avgPdd == null ? "text-slate-500" : avgPdd > 500 ? "text-red-400" : avgPdd > 350 ? "text-amber-400" : "text-green-400"}
          icon={Clock}
        />
        <KpiChip
          label="STAB"
          value={avgStab != null ? avgStab.toFixed(0) : "—"}
          color={avgStab == null ? "text-slate-500" : avgStab < 45 ? "text-red-400" : avgStab < 70 ? "text-amber-400" : "text-green-400"}
          icon={Shield}
        />
        <div className="w-px h-5 bg-slate-700 mx-1" />
        <KpiChip
          label="INC"
          value={allActiveInc.length}
          color={allActiveInc.length === 0 ? "text-green-400" : criticalIncidents > 0 ? "text-red-400" : "text-amber-400"}
          pulse={allActiveInc.length > 0 ? (criticalIncidents > 0 ? "red" : "amber") : undefined}
          icon={AlertOctagon}
        />
        <KpiChip
          label="ALERTS"
          value={openAlerts.length}
          color={openAlerts.length === 0 ? "text-slate-500" : "text-amber-400"}
          icon={AlertTriangle}
        />
        <KpiChip
          label="OUTAGES"
          value={carrierOutages}
          color={carrierOutages === 0 ? "text-slate-500" : "text-red-400"}
          pulse={carrierOutages > 0 ? "red" : undefined}
          icon={Wifi}
        />
        <div className="ml-auto flex gap-1.5">
          {QUICK_LINKS.slice(0, 4).map(({ href, label, icon: Icon, color }) => (
            <Link key={href} href={href}>
              <a
                data-testid={`noc-dash-link-${label.toLowerCase().replace(/\s/g, "-")}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/60 transition-all text-[10px] text-slate-400 hover:text-slate-200"
              >
                <Icon className={cn("h-3 w-3", color)} />
                {label}
              </a>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Low Balance Alert Strip ── */}
      {showLowBalanceStrip && (
        <div className="flex-shrink-0 bg-amber-950/40 border-b border-amber-500/30 px-4 py-1.5 flex items-center gap-3 overflow-x-auto">
          <Wallet className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 shrink-0">
            Low Balance
          </span>
          <div className="flex items-center gap-2 flex-1 overflow-x-auto">
            {[...criticalBalAlerts, ...urgentBalAlerts].slice(0, 8).map((a: any) => (
              <span
                key={a.id}
                className={`text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded border ${
                  a.severity === "critical"
                    ? "bg-red-500/20 text-red-300 border-red-500/30"
                    : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                }`}
              >
                {a.accountName ?? `#${a.accountId}`} ${Number(a.currentBalance).toFixed(0)}
              </span>
            ))}
            {(criticalBalAlerts.length + urgentBalAlerts.length) > 8 && (
              <span className="text-[10px] text-amber-600 font-mono shrink-0">
                +{criticalBalAlerts.length + urgentBalAlerts.length - 8} more
              </span>
            )}
          </div>
          <Link href="/balance">
            <a className="text-[10px] text-amber-500 hover:text-amber-300 transition-colors flex items-center gap-1 shrink-0">
              Monitor <ChevronRight className="h-3 w-3" />
            </a>
          </Link>
        </div>
      )}

      {/* ── Approval Expiry Banners ── */}
      <AnimatePresence>
        <ApprovalExpiredBanner
          events={expiredApprovals}
          onDismiss={(expiredAt) => {
            const evt = expiredApprovals.find(e => e.expiredAt === expiredAt);
            if (evt) {
              const key = `${evt.actionId}-${evt.expiredAt}`;
              setDismissedExpiry(prev => new Set([...prev, key]));
            }
            setExpiredApprovals(prev => prev.filter(e => e.expiredAt !== expiredAt));
          }}
        />
      </AnimatePresence>

      {/* ── Rollback Failure Banners ── */}
      <AnimatePresence>
        <RollbackFailureBanner
          alerts={rollbackAlerts}
          onDismiss={(occurredAt) => {
            setDismissedAlerts(prev => new Set([...prev, occurredAt]));
            setRollbackAlerts(prev => prev.filter(a => a.occurredAt !== occurredAt));
          }}
        />
      </AnimatePresence>

      {/* ── SSL Certificate Expiry Banners ── */}
      <AnimatePresence>
        <SslCertExpiryBanner
          certs={visibleSslCerts}
          onDismiss={(certId) => setDismissedSslCerts(prev => new Set([...prev, certId]))}
        />
      </AnimatePresence>

      {/* ── Copilot Alert Strip ── */}
      <CopilotAlertStrip
        summary={copilotSummary}
        canApply={isManagement}
        onQuickApply={(rec) => setStripModalRec(rec)}
      />

      {/* ── Strip Quick-Apply Modal ── */}
      <AnimatePresence>
        {stripModalRec && (
          <StripQuickApplyModal
            rec={stripModalRec}
            isPending={stripApplyMutation.isPending}
            executionEnabled={executionEnabled}
            onConfirm={() => stripApplyMutation.mutate(stripModalRec)}
            onCancel={() => !stripApplyMutation.isPending && setStripModalRec(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Main three-panel grid ── */}
      <div className="flex-1 grid grid-cols-12 gap-0 min-h-0 overflow-hidden">

        {/* ── LEFT: Incident Feed (4 cols) ── */}
        <div className="col-span-12 lg:col-span-4 border-r border-slate-800/60 flex flex-col">
          <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Siren className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Incident Feed
              </span>
              {allActiveInc.length > 0 && (
                <span className="text-[10px] font-bold text-red-400 font-mono">
                  ({allActiveInc.length})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {incFetching && <RefreshCw className="h-3 w-3 text-slate-600 animate-spin" />}
              <Link href="/noc-incidents">
                <a className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
                  All <ChevronRight className="h-3 w-3" />
                </a>
              </Link>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              <AnimatePresence initial={false}>
                {allActiveInc.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <CheckCircle2 className="h-8 w-8 mb-2 text-green-500/30" />
                    <p className="text-[11px] font-mono">All systems nominal</p>
                  </div>
                ) : allActiveInc.map(inc => (
                  <IncidentFeedRow
                    key={`inc-${inc.id}-${'incidentType' in inc ? 'acc' : 'noc'}`}
                    inc={inc}
                    onInvestigate={'type' in inc && !(inc as any).incidentType
                      ? (id) => investigateMutation.mutate(id)
                      : undefined
                    }
                  />
                ))}
              </AnimatePresence>

              {/* Resolved NOC incidents mini-count */}
              {nocIncidentRows.filter(i => i.status === "resolved" || i.status === "mitigated").length > 0 && (
                <div className="pt-2 border-t border-slate-800/60">
                  <Link href="/noc-incidents?status=resolved">
                    <a className="flex items-center gap-2 text-[10px] text-slate-600 hover:text-slate-400 transition-colors px-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500/40" />
                      {nocIncidentRows.filter(i => i.status === "resolved" || i.status === "mitigated").length} resolved / mitigated
                      <ChevronRight className="h-3 w-3 ml-auto" />
                    </a>
                  </Link>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── CENTER: Route Health Matrix (5 cols) ── */}
        <div className="col-span-12 lg:col-span-5 border-r border-slate-800/60 flex flex-col">
          <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Route Health Matrix
              </span>
              <span className="text-[10px] text-slate-600 font-mono">
                {scores.length} carriers
              </span>
            </div>
            <Link href="/route-intelligence">
              <a className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
                Deep Dive <ChevronRight className="h-3 w-3" />
              </a>
            </Link>
          </div>
          <ScrollArea className="flex-1">
            {scores.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                <Network className="h-8 w-8 mb-2 text-slate-700" />
                <p className="text-[11px] font-mono">No carrier data yet</p>
                <p className="text-[10px] text-slate-700 mt-1">Run synthetic tests to populate</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#080d18]">
                  <tr className="border-b border-slate-800/80">
                    {["CARRIER", "ASR%", "FAIL%", "PDD", "STAB", "TREND", "STATUS"].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left text-[10px] uppercase tracking-widest text-slate-600 font-mono font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...scores].sort((a, b) => (a.stabilityScore ?? 0) - (b.stabilityScore ?? 0)).map((s, i) => {
                    const color = stabilityColor(s.stabilityScore);
                    const rowBg = i % 2 === 0 ? "bg-slate-900/20" : "";
                    const statusLabel = { green: "HEALTHY", amber: "DEGRADED", red: "CRITICAL" }[color];
                    const statusCls   = {
                      green: "text-green-400 bg-green-500/10 border-green-500/20",
                      amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                      red:   "text-red-400   bg-red-500/10   border-red-500/20",
                    }[color];
                    return (
                      <tr
                        key={s.carrierId}
                        data-testid={`route-matrix-row-${s.carrierId}`}
                        className={cn("border-b border-slate-800/30 hover:bg-slate-800/30 transition-colors", rowBg)}
                      >
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", {
                              green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500",
                            }[color])} />
                            <span className="font-mono text-slate-300 truncate max-w-[80px]" title={s.carrierName}>
                              {s.carrierName}
                            </span>
                          </div>
                        </td>
                        <td className={cn("px-2 py-1.5 font-mono tabular-nums font-bold", {
                          green: "text-green-400", amber: "text-amber-400", red: "text-red-400",
                        }[color])}>
                          {s.rollingAsr != null ? `${s.rollingAsr.toFixed(1)}%` : "—"}
                        </td>
                        <td className={cn("px-2 py-1.5 font-mono tabular-nums", (s.failureRate ?? 0) > 25 ? "text-red-400" : "text-slate-400")}>
                          {s.failureRate != null ? `${s.failureRate.toFixed(1)}%` : "—"}
                        </td>
                        <td className={cn("px-2 py-1.5 font-mono tabular-nums", (s.avgPddMs ?? 0) > 500 ? "text-amber-400" : "text-slate-400")}>
                          {s.avgPddMs != null ? `${s.avgPddMs.toFixed(0)}ms` : "—"}
                        </td>
                        <td className={cn("px-2 py-1.5 font-mono tabular-nums font-bold", {
                          green: "text-green-400", amber: "text-amber-400", red: "text-red-400",
                        }[color])}>
                          {s.stabilityScore?.toFixed(0) ?? "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <TrendIcon trend={s.trend} />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={cn(
                            "text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border",
                            statusCls,
                          )}>
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </div>

        {/* ── RIGHT: Balance Alerts + Cap Warnings + AI Recommendations (3 cols) ── */}
        <div className="col-span-12 lg:col-span-3 flex flex-col">

          {/* Balance Alerts Panel — all accounts below any threshold, sorted by balance asc */}
          <div className="flex flex-col border-b border-slate-800/60" style={{ maxHeight: '30%' }}>
            <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Low Balance
                </span>
                {balAlerts.length > 0 && (
                  <span className="text-[10px] font-mono text-amber-400">({balAlerts.length})</span>
                )}
              </div>
              <Link href="/balance">
                <a className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
                  Monitor <ChevronRight className="h-3 w-3" />
                </a>
              </Link>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {balAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-4 text-slate-600">
                    <Wallet className="h-5 w-5 mb-1.5 text-slate-700" />
                    <p className="text-[10px] font-mono">No low balance alerts</p>
                  </div>
                ) : (
                  [...balAlerts]
                    .sort((a: any, b: any) => Number(a.currentBalance) - Number(b.currentBalance))
                    .map((a: any) => {
                      const sevCls =
                        a.severity === 'critical' ? 'text-red-300 border-red-500/30 bg-red-500/10' :
                        a.severity === 'urgent'   ? 'text-orange-300 border-orange-500/30 bg-orange-500/10' :
                                                    'text-amber-300 border-amber-500/30 bg-amber-500/10';
                      return (
                        <div
                          key={a.id}
                          data-testid={`noc-balance-alert-${a.id}`}
                          className="flex items-center justify-between rounded border px-2 py-1 text-[10px] bg-slate-900/30"
                        >
                          <span className="font-mono text-slate-300 truncate max-w-[100px]" title={a.accountName ?? `#${a.accountId}`}>
                            {a.accountName ?? `#${a.accountId}`}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`font-mono font-bold px-1 py-0.5 rounded border ${sevCls}`}>
                              ${Number(a.currentBalance).toFixed(0)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Cap Warnings */}
          <div className="flex flex-col border-b border-slate-800/60" style={{ maxHeight: "32%" }}>
            <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Gauge className={cn("h-3.5 w-3.5", (capAlerts?.critical ?? 0) > 0 ? "text-red-400" : (capAlerts?.total ?? 0) > 0 ? "text-amber-400" : "text-slate-500")} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Cap Warnings
                </span>
                {(capAlerts?.total ?? 0) > 0 && (
                  <span className={cn("text-[10px] font-bold font-mono", (capAlerts?.critical ?? 0) > 0 ? "text-red-400" : "text-amber-400")}>
                    ({capAlerts?.total})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {capFetching && <RefreshCw className="h-3 w-3 text-slate-600 animate-spin" />}
                <button
                  data-testid="cap-refresh-btn"
                  onClick={() => { refetchCaps(); apiRequest("POST", "/api/noc/cap-alerts/refresh-caps").catch(() => {}); }}
                  className="p-1 rounded hover:bg-slate-700/40 text-slate-600 hover:text-slate-400 transition-colors"
                  title="Trigger Sippy cap sync"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-1.5">
                {!capAlerts || capAlerts.warnings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-slate-600">
                    <Gauge className="h-6 w-6 mb-1.5 text-slate-700" />
                    <p className="text-[10px] font-mono">No cap warnings</p>
                    {capAlerts?.lastSyncedAt && (
                      <p className="text-[9px] text-slate-700 mt-0.5 font-mono">
                        synced {timeAgo(capAlerts.lastSyncedAt)}
                      </p>
                    )}
                  </div>
                ) : capAlerts.warnings.map((w, i) => {
                  const isCrit = w.severity === "critical";
                  const utilBar = Math.min(100, w.utilisationPct);
                  return (
                    <motion.div
                      key={`${w.accountId}-${w.capType}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      data-testid={`cap-warning-${w.accountId}`}
                      className={cn(
                        "rounded-md border p-2 text-xs",
                        isCrit
                          ? "bg-red-500/10 border-red-500/30"
                          : "bg-amber-500/10 border-amber-500/30"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn("text-[10px] font-bold font-mono uppercase", isCrit ? "text-red-400" : "text-amber-400")}>
                          {isCrit ? "CRITICAL" : "WARNING"}
                        </span>
                        <span className={cn("text-[10px] font-bold font-mono tabular-nums", isCrit ? "text-red-300" : "text-amber-300")}>
                          {w.utilisationPct}%
                        </span>
                      </div>
                      <p className="text-slate-200 text-[11px] font-medium leading-tight truncate mb-1.5" title={w.accountName}>
                        {w.accountName}
                      </p>
                      {/* Progress bar */}
                      <div className="h-1 rounded-full bg-slate-800 overflow-hidden mb-1">
                        <motion.div
                          className={cn("h-full rounded-full", isCrit ? "bg-red-500" : "bg-amber-500")}
                          initial={{ width: 0 }}
                          animate={{ width: `${utilBar}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono mb-1.5">
                        {w.currentValue} / {w.limitValue} {w.capType}
                        {w.capType === 'cps' && (
                          <span className="ml-1 text-slate-600">(approx.)</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/clients/${w.accountId}`}>
                          <a
                            data-testid={`cap-warning-account-link-${w.accountId}`}
                            className={cn(
                              "flex items-center gap-0.5 text-[10px] transition-colors",
                              isCrit ? "text-red-500 hover:text-red-300" : "text-amber-500 hover:text-amber-300",
                            )}
                          >
                            Account <ArrowRight className="h-2.5 w-2.5" />
                          </a>
                        </Link>
                        <Link href={`/cdrs?accountId=${w.accountId}`}>
                          <a
                            data-testid={`cap-warning-cdr-link-${w.accountId}`}
                            className="flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                            title="View recent CDRs for this account"
                          >
                            CDRs <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </Link>
                        {capAlerts?.sippyBaseUrl && (
                          <a
                            data-testid={`cap-warning-sippy-link-${w.accountId}`}
                            href={`${capAlerts.sippyBaseUrl}/customers/accounts/edit/?i_account=${w.accountId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-cyan-400 transition-colors"
                            title="Open account in Sippy portal"
                          >
                            Sippy <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        <span className="text-[10px] text-slate-700 ml-auto">
                          {timeAgo(w.triggeredAt)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* AI Recommendations Panel */}
          <div className="flex flex-col flex-1 min-h-0">
          <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                AI Recommendations
              </span>
            </div>
            {recommendations.length > 0 && (
              <span className="text-[10px] font-mono text-violet-400">{recommendations.length}</span>
            )}
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {recommendations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                  <BrainCircuit className="h-8 w-8 mb-2 text-slate-700" />
                  <p className="text-[11px] font-mono">No active recommendations</p>
                </div>
              ) : recommendations.slice(0, 12).map((rec, i) => {
                const urgency = URGENCY_CONFIG[rec.urgency ?? "monitor"] ?? URGENCY_CONFIG.monitor;
                return (
                  <motion.div
                    key={`${rec.accountId}-${i}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="rounded-md border border-slate-700/40 bg-slate-900/40 p-2.5"
                    data-testid={`noc-rec-${i}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-bold font-mono text-slate-600">
                        #{rec.priority ?? i + 1}
                      </span>
                      <span className={cn(
                        "text-[9px] font-bold font-mono px-1 py-0.5 rounded border",
                        urgency.color,
                      )}>
                        {urgency.label}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium truncate ml-auto max-w-[80px]">
                        {rec.accountName ?? rec.accountId}
                      </span>
                    </div>
                    {rec.action && (
                      <p className="text-[11px] text-slate-300 leading-snug mb-1">{rec.action}</p>
                    )}
                    {rec.dominantSignal && (
                      <p className="text-[10px] text-slate-600 truncate">
                        Signal: {rec.dominantSignal.replace(/_/g, " ")}
                      </p>
                    )}
                    <Link href={`/clients/${rec.accountId}`}>
                      <a className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-600 hover:text-violet-400 transition-colors">
                        View account <ArrowRight className="h-2.5 w-2.5" />
                      </a>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </ScrollArea>
          </div> {/* end AI Recommendations panel */}
        </div> {/* end RIGHT col */}
      </div>
    </div>
  );
}
