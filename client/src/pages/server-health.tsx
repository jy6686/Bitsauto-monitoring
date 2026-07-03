import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server, HardDrive, Cpu, Activity, Database, Radio, Wifi,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle, AlertCircle,
  Trash2, Zap, Clock, TrendingUp, Gauge,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Snapshot {
  capturedAt: string;
  diskPct: number | null;
  diskFreeGb: number | null;
  diskTotalGb: number | null;
  memUsedPct: number | null;
  swapUsedPct: number | null;
  load1m: number | null;
  load5m: number | null;
  load15m: number | null;
  cpuCores: number | null;
  mariadbRunning: boolean | null;
  asteriskRunning: boolean | null;
  sipPeerOk: boolean | null;
  amiConnected: boolean | null;
  recordingFolderMb: number | null;
  logFolderMb: number | null;
  sshError: string | null;
  status: 'ok' | 'warning' | 'critical' | 'error';
}

interface CleanupDetail {
  path: string;
  sizeMb: number;
  action: string;
}

interface CleanupPreview {
  asteriskLogsMb: number;
  asteriskFullLogMb: number;
  fail2banLogsMb: number;
  freepbxLogsMb: number;
  tmpFilesMb: number;
  totalReclaimableMb: number;
  details: CleanupDetail[];
}

