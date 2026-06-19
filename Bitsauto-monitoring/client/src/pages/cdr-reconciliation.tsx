import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  XCircle, Plus, Download, ChevronDown, ChevronRight,
  ArrowRightLeft, Eye, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReconSession {
  id: number;
  sessionType: "vendor" | "client";
  partyName: string;
  billingPeriod: string;
  uploadedAt: string;
  totalRows: number;
  matched: number;
  durationMismatch: number;
  missingOurs: number;
  extraOurs: number;
  notes: string | null;
}

interface ReconRow {
  id: number;
  cli: string | null;
  cld: string | null;
  startTime: string | null;
  theirDuration: number | null;
  ourDuration: number | null;
  delta: number | null;
  theirCost: number | null;
  ourCost: number | null;
  matchStatus: "matched" | "duration_mismatch" | "missing_ours" | "extra_ours";
  sippyCallId: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  matched:           { label: "Matched",              color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  duration_mismatch: { label: "Duration Mismatch",    color: "bg-amber-500/15 text-amber-400 border-amber-500/30",      icon: AlertTriangle },
  missing_ours:      { label: "Missing from Our CDR", color: "bg-red-500/15 text-red-400 border-red-500/30",            icon: XCircle },
  extra_ours:        { label: "Extra in Our CDR",     color: "bg-blue-500/15 text-blue-400 border-blue-500/30",         icon: Plus },
} as const;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ── Session stats bar ─────────────────────────────────────────────────────────

function SessionStats({ s }: { s: ReconSession }) {
  const total = s.totalRows || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="grid grid-cols-4 gap-3 mt-3">
      {[
        { key: "matched",           val: s.matched,          label: "Matched",          bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
        { key: "durationMismatch",  val: s.durationMismatch, label: "Duration Mismatch",bg: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
        { key: "missingOurs",       val: s.missingOurs,      label: "Missing Ours",     bg: "bg-red-500/10 border-red-500/20 text-red-400" },
        { key: "extraOurs",         val: s.extraOurs,        label: "Extra in Ours",    bg: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
      ].map(item => (
        <div key={item.key} className={`rounded-md border px-3 py-2 ${item.bg}`}>
          <p className="text-xl font-bold">{item.val}</p>
          <p className="text-[11px] opacity-80">{item.label}</p>
          <p className="text-[10px] opacity-60">{pct(item.val)}% of {total}</p>
        </div>
      ))}
    </div>
  );
}

// ── Row-level diff table ──────────────────────────────────────────────────────

function ReconRowsTable({ sessionId }: { sessionId: number }) {
  const [filter, setFilter] = useState<"all" | ReconRow["matchStatus"]>("all");
  const [page, setPage] = useState(0);
  const PAGE = 100;

  const { data: rows = [], isLoading } = useQuery<ReconRow[]>({
    queryKey: ["/api/cdr-recon/sessions", sessionId, "rows"],
    queryFn: () => apiRequest("GET", `/api/cdr-recon/sessions/${sessionId}/rows`).then(r => r.json()),
    staleTime: 60_000,
  });

  const filtered = filter === "all" ? rows : rows.filter(r => r.matchStatus === filter);
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {(["all", "matched", "duration_mismatch", "missing_ours", "extra_ours"] as const).map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => { setFilter(f); setPage(0); }}
            data-testid={`cdr-recon-filter-${f}`}
          >
            {f === "all" ? `All (${rows.length})` : `${STATUS_CFG[f].label} (${rows.filter(r => r.matchStatus === f).length})`}
          </Button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading rows…</p>}

      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">No rows match this filter.</p>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">CLI</TableHead>
                  <TableHead className="text-xs">CLD</TableHead>
                  <TableHead className="text-xs">Start Time</TableHead>
                  <TableHead className="text-xs text-right">Their Dur (s)</TableHead>
                  <TableHead className="text-xs text-right">Our Dur (s)</TableHead>
                  <TableHead className="text-xs text-right">Delta (s)</TableHead>
                  <TableHead className="text-xs text-right">Their Cost</TableHead>
                  <TableHead className="text-xs text-right">Our Cost</TableHead>
                  <TableHead className="text-xs">Sippy Call ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map(r => {
                  const cfg = STATUS_CFG[r.matchStatus];
                  const Icon = cfg.icon;
                  return (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>
                          <Icon className="h-2.5 w-2.5 mr-1" />{cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">{r.cli ?? "—"}</TableCell>
                      <TableCell className="font-mono">{r.cld ?? "—"}</TableCell>
                      <TableCell className="font-mono">{r.startTime ? new Date(r.startTime).toISOString().replace("T", " ").slice(0, 19) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{r.theirDuration ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{r.ourDuration ?? "—"}</TableCell>
                      <TableCell className={`text-right font-mono font-medium ${r.delta != null && r.delta !== 0 ? Math.abs(r.delta) > 30 ? "text-red-400" : "text-amber-400" : "text-muted-foreground"}`}>
                        {r.delta != null ? (r.delta > 0 ? `+${r.delta}` : String(r.delta)) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{r.theirCost != null ? `$${Number(r.theirCost).toFixed(4)}` : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{r.ourCost != null ? `$${Number(r.ourCost).toFixed(4)}` : "—"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground text-[10px]">{r.sippyCallId ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {filtered.length > PAGE && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, filtered.length)} of {filtered.length}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-6 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button size="sm" variant="outline" className="h-6 text-xs" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Session detail dialog ─────────────────────────────────────────────────────

function SessionDetailDialog({ session, open, onClose }: { session: ReconSession | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const raiseMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/cdr-recon/sessions/${session!.id}/raise-dispute`).then(r => r.json()),
    onSuccess: (data: any) => {
      toast({ title: "Dispute case created", description: `Case #${data.caseId} opened with ${data.evidenceRows} evidence rows.` });
      queryClient.invalidateQueries({ queryKey: ["/api/dispute-cases"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function handleExport() {
    const a = document.createElement("a");
    a.href = `/api/cdr-recon/sessions/${session!.id}/export`;
    a.download = `cdr-recon-${session!.partyName.replace(/\s+/g, "-")}-${session!.billingPeriod}.xlsx`;
    a.click();
  }

  if (!session) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="dialog-cdr-recon-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            CDR Reconciliation — {session.partyName}
          </DialogTitle>
          <DialogDescription>
            {session.sessionType === "vendor" ? "Vendor" : "Client"} · {session.billingPeriod} ·
            Uploaded {new Date(session.uploadedAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        <SessionStats s={session} />

        <div className="flex gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={handleExport} data-testid="btn-cdr-recon-export">
            <Download className="h-3.5 w-3.5 mr-1.5" />Export Counter-CDR (.xlsx)
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => raiseMutation.mutate()}
            disabled={raiseMutation.isPending || session.durationMismatch + session.missingOurs === 0}
            data-testid="btn-cdr-recon-raise-dispute"
          >
            <Shield className="h-3.5 w-3.5 mr-1.5" />
            {raiseMutation.isPending ? "Creating…" : "Raise Dispute Case"}
          </Button>
        </div>

        <Separator className="my-3" />

        <Button
          variant="ghost" size="sm"
          className="flex items-center gap-1 text-xs -ml-1"
          onClick={() => setExpanded(e => !e)}
          data-testid="btn-cdr-recon-toggle-rows"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {expanded ? "Hide" : "Show"} Call-by-Call Diff ({session.totalRows.toLocaleString()} rows)
        </Button>

        {expanded && <ReconRowsTable sessionId={session.id} />}
      </DialogContent>
    </Dialog>
  );
}

// ── Upload dialog ─────────────────────────────────────────────────────────────

function UploadDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: (sessionId: number) => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<string[]>([]);
  const [form, setForm] = useState({ sessionType: "vendor" as "vendor" | "client", partyName: "", billingPeriod: "" });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const buf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const res = await apiRequest("POST", "/api/cdr-recon/upload", {
        base64,
        filename: file.name,
        sessionType: form.sessionType,
        partyName: form.partyName.trim(),
        billingPeriod: form.billingPeriod.trim(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "CDR reconciliation complete", description: `${data.stats.total} rows processed — ${data.stats.matched} matched, ${data.stats.durationMismatch} duration mismatches, ${data.stats.missingOurs} missing.` });
      onSuccess(data.sessionId);
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    // Show first 3 rows as preview
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        setPreviewRows([headers.join(" | "), ...rows.slice(0, 3).map(r => Object.values(r).slice(0, 8).join(" | "))]);
      } catch { setPreviewRows(["Could not preview file"]); }
    };
    reader.readAsArrayBuffer(f);
  }

  function reset() {
    setFile(null); setPreviewRows([]);
    setForm({ sessionType: "vendor", partyName: "", billingPeriod: "" });
    if (fileRef.current) fileRef.current.value = "";
  }

  const canSubmit = !!file && form.partyName.trim() && /^\d{4}-\d{2}$/.test(form.billingPeriod);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg" data-testid="dialog-cdr-recon-upload">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />Upload Counterparty CDRs
          </DialogTitle>
          <DialogDescription>
            Upload the vendor's or client's CDR Excel file to compare against our records call-by-call.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={form.sessionType} onValueChange={v => setForm(f => ({ ...f, sessionType: v as "vendor" | "client" }))}>
                <SelectTrigger data-testid="select-cdr-session-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">Vendor / Carrier</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Billing Period (YYYY-MM)</Label>
              <Input
                placeholder="2026-05"
                value={form.billingPeriod}
                onChange={e => setForm(f => ({ ...f, billingPeriod: e.target.value }))}
                data-testid="input-cdr-billing-period"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{form.sessionType === "vendor" ? "Vendor / Carrier Name" : "Client Name"}</Label>
            <Input
              placeholder={form.sessionType === "vendor" ? "e.g. Callntalk" : "e.g. Acme Corp"}
              value={form.partyName}
              onChange={e => setForm(f => ({ ...f, partyName: e.target.value }))}
              data-testid="input-cdr-party-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">CDR File (.xlsx)</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              data-testid="drop-cdr-file"
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">
                  <Upload className="h-6 w-6 mx-auto mb-1 opacity-50" />
                  Click to choose .xlsx file
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-cdr-file"
            />
            <p className="text-[11px] text-muted-foreground">
              Expected columns (any order): <span className="font-mono">cli, cld, start_time, duration / billsec, cost</span>
            </p>
          </div>

          {previewRows.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">File Preview</p>
              {previewRows.map((r, i) => (
                <p key={i} className={`text-[11px] font-mono truncate ${i === 0 ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{r}</p>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!canSubmit || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
            data-testid="btn-cdr-upload-submit"
          >
            {uploadMutation.isPending ? "Processing…" : "Upload & Match CDRs"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CDRReconciliationPage() {
  const [showUpload, setShowUpload] = useState(false);
  const [detailSession, setDetailSession] = useState<ReconSession | null>(null);
  const queryClient = useQueryClient();

  const { data: sessions = [], isLoading } = useQuery<ReconSession[]>({
    queryKey: ["/api/cdr-recon/sessions"],
    queryFn: () => apiRequest("GET", "/api/cdr-recon/sessions").then(r => r.json()),
    refetchInterval: 30_000,
  });

  function handleUploadSuccess(sessionId: number) {
    setShowUpload(false);
    queryClient.invalidateQueries({ queryKey: ["/api/cdr-recon/sessions"] });
    // Open the new session
    setTimeout(() => {
      queryClient.fetchQuery({
        queryKey: ["/api/cdr-recon/sessions"],
        queryFn: () => apiRequest("GET", "/api/cdr-recon/sessions").then(r => r.json()),
      }).then((ss: any) => {
        const found = (ss as ReconSession[]).find(s => s.id === sessionId);
        if (found) setDetailSession(found);
      });
    }, 500);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            CDR Dispute Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload a vendor's or client's CDR Excel file and compare call-by-call against our records to identify mismatches.
          </p>
        </div>
        <Button onClick={() => setShowUpload(true)} data-testid="btn-cdr-new-session">
          <Upload className="h-4 w-4 mr-2" />Upload CDR File
        </Button>
      </div>

      {/* How-it-works banner */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap gap-6 text-sm">
          {[
            { step: "1", label: "Upload .xlsx", desc: "Upload vendor or client CDR file" },
            { step: "2", label: "Auto-Match", desc: "Matched by CLD + date + duration ±10s" },
            { step: "3", label: "Review Diff", desc: "See matched / mismatch / missing rows" },
            { step: "4", label: "Export & Dispute", desc: "Counter-CDR .xlsx + one-click dispute" },
          ].map(item => (
            <div key={item.step} className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">{item.step}</span>
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="text-muted-foreground text-xs">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Session list */}
      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Loading sessions…</p>}

      {!isLoading && sessions.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <ArrowRightLeft className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">No reconciliation sessions yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Upload a vendor or client CDR file to get started.</p>
          <Button className="mt-4" onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-2" />Upload CDR File
          </Button>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map(s => {
            const matchPct = s.totalRows > 0 ? Math.round((s.matched / s.totalRows) * 100) : 0;
            return (
              <div
                key={s.id}
                className="rounded-lg border bg-card p-4 hover:border-primary/40 transition-colors cursor-pointer"
                onClick={() => setDetailSession(s)}
                data-testid={`cdr-session-row-${s.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{s.partyName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {s.sessionType === "vendor" ? "Vendor" : "Client"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {s.billingPeriod}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(s.uploadedAt).toLocaleString()} · {s.totalRows} rows
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex gap-2 text-xs">
                      <span className="text-emerald-400 font-medium">{s.matched} ✓</span>
                      {s.durationMismatch > 0 && <span className="text-amber-400 font-medium">{s.durationMismatch} ⚠</span>}
                      {s.missingOurs > 0 && <span className="text-red-400 font-medium">{s.missingOurs} ✗</span>}
                    </div>
                    <div className={`text-sm font-bold ${matchPct >= 95 ? "text-emerald-400" : matchPct >= 80 ? "text-amber-400" : "text-red-400"}`}>
                      {matchPct}%
                    </div>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                {/* Mini match bar */}
                <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-emerald-500" style={{ width: `${s.totalRows > 0 ? (s.matched / s.totalRows) * 100 : 0}%` }} />
                  <div className="bg-amber-500" style={{ width: `${s.totalRows > 0 ? (s.durationMismatch / s.totalRows) * 100 : 0}%` }} />
                  <div className="bg-red-500" style={{ width: `${s.totalRows > 0 ? (s.missingOurs / s.totalRows) * 100 : 0}%` }} />
                  <div className="bg-blue-500" style={{ width: `${s.totalRows > 0 ? (s.extraOurs / s.totalRows) * 100 : 0}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} onSuccess={handleUploadSuccess} />
      <SessionDetailDialog session={detailSession} open={!!detailSession} onClose={() => setDetailSession(null)} />
    </div>
  );
}
