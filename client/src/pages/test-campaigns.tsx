import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus, Play, Trash2, RefreshCw, CheckCircle2, Clock, X, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface CampaignDestination { cld: string; cli?: string; label?: string; }
interface TestCampaign {
  id: number; name: string; destinations: string; scheduleType: string;
  scheduledAt: string | null; cronHour: number | null;
  status: string; lastRunAt: string | null; createdAt: string;
}
interface CampaignResult {
  id: number; campaignId: number; runAt: string;
  cld: string; cli: string | null; label: string | null;
  outcome: string; sipCode: number | null; durationSec: number | null;
  pddMs: number | null; fasDetected: boolean; notes: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string }> = {
    pending: { cls: "bg-muted/20 text-muted-foreground" },
    running: { cls: "bg-blue-500/15 text-blue-400 border border-blue-500/25" },
    done:    { cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" },
    failed:  { cls: "bg-rose-500/15 text-rose-400 border border-rose-500/25" },
  };
  const c = cfg[status] ?? cfg.pending;
  return <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold", c.cls)}>{status}</span>;
}

function OutcomeBadge({ outcome, fas }: { outcome: string; fas: boolean }) {
  if (fas) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/25"><AlertTriangle className="w-3 h-3" />FAS</span>;
  if (outcome === "connected") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"><CheckCircle2 className="w-3 h-3" />Connected</span>;
  if (outcome === "timeout")   return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25"><Clock className="w-3 h-3" />Timeout</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25"><X className="w-3 h-3" />Failed</span>;
}

