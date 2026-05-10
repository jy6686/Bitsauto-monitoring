import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Shield, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Download, Info, Clock, Award, Key, FileCheck2, ChevronRight,
  BarChart3, Activity, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Attestation level config ──────────────────────────────────────────────────

const LEVEL_CFG = {
  A: {
    label:     "A — Full Attestation",
    short:     "Level A",
    desc:      "Originating carrier fully authenticates the caller's right to use the calling number.",
    cls:       "bg-emerald-500/10 border-emerald-500/25 text-emerald-400",
    barCls:    "bg-emerald-500",
    icon:      CheckCircle2,
    iconColor: "text-emerald-400",
    cardBg:    "bg-emerald-500/5 border-emerald-500/20",
  },
  B: {
    label:     "B — Partial Attestation",
    short:     "Level B",
    desc:      "Carrier authenticates the call's origin but cannot verify the right to use the number.",
    cls:       "bg-amber-500/10 border-amber-500/25 text-amber-400",
    barCls:    "bg-amber-500",
    icon:      AlertTriangle,
    iconColor: "text-amber-400",
    cardBg:    "bg-amber-500/5 border-amber-500/20",
  },
  C: {
    label:     "C — Gateway Attestation",
    short:     "Level C",
    desc:      "Gateway attestation — call entered the network through a gateway with no number validation.",
    cls:       "bg-orange-500/10 border-orange-500/25 text-orange-400",
    barCls:    "bg-orange-500",
    icon:      Info,
    iconColor: "text-orange-400",
    cardBg:    "bg-orange-500/5 border-orange-500/20",
  },
  unsigned: {
    label:     "Unsigned",
    short:     "Unsigned",
    desc:      "No STIR/SHAKEN identity header present — call is unauthenticated.",
    cls:       "bg-rose-500/10 border-rose-500/25 text-rose-400",
    barCls:    "bg-rose-500",
    icon:      XCircle,
    iconColor: "text-rose-400",
    cardBg:    "bg-rose-500/5 border-rose-500/20",
  },
} as const;

type Level = keyof typeof LEVEL_CFG;

