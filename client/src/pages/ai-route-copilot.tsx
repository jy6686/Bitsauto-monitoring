import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FlaskConical, Plus, Play, Trash2, ToggleLeft, ToggleRight,
  CheckCircle2, XCircle, Clock, Wifi, TrendingUp, TrendingDown,
  Activity, AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RouteTestJob {
  id: number;
  name: string;
  destinationPrefix: string;
  vendorIds: string[];
  vendorNames: string[];
  scheduleMinutes: number;
  enabled: boolean;
  createdBy: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string | null;
}

interface RouteTestResult {
  id: number;
  jobId: number | null;
  vendorId: string | null;
  vendorName: string | null;
  destination: string | null;
  startedAt: string;
  connected: boolean;
  sipCode: number | null;
  pddMs: number | null;
  durationMs: number | null;
  notes: string | null;
}

interface RouteTestEvidence {
  jobId: number;
  jobName: string;
  vendorName: string;
  destination: string;
  totalTests: number;
  successCount: number;
  failCount: number;
  recentSipCodes: number[];
  avgPddMs: number | null;
  passRate: number;
}

// ── Schedule badge helper ──────────────────────────────────────────────────────

function scheduleBadge(mins: number) {
  if (mins === 0) return <Badge variant="secondary" data-testid="badge-manual">Manual</Badge>;
  if (mins === 15) return <Badge className="bg-blue-600 text-white" data-testid="badge-15m">Every 15 min</Badge>;
  if (mins === 30) return <Badge className="bg-indigo-600 text-white" data-testid="badge-30m">Every 30 min</Badge>;
  if (mins === 60) return <Badge className="bg-violet-600 text-white" data-testid="badge-60m">Hourly</Badge>;
  return <Badge variant="outline">{mins} min</Badge>;
}

function healthBadge(passRate: number) {
  if (passRate >= 80) return <Badge className="bg-emerald-600 text-white">● Healthy</Badge>;
  if (passRate >= 50) return <Badge className="bg-amber-500 text-white">● Degraded</Badge>;
  return <Badge className="bg-red-600 text-white">● Critical</Badge>;
}

function sipCodeBadge(code: number | null) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  if (code === 200) return <Badge className="bg-emerald-600 text-white text-xs">{code}</Badge>;
  if (code >= 500) return <Badge className="bg-red-600 text-white text-xs">{code}</Badge>;
  if (code >= 400) return <Badge className="bg-amber-500 text-white text-xs">{code}</Badge>;
  return <Badge variant="outline" className="text-xs">{code}</Badge>;
}

// ── Trend sparkline (SVG polyline over hourly pass-rate buckets) ──────────────

interface TrendBucket { hour: string; passRate: number | null; total: number; passed: number }

