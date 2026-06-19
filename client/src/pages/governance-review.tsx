import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Lock, FileText, AlertTriangle, RotateCcw,
  ChevronDown, ChevronRight, Loader2, ShieldCheck, User, Calendar,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────
interface GovernanceReview {
  id: number; status: string;
  reviewedBy?: string | null; reviewedAt?: string | null;
  comments?: string | null;
  lockedBy?: string | null; lockedAt?: string | null;
}
interface ConfigValue {
  id: number; category: string; configKey: string; label: string;
  unit?: string | null; value?: string | null; defaultValue?: string | null;
  valueType: string; description?: string | null;
}
interface Rule {
  id: number; scope: string; groupName: string; description: string;
  selectedAction: string; threshold?: string | null; thresholdUnit?: string | null;
  configCategory?: string | null; configKey?: string | null;
}
interface ReviewData { review: GovernanceReview; configs: ConfigValue[]; rules: Rule[] }

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  draft:    { label: "Draft",    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",    icon: FileText    },
  approved: { label: "Approved", color: "text-blue-400 bg-blue-400/10 border-blue-400/30",       icon: CheckCircle2 },
  locked:   { label: "Locked",   color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30", icon: Lock     },
};

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  ignore:                     { label: "Ignore",               color: "text-muted-foreground" },
  reject_rate_sheet:          { label: "Reject Rate Sheet",    color: "text-rose-400" },
  reject_country:             { label: "Reject Country",       color: "text-orange-400" },
  reject_destination:         { label: "Reject Destination",   color: "text-amber-400" },
  approval_reqd:              { label: "Approval Required",    color: "text-blue-400" },
  auto_adjust_effective_date: { label: "Auto Adjust Eff. Date", color: "text-cyan-400" },
};

const CATEGORY_LABELS: Record<string, string> = {
  vendor: "Vendor", client: "Client", commercial: "Commercial",
  global: "Global", az: "A-Z", bsr: "BSR",
};

const SCOPE_ORDER = ["vendor", "client", "commercial", "global"];