interface HistoryRow {
  hour: string;
  disk_pct: number | null;
  disk_free_gb: number | null;
  mem_used_pct: number | null;
  swap_used_pct: number | null;
  load_1m: number | null;
  log_folder_mb: number | null;
  mariadb_running: boolean | null;
  asterisk_running: boolean | null;
  sample_count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function statusColor(s: Snapshot['status']): string {
  if (s === 'ok')       return 'text-emerald-400';
  if (s === 'warning')  return 'text-amber-400';
  if (s === 'critical') return 'text-red-400';
  return 'text-slate-500';
}

function statusBg(s: Snapshot['status']): string {
  if (s === 'ok')       return 'bg-emerald-500/10 border-emerald-500/30';
  if (s === 'warning')  return 'bg-amber-500/10 border-amber-500/30';
  if (s === 'critical') return 'bg-red-500/10 border-red-500/30';
  return 'bg-slate-800/50 border-slate-700/40';
}

function pctColor(pct: number | null, warn = 80, crit = 90): string {
  if (pct === null) return 'text-slate-500';
  if (pct >= crit)  return 'text-red-400';
  if (pct >= warn)  return 'text-amber-400';
  return 'text-emerald-400';
}

function boolIndicator(val: boolean | null, label: string) {
  if (val === null) return (
    <span className="flex items-center gap-1.5 text-slate-500">
      <AlertCircle className="h-3.5 w-3.5" /> {label} <span className="text-[10px]">Unknown</span>
    </span>
  );
  if (val) return (
    <span className="flex items-center gap-1.5 text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> {label}
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-red-400">
      <XCircle className="h-3.5 w-3.5" /> {label} <span className="text-[10px]">DOWN</span>
    </span>
  );
}

function formatMb(mb: number | null): string {
  if (mb === null) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Gauge bar ──────────────────────────────────────────────────────────────────
function GaugeBar({ pct, warn = 80, crit = 90 }: { pct: number | null; warn?: number; crit?: number }) {
  const v = pct ?? 0;
  const color = v >= crit ? 'bg-red-500' : v >= warn ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${Math.min(100, v)}%` }}
      />
    </div>
  );
}

// ── Mini sparkline for trend cards ────────────────────────────────────────────
function MiniChart({
  data, dataKey, color, refLine,
}: {
  data: HistoryRow[];
  dataKey: keyof HistoryRow;
  color: string;
  refLine?: number;
}) {
  const points = [...data].reverse().slice(-48).map(r => ({
    t: r.hour,
    v: r[dataKey] as number | null,
  }));

  return (
    <ResponsiveContainer width="100%" height={60}>
      <LineChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#1e293b" vertical={false} />
        {refLine !== undefined && (
          <ReferenceLine y={refLine} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
        )}
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
          labelFormatter={(l) => {
            try { return format(new Date(l as string), 'MMM d HH:mm'); } catch { return String(l); }
          }}
          formatter={(v: any) => [v !== null ? `${v}` : '—', '']}
        />
        <XAxis dataKey="t" hide />
        <YAxis hide domain={[0, 100]} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Cleanup Preview Modal ──────────────────────────────────────────────────────
function CleanupModal({
  open,
  onClose,
  onExecuted,
}: {
  open: boolean;
  onClose: () => void;
  onExecuted: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const previewQuery = useQuery<{ preview: CleanupPreview }>({
    queryKey: ['/api/server-health/cleanup-preview'],
    enabled: open,
    staleTime: 30_000,
  });

  const executeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/server-health/cleanup-execute'),
    onSuccess: (data: any) => {
      toast({
        title: 'Disk cleanup complete',
        description: `Reclaimed ~${formatMb(data.reclaimedMb)}. Server disk is now healthier.`,
      });
      qc.invalidateQueries({ queryKey: ['/api/server-health/current'] });
      qc.invalidateQueries({ queryKey: ['/api/server-health/history'] });
      onExecuted();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: 'Cleanup failed', description: e.message, variant: 'destructive' });
    },
  });

  const preview = previewQuery.data?.preview;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0a1120] border-slate-700/60 text-slate-200 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Trash2 className="h-4 w-4 text-amber-400" />
            Disk Cleanup Preview
          </DialogTitle>
        </DialogHeader>

        {previewQuery.isLoading && (
          <div className="flex items-center justify-center py-10 gap-3 text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm font-mono">Calculating reclaimable space…</span>
          </div>
        )}

        {previewQuery.isError && (
          <div className="text-red-400 text-sm p-4 bg-red-500/10 rounded-lg border border-red-500/20">
            SSH error: {(previewQuery.error as any)?.message ?? 'Failed to connect'}
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <span className="text-sm text-amber-300 font-medium">Total reclaimable</span>
              <span className="text-xl font-mono font-bold text-amber-400">
                ~{formatMb(preview.totalReclaimableMb)}
              </span>
            </div>

            <div className="space-y-1.5">
              {preview.details.map((d, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 bg-slate-800/40 border border-slate-700/30 rounded-md">
                  <HardDrive className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-mono text-slate-300 truncate">{d.path}</p>
                    <p className="text-[10px] text-slate-600">{d.action}</p>
                  </div>
                  <span className={cn(
                    "text-[11px] font-mono font-semibold flex-shrink-0",
                    d.sizeMb > 200 ? 'text-red-400' : d.sizeMb > 50 ? 'text-amber-400' : 'text-slate-400',
                  )}>
                    {formatMb(d.sizeMb)}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              This will truncate oversized log files and clear old temp files.
              Asterisk and MariaDB will continue running — no service restart required.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-slate-400" data-testid="cleanup-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => executeMutation.mutate()}
            disabled={!preview || executeMutation.isPending}
            className="bg-amber-600 hover:bg-amber-500 text-white"
            data-testid="cleanup-execute"
          >
            {executeMutation.isPending ? (
              <><RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Cleaning…</>
            ) : (
              <><Trash2 className="h-3.5 w-3.5 mr-2" /> Execute Cleanup</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ServerHealthPage() {
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [historyDays, setHistoryDays] = useState(7);
  const { toast } = useToast();
  const qc = useQueryClient();

  const currentQuery = useQuery<{ snapshot: Snapshot | null }>({
    queryKey: ['/api/server-health/current'],
    refetchInterval: 30_000,
  });

  const historyQuery = useQuery<{ rows: HistoryRow[] }>({
    queryKey: ['/api/server-health/history', historyDays],
    queryFn: () => fetch(`/api/server-health/history?days=${historyDays}`, { credentials: 'include' }).then(r => r.json()),
    staleTime: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/server-health/refresh'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/server-health/current'] });
      qc.invalidateQueries({ queryKey: ['/api/server-health/history'] });
      toast({ title: 'Refreshed', description: 'Live SSH poll complete.' });
    },
    onError: (e: any) => {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    },
  });

  const snap = currentQuery.data?.snapshot ?? null;
  const histRows = historyQuery.data?.rows ?? [];

  const overallStatus: Snapshot['status'] = snap?.status ?? 'error';

  return (
    <div className="min-h-screen bg-[#060a12] text-slate-200 font-mono">
      {/* Header */}
      <div className="border-b border-slate-800/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-cyan-400" />
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-tight">Server Health</h1>
            <p className="text-[11px] text-slate-500">159.223.32.59 · reve-otp · polled every 60s</p>
          </div>
          <div className={cn(
            "ml-4 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest",
            statusBg(overallStatus),
            statusColor(overallStatus),
          )}>
            {overallStatus}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {snap && (
            <span className="text-[10px] text-slate-600 flex items-center gap-1">
              <Clock className="h-3 w-3" /> {timeAgo(snap.capturedAt)}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="text-slate-400 hover:text-slate-200 h-8"
            data-testid="server-health-refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshMutation.isPending && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setCleanupOpen(true)}
            className="bg-amber-600/20 border border-amber-500/30 text-amber-300 hover:bg-amber-600/30 h-8"
            data-testid="disk-cleanup-button"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Disk Cleanup
          </Button>
        </div>
      </div>

      {/* SSH Error banner */}
      {snap?.sshError && (
        <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-300 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          SSH error: {snap.sshError}
        </div>
      )}

      {/* No data yet */}
      {!snap && !currentQuery.isLoading && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-600 gap-3">
          <Server className="h-12 w-12 text-slate-700" />
          <p className="text-sm">First poll in progress… (~10s after server start)</p>
          <Button size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}
            className="mt-2 text-slate-400">
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshMutation.isPending && "animate-spin")} />
            Poll Now
          </Button>
        </div>
      )}

      {snap && (
        <div className="p-6 space-y-6">

          {/* ── Status Cards Row ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            {/* Disk */}
            <div className={cn(
              "rounded-xl border p-4 space-y-2",
              snap.diskPct !== null && snap.diskPct >= 90
                ? 'bg-red-500/10 border-red-500/30'
                : snap.diskPct !== null && snap.diskPct >= 80
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-slate-800/40 border-slate-700/40',
            )}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                  <HardDrive className="h-3 w-3" /> Disk
                </span>
                {snap.diskPct !== null && snap.diskPct >= 80 && (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                )}
              </div>
              <div className={cn("text-3xl font-bold", pctColor(snap.diskPct))}>
                {snap.diskPct !== null ? `${snap.diskPct}%` : '—'}
              </div>
              <GaugeBar pct={snap.diskPct} />
              <div className="text-[10px] text-slate-500">
                {snap.diskFreeGb !== null ? `${snap.diskFreeGb} GB free` : ''}
                {snap.diskTotalGb !== null ? ` / ${snap.diskTotalGb} GB` : ''}
              </div>
            </div>

            {/* Memory */}
            <div className="rounded-xl border bg-slate-800/40 border-slate-700/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                  <Gauge className="h-3 w-3" /> Memory
                </span>
              </div>
              <div className={cn("text-3xl font-bold", pctColor(snap.memUsedPct))}>
                {snap.memUsedPct !== null ? `${snap.memUsedPct}%` : '—'}
              </div>
              <GaugeBar pct={snap.memUsedPct} />
              <div className="text-[10px] text-slate-500">
                Swap: {snap.swapUsedPct !== null ? `${snap.swapUsedPct}%` : '—'}
              </div>
            </div>

            {/* Load */}
            <div className="rounded-xl border bg-slate-800/40 border-slate-700/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" /> Load Avg
                </span>
                {snap.cpuCores && (
                  <span className="text-[10px] text-slate-600">{snap.cpuCores} cores</span>
                )}
              </div>
              <div className={cn(
                "text-3xl font-bold",
                snap.load1m !== null && snap.cpuCores && snap.load1m > snap.cpuCores
                  ? 'text-red-400' : snap.load1m !== null && snap.cpuCores && snap.load1m > snap.cpuCores * 0.8
                  ? 'text-amber-400' : 'text-emerald-400',
              )}>
                {snap.load1m?.toFixed(2) ?? '—'}
              </div>
              <div className="text-[10px] text-slate-500 space-x-3">
                <span>5m: {snap.load5m?.toFixed(2) ?? '—'}</span>
                <span>15m: {snap.load15m?.toFixed(2) ?? '—'}</span>
              </div>
            </div>

            {/* Logs */}
            <div className={cn(
              "rounded-xl border p-4 space-y-2",
              snap.logFolderMb !== null && snap.logFolderMb > 500
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-slate-800/40 border-slate-700/40',
            )}>
              <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <Activity className="h-3 w-3" /> Log Folder
              </span>
              <div className={cn(
                "text-3xl font-bold",
                snap.logFolderMb !== null && snap.logFolderMb > 500 ? 'text-amber-400' : 'text-slate-300',
              )}>
                {formatMb(snap.logFolderMb)}
              </div>
              <div className="text-[10px] text-slate-500">
                Recordings: {formatMb(snap.recordingFolderMb)}
              </div>
              {snap.logFolderMb !== null && snap.logFolderMb > 200 && (
                <button
                  onClick={() => setCleanupOpen(true)}
                  className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Clean up
                </button>
              )}
            </div>
          </div>

          {/* ── Service Status Row ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'MariaDB',  val: snap.mariadbRunning,  icon: <Database className="h-4 w-4" /> },
              { label: 'Asterisk', val: snap.asteriskRunning, icon: <Radio className="h-4 w-4" /> },
              { label: 'SIP Peer', val: snap.sipPeerOk,       icon: <Wifi className="h-4 w-4" /> },
              { label: 'AMI',      val: snap.amiConnected,    icon: <Zap className="h-4 w-4" /> },
            ].map(({ label, val, icon }) => (
              <div key={label} className={cn(
                "flex items-center gap-3 p-3 rounded-lg border",
                val === true  ? 'bg-emerald-500/10 border-emerald-500/25' :
                val === false ? 'bg-red-500/10 border-red-500/25' :
                'bg-slate-800/30 border-slate-700/30',
              )}>
                <span className={cn(
                  val === true ? 'text-emerald-400' : val === false ? 'text-red-400' : 'text-slate-500',
                )}>
                  {icon}
                </span>
                <div>
                  <p className="text-[11px] font-bold text-slate-300">{label}</p>
                  <p className={cn(
                    "text-[10px]",
                    val === true ? 'text-emerald-500' : val === false ? 'text-red-500' : 'text-slate-600',
                  )}>
                    {val === true ? 'Running' : val === false ? 'DOWN' : 'Unknown'}
                  </p>
                </div>
                <div className="ml-auto">
                  {val === true  && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  {val === false && <XCircle className="h-4 w-4 text-red-400" />}
                  {val === null  && <AlertCircle className="h-4 w-4 text-slate-600" />}
                </div>
              </div>
            ))}
          </div>

          {/* ── Trend Charts ─────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-bold text-slate-300">Trend Charts</span>
              </div>
              <div className="flex gap-1">
                {[1, 3, 7, 14].map(d => (
                  <button
                    key={d}
                    onClick={() => setHistoryDays(d)}
                    className={cn(
                      "px-2.5 py-1 rounded text-[10px] font-mono border transition-colors",
                      historyDays === d
                        ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                        : 'border-slate-700/40 text-slate-500 hover:text-slate-300',
                    )}
                    data-testid={`trend-days-${d}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {historyQuery.isLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-600 gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading trend data…</span>
              </div>
            ) : histRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600 gap-2">
                <TrendingUp className="h-8 w-8 text-slate-700" />
                <p className="text-sm">No historical data yet — data accumulates every 60s</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: 'Disk Usage %',   dataKey: 'disk_pct'     as keyof HistoryRow, color: '#f59e0b', refLine: 80, unit: '%' },
                  { title: 'Memory Usage %', dataKey: 'mem_used_pct' as keyof HistoryRow, color: '#38bdf8', refLine: 90, unit: '%' },
                  { title: 'Load Average',   dataKey: 'load_1m'      as keyof HistoryRow, color: '#a78bfa', unit: '' },
                  { title: 'Log Folder MB',  dataKey: 'log_folder_mb'as keyof HistoryRow, color: '#fb923c', unit: ' MB' },
                ].map(({ title, dataKey, color, refLine, unit }) => (
                  <div key={title} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">{title}</p>
                    <MiniChart data={histRows} dataKey={dataKey} color={color} refLine={refLine} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Raw Snapshot Debug ───────────────────────────────────────────── */}
          <details className="text-[10px] text-slate-600">
            <summary className="cursor-pointer hover:text-slate-400 select-none">Raw snapshot</summary>
            <pre className="mt-2 p-3 bg-slate-900/60 border border-slate-800/40 rounded-lg overflow-x-auto text-slate-500 text-[10px]">
              {JSON.stringify(snap, null, 2)}
            </pre>
          </details>

        </div>
      )}

      <CleanupModal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        onExecuted={() => {}}
      />
    </div>
  );
}
