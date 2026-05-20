import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Mic, Play, Pause, Download, Search, RefreshCw,
  PhoneIncoming, PhoneOutgoing, CheckCircle2, Info, Settings2,
  Volume2, Lock, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recording {
  id: string;
  callId: string;
  direction: "inbound" | "outbound";
  caller: string;
  callee: string;
  startTime: string;
  duration: number;
  fileSize: string;
  codec: string;
  encrypted: boolean;
  retainUntil: string;
  status: "available" | "processing" | "expired";
  clientName?: string | null;
  vendor?: string | null;
  cost?: number;
}

interface RecordingsResponse {
  recordings: Recording[];
  configured: boolean;
  url: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number) {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const STATUS_CFG = {
  available:  { label: "Available",  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  processing: { label: "Processing", color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/25"   },
  expired:    { label: "Expired",    color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/25"     },
};

// ── Inline audio player row ───────────────────────────────────────────────────

function AudioPlayerRow({ rec, serverUrl }: { rec: Recording; serverUrl: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const audioSrc = serverUrl
    ? `${serverUrl.replace(/\/+$/, "")}/calls/${encodeURIComponent(rec.callId)}.wav`
    : null;

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().catch(() => {}); setPlaying(true); }
  }

  return (
    <tr className="bg-blue-500/5 border-b border-blue-500/10">
      <td colSpan={9} className="px-5 py-3">
        <div className="flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-blue-400 flex-shrink-0" />
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={togglePlay}
              disabled={!audioSrc}
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center transition-colors",
                audioSrc
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
              data-testid={`button-audio-toggle-${rec.id}`}
            >
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 translate-x-px" />}
            </button>
          </div>
          {/* Progress bar */}
          <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-muted-foreground flex-shrink-0">
            {fmtDuration(rec.duration)}
          </span>
          <span className="text-[11px] text-muted-foreground flex-shrink-0">{rec.codec}</span>
          {rec.encrypted && <span title="AES-256 encrypted"><Lock className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" /></span>}
          {!audioSrc && (
            <span className="text-[10px] text-amber-400/80">
              Configure a recording server in <strong>Settings → Call Recordings</strong> to enable playback
            </span>
          )}
        </div>
        {audioSrc && (
          <audio
            ref={audioRef}
            src={audioSrc}
            onTimeUpdate={() => {
              const el = audioRef.current;
              if (el && el.duration) setProgress((el.currentTime / el.duration) * 100);
            }}
            onEnded={() => { setPlaying(false); setProgress(0); }}
            onError={() => { setPlaying(false); }}
            className="hidden"
          />
        )}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CallRecordingsPage() {
  const { toast }    = useToast();
  const qc           = useQueryClient();
  const [search,    setSearch]    = useState("");
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");
  const [status,    setStatus]    = useState<"all" | "available" | "processing" | "expired">("all");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<RecordingsResponse>({
    queryKey: ["/api/sippy/recordings"],
    queryFn: () => fetch("/api/sippy/recordings").then(r => r.json()),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const recordings  = data?.recordings ?? [];
  const serverUrl   = data?.url ?? null;
  const configured  = data?.configured ?? false;

  const filtered = recordings.filter(r => {
    const matchDir = direction === "all" || r.direction === direction;
    const matchSt  = status    === "all" || r.status    === status;
    const q = search.toLowerCase();
    const matchQ = !q || r.caller.includes(q) || r.callee.includes(q) || r.callId.toLowerCase().includes(q) || (r.clientName ?? "").toLowerCase().includes(q);
    return matchDir && matchSt && matchQ;
  });

  async function handleRefresh() {
    await qc.invalidateQueries({ queryKey: ["/api/sippy/recordings"] });
    toast({ title: "Recordings refreshed", description: `${recordings.length} records loaded from CDR cache.` });
  }

  function handlePlay(rec: Recording) {
    if (rec.status !== "available") {
      toast({ title: "Unavailable", description: "This recording is not yet available for playback.", variant: "destructive" });
      return;
    }
    setPlayingId(playingId === rec.id ? null : rec.id);
  }

  function handleDownload(rec: Recording) {
    if (rec.status !== "available") {
      toast({ title: "Unavailable", description: "This recording cannot be downloaded right now.", variant: "destructive" });
      return;
    }
    if (!configured) {
      toast({ title: "Recording server not configured", description: "Add a recording server URL in Settings → Call Recordings.", variant: "destructive" });
      return;
    }
    const url = `/api/sippy/recording-download/${encodeURIComponent(rec.callId)}`;
    const a   = document.createElement("a");
    a.href = url; a.download = `${rec.callId}.wav`; a.click();
    toast({ title: "Download started", description: `${rec.callId} · ${rec.fileSize}` });
  }

  function handleExportList() {
    const rows = [
      ["Call ID", "Direction", "Caller", "Callee", "Client", "Vendor", "Start Time", "Duration", "Size", "Codec", "Retain Until", "Status"].join(","),
      ...filtered.map(r =>
        [r.callId, r.direction, r.caller, r.callee, r.clientName ?? "", r.vendor ?? "", r.startTime,
         fmtDuration(r.duration), r.fileSize, r.codec, r.retainUntil, r.status].join(",")
      ),
    ].join("\n");
    downloadText(`call-recordings-${new Date().toISOString().slice(0, 10)}.csv`, rows, "text/csv");
    toast({ title: "Export ready", description: `${filtered.length} recordings exported as CSV.` });
  }

  const available  = recordings.filter(r => r.status === "available").length;
  const totalHours = Math.round(recordings.reduce((s, r) => s + (r.duration ?? 0), 0) / 3600 * 10) / 10;
  const totalMb    = recordings.reduce((s, r) => {
    const m = r.fileSize.match(/([\d.]+)\s*(MB|KB)/i);
    if (!m) return s;
    return s + (m[2].toUpperCase() === "MB" ? parseFloat(m[1]) : parseFloat(m[1]) / 1024);
  }, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Mic className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Call Recordings</h1>
              <p className="text-sm text-muted-foreground">Browse, play and download recorded calls — last 72 hours</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportList} disabled={filtered.length === 0} data-testid="button-export-recordings">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isFetching} data-testid="button-refresh-recordings">
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <Skeleton className="h-3 w-24 mb-2" />
                <Skeleton className="h-7 w-14 mb-1" />
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))
          ) : (
            [
              { label: "Total Records",   value: recordings.length,            unit: "calls (72 h)", color: "text-blue-400"    },
              { label: "Available",       value: available,                     unit: "ready",        color: "text-emerald-400" },
              { label: "Total Duration",  value: totalHours,                    unit: "hours",        color: "text-violet-400"  },
              { label: "Est. Storage",    value: `${totalMb.toFixed(1)}`,       unit: "MB",           color: "text-amber-400"   },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn("text-2xl font-bold mt-1 tabular-nums", s.color)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{s.unit}</p>
              </div>
            ))
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by number, call ID, or client…"
              className="pl-8 h-8 text-sm"
              data-testid="input-search-recordings"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "inbound", "outbound"] as const).map(d => (
              <button key={d} onClick={() => setDirection(d)} data-testid={`filter-dir-${d}`}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-lg border transition-colors",
                  direction === d ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-card",
                )}>
                {d === "all" ? "All" : d === "inbound" ? "Inbound" : "Outbound"}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["all", "available", "processing", "expired"] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} data-testid={`filter-status-${s}`}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize",
                  status === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground bg-card",
                )}>
                {s === "all" ? "All Statuses" : s}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">
              {isLoading ? "Loading…" : `${filtered.length} recording${filtered.length !== 1 ? "s" : ""}`}
            </span>
            <span className="text-xs text-muted-foreground">Retention: 90 days · AES-256 encrypted</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-xs font-medium text-muted-foreground">
                  <th className="text-left px-4 py-2.5">Direction</th>
                  <th className="text-left px-4 py-2.5">Caller</th>
                  <th className="text-left px-4 py-2.5">Callee</th>
                  <th className="text-left px-4 py-2.5">Client</th>
                  <th className="text-left px-4 py-2.5">Start Time</th>
                  <th className="text-left px-4 py-2.5">Duration</th>
                  <th className="text-left px-4 py-2.5">Size</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[80px]" /></td>
                      ))}
                    </tr>
                  ))
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {recordings.length === 0
                        ? "No call records found in the last 72 hours. CDR data populates as calls complete."
                        : "No recordings match your filters."}
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.map(rec => {
                  const stCfg  = STATUS_CFG[rec.status];
                  const isPlay = playingId === rec.id;
                  return [
                    <tr
                      key={rec.id}
                      className={cn(
                        "border-b border-border/50 last:border-0 transition-colors",
                        isPlay ? "bg-blue-500/5 border-blue-500/10" : "hover:bg-muted/5",
                      )}
                      data-testid={`row-recording-${rec.id}`}
                    >
                      <td className="px-4 py-3">
                        {rec.direction === "inbound"
                          ? <span className="flex items-center gap-1 text-xs text-emerald-400"><PhoneIncoming className="h-3.5 w-3.5" />In</span>
                          : <span className="flex items-center gap-1 text-xs text-blue-400"><PhoneOutgoing className="h-3.5 w-3.5" />Out</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{rec.caller}</td>
                      <td className="px-4 py-3 font-mono text-xs">{rec.callee}</td>
                      <td className="px-4 py-3 text-xs max-w-[120px]">
                        {rec.clientName ? (
                          <span className="flex items-center gap-1 text-violet-400 truncate" title={rec.clientName}>
                            <Building2 className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{rec.clientName}</span>
                          </span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{rec.startTime}</td>
                      <td className="px-4 py-3 text-xs font-mono">{fmtDuration(rec.duration)}</td>
                      <td className="px-4 py-3 text-xs">{rec.fileSize}</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border", stCfg.bg, stCfg.color)}>
                          {stCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button size="icon" variant={isPlay ? "default" : "outline"} className="h-7 w-7"
                            onClick={() => handlePlay(rec)}
                            disabled={rec.status !== "available"}
                            data-testid={`button-play-${rec.id}`}
                            title="Play recording">
                            {isPlay ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          </Button>
                          <Button size="icon" variant="outline" className="h-7 w-7"
                            onClick={() => handleDownload(rec)}
                            disabled={rec.status !== "available"}
                            data-testid={`button-download-${rec.id}`}
                            title="Download recording">
                            <Download className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>,
                    isPlay && <AudioPlayerRow key={`${rec.id}-player`} rec={rec} serverUrl={serverUrl} />,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recording server status banner */}
        {!isLoading && !configured && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <Settings2 className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-300 mb-0.5">Recording server not configured</p>
              <p className="text-xs text-muted-foreground">
                Playback and download are disabled until a recording server URL is set. Go to{" "}
                <strong>Settings → Call Recordings</strong> and enter the base URL of your recording server
                (e.g. <span className="font-mono text-amber-400/80">https://rec.yourdomain.com</span>).
                The platform constructs audio URLs as{" "}
                <span className="font-mono text-amber-400/80">{"{base}"}/calls/{"{callId}"}.wav</span>.
              </p>
            </div>
          </div>
        )}
        {!isLoading && configured && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Recording server: <span className="font-mono text-emerald-400/80">{serverUrl}</span> ·
              Download links proxy through <span className="font-mono text-xs">/api/sippy/recording-download/:callId</span>
            </p>
          </div>
        )}
        {!isLoading && data === undefined && (
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
            <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Call recording history is derived from the CDR cache (last 72 hours of answered calls).
              Recordings are AES-256 encrypted at rest and automatically purged after 90 days per the retention policy.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
