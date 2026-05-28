import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertOctagon, Plus, ChevronDown, ChevronUp, Clock, User,
  CheckCircle2, Eye, Shield, ArrowRight, RefreshCw, X, Send,
  AlertTriangle, Siren, Zap, TrendingDown, Activity, GitBranch,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

interface NocIncident {
  id: number; title: string; type: string; severity: string;
  status: string; entityType?: string | null; entityId?: string | null;
  entityName?: string | null; description?: string | null;
  suggestedAction?: string | null; assigneeId?: string | null;
  assigneeName?: string | null; source: string; tags: string[];
  openedAt: string; acknowledgedAt?: string | null;
  mitigatedAt?: string | null; resolvedAt?: string | null;
  updatedAt: string;
}

interface NocIncidentEvent {
  id: number; incidentId: number; eventType: string;
  fromStatus?: string | null; toStatus?: string | null;
  actorName: string; note?: string | null;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "all",          label: "All",          color: "text-slate-400" },
  { key: "open",         label: "Open",         color: "text-red-500"   },
  { key: "investigating",label: "Investigating", color: "text-amber-500" },
  { key: "mitigated",    label: "Mitigated",    color: "text-blue-500"  },
  { key: "resolved",     label: "Resolved",     color: "text-green-500" },
  { key: "postmortem",   label: "Postmortem",   color: "text-purple-500"},
];

const TYPE_OPTIONS = [
  { value: "route_degradation", label: "Route Degradation",   icon: TrendingDown  },
  { value: "carrier_outage",    label: "Carrier Outage",      icon: Siren         },
  { value: "fraud_alert",       label: "Fraud Alert",         icon: AlertTriangle },
  { value: "quality_issue",     label: "Quality Issue",       icon: Activity      },
  { value: "traffic_drop",      label: "Traffic Drop",        icon: Zap           },
  { value: "routing_failure",   label: "Routing Failure",     icon: GitBranch     },
  { value: "manual",            label: "Manual",              icon: AlertOctagon  },
];

const SEV_OPTIONS = ["critical", "high", "medium", "low"];

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low:      "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const STATUS_COLOR: Record<string, string> = {
  open:          "bg-red-500/15 text-red-400 border-red-500/30",
  investigating: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  mitigated:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  resolved:      "bg-green-500/15 text-green-400 border-green-500/30",
  postmortem:    "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

const NEXT_STATUS: Record<string, { label: string; value: string; cls: string }[]> = {
  open:          [{ label: "Investigate", value: "investigating", cls: "bg-amber-500 hover:bg-amber-600 text-white" }],
  investigating: [
    { label: "Mitigate",  value: "mitigated",  cls: "bg-blue-500 hover:bg-blue-600 text-white"  },
    { label: "Resolve",   value: "resolved",   cls: "bg-green-500 hover:bg-green-600 text-white" },
  ],
  mitigated:     [
    { label: "Resolve",   value: "resolved",   cls: "bg-green-500 hover:bg-green-600 text-white" },
    { label: "Reopen",    value: "investigating", cls: "bg-amber-500 hover:bg-amber-600 text-white" },
  ],
  resolved:      [{ label: "Postmortem", value: "postmortem", cls: "bg-purple-500 hover:bg-purple-600 text-white" }],
  postmortem:    [],
};

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  opened:         AlertOctagon,
  status_changed: ArrowRight,
  assigned:       User,
  note_added:     Send,
  default:        Clock,
};

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Create Incident Dialog ─────────────────────────────────────────────────────

function CreateIncidentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "", type: "manual", severity: "medium",
    entityName: "", description: "", suggestedAction: "",
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/noc/incidents", data),
    onSuccess: () => {
      toast({ title: "Incident created" });
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents"] });
      onClose();
      setForm({ title: "", type: "manual", severity: "medium", entityName: "", description: "", suggestedAction: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const TypeIcon = TYPE_OPTIONS.find(t => t.value === form.type)?.icon ?? AlertOctagon;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-red-500" />
            New NOC Incident
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Title *</label>
            <Input
              data-testid="noc-inc-title"
              placeholder="Brief incident title…"
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger data-testid="noc-inc-type">
                  <div className="flex items-center gap-2">
                    <TypeIcon className="h-3.5 w-3.5" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center gap-2">
                        <t.icon className="h-3.5 w-3.5" />
                        {t.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Severity</label>
              <Select value={form.severity} onValueChange={v => setForm(p => ({ ...p, severity: v }))}>
                <SelectTrigger data-testid="noc-inc-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEV_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>
                      <span className={cn("text-xs font-bold uppercase", SEV_COLOR[s]?.split(" ")[1])}>{s}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Affected Entity</label>
            <Input
              data-testid="noc-inc-entity"
              placeholder="Carrier name, route, etc. (optional)"
              value={form.entityName}
              onChange={e => setForm(p => ({ ...p, entityName: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <Textarea
              data-testid="noc-inc-description"
              placeholder="What is happening? Include observed impact…"
              rows={3}
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Suggested Action</label>
            <Input
              data-testid="noc-inc-action"
              placeholder="Recommended immediate action…"
              value={form.suggestedAction}
              onChange={e => setForm(p => ({ ...p, suggestedAction: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="noc-inc-submit"
            disabled={!form.title.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(form)}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {createMutation.isPending ? "Creating…" : "Create Incident"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail Sheet ───────────────────────────────────────────────────────────────

function IncidentDetailSheet({ incident, onClose }: { incident: NocIncident | null; onClose: () => void }) {
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");
  const [assignName, setAssignName] = useState("");

  const { data: detail } = useQuery<{ incident: NocIncident; events: NocIncidentEvent[] }>({
    queryKey: ["/api/noc/incidents", incident?.id, "events"],
    queryFn: () => fetch(`/api/noc/incidents/${incident!.id}/events`).then(r => r.json()),
    enabled: !!incident,
    refetchInterval: 10_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ status, note }: { status: string; note?: string }) =>
      apiRequest("PATCH", `/api/noc/incidents/${incident!.id}/status`, { status, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents", incident?.id, "events"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: (note: string) =>
      apiRequest("POST", `/api/noc/incidents/${incident!.id}/note`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents", incident?.id, "events"] });
      setNoteText("");
      toast({ title: "Note added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: (userName: string) =>
      apiRequest("POST", `/api/noc/incidents/${incident!.id}/assign`, { userId: userName, userName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/noc/incidents", incident?.id, "events"] });
      setAssignName("");
      toast({ title: "Assigned" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inc = detail?.incident ?? incident;
  const events = detail?.events ?? [];
  const nextActions = inc ? (NEXT_STATUS[inc.status] ?? []) : [];
  const TypeIcon = TYPE_OPTIONS.find(t => t.value === inc?.type)?.icon ?? AlertOctagon;

  return (
    <Sheet open={!!incident} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:w-[520px] sm:max-w-[520px] p-0 flex flex-col" side="right">
        {inc && (
          <>
            <SheetHeader className="flex-shrink-0 border-b px-4 py-3">
              <SheetTitle className="text-sm flex items-center gap-2">
                <TypeIcon className="h-4 w-4 text-slate-500" />
                <span className="truncate">{inc.title}</span>
                <span className={cn("ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded border font-mono", SEV_COLOR[inc.severity])}>
                  {inc.severity}
                </span>
              </SheetTitle>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {/* Meta row */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={cn("px-2 py-0.5 rounded border font-mono font-bold uppercase", STATUS_COLOR[inc.status])}>
                    {inc.status}
                  </span>
                  <span className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-muted-foreground font-mono">
                    {inc.type.replace(/_/g, " ")}
                  </span>
                  {inc.entityName && (
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-muted-foreground">
                      {inc.entityName}
                    </span>
                  )}
                  {inc.assigneeName && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
                      <User className="h-3 w-3" /> {inc.assigneeName}
                    </span>
                  )}
                </div>

                {/* Timestamps */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: "Opened",       val: fmtTs(inc.openedAt)       },
                    { label: "Acknowledged", val: fmtTs(inc.acknowledgedAt) },
                    { label: "Mitigated",    val: fmtTs(inc.mitigatedAt)    },
                    { label: "Resolved",     val: fmtTs(inc.resolvedAt)     },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded bg-slate-50 dark:bg-slate-900 p-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
                      <p className="font-mono font-medium">{val}</p>
                    </div>
                  ))}
                </div>

                {/* Description */}
                {inc.description && (
                  <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                    <p className="text-sm">{inc.description}</p>
                  </div>
                )}

                {inc.suggestedAction && (
                  <div className="rounded border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-500/5 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">Suggested Action</p>
                    <p className="text-sm text-amber-800 dark:text-amber-300">{inc.suggestedAction}</p>
                  </div>
                )}

                {/* Lifecycle actions */}
                {nextActions.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Lifecycle Actions</p>
                    <div className="flex gap-2 flex-wrap">
                      {nextActions.map(action => (
                        <Button
                          key={action.value}
                          size="sm"
                          className={cn("text-xs h-7", action.cls)}
                          disabled={statusMutation.isPending}
                          data-testid={`inc-action-${action.value}`}
                          onClick={() => statusMutation.mutate({ status: action.value })}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assign */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Assign To</p>
                  <div className="flex gap-2">
                    <Input
                      data-testid="inc-assign-input"
                      placeholder="Operator name or ID…"
                      className="h-8 text-xs"
                      value={assignName}
                      onChange={e => setAssignName(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={!assignName.trim() || assignMutation.isPending}
                      data-testid="inc-assign-btn"
                      onClick={() => assignMutation.mutate(assignName.trim())}
                    >
                      <User className="h-3 w-3 mr-1" /> Assign
                    </Button>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                    Timeline ({events.length})
                  </p>
                  <div className="space-y-2">
                    {events.map(ev => {
                      const Icon = EVENT_ICONS[ev.eventType] ?? EVENT_ICONS.default;
                      return (
                        <div key={ev.id} className="flex gap-2.5 text-xs">
                          <div className="flex flex-col items-center">
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                              <Icon className="h-3 w-3 text-slate-500" />
                            </div>
                            <div className="w-px flex-1 bg-slate-200 dark:bg-slate-800 mt-1" />
                          </div>
                          <div className="pb-3 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-700 dark:text-slate-300">{ev.actorName}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{timeAgo(ev.createdAt)}</span>
                            </div>
                            {ev.fromStatus && ev.toStatus && (
                              <span className="text-muted-foreground">
                                {ev.fromStatus} → <span className="font-medium">{ev.toStatus}</span>
                              </span>
                            )}
                            {ev.note && <p className="text-muted-foreground mt-0.5 break-words">{ev.note}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Add note */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Add Note</p>
                  <div className="flex gap-2">
                    <Input
                      data-testid="inc-note-input"
                      placeholder="Type a note…"
                      className="h-8 text-xs"
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && noteText.trim()) noteMutation.mutate(noteText.trim()); }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={!noteText.trim() || noteMutation.isPending}
                      data-testid="inc-note-submit"
                      onClick={() => noteMutation.mutate(noteText.trim())}
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NocIncidentsPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInc, setSelectedInc] = useState<NocIncident | null>(null);
  const [search, setSearch] = useState("");

  const queryParams = activeTab !== "all" ? `?status=${activeTab}` : "";
  const { data: incidents = [], isFetching } = useQuery<NocIncident[]>({
    queryKey: ["/api/noc/incidents", activeTab],
    queryFn: () => fetch(`/api/noc/incidents${queryParams}`).then(r => r.json()),
    refetchInterval: 20_000,
  });

  const filtered = incidents.filter(i =>
    !search || i.title.toLowerCase().includes(search.toLowerCase()) ||
    (i.entityName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const counts = STATUS_TABS.reduce((acc, t) => {
    acc[t.key] = t.key === "all" ? incidents.length
      : incidents.filter(i => i.status === t.key).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-red-500" />
            Incident Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Network-level incident lifecycle management
          </p>
        </div>
        <Button
          data-testid="noc-create-incident-btn"
          onClick={() => setCreateOpen(true)}
          className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
          size="sm"
        >
          <Plus className="h-4 w-4" /> New Incident
        </Button>
      </div>

      {/* Status tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              data-testid={`noc-tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                activeTab === tab.key
                  ? "bg-white dark:bg-slate-800 shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {counts[tab.key] > 0 && (
                <span className={cn("ml-1.5 text-[10px] font-bold", tab.color)}>
                  {counts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>
        <Input
          data-testid="noc-incident-search"
          placeholder="Search incidents…"
          className="h-8 text-xs w-48 ml-auto"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {["ID", "Severity", "Type", "Title / Entity", "Status", "Opened", "Assignee", ""].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                    {isFetching ? "Loading…" : "No incidents found"}
                  </td>
                </tr>
              )}
              {filtered.map((inc, i) => {
                const TypeIcon = TYPE_OPTIONS.find(t => t.value === inc.type)?.icon ?? AlertOctagon;
                return (
                  <motion.tr
                    key={inc.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    data-testid={`noc-incident-row-${inc.id}`}
                    onClick={() => setSelectedInc(inc)}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                      #{inc.id}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("text-[10px] font-bold uppercase font-mono px-1.5 py-0.5 rounded border", SEV_COLOR[inc.severity])}>
                        {inc.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <TypeIcon className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate max-w-[100px]">{inc.type.replace(/_/g, " ")}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-sm truncate max-w-[220px]">{inc.title}</p>
                      {inc.entityName && (
                        <p className="text-[11px] text-muted-foreground truncate">{inc.entityName}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("text-[10px] font-bold uppercase font-mono px-1.5 py-0.5 rounded border", STATUS_COLOR[inc.status])}>
                        {inc.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {timeAgo(inc.openedAt)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {inc.assigneeName ? (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {inc.assigneeName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground" />
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <CreateIncidentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <IncidentDetailSheet incident={selectedInc} onClose={() => setSelectedInc(null)} />
    </div>
  );
}