function TrendSparkline({ jobId, vendorName, passRate, total }: {
  jobId: number;
  vendorName: string;
  passRate: number;
  total: number;
}) {
  const { data } = useQuery<{ success: boolean; data: TrendBucket[] }>({
    queryKey: ["/api/route-tests/trend", jobId, vendorName],
    queryFn: async () => {
      const url = `/api/route-tests/trend?jobId=${jobId}&vendorName=${encodeURIComponent(vendorName)}&hours=24`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const pct = Math.min(100, Math.max(0, passRate));
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444";

  // SVG sparkline — 96×24px polyline from trend data
  const buckets = data?.data ?? [];
  const withData = buckets.filter(b => b.passRate !== null);
  let polyline = "";
  if (withData.length >= 2) {
    const W = 96; const H = 20;
    const xs = withData.map((_, i) => Math.round((i / (withData.length - 1)) * W));
    const ys = withData.map(b => Math.round(H - (b.passRate! / 100) * H));
    polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  }

  return (
    <div className="space-y-1" data-testid="sparkline">
      {polyline ? (
        <svg width={96} height={20} viewBox="0 0 96 20" className="overflow-visible">
          <polyline
            points={polyline}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.9}
          />
        </svg>
      ) : (
        <div className="relative w-24 h-2 rounded-full bg-muted overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="text-xs font-mono" style={{ color }}>{pct}%</span>
        <span className="text-xs text-muted-foreground">({total} tests, 24h trend)</span>
      </div>
    </div>
  );
}

// ── New Job Form ──────────────────────────────────────────────────────────────

interface SippyVendor {
  i_vendor: number;
  name: string;
}

function NewJobDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen]     = useState(false);
  const [name, setName]     = useState("");
  const [prefix, setPrefix] = useState("");
  const [schedule, setSchedule] = useState("0");
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const qc = useQueryClient();

  // Fetch real Sippy vendor list when dialog opens
  const { data: vendorData, isLoading: vendorsLoading } = useQuery<{ vendors: SippyVendor[] }>({
    queryKey: ["/api/sippy/vendors"],
    enabled: open,
  });
  const sippyVendors = vendorData?.vendors ?? [];

  const toggleVendor = useCallback((id: number) => {
    setSelectedVendorIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/route-tests/jobs", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/route-tests/jobs"] });
      setOpen(false);
      setName(""); setPrefix(""); setSchedule("0"); setSelectedVendorIds(new Set());
      toast({ title: "Job created", description: "Route test job scheduled" });
      onCreated();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const selectedVendors = sippyVendors.filter(v => selectedVendorIds.has(v.i_vendor));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-new-job">
          <Plus className="h-4 w-4 mr-1" /> New Test Job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Route Test Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label htmlFor="job-name">Job Name</Label>
            <Input
              id="job-name"
              data-testid="input-job-name"
              placeholder="e.g. UK Mobile quality check"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="job-prefix">Destination Prefix</Label>
            <Input
              id="job-prefix"
              data-testid="input-prefix"
              placeholder="e.g. 44750 or 1212"
              value={prefix}
              onChange={e => setPrefix(e.target.value)}
            />
          </div>
          <div>
            <Label>Vendors to Test</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Select vendors expected to carry this destination. Routing follows Sippy's LCR plan.
            </p>
            {vendorsLoading ? (
              <div className="text-xs text-muted-foreground py-2">Loading vendors…</div>
            ) : sippyVendors.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No vendors found in Sippy</div>
            ) : (
              <ScrollArea className="h-32 border rounded-md p-2">
                <div className="space-y-2">
                  {sippyVendors.map(v => (
                    <div key={v.i_vendor} className="flex items-center gap-2">
                      <Checkbox
                        id={`vendor-${v.i_vendor}`}
                        data-testid={`checkbox-vendor-${v.i_vendor}`}
                        checked={selectedVendorIds.has(v.i_vendor)}
                        onCheckedChange={() => toggleVendor(v.i_vendor)}
                      />
                      <label htmlFor={`vendor-${v.i_vendor}`} className="text-sm cursor-pointer">
                        {v.name}
                        <span className="text-xs text-muted-foreground ml-1">#{v.i_vendor}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            {selectedVendors.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {selectedVendors.length} vendor{selectedVendors.length !== 1 ? "s" : ""} selected: {selectedVendors.map(v => v.name).join(", ")}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="job-schedule">Schedule</Label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger data-testid="select-schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Manual only</SelectItem>
                <SelectItem value="15">Every 15 minutes</SelectItem>
                <SelectItem value="30">Every 30 minutes</SelectItem>
                <SelectItem value="60">Hourly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-job">Cancel</Button>
            <Button
              data-testid="button-create-job"
              disabled={!name || !prefix || createMut.isPending}
              onClick={() => createMut.mutate({
                name,
                destinationPrefix: prefix,
                vendorNames: selectedVendors.map(v => v.name),
                vendorIds:   selectedVendors.map(v => String(v.i_vendor)),
                scheduleMinutes: Number(schedule),
                enabled: true,
              })}
            >
              {createMut.isPending ? "Creating…" : "Create Job"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AiRouteCopilotPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const { data: jobsData, isLoading: jobsLoading } = useQuery<{ success: boolean; data: RouteTestJob[] }>({
    queryKey: ["/api/route-tests/jobs"],
    refetchInterval: 30_000,
  });

  const { data: resultsData, isLoading: resultsLoading } = useQuery<{ success: boolean; data: RouteTestResult[] }>({
    queryKey: ["/api/route-tests/results", selectedJobId],
    queryFn: async () => {
      const url = selectedJobId != null
        ? `/api/route-tests/results?jobId=${selectedJobId}`
        : "/api/route-tests/results";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
    refetchInterval: 20_000,
  });

  // ── WebSocket: listen for route_test_completed events ─────────────────────
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/noc`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "route_test_completed") {
          qc.invalidateQueries({ queryKey: ["/api/route-tests/jobs"] });
          qc.invalidateQueries({ queryKey: ["/api/route-tests/results", msg.jobId] });
          qc.invalidateQueries({ queryKey: ["/api/route-tests/results", null] });
          qc.invalidateQueries({ queryKey: ["/api/route-tests/evidence"] });
        }
      } catch { /* ignore parse errors */ }
    };
    return () => ws.close();
  }, [qc]);

  const { data: evidenceData } = useQuery<{ success: boolean; data: RouteTestEvidence[] }>({
    queryKey: ["/api/route-tests/evidence"],
    refetchInterval: 60_000,
  });

  const jobs    = jobsData?.data    ?? [];
  const results = resultsData?.data ?? [];
  const evidence = evidenceData?.data ?? [];

  const runMut = useMutation({
    mutationFn: (jobId: number) => apiRequest("POST", `/api/route-tests/run/${jobId}`),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ["/api/route-tests/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/route-tests/results", jobId] });
      qc.invalidateQueries({ queryKey: ["/api/route-tests/evidence"] });
      toast({ title: "Test executed", description: "Route test fired — results updating…" });
    },
    onError: (e: any) => toast({ title: "Execution failed", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/route-tests/jobs/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/route-tests/jobs"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/route-tests/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/route-tests/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/route-tests/results", null] });
      if (selectedJobId !== null) setSelectedJobId(null);
      toast({ title: "Job deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredResults = selectedJobId
    ? results.filter(r => r.jobId === selectedJobId)
    : results;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <FlaskConical className="h-6 w-6 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Route Testing Engine</h1>
            <p className="text-sm text-muted-foreground">
              Proactively fire test calls through vendor routes — before your customers do.
            </p>
          </div>
        </div>
        <NewJobDialog onCreated={() => qc.invalidateQueries({ queryKey: ["/api/route-tests/jobs"] })} />
      </div>

      {/* Evidence summary strip */}
      {evidence.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="evidence-strip">
          {evidence.slice(0, 6).map(ev => (
            <Card
              key={`${ev.jobId}-${ev.vendorName}`}
              className={`border ${ev.passRate < 50 ? "border-red-500/30 bg-red-500/5" : ev.passRate < 80 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20"}`}
              data-testid={`card-evidence-${ev.jobId}`}
            >
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate">{ev.jobName}</span>
                  {healthBadge(ev.passRate)}
                </div>
                <div className="text-xs text-muted-foreground">{ev.vendorName} → {ev.destination}</div>
                <TrendSparkline jobId={ev.jobId} vendorName={ev.vendorName} passRate={ev.passRate} total={ev.totalTests} />
                {ev.failCount > 0 && ev.recentSipCodes.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Recent SIP codes: {ev.recentSipCodes.join(", ")}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Job list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Test Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading jobs…</div>
          ) : jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No test jobs yet. Create your first job to start proactive route testing.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Vendors</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Last Tested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(job => {
                  const ev = evidence.find(e => e.jobId === job.id);
                  return (
                    <TableRow
                      key={job.id}
                      className={`cursor-pointer ${selectedJobId === job.id ? "bg-muted/50" : "hover:bg-muted/30"}`}
                      onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}
                      data-testid={`row-job-${job.id}`}
                    >
                      <TableCell className="font-medium">{job.name}</TableCell>
                      <TableCell className="font-mono text-sm">{job.destinationPrefix}</TableCell>
                      <TableCell>
                        {job.vendorNames.length > 0
                          ? job.vendorNames.join(", ")
                          : <span className="text-muted-foreground text-xs">Default routing</span>
                        }
                      </TableCell>
                      <TableCell>{scheduleBadge(job.scheduleMinutes)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {job.lastRunAt
                          ? new Date(job.lastRunAt).toLocaleString()
                          : <span className="italic">Never</span>
                        }
                      </TableCell>
                      <TableCell>
                        {ev ? healthBadge(ev.passRate) : (
                          job.enabled
                            ? <Badge variant="outline">Ready</Badge>
                            : <Badge variant="secondary">Disabled</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Run Now"
                            data-testid={`button-run-${job.id}`}
                            disabled={runMut.isPending}
                            onClick={() => { setSelectedJobId(job.id); runMut.mutate(job.id); }}
                          >
                            <Play className="h-3.5 w-3.5 text-emerald-400" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title={job.enabled ? "Disable" : "Enable"}
                            data-testid={`button-toggle-${job.id}`}
                            onClick={() => toggleMut.mutate({ id: job.id, enabled: !job.enabled })}
                          >
                            {job.enabled
                              ? <ToggleRight className="h-4 w-4 text-emerald-400" />
                              : <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                            }
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete"
                            data-testid={`button-delete-${job.id}`}
                            onClick={() => deleteMut.mutate(job.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Results panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            {selectedJobId
              ? `Results — ${jobs.find(j => j.id === selectedJobId)?.name ?? "Job " + selectedJobId}`
              : "Recent Results (all jobs)"
            }
            {selectedJobId && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-xs h-6"
                onClick={() => setSelectedJobId(null)}
                data-testid="button-clear-filter"
              >
                Clear filter
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {resultsLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading results…</div>
          ) : filteredResults.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No results yet. Click <strong>Run Now</strong> on a job to fire a test call.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Connected</TableHead>
                  <TableHead>SIP Code</TableHead>
                  <TableHead>PDD</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.slice(0, 50).map(r => (
                  <TableRow key={r.id} data-testid={`row-result-${r.id}`}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{r.vendorName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{r.destination ?? "—"}</TableCell>
                    <TableCell>
                      {r.connected
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        : <XCircle className="h-4 w-4 text-red-400" />
                      }
                    </TableCell>
                    <TableCell>{sipCodeBadge(r.sipCode)}</TableCell>
                    <TableCell className="text-sm">
                      {r.pddMs != null
                        ? <span className={r.pddMs > 2000 ? "text-amber-400" : "text-foreground"}>{r.pddMs}ms</span>
                        : "—"
                      }
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={r.notes ?? ""}>
                      {r.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Copilot integration note */}
      {evidence.some(e => e.passRate < 80) && (
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-violet-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-violet-300">Copilot Integration Active</p>
              <p className="text-xs text-muted-foreground mt-1">
                {evidence.filter(e => e.passRate < 80).length} vendor route(s) are failing proactive tests.
                These signals are now included in AI Route Copilot recommendations as "proactive test evidence."
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
