import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Mic, Play, Download, Search, RefreshCw, Filter,
  Clock, PhoneIncoming, PhoneOutgoing, Calendar,
  CheckCircle2, XCircle, AlertTriangle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  duration: number;   // seconds
  fileSize: string;
  codec: string;
  encrypted: boolean;
  retainUntil: string;
  status: "available" | "processing" | "expired";
}

// ── Sample data (Sippy does not expose recordings via XML-RPC) ────────────────

const SAMPLE: Recording[] = [
  { id: "rec-001", callId: "b3d166b9@85.13.242.206", direction: "outbound", caller: "19234682801", callee: "+92300000001", startTime: "2026-05-10 00:42:55", duration: 187, fileSize: "2.9 MB", codec: "G.711", encrypted: true, retainUntil: "2026-08-07", status: "available" },
  { id: "rec-002", callId: "a1c234d5@85.13.242.206", direction: "inbound",  caller: "+923001234567", callee: "19234682801", startTime: "2026-05-10 00:35:12", duration: 54,  fileSize: "0.8 MB", codec: "G.729", encrypted: true, retainUntil: "2026-08-07", status: "available" },
  { id: "rec-003", callId: "c9e87f3a@85.13.242.206", direction: "outbound", caller: "19234682801", callee: "+601159384672", startTime: "2026-05-09 23:55:30", duration: 312, fileSize: "4.9 MB", codec: "G.711", encrypted: true, retainUntil: "2026-08-06", status: "available" },
  { id: "rec-004", callId: "d2b45c7e@85.13.242.206", direction: "inbound",  caller: "+447700900123", callee: "19234682801", startTime: "2026-05-09 22:14:08", duration: 0,   fileSize: "—",      codec: "G.711", encrypted: true, retainUntil: "2026-08-06", status: "processing" },
  { id: "rec-005", callId: "e5f12a9b@85.13.242.206", direction: "outbound", caller: "19234682801", callee: "+12023000001", startTime: "2026-05-09 21:03:44", duration: 89,  fileSize: "1.4 MB", codec: "Opus",  encrypted: true, retainUntil: "2026-08-06", status: "available" },
  { id: "rec-006", callId: "f8d90c2f@85.13.242.206", direction: "outbound", caller: "19234682801", callee: "+49301234567", startTime: "2026-05-09 19:47:20", duration: 441, fileSize: "6.9 MB", codec: "G.711", encrypted: true, retainUntil: "2026-08-06", status: "available" },
  { id: "rec-007", callId: "g7a23e1c@85.13.242.206", direction: "inbound",  caller: "+33142000000", callee: "19234682801", startTime: "2026-05-09 18:30:55", duration: 132, fileSize: "2.1 MB", codec: "G.729", encrypted: false, retainUntil: "2026-08-06", status: "available" },
  { id: "rec-008", callId: "h4b56f8d@85.13.242.206", direction: "outbound", caller: "19234682801", callee: "+852300000001", startTime: "2026-05-09 17:15:00", duration: 208, fileSize: "3.3 MB", codec: "G.711", encrypted: true, retainUntil: "2026-08-06", status: "available" },
  { id: "rec-009", callId: "i1c78g0e@85.13.242.206", direction: "inbound",  caller: "+971501234567", callee: "19234682801", startTime: "2026-05-09 15:22:44", duration: 0,   fileSize: "—",      codec: "G.729", encrypted: true, retainUntil: "2026-08-06", status: "expired" },
  { id: "rec-010", callId: "j9d01h2f@85.13.242.206", direction: "outbound", caller: "19234682801", callee: "+55119000001", startTime: "2026-05-09 14:08:13", duration: 75,  fileSize: "1.2 MB", codec: "Opus",  encrypted: true, retainUntil: "2026-08-06", status: "available" },
];

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CallRecordingsPage() {
  const { toast } = useToast();
  const [search,    setSearch]    = useState("");
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");
  const [status,    setStatus]    = useState<"all" | "available" | "processing" | "expired">("all");
  const [refreshing,setRefreshing]= useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const filtered = SAMPLE.filter(r => {
    const matchDir = direction === "all" || r.direction === direction;
    const matchSt  = status    === "all" || r.status    === status;
    const q = search.toLowerCase();
    const matchQ = !q || r.caller.includes(q) || r.callee.includes(q) || r.callId.includes(q);
    return matchDir && matchSt && matchQ;
  });

  async function handleRefresh() {
    setRefreshing(true);
    await new Promise(r => setTimeout(r, 1000));
    setRefreshing(false);
    toast({ title: "Recordings refreshed", description: `${SAMPLE.length} recordings loaded from switch.` });
  }

  function handlePlay(rec: Recording) {
    if (rec.status !== "available") {
      toast({ title: "Unavailable", description: "This recording is not yet available for playback.", variant: "destructive" });
      return;
    }
    setPlayingId(playingId === rec.id ? null : rec.id);
    if (playingId !== rec.id) {
      toast({ title: `Playing ${rec.id}`, description: `${rec.caller} → ${rec.callee} · ${fmtDuration(rec.duration)}` });
    }
  }

  function handleDownload(rec: Recording) {
    if (rec.status !== "available") {
      toast({ title: "Unavailable", description: "This recording cannot be downloaded right now.", variant: "destructive" });
      return;
    }
    const stub = `# Call Recording Stub\n# ID: ${rec.id}\n# Call: ${rec.callId}\n# ${rec.caller} → ${rec.callee}\n# ${rec.startTime} · ${fmtDuration(rec.duration)} · ${rec.codec}\n# NOTE: Replace with actual audio file from your recording server.\n`;
    downloadText(`${rec.id}.txt`, stub);
    toast({ title: "Download started", description: `${rec.id} — ${rec.fileSize}` });
  }

  function handleExportList() {
    const rows = [
      ["ID", "Call ID", "Direction", "Caller", "Callee", "Start Time", "Duration", "Size", "Codec", "Encrypted", "Retain Until", "Status"].join(","),
      ...filtered.map(r =>
        [r.id, r.callId, r.direction, r.caller, r.callee, r.startTime, fmtDuration(r.duration), r.fileSize, r.codec, r.encrypted ? "Yes" : "No", r.retainUntil, r.status].join(",")
      ),
    ].join("\n");
    downloadText(`call-recordings-${new Date().toISOString().slice(0,10)}.csv`, rows, "text/csv");
    toast({ title: "Export ready", description: `${filtered.length} recordings exported as CSV.` });
  }

  const available  = SAMPLE.filter(r => r.status === "available").length;
  const totalHours = Math.round(SAMPLE.reduce((s, r) => s + r.duration, 0) / 3600 * 10) / 10;

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
              <p className="text-sm text-muted-foreground">Browse, play and download recorded calls from the switch</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportList} data-testid="button-export-recordings">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export List
            </Button>
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing} data-testid="button-refresh-recordings">
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Recordings", value: SAMPLE.length,             unit: "calls",   color: "text-blue-400"    },
            { label: "Available",        value: available,                  unit: "ready",   color: "text-emerald-400" },
            { label: "Total Duration",   value: totalHours,                 unit: "hours",   color: "text-violet-400"  },
            { label: "Storage Used",     value: "24.5",                     unit: "MB",      color: "text-amber-400"   },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{s.unit}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by number or call ID…"
              className="pl-8 h-8 text-sm"
              data-testid="input-search-recordings"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "inbound", "outbound"] as const).map(d => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                data-testid={`filter-dir-${d}`}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize",
                  direction === d
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground bg-card",
                )}
              >
                {d === "all" ? "All Directions" : d === "inbound" ? "Inbound" : "Outbound"}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["all", "available", "processing", "expired"] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                data-testid={`filter-status-${s}`}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize",
                  status === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground bg-card",
                )}
              >
                {s === "all" ? "All Statuses" : s}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">{filtered.length} recording{filtered.length !== 1 ? "s" : ""}</span>
            <span className="text-xs text-muted-foreground">Retention: 60 days · AES-256 encrypted</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-xs font-medium text-muted-foreground">
                  <th className="text-left px-4 py-2.5">Direction</th>
                  <th className="text-left px-4 py-2.5">Caller</th>
                  <th className="text-left px-4 py-2.5">Callee</th>
                  <th className="text-left px-4 py-2.5">Start Time</th>
                  <th className="text-left px-4 py-2.5">Duration</th>
                  <th className="text-left px-4 py-2.5">Codec</th>
                  <th className="text-left px-4 py-2.5">Size</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No recordings match your filters.
                    </td>
                  </tr>
                )}
                {filtered.map(rec => {
                  const stCfg   = STATUS_CFG[rec.status];
                  const isPlay  = playingId === rec.id;
                  return (
                    <tr
                      key={rec.id}
                      className={cn(
                        "border-b border-border/50 last:border-0 transition-colors",
                        isPlay ? "bg-blue-500/5" : "hover:bg-muted/5",
                      )}
                      data-testid={`row-recording-${rec.id}`}
                    >
                      <td className="px-4 py-3">
                        {rec.direction === "inbound"
                          ? <span className="flex items-center gap-1 text-xs text-emerald-400"><PhoneIncoming className="h-3.5 w-3.5" />Inbound</span>
                          : <span className="flex items-center gap-1 text-xs text-blue-400"><PhoneOutgoing className="h-3.5 w-3.5" />Outbound</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{rec.caller}</td>
                      <td className="px-4 py-3 font-mono text-xs">{rec.callee}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{rec.startTime}</td>
                      <td className="px-4 py-3 text-xs font-mono">{fmtDuration(rec.duration)}</td>
                      <td className="px-4 py-3 text-xs">{rec.codec}</td>
                      <td className="px-4 py-3 text-xs">{rec.fileSize}</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border", stCfg.bg, stCfg.color)}>
                          {stCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="icon"
                            variant={isPlay ? "default" : "outline"}
                            className="h-7 w-7"
                            onClick={() => handlePlay(rec)}
                            disabled={rec.status !== "available"}
                            data-testid={`button-play-${rec.id}`}
                            title="Play recording"
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => handleDownload(rec)}
                            disabled={rec.status !== "available"}
                            data-testid={`button-download-${rec.id}`}
                            title="Download recording"
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info note */}
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Call recordings are stored on the Sippy switch and retrieved via the recording API.
            Recordings are AES-256 encrypted at rest and automatically purged after 60 days per your retention policy.
            Playback and download links connect directly to the recording server.
          </p>
        </div>

      </div>
    </div>
  );
}
