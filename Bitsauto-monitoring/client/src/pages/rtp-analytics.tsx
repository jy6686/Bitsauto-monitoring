import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Radio, RefreshCw, AlertTriangle, TrendingDown, Phone, PhoneOff,
  Clock, Activity, Wifi, ChevronRight, Info, Building2, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────────

interface VendorRow {
  vendor: string; total: number; answered: number; asr: number;
  avgPdd: number; shortCalls: number;
}

interface DisconnectReason { reason: string; count: number }

interface HourlyPoint { hour: string; total: number; answered: number; asr: number; avgPdd: number }

interface SuspectCall {
  callId: string; caller: string; callee: string; startTime: string;
  duration: number; result: string; remoteIp?: string; clientName?: string; vendorName?: string;
}

interface RtpQualityData {
  hours: number; total: number; answered: number; failed: number; asr: number; avgPdd: number;
  perVendor: VendorRow[];
  disconnectReasons: DisconnectReason[];
  pddBuckets: { fast: number; normal: number; slow: number; verySlow: number };
  hourlyTimeline: HourlyPoint[];
  suspectOneWay: SuspectCall[];
  cacheUpdatedAt: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDurSec(s: number) {
  const sec = Math.round(s || 0);
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

function asrColor(asr: number) {
  if (asr >= 70) return 'text-emerald-400';
  if (asr >= 45) return 'text-amber-400';
  return 'text-red-400';
}

function pddColor(pdd: number) {
  if (pdd < 2) return 'text-emerald-400';
  if (pdd < 4) return 'text-amber-400';
  return 'text-red-400';
}

const REASON_COLORS: Record<string, string> = {
  NORMAL_CLEARING: '#34d399',
  USER_BUSY: '#f59e0b',
  NO_ANSWER: '#60a5fa',
  ALLOTTED_TIMEOUT: '#818cf8',
  SERVICE_UNAVAILABLE: '#f87171',
  NO_ROUTE_DESTINATION: '#fb923c',
  NOT_FOUND: '#e879f9',
  RECOVERY_ON_TIMER_EXPIRE: '#94a3b8',
  CALL_REJECTED: '#f43f5e',
  NETWORK_ERROR: '#ef4444',
};
function reasonColor(r: string) {
  return REASON_COLORS[r] ?? '#6b7280';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function OverviewCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: any; color: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 flex items-start gap-3">
      <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0", color + '/10 border border-current/20')}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold font-mono mt-0.5" data-testid={`stat-${label.replace(/\s/g,'-').toLowerCase()}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <strong>{p.value}{p.name === 'ASR' ? '%' : p.name === 'Avg PDD' ? 's' : ''}</strong></p>
      ))}
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────────

const HOURS_OPTIONS = [12, 24, 48, 72] as const;

export default function RtpAnalyticsPage() {
  const [hours, setHours] = useState<12 | 24 | 48 | 72>(24);

  const query = useQuery<RtpQualityData>({
    queryKey: [`/api/analytics/rtp-quality?hours=${hours}`],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const data = query.data;

  return (
    <div className="flex flex-col gap-4 p-4 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
          <Radio className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold">RTP / Media Analytics</h1>
          <p className="text-xs text-muted-foreground">
            Call quality analysis — ASR, PDD, disconnect reasons, one-way audio detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Hours selector */}
          <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg border border-border/40">
            {HOURS_OPTIONS.map(h => (
              <button key={h} onClick={() => setHours(h)}
                data-testid={`btn-hours-${h}`}
                className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all",
                  hours === h ? "bg-background shadow text-foreground border border-border/60" : "text-muted-foreground hover:text-foreground")}>
                {h}h
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}
            data-testid="button-refresh-rtp">
            <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Cache freshness */}
      {data?.cacheUpdatedAt && (
        <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1 -mt-2">
          <Info className="h-3 w-3" />
          CDR cache last updated: {new Date(data.cacheUpdatedAt).toLocaleTimeString()}
          {' · '}{data.total} calls in window
        </p>
      )}

      {/* Loading */}
      {query.isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      )}

      {/* Error */}
      {query.isError && !query.isLoading && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">Failed to load analytics</p>
            <p className="text-xs text-muted-foreground mt-1">{(query.error as any)?.message}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* ── Overview cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <OverviewCard label="Total Calls" value={data.total.toLocaleString()} icon={Activity} color="text-blue-400"
              sub={`Last ${hours}h`} />
            <OverviewCard label="Answered" value={data.answered.toLocaleString()} icon={Phone} color="text-emerald-400"
              sub={`${data.failed} failed`} />
            <OverviewCard label="ASR" value={`${data.asr}%`} icon={BarChart3} color={asrColor(data.asr) as any}
              sub="Answer Seizure Ratio" />
            <OverviewCard label="Avg PDD" value={`${data.avgPdd}s`} icon={Clock} color={pddColor(data.avgPdd) as any}
              sub="Post-Dial Delay" />
          </div>

          {/* ── PDD buckets ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" /> PDD Distribution
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {([
                { label: '< 1s',  key: 'fast',     color: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' },
                { label: '1–3s',  key: 'normal',   color: 'bg-blue-500/20 border-blue-500/30 text-blue-300' },
                { label: '3–6s',  key: 'slow',     color: 'bg-amber-500/20 border-amber-500/30 text-amber-300' },
                { label: '> 6s',  key: 'verySlow', color: 'bg-red-500/20 border-red-500/30 text-red-300' },
              ] as const).map(b => {
                const count = data.pddBuckets[b.key];
                const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0;
                return (
                  <div key={b.key} className={cn("rounded-lg border p-3 text-center", b.color)}>
                    <p className="text-lg font-bold font-mono">{count.toLocaleString()}</p>
                    <p className="text-[10px] uppercase tracking-wide mt-1">{b.label}</p>
                    <p className="text-[11px] font-medium mt-0.5">{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Hourly ASR timeline ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" /> Hourly Call Quality
            </h2>
            {data.hourlyTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.hourlyTimeline} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} interval={Math.floor(data.hourlyTimeline.length / 8)} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="asr" name="ASR" stroke="#60a5fa" strokeWidth={1.5}
                    dot={false} activeDot={{ r: 3 }} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#94a3b8" strokeWidth={1}
                    dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="avgPdd" name="Avg PDD" stroke="#f59e0b" strokeWidth={1.5}
                    dot={false} activeDot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground/40 text-sm">
                No timeline data — CDR cache may still be warming up
              </div>
            )}
          </div>

          {/* ── Two-column: vendors + disconnect reasons ─────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Per-vendor table */}
            <div className="rounded-xl border border-border/50 bg-card/50 p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-violet-400" /> Per-Vendor Quality
              </h2>
              {data.perVendor.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 py-4 text-center">
                  Vendor data available when CDR cache includes connection info
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/40">
                        <th className="pb-2 font-medium">Vendor</th>
                        <th className="pb-2 text-right font-medium">Calls</th>
                        <th className="pb-2 text-right font-medium">ASR</th>
                        <th className="pb-2 text-right font-medium">PDD</th>
                        <th className="pb-2 text-right font-medium">Short</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {data.perVendor.map((v, i) => (
                        <tr key={v.vendor} data-testid={`vendor-row-${i}`}
                          className="hover:bg-muted/10 transition-colors">
                          <td className="py-1.5 font-medium truncate max-w-[120px]" title={v.vendor}>{v.vendor}</td>
                          <td className="py-1.5 text-right font-mono text-muted-foreground">{v.total.toLocaleString()}</td>
                          <td className="py-1.5 text-right">
                            <span className={cn("font-mono font-semibold", asrColor(v.asr))}>{v.asr}%</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <span className={cn("font-mono", pddColor(v.avgPdd))}>{v.avgPdd}s</span>
                          </td>
                          <td className="py-1.5 text-right text-muted-foreground font-mono">{v.shortCalls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Disconnect reason bar chart */}
            <div className="rounded-xl border border-border/50 bg-card/50 p-4">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <PhoneOff className="h-4 w-4 text-red-400" /> Disconnect Reasons
              </h2>
              {data.disconnectReasons.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 py-4 text-center">No disconnect data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.disconnectReasons} layout="vertical"
                    margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis type="category" dataKey="reason" tick={{ fontSize: 9, fill: '#6b7280' }} width={130} />
                    <Tooltip formatter={(v: any) => [v, 'Calls']} />
                    <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                      {data.disconnectReasons.map((r, i) => (
                        <Cell key={i} fill={reasonColor(r.reason)} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── One-way audio / short-call suspects ─────────────────────────── */}
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-orange-400" />
                Suspect One-Way Audio
                <Badge variant="outline" className="text-[10px]">Connected &lt; 30s</Badge>
              </h2>
              <span className="text-xs text-muted-foreground">{data.suspectOneWay.length} calls</span>
            </div>
            <p className="text-[11px] text-muted-foreground/60 mb-3 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Calls that connected but lasted under 30 seconds are often caused by one-way audio, codec mismatch, or NAT failures.
            </p>
            {data.suspectOneWay.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground/40 text-sm">
                No short-duration connected calls — good signal
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/40">
                      <th className="pb-2 font-medium">Start Time</th>
                      <th className="pb-2 font-medium">Caller</th>
                      <th className="pb-2 font-medium">Callee</th>
                      <th className="pb-2 text-right font-medium">Duration</th>
                      <th className="pb-2 font-medium">Result</th>
                      <th className="pb-2 font-medium">Remote IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {data.suspectOneWay.map((c, i) => (
                      <tr key={c.callId || i} data-testid={`suspect-row-${i}`}
                        className="hover:bg-muted/10 transition-colors">
                        <td className="py-1.5 font-mono text-muted-foreground whitespace-nowrap">
                          {c.startTime ? new Date(c.startTime).toLocaleTimeString() : '-'}
                        </td>
                        <td className="py-1.5 font-mono">{c.caller}</td>
                        <td className="py-1.5 font-mono">{c.callee}</td>
                        <td className="py-1.5 text-right font-mono text-orange-400 font-semibold">
                          {fmtDurSec(c.duration)}
                        </td>
                        <td className="py-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">
                            {c.result}
                          </span>
                        </td>
                        <td className="py-1.5 font-mono text-muted-foreground">{c.remoteIp || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state — no data yet */}
      {!query.isLoading && !query.isError && data?.total === 0 && (
        <div className="rounded-xl border border-border/30 border-dashed bg-muted/5 p-10 text-center">
          <Radio className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No CDR data in the selected window</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            The CDR cache refreshes every 5 minutes. Check your Sippy connection on the Settings page.
          </p>
        </div>
      )}
    </div>
  );
}
