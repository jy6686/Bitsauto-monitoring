import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalRequest, ApprovalAuditEntry } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

type ApprovalRequestWithLog = ApprovalRequest & { auditLog?: ApprovalAuditEntry[] };

const STATUS_BADGE: Record<string, { label: string; icon: any; className: string }> = {
  pending:  { label: "Pending",  icon: Clock,        className: "bg-amber-500/10 text-amber-400 border-amber-500/20"  },
  approved: { label: "Approved", icon: CheckCircle2, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected: { label: "Rejected", icon: XCircle,      className: "bg-rose-500/10 text-rose-400 border-rose-500/20"   },
};

const ACTION_LABEL: Record<string, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
};

const OP_COLOR: Record<string, string> = {
  create: "text-emerald-400",
  update: "text-blue-400",
  delete: "text-rose-400",
};

function formatRelative(date: string | null | Date | undefined): string {
  if (!date) return "—";
  const d = new Date(date as string);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

function DiffView({ before, after }: { before: any; after: any }) {
  if (!before && !after) return null;

  const renderObj = (obj: any, label: string, colorClass: string) => (
    <div className="flex-1 min-w-0">
      <div className={cn("text-xs font-mono font-semibold mb-1", colorClass)}>{label}</div>
      <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
        {obj != null ? JSON.stringify(obj, null, 2) : "—"}
      </pre>
    </div>
  );

  return (
    <div className="flex gap-3 mt-2">
      {before != null && renderObj(before, "Before", "text-rose-400")}
      {after  != null && renderObj(after,  "After",  "text-emerald-400")}
    </div>
  );
}

function AuditLogEntry({ entry }: { entry: ApprovalAuditEntry }) {
  const icon = entry.action === "approved" ? CheckCircle2 : entry.action === "rejected" ? XCircle : Clock;
  const color = entry.action === "approved" ? "text-emerald-400" : entry.action === "rejected" ? "text-rose-400" : "text-amber-400";
  const Icon = icon;
  const isSelfApproval = entry.note?.includes("SELF-APPROVAL");

  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium">{entry.actorName ?? entry.actorId}</span>
          {entry.actorRole && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">{entry.actorRole}</Badge>
          )}
          <span className={cn("text-xs font-semibold capitalize", color)}>{entry.action}</span>
          {isSelfApproval && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 bg-rose-500/10 text-rose-400 border-rose-500/30">
              Self-Approved
            </Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{formatRelative(entry.createdAt)}</span>
        </div>
        {entry.note && !isSelfApproval && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.note}</p>
        )}
        {isSelfApproval && (
          <p className="text-xs text-rose-400 mt-0.5 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Emergency self-approval — logged for audit
          </p>
        )}
      </div>
    </div>
  );
}