function formatThreshold(value?: string | null, unit?: string | null): string {
  if (!value) return "—";
  if (unit === "percent") return `${value}%`;
  if (unit === "days")    return `${value} day${value === "1" ? "" : "s"}`;
  if (unit === "hour")    return `${value} hr${value === "1" ? "" : "s"}`;
  if (unit === "mb")      return `${value} MB`;
  if (value === "true")   return "Enabled";
  if (value === "false")  return "Disabled";
  return value + (unit ? ` ${unit}` : "");
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ── Collapsible section ────────────────────────────────────────────────────────
function Section({ title, badge, children, defaultOpen = true }:
  { title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
        data-testid={`section-toggle-${title.replace(/\s+/g, "-").toLowerCase()}`}>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground border border-border/30">
              {badge}
            </span>
          )}
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
               : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function GovernanceReviewPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isManagement, user } = useAuth();

  const [comments, setComments]   = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [commentsInit, setCommentsInit] = useState(false);

  const { data, isLoading } = useQuery<ReviewData>({
    queryKey: ["/api/governance-review"],
    queryFn: () => fetch("/api/governance-review", { credentials: "include" }).then(r => r.json()),
    onSuccess: (d) => {
      if (!commentsInit) {
        setComments(d.review.comments ?? "");
        setReviewerName(d.review.reviewedBy ?? (user as any)?.username ?? "");
        setCommentsInit(true);
      }
    },
  });

  const review  = data?.review;
  const configs = data?.configs ?? [];
  const rules   = data?.rules   ?? [];

  const isLocked   = review?.status === "locked";
  const isApproved = review?.status === "approved";
  const statusMeta = STATUS_META[review?.status ?? "draft"];
  const StatusIcon = statusMeta?.icon ?? FileText;

  // Group configs by category
  const configsByCategory: Record<string, ConfigValue[]> = {};
  for (const c of configs) {
    if (!configsByCategory[c.category]) configsByCategory[c.category] = [];
    configsByCategory[c.category].push(c);
  }

  // Group rules by scope → group
  const rulesByScope: Record<string, Record<string, Rule[]>> = {};
  for (const r of rules) {
    if (!rulesByScope[r.scope]) rulesByScope[r.scope] = {};
    if (!rulesByScope[r.scope][r.groupName]) rulesByScope[r.scope][r.groupName] = [];
    rulesByScope[r.scope][r.groupName].push(r);
  }

  // Approval summary — rules that require action (non-ignore)
  const enforcedRules = rules.filter(r => r.selectedAction !== "ignore");

  const saveMut = useMutation({
    mutationFn: (approve: boolean) =>
      apiRequest("PATCH", "/api/governance-review", { comments, reviewedBy: reviewerName, approve }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/governance-review"] });
      toast({ title: isApproved ? "Governance approved" : "Changes saved" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const lockMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/governance-review/lock", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/governance-review"] });
      toast({ title: "Governance locked", description: "Configuration and rules are now locked." });
    },
    onError: (e: any) => toast({ title: "Lock failed", description: e.message, variant: "destructive" }),
  });

  const resetMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/governance-review/reset", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/governance-review"] });
      setCommentsInit(false);
      toast({ title: "Reset to draft" });
    },
    onError: (e: any) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 justify-center h-full text-xs text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading governance review…
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-border/40 flex-shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-foreground">Governance Review</h1>
            {statusMeta && (
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border",
                statusMeta.color,
              )}>
                <StatusIcon className="w-3 h-3" />
                {statusMeta.label}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Formal sign-off for Configuration Values (#337) and Validation Rules (#338)
            before enforcement (#339) is enabled.
          </p>
        </div>

        {/* Status metadata */}
        <div className="flex flex-col gap-1 text-[10px] text-muted-foreground text-right flex-shrink-0 ml-4">
          {review?.reviewedBy && (
            <div className="flex items-center gap-1 justify-end">
              <User className="w-3 h-3" />
              Reviewed by <span className="text-foreground font-medium">{review.reviewedBy}</span>
            </div>
          )}
          {review?.reviewedAt && (
            <div className="flex items-center gap-1 justify-end">
              <Calendar className="w-3 h-3" />
              {fmtDate(review.reviewedAt)}
            </div>
          )}
          {review?.lockedBy && (
            <div className="flex items-center gap-1 justify-end">
              <Lock className="w-3 h-3 text-emerald-400" />
              Locked by <span className="text-emerald-400 font-medium">{review.lockedBy}</span>
            </div>
          )}
          {review?.lockedAt && (
            <span className="text-muted-foreground/60">{fmtDate(review.lockedAt)}</span>
          )}
        </div>
      </div>

      {/* Locked banner */}
      {isLocked && (
        <div className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex-shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-xs text-emerald-300 font-medium">
            Governance is locked. Configuration Values and Validation Rules are in their approved state. #339 Rule Consumption Layer may now be enabled.
          </span>
        </div>
      )}

      {/* ── Governance KPI strip ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-border/40 px-6 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: "Configuration Values",
            value: configs.length,
            sub: "parameters defined",
            color: "text-foreground",
          },
          {
            label: "Validation Rules",
            value: rules.length,
            sub: "rules across 3 scopes",
            color: "text-foreground",
          },
          {
            label: "Active Controls",
            value: enforcedRules.length,
            sub: "non-ignore rules",
            color: enforcedRules.length > 0 ? "text-amber-400" : "text-muted-foreground",
          },
          {
            label: "Governance Status",
            value: statusMeta?.label ?? "—",
            sub: "current lifecycle state",
            color: isLocked ? "text-emerald-400" : isApproved ? "text-blue-400" : "text-amber-400",
          },
          {
            label: "Last Reviewed By",
            value: review?.reviewedBy ?? "—",
            sub: review?.reviewedAt ? fmtDate(review.reviewedAt) : "not yet reviewed",
            color: review?.reviewedBy ? "text-foreground" : "text-muted-foreground/50",
          },
          {
            label: isLocked ? "Locked By" : "Locked By",
            value: review?.lockedBy ?? "—",
            sub: review?.lockedAt ? fmtDate(review.lockedAt) : "not yet locked",
            color: review?.lockedBy ? "text-emerald-400" : "text-muted-foreground/50",
          },
        ].map(kpi => (
          <div key={kpi.label} className="flex flex-col gap-0.5" data-testid={`kpi-${kpi.label.replace(/\s+/g,"-").toLowerCase()}`}>
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium leading-none">{kpi.label}</span>
            <span className={cn("text-sm font-semibold tabular-nums leading-tight", kpi.color)}>{kpi.value}</span>
            <span className="text-[10px] text-muted-foreground/50 leading-none">{kpi.sub}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-6 py-5 space-y-4">

        {/* ── Section 1: Configuration Values ─────────────────────────────── */}
        <Section title="Section 1 — Configuration Values" badge={`${configs.length} parameters`}>
          <div className="space-y-5">
            {Object.entries(CATEGORY_LABELS)
              .filter(([k]) => configsByCategory[k]?.length)
              .map(([cat, catLabel]) => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                    {catLabel}
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-1.5 px-0 font-medium text-muted-foreground">Parameter</th>
                        <th className="text-left py-1.5 px-3 font-medium text-muted-foreground w-24">Unit</th>
                        <th className="text-right py-1.5 px-0 font-medium text-muted-foreground w-36">Current Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configsByCategory[cat].map(cv => (
                        <tr key={cv.id} className="border-b border-border/10 hover:bg-muted/5" data-testid={`cfg-row-${cv.id}`}>
                          <td className="py-1.5 text-foreground/80">{cv.label}</td>
                          <td className="py-1.5 px-3 text-muted-foreground">{cv.unit || "—"}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums text-foreground/90">
                            {formatThreshold(cv.value, cv.unit) || <span className="text-muted-foreground/40">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </Section>

        {/* ── Section 2: Validation Rules ──────────────────────────────────── */}
        <Section title="Section 2 — Validation Rules" badge={`${rules.length} rules`}>
          <div className="space-y-5">
            {SCOPE_ORDER.filter(s => rulesByScope[s]).map(scope => (
              <div key={scope}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
                  {CATEGORY_LABELS[scope] ?? scope} Scope
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="text-left py-1.5 px-0 font-medium text-muted-foreground">Rule</th>
                      <th className="text-left py-1.5 px-3 font-medium text-muted-foreground w-28">Threshold</th>
                      <th className="text-right py-1.5 px-0 font-medium text-muted-foreground w-44">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(rulesByScope[scope]).flatMap(([groupName, groupRules]) => [
                      <tr key={`grp-${scope}-${groupName}`} className="bg-muted/20">
                        <td colSpan={3} className="py-1 px-0 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">
                          {groupName}
                        </td>
                      </tr>,
                      ...groupRules.map(rule => {
                        const actionMeta = ACTION_LABEL[rule.selectedAction];
                        return (
                          <tr key={rule.id} className="border-b border-border/10 hover:bg-muted/5" data-testid={`rule-row-${rule.id}`}>
                            <td className="py-1.5 text-foreground/80">{rule.description}</td>
                            <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                              {formatThreshold(rule.threshold, rule.thresholdUnit)}
                            </td>
                            <td className="py-1.5 text-right">
                              <span className={cn("font-medium", actionMeta?.color)}>
                                {actionMeta?.label ?? rule.selectedAction}
                              </span>
                            </td>
                          </tr>
                        );
                      }),
                    ])}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Section 3: Approval Summary ──────────────────────────────────── */}
        <Section title="Section 3 — Approval Summary" badge={`${enforcedRules.length} active controls`}>
          {enforcedRules.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">No enforcement controls active — all rules set to Ignore.</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left py-1.5 px-0 font-medium text-muted-foreground">Rule</th>
                  <th className="text-left py-1.5 px-3 font-medium text-muted-foreground w-20">Scope</th>
                  <th className="text-left py-1.5 px-3 font-medium text-muted-foreground w-28">Threshold</th>
                  <th className="text-right py-1.5 px-0 font-medium text-muted-foreground w-44">Action</th>
                </tr>
              </thead>
              <tbody>
                {enforcedRules.map(rule => {
                  const actionMeta = ACTION_LABEL[rule.selectedAction];
                  return (
                    <tr key={rule.id} className="border-b border-border/10 hover:bg-muted/5" data-testid={`summary-row-${rule.id}`}>
                      <td className="py-1.5 text-foreground/80">{rule.description}</td>
                      <td className="py-1.5 px-3 text-muted-foreground capitalize">{rule.scope}</td>
                      <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                        {formatThreshold(rule.threshold, rule.thresholdUnit)}
                      </td>
                      <td className="py-1.5 text-right">
                        <span className={cn("font-semibold", actionMeta?.color)}>
                          {actionMeta?.label ?? rule.selectedAction}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="mt-4 p-3 rounded border border-amber-500/20 bg-amber-500/5">
            <p className="text-[11px] text-amber-300/80 leading-relaxed">
              <span className="font-semibold text-amber-300">Phase 1 consumer (#339):</span>{" "}
              Only <code className="font-mono">Commercial.Require Approval For Initial Rates</code> will be read
              by the Initial Rate Workflow (#336). All other enforcement rules remain inactive until
              Commercial/NOC review is complete and governance is locked.
            </p>
          </div>
        </Section>

        {/* ── Section 4: Ownership Matrix ──────────────────────────────────── */}
        <Section title="Section 4 — Ownership Matrix" defaultOpen={false}>
          <p className="text-[11px] text-muted-foreground/70 mb-3 leading-relaxed">
            Defines who is responsible for reviewing and approving changes in each area
            before governance can be locked. Required sign-off before #339 enforcement is enabled.
          </p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-1.5 px-0 font-medium text-muted-foreground">Area</th>
                <th className="text-left py-1.5 px-4 font-medium text-muted-foreground">Owner</th>
                <th className="text-left py-1.5 px-0 font-medium text-muted-foreground">What to verify</th>
              </tr>
            </thead>
            <tbody>
              {[
                { area: "Commercial Values",    owner: "Commercial",          note: "Approval flags, notification limits, effective date offsets" },
                { area: "Client Values",        owner: "KAM / Commercial",    note: "Notice periods, rate change alert thresholds, invoice settings" },
                { area: "Vendor Values",        owner: "Trading / Routing",   note: "Effective date windows, rounding, file size limits, CDR delay" },
                { area: "Global Values",        owner: "Operations",          note: "Date formats, file/user limits, invoice difference thresholds" },
                { area: "Validation Rules",     owner: "NOC + Commercial",    note: "Actions per rule (Ignore / Reject / Approval Reqd) match policy" },
                { area: "Governance Lock",      owner: "Management",          note: "Final sign-off — confirms all areas above have been reviewed" },
                { area: "Approval Workflow",    owner: "Commercial",          note: "Continues normally when locked — not blocked by governance lock" },
                { area: "Send Rate / Push",     owner: "Frozen",              note: "Unaffected — no changes until #339 Phase 1 is explicitly enabled" },
              ].map(row => (
                <tr key={row.area} className="border-b border-border/10 hover:bg-muted/5">
                  <td className="py-1.5 font-medium text-foreground/80">{row.area}</td>
                  <td className="py-1.5 px-4">
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium",
                      row.owner === "Frozen"
                        ? "bg-muted/30 text-muted-foreground/60"
                        : "bg-amber-500/10 text-amber-300 border border-amber-500/20",
                    )}>{row.owner}</span>
                  </td>
                  <td className="py-1.5 text-muted-foreground/70">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* ── Sign-off panel ────────────────────────────────────────────────── */}
        {!isLocked && isManagement && (
          <div className="border border-border/40 rounded-lg p-5 bg-muted/10 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Sign-off</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  Reviewed By
                </label>
                <input
                  value={reviewerName}
                  onChange={e => setReviewerName(e.target.value)}
                  placeholder="Your name or team"
                  data-testid="input-reviewed-by"
                  className="bg-background border border-border/40 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                Review Comments
              </label>
              <textarea
                value={comments}
                onChange={e => setComments(e.target.value)}
                rows={4}
                placeholder="Note any policy decisions, threshold adjustments discussed, or deferred items for the next review cycle…"
                data-testid="input-review-comments"
                className="bg-background border border-border/40 rounded px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => saveMut.mutate(false)}
                disabled={saveMut.isPending}
                data-testid="btn-save-comments"
                className="flex items-center gap-1.5 text-xs border border-border/40 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded transition-colors">
                {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Save Comments
              </button>

              <button
                onClick={() => saveMut.mutate(true)}
                disabled={saveMut.isPending || isApproved}
                data-testid="btn-approve-governance"
                className={cn(
                  "flex items-center gap-1.5 text-xs px-4 py-1.5 rounded font-medium transition-colors",
                  isApproved
                    ? "bg-blue-600/30 text-blue-300/60 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white",
                )}>
                <CheckCircle2 className="w-3 h-3" />
                {isApproved ? "Approved" : "Approve Governance"}
              </button>

              {isApproved && (
                <button
                  onClick={() => lockMut.mutate()}
                  disabled={lockMut.isPending}
                  data-testid="btn-lock-governance"
                  className="flex items-center gap-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-1.5 rounded font-medium transition-colors">
                  {lockMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                  Lock Governance
                </button>
              )}

              {isApproved && (
                <button
                  onClick={() => { if (confirm("Reset to Draft? This will clear the approval.")) resetMut.mutate(); }}
                  disabled={resetMut.isPending}
                  data-testid="btn-reset-governance"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded transition-colors ml-auto">
                  <RotateCcw className="w-3 h-3" /> Reset to Draft
                </button>
              )}
            </div>

            {isApproved && (
              <div className="flex items-center gap-2 p-2.5 rounded bg-blue-500/10 border border-blue-500/20">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                <span className="text-[11px] text-blue-300">
                  Governance approved by <strong>{review?.reviewedBy}</strong> on {fmtDate(review?.reviewedAt)}.
                  Lock to prevent further changes and enable #339.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Admin reset on locked */}
        {isLocked && (user as any)?.role === "admin" && (
          <div className="border border-border/30 rounded-lg p-4">
            <button
              onClick={() => { if (confirm("Reset locked governance to draft? This should only be done to make corrections.")) resetMut.mutate(); }}
              disabled={resetMut.isPending}
              data-testid="btn-reset-locked"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-400 transition-colors">
              <RotateCcw className="w-3 h-3" />
              Admin: Reset to Draft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