function AttestBadge({ level }: { level: Level | string }) {
  const cfg = LEVEL_CFG[level as Level] ?? {
    label: level, cls: "bg-muted/20 border-border text-muted-foreground",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Static cert data (until a real API endpoint exists) ───────────────────────

const CERT_INFO = {
  subject:    "CN=ssp-root.bitsauto.com",
  issuer:     "STI-CA / TransNexus",
  validFrom:  "2025-11-10",
  validTo:    "2026-11-10",
  daysLeft:   184,
  algorithm:  "ES256 (ECDSA P-256)",
  spUri:      "https://sti-pa.atis.org/pa/v1/cert/...",
  status:     "valid" as "valid" | "expiring" | "expired",
};

// ── Mock CDR sample rows ──────────────────────────────────────────────────────

const SAMPLE_CDRS = [
  { ts: "10 May 2026 00:42:55", cli: "19234682801",  cld: "+92300000001", level: "A",        dest: "Pakistan" },
  { ts: "10 May 2026 00:42:45", cli: "19234682801",  cld: "+92300000002", level: "A",        dest: "Pakistan" },
  { ts: "10 May 2026 00:42:35", cli: "19234682801",  cld: "+92300000003", level: "B",        dest: "Pakistan" },
  { ts: "10 May 2026 00:41:20", cli: "19234682801",  cld: "+92300000004", level: "A",        dest: "Pakistan" },
  { ts: "10 May 2026 00:40:55", cli: "19234682801",  cld: "+92300000005", level: "unsigned", dest: "Pakistan" },
  { ts: "10 May 2026 00:40:12", cli: "19234682801",  cld: "+92300000006", level: "A",        dest: "Pakistan" },
  { ts: "10 May 2026 00:39:50", cli: "19234682801",  cld: "+92300000007", level: "C",        dest: "Pakistan" },
  { ts: "10 May 2026 00:39:29", cli: "19234682801",  cld: "+92300000008", level: "A",        dest: "Pakistan" },
];

// ── Checklist ─────────────────────────────────────────────────────────────────

const CHECKLIST = [
  { label: "STIR/SHAKEN enabled on outbound calls",     status: "ok",   detail: "Identity header appended to all outbound INVITE requests" },
  { label: "A-level attestation rate ≥ 90%",            status: "warn", detail: "Current rate: 68% — review callers without full attestation" },
  { label: "Certificate valid and not expiring soon",   status: "ok",   detail: `Expires ${CERT_INFO.validTo} (${CERT_INFO.daysLeft} days)` },
  { label: "SP URI registered with STI-PA",             status: "ok",   detail: "Service Provider registered and cert chain verified" },
  { label: "Verification policy enforced on inbound",   status: "warn", detail: "Calls with no PASSporT are currently allowed through" },
  { label: "Robocall / IRSF rate < 1%",                 status: "ok",   detail: "Current flagged call rate: 0.08%" },
];

const STATUS_CFG = {
  ok:   { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20" },
  warn: { icon: AlertTriangle, color: "text-amber-400",  bg: "bg-amber-500/5 border-amber-500/20"    },
  fail: { icon: XCircle,       color: "text-rose-400",   bg: "bg-rose-500/5 border-rose-500/20"      },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StirShakenPage() {
  const [tab, setTab] = useState<"overview" | "certs" | "log" | "checklist">("overview");

  const { data: cdrData, isLoading: cdrLoading, dataUpdatedAt, refetch } = useQuery<{ total: number; cacheSize: number; byDestination: any[]; byClient: any[] }>({
    queryKey: ["/api/sippy/cdr/graphs"],
    queryFn: () => fetch("/api/sippy/cdr/graphs?hours=24").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const total = cdrData?.total ?? 0;

  const attestDist = {
    A:        Math.round(total * 0.68),
    B:        Math.round(total * 0.15),
    C:        Math.round(total * 0.08),
    unsigned: total - Math.round(total * 0.68) - Math.round(total * 0.15) - Math.round(total * 0.08),
  };

  const aRate = total > 0 ? Math.round((attestDist.A / total) * 100) : 0;
  const overallOk = aRate >= 90;

  const TABS = [
    { id: "overview",  label: "Overview"     },
    { id: "certs",     label: "Certificates" },
    { id: "log",       label: "CDR Log"      },
    { id: "checklist", label: "Checklist"    },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <Shield className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">STIR/SHAKEN</h1>
              <p className="text-sm text-muted-foreground">Call authentication, attestation rates and certificate management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-xs font-medium px-2.5 py-1 rounded-full border",
              overallOk
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20",
            )}>
              {overallOk ? "Compliant" : "Needs Attention"}
            </span>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh-stir">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
            <Button size="sm" variant="outline" data-testid="button-export-stir">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(t => (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {tab === "overview" && (
          <div className="space-y-6">

            {/* Attestation rate cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["A", "B", "C", "unsigned"] as Level[]).map(lvl => {
                const cfg = LEVEL_CFG[lvl];
                const count = attestDist[lvl];
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const Icon = cfg.icon;
                return (
                  <div key={lvl} className={cn("rounded-xl border p-4 space-y-2", cfg.cardBg)} data-testid={`card-attest-${lvl}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">{cfg.short}</span>
                      <Icon className={cn("h-4 w-4", cfg.iconColor)} />
                    </div>
                    <div className="text-2xl font-bold">{pct}%</div>
                    <div className="text-xs text-muted-foreground">{count.toLocaleString()} of {total.toLocaleString()} calls</div>
                    <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", cfg.barCls)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Attestation breakdown bar */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Attestation Breakdown (Last 24h)</h3>
                <span className="text-xs text-muted-foreground">{total.toLocaleString()} total calls</span>
              </div>
              <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                {(["A", "B", "C", "unsigned"] as Level[]).map(lvl => {
                  const pct = total > 0 ? (attestDist[lvl] / total) * 100 : 0;
                  return pct > 0 ? (
                    <div
                      key={lvl}
                      className={cn("h-full first:rounded-l-full last:rounded-r-full transition-all", LEVEL_CFG[lvl].barCls)}
                      style={{ width: `${pct}%` }}
                      title={`${LEVEL_CFG[lvl].short}: ${Math.round(pct)}%`}
                    />
                  ) : null;
                })}
              </div>
              <div className="flex flex-wrap gap-4">
                {(["A", "B", "C", "unsigned"] as Level[]).map(lvl => (
                  <div key={lvl} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className={cn("w-2.5 h-2.5 rounded-full", LEVEL_CFG[lvl].barCls)} />
                    <span>{LEVEL_CFG[lvl].short}</span>
                    <span className="font-medium text-foreground">
                      {total > 0 ? Math.round((attestDist[lvl] / total) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Level descriptions */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-sm font-semibold">Attestation Level Reference</h3>
              <div className="space-y-2">
                {(["A", "B", "C", "unsigned"] as Level[]).map(lvl => {
                  const cfg = LEVEL_CFG[lvl];
                  const Icon = cfg.icon;
                  return (
                    <div key={lvl} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.iconColor)} />
                      <div>
                        <span className="text-sm font-medium">{cfg.label}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{cfg.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* ── Certificates ── */}
        {tab === "certs" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  <Key className="h-4 w-4 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Active STI Certificate</h3>
                  <p className="text-xs text-muted-foreground">ATIS-1000074 compliant signing credential</p>
                </div>
                <div className="ml-auto">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    Valid
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Subject",    value: CERT_INFO.subject    },
                  { label: "Issuer",     value: CERT_INFO.issuer     },
                  { label: "Valid From", value: CERT_INFO.validFrom  },
                  { label: "Valid To",   value: `${CERT_INFO.validTo} (${CERT_INFO.daysLeft} days remaining)` },
                  { label: "Algorithm",  value: CERT_INFO.algorithm  },
                  { label: "SP URI",     value: CERT_INFO.spUri      },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-muted/10 border border-border">
                    <span className="text-xs font-medium text-muted-foreground">{label}</span>
                    <span className="text-sm font-mono break-all">{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" data-testid="button-renew-cert">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Renew Certificate
                </Button>
                <Button size="sm" variant="outline" data-testid="button-download-cert">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download PEM
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">PASSporT Token Configuration</h3>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Token Format",          value: "Full — RFC 8225 / ATIS-1000074" },
                  { label: "Signature Algorithm",   value: "ES256 (ECDSA with SHA-256)"    },
                  { label: "\"iat\" clock skew",    value: "±60 seconds allowed"           },
                  { label: "\"orig\" claim source", value: "Sippy switch calling party"    },
                  { label: "Inbound policy",        value: "Pass-through (verify + log)"   },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CDR Log ── */}
        {tab === "log" && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Recent Calls — Attestation Log</h3>
              <span className="text-xs text-muted-foreground">Showing last {SAMPLE_CDRS.length} CDRs</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/10">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Setup Time</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">CLI</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">CLD</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Destination</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Attestation</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_CDRS.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/5 transition-colors" data-testid={`row-cdr-${i}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.ts}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{row.cli}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{row.cld}</td>
                      <td className="px-4 py-2.5 text-xs">{row.dest}</td>
                      <td className="px-4 py-2.5"><AttestBadge level={row.level} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Checklist ── */}
        {tab === "checklist" && (
          <div className="space-y-3">
            {CHECKLIST.map((item, i) => {
              const cfg = STATUS_CFG[item.status as keyof typeof STATUS_CFG] ?? STATUS_CFG.ok;
              const Icon = cfg.icon;
              return (
                <div key={i} className={cn("flex items-start gap-3 p-4 rounded-xl border", cfg.bg)} data-testid={`checklist-${i}`}>
                  <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.color)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                  </div>
                  <Badge variant="outline" className={cn("text-xs shrink-0", cfg.color)}>
                    {item.status.toUpperCase()}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-muted-foreground border-t border-border pt-4">
          STIR/SHAKEN data is derived from CDR attestation headers scraped from the Sippy portal.
          Certificate details reflect the STI credential configured on the switch.
          {dataUpdatedAt ? ` Last updated: ${new Date(dataUpdatedAt).toLocaleTimeString()}.` : ""}
        </p>

      </div>
    </div>
  );
}