function RequestRow({ request, onApprove, onReject, canAct }: {
  request: ApprovalRequest;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  canAct: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: detail } = useQuery<ApprovalRequestWithLog>({
    queryKey: ["/api/approvals", request.id],
    enabled: expanded,
  });

  const statusInfo = STATUS_BADGE[request.status] ?? STATUS_BADGE.pending;
  const StatusIcon = statusInfo.icon;
  const isSelf = request.selfApproval;

  return (
    <>
      <TableRow
        className={cn("cursor-pointer hover:bg-muted/30 transition-colors", expanded && "bg-muted/20")}
        onClick={() => setExpanded(e => !e)}
        data-testid={`approval-row-${request.id}`}
      >
        <TableCell className="py-2.5 pr-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate max-w-[200px]" title={request.entityName ?? ""}>
              {request.entityName ?? `Request #${request.id}`}
            </span>
            {isSelf && (
              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-rose-500/10 text-rose-400 border-rose-500/30 shrink-0">
                Self-Approved
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {request.operationType}
          </div>
        </TableCell>
        <TableCell className="py-2.5">
          <span className={cn("text-xs font-semibold uppercase tracking-wide", OP_COLOR[request.action] ?? "text-muted-foreground")}>
            {ACTION_LABEL[request.action] ?? request.action}
          </span>
        </TableCell>
        <TableCell className="py-2.5 text-xs text-muted-foreground">
          {request.requestedByName ?? request.requestedBy}
        </TableCell>
        <TableCell className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
          {formatRelative(request.requestedAt)}
        </TableCell>
        <TableCell className="py-2.5">
          <Badge variant="outline" className={cn("text-[11px] h-5 px-2 gap-1", statusInfo.className)}>
            <StatusIcon className="h-3 w-3" />
            {statusInfo.label}
          </Badge>
        </TableCell>
        <TableCell className="py-2.5 text-right" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1.5">
            {request.status === 'pending' && canAct && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => onApprove(request.id)}
                  data-testid={`btn-approve-${request.id}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                  onClick={() => onReject(request.id)}
                  data-testid={`btn-reject-${request.id}`}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </>
            )}
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/10 border-t-0">
          <TableCell colSpan={6} className="py-3 px-4">
            <div className="space-y-3">
              {(request.payloadBefore != null || request.payloadAfter != null) && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Change Details</div>
                  <DiffView before={request.payloadBefore as any} after={request.payloadAfter as any} />
                </div>
              )}
              {request.status === 'rejected' && request.rejectionReason && (
                <div className="flex items-start gap-2 rounded bg-rose-500/5 border border-rose-500/20 px-3 py-2">
                  <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-rose-300"><span className="font-semibold">Rejection reason:</span> {request.rejectionReason}</p>
                </div>
              )}
              {request.status !== 'pending' && request.reviewedBy && (
                <div className="text-xs text-muted-foreground">
                  {request.status === 'approved' ? 'Approved' : 'Rejected'} by{" "}
                  <span className="font-medium text-foreground">{request.reviewedByName ?? request.reviewedBy}</span>
                  {request.reviewedAt && <> · {formatRelative(request.reviewedAt)}</>}
                </div>
              )}
              {detail?.auditLog && detail.auditLog.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Audit Trail</div>
                  <div className="rounded border border-border/40 px-3 py-1">
                    {detail.auditLog.map(e => <AuditLogEntry key={e.id} entry={e} />)}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ApprovalQueuePage() {
  const { role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>("pending");
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: requests = [], isLoading } = useQuery<ApprovalRequest[]>({
    queryKey: ["/api/approvals", tab !== "all" ? tab : undefined],
    queryFn: async () => {
      const url = tab === "all" ? "/api/approvals" : `/api/approvals?status=${tab}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/approvals/pending-count"],
    refetchInterval: 15000,
  });
  const pendingCount = countData?.count ?? 0;

  const approvePolicy = { super_admin: true, admin: true, team_lead: true, management: false, noc_operator: false, viewer: false } as Record<string, boolean>;
  const canAct = approvePolicy[role ?? "viewer"] ?? false;

  const approveMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/approvals/${id}/approve`)).json(),
    onSuccess: (data: any) => {
      if (!data.success) {
        toast({ title: "Cannot approve", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Approved", description: "Change executed on Sippy." });
      }
      qc.invalidateQueries({ queryKey: ["/api/approvals"] });
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
      (await apiRequest("POST", `/api/approvals/${id}/reject`, { reason })).json(),
    onSuccess: (data: any) => {
      if (!data.success) {
        toast({ title: "Cannot reject", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Request rejected." });
      }
      setRejectTarget(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["/api/approvals"] });
    },
    onError: (e: any) => toast({ title: "Rejection failed", description: e.message, variant: "destructive" }),
  });

  const handleApprove = (id: number) => { approveMut.mutate(id); };
  const handleReject  = (id: number) => { setRejectTarget(id); setRejectReason(""); };
  const submitReject  = () => { if (rejectTarget && rejectReason.trim()) rejectMut.mutate({ id: rejectTarget, reason: rejectReason.trim() }); };

  const tabs = [
    { value: "pending",  label: "Pending",  count: pendingCount },
    { value: "approved", label: "Approved", count: 0 },
    { value: "rejected", label: "Rejected", count: 0 },
    { value: "all",      label: "All",      count: 0 },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-violet-400" />
          <div>
            <h1 className="text-xl font-bold">Approval Queue</h1>
            <p className="text-sm text-muted-foreground">
              Review and action routing change requests before they are applied to Sippy.
            </p>
          </div>
          {pendingCount > 0 && (
            <Badge className="bg-amber-500 text-white text-xs px-2 py-0.5" data-testid="badge-pending-count">
              {pendingCount}
            </Badge>
          )}
        </div>
      </div>

      {/* Role info banner */}
      {!canAct && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-300">
            Your role ({role ?? "viewer"}) can submit change requests but cannot approve or reject them.
            Requests you submit will be reviewed by an Admin or Team Lead.
          </p>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          {tabs.map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="text-xs gap-1.5"
              data-testid={`tab-${t.value}`}
            >
              {t.label}
              {t.count > 0 && (
                <Badge className="h-4 px-1 text-[10px] bg-amber-500 text-white">{t.count}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading approval requests…</span>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShieldCheck className="h-10 w-10 opacity-20 mx-auto mb-3" />
          <p className="text-sm font-medium">No {tab === "all" ? "" : tab} requests</p>
          <p className="text-xs mt-1">
            {tab === "pending"
              ? "No changes are awaiting approval."
              : "No requests match this filter."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 bg-muted/20">
                <TableHead className="text-xs py-2.5">Entity / Operation</TableHead>
                <TableHead className="text-xs py-2.5">Action</TableHead>
                <TableHead className="text-xs py-2.5">Requested By</TableHead>
                <TableHead className="text-xs py-2.5">When</TableHead>
                <TableHead className="text-xs py-2.5">Status</TableHead>
                <TableHead className="text-xs py-2.5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(req => (
                <RequestRow
                  key={req.id}
                  request={req}
                  canAct={canAct}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectTarget !== null} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Change Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Provide a reason for rejecting this request. This will be visible to the submitter and logged in the audit trail.
            </p>
            <Textarea
              placeholder="Rejection reason (required)…"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="min-h-[80px] resize-none"
              data-testid="input-reject-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMut.isPending}
              onClick={submitReject}
              data-testid="btn-confirm-reject"
            >
              {rejectMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