function ResultsPanel({ campaignId }: { campaignId: number }) {
  const { data: results = [], isLoading } = useQuery<CampaignResult[]>({
    queryKey: ["/api/campaigns", campaignId, "results"],
    queryFn: () => fetch(`/api/campaigns/${campaignId}/results`).then(r => r.json()),
  });

  if (isLoading) return <div className="text-xs text-muted-foreground p-4">Loading results…</div>;
  if (!results.length) return <div className="text-xs text-muted-foreground p-4">No results yet. Run the campaign to see call outcomes.</div>;

  return (
    <div className="border-t border-border/30 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/10">
          <tr>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Time</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Destination</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">CLI</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Outcome</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">SIP</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Duration</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">PDD</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id} className="border-t border-border/20 hover:bg-muted/10">
              <td className="px-3 py-2 text-muted-foreground">{new Date(r.runAt).toLocaleString()}</td>
              <td className="px-3 py-2 font-mono">{r.label ? `${r.label} (${r.cld})` : r.cld}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{r.cli || "—"}</td>
              <td className="px-3 py-2"><OutcomeBadge outcome={r.outcome} fas={r.fasDetected} /></td>
              <td className="px-3 py-2 font-mono">{r.sipCode ?? "—"}</td>
              <td className="px-3 py-2 font-mono">{r.durationSec != null ? `${r.durationSec.toFixed(1)}s` : "—"}</td>
              <td className="px-3 py-2 font-mono">{r.pddMs != null ? `${r.pddMs.toFixed(0)}ms` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName]         = useState("");
  const [scheduleType, setSched] = useState("once");
  const [scheduledAt, setSchedAt] = useState("");
  const [cronHour, setCronHour]  = useState("8");
  const [dests, setDests]        = useState<CampaignDestination[]>([{ cld: "", cli: "", label: "" }]);

  const addDest = () => setDests(d => [...d, { cld: "", cli: "", label: "" }]);
  const removeDest = (i: number) => setDests(d => d.filter((_, idx) => idx !== i));
  const setDest = (i: number, k: keyof CampaignDestination, v: string) =>
    setDests(d => d.map((row, idx) => idx === i ? { ...row, [k]: v } : row));

  const mutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/campaigns", body),
    onSuccess: () => {
      toast({ title: "Campaign created" });
      qc.invalidateQueries({ queryKey: ["/api/campaigns"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    const validDests = dests.filter(d => d.cld.trim());
    if (!name.trim() || !validDests.length) {
      toast({ title: "Campaign name and at least one destination required", variant: "destructive" }); return;
    }
    mutation.mutate({
      name: name.trim(),
      destinations: validDests,
      scheduleType,
      scheduledAt: scheduleType === "once" && scheduledAt ? scheduledAt : null,
      cronHour: (scheduleType === "daily" || scheduleType === "hourly") ? Number(cronHour) : null,
    });
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Test Campaign</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1 block">Campaign Name</Label>
            <Input data-testid="input-campaign-name" placeholder="e.g. Nigeria CLI check" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Schedule</Label>
              <Select value={scheduleType} onValueChange={setSched}>
                <SelectTrigger data-testid="select-campaign-schedule"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Run once</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scheduleType === "once" && (
              <div>
                <Label className="text-xs mb-1 block">Scheduled At (optional)</Label>
                <Input type="datetime-local" data-testid="input-campaign-at" value={scheduledAt} onChange={e => setSchedAt(e.target.value)} />
              </div>
            )}
            {scheduleType === "daily" && (
              <div>
                <Label className="text-xs mb-1 block">Hour (UTC)</Label>
                <Input type="number" min="0" max="23" data-testid="input-campaign-hour" value={cronHour} onChange={e => setCronHour(e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Destinations</Label>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={addDest} data-testid="button-add-destination">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add destination
              </Button>
            </div>
            <div className="space-y-2">
              {dests.map((dest, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                  <Input placeholder="CLD e.g. +2348012345" data-testid={`input-cld-${i}`} value={dest.cld} onChange={e => setDest(i, "cld", e.target.value)} />
                  <Input placeholder="CLI (optional)" data-testid={`input-cli-${i}`} value={dest.cli ?? ""} onChange={e => setDest(i, "cli", e.target.value)} />
                  <Input placeholder="Label (optional)" data-testid={`input-label-${i}`} value={dest.label ?? ""} onChange={e => setDest(i, "label", e.target.value)} />
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground" onClick={() => removeDest(i)} data-testid={`button-remove-dest-${i}`}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">CLD = destination number · CLI = caller ID · Label = friendly name</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}><X className="w-4 h-4 mr-1" />Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending} data-testid="button-campaign-save">
            {mutation.isPending && <RefreshCw className="w-4 h-4 animate-spin mr-2" />}
            Create Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignCard({ campaign }: { campaign: TestCampaign }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const dests: CampaignDestination[] = (() => { try { return JSON.parse(campaign.destinations); } catch { return []; } })();

  const runMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/campaigns/${campaign.id}/run`, {}),
    onSuccess: () => {
      toast({ title: "Campaign started", description: "Calls queued — check results shortly." });
      qc.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/campaigns/${campaign.id}`),
    onSuccess: () => { toast({ title: "Campaign deleted" }); qc.invalidateQueries({ queryKey: ["/api/campaigns"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden" data-testid={`card-campaign-${campaign.id}`}>
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" data-testid={`text-campaign-name-${campaign.id}`}>{campaign.name}</span>
            <StatusBadge status={campaign.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dests.length} destination{dests.length !== 1 ? "s" : ""} ·{" "}
            {campaign.scheduleType === "daily" ? `Daily at ${campaign.cronHour ?? 8}:00 UTC` :
             campaign.scheduleType === "hourly" ? "Hourly" :
             campaign.scheduledAt ? `Once · ${new Date(campaign.scheduledAt).toLocaleString()}` : "Manual trigger"} ·{" "}
            {campaign.lastRunAt ? `Last run ${new Date(campaign.lastRunAt).toLocaleString()}` : "Never run"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => runMut.mutate()}
            disabled={runMut.isPending || campaign.status === "running"} data-testid={`button-run-campaign-${campaign.id}`}>
            {runMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Run now
          </Button>
          <Button variant="ghost" size="icon" className="w-8 h-8 text-rose-400 hover:text-rose-300"
            onClick={() => { if (confirm("Delete this campaign?")) deleteMut.mutate(); }} data-testid={`button-delete-campaign-${campaign.id}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setExpanded(e => !e)} data-testid={`button-expand-campaign-${campaign.id}`}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      {expanded && <ResultsPanel campaignId={campaign.id} />}
    </div>
  );
}

export default function TestCampaignsPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: campaigns = [], isLoading } = useQuery<TestCampaign[]>({
    queryKey: ["/api/campaigns"],
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-cyan-400" />
            <h2 className="text-2xl font-bold tracking-tight">Test Call Campaigns</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Scheduled batch test calls to verify CLI delivery, connection quality, and FAS detection</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/campaigns"] })} disabled={isLoading} data-testid="button-refresh-campaigns">
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />Refresh
          </Button>
          <Button size="sm" onClick={() => setShowModal(true)} data-testid="button-new-campaign">
            <Plus className="w-4 h-4 mr-2" />New Campaign
          </Button>
        </div>
      </div>

      {isLoading && <div className="flex items-center justify-center h-32 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading…</div>}

      {!isLoading && campaigns.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <FlaskConical className="w-10 h-10 opacity-30" />
          <p>No campaigns yet. Create your first test campaign.</p>
        </div>
      )}

      {!isLoading && campaigns.map(c => <CampaignCard key={c.id} campaign={c} />)}

      {showModal && <CampaignModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
