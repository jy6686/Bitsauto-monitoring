import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RcTooltip, Legend,
} from 'recharts';
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS } from '@/components/bse-chart';
import { RefreshCw, Loader2, Radio, AlertTriangle, TrendingUp, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodecBreakdown {
  codec:        string;
  calls:        number;
  pct:          number;
}

interface CarrierCodec {
  carrier:      string;
  totalCalls:   number;
  codecs:       { codec: string; calls: number; pct: number }[];
  transcodePct: number;    // % calls using a non-G.711 codec (proxy for transcoding)
}

interface CodecAnalyticsData {
  breakdown:     CodecBreakdown[];
  byCarrier:     CarrierCodec[];
  totalCalls:    number;
  uniqueCodecs:  number;
  transcodePct:  number;
  windowHours:   number;
}

// ─── Color map ────────────────────────────────────────────────────────────────

const CODEC_COLORS: Record<string, string> = {
  'PCMU':    '#10b981',
  'PCMA':    '#34d399',
  'G.711':   '#10b981',
  'G.729':   '#f59e0b',
  'G.723':   '#ef4444',
  'G.722':   '#6366f1',
  'opus':    '#8b5cf6',
  'GSM':     '#f97316',
  '-':       '#374151',
  'unknown': '#374151',
};
function codecColor(codec: string): string {
  return CODEC_COLORS[codec] ?? CODEC_COLORS[codec.split('/')[0]] ?? '#64748b';
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CodecAnalyticsPage() {
  const [carrierSort, setCarrierSort] = useState<'transcode' | 'calls'>('transcode');

  const { data, isLoading, isFetching, refetch } = useQuery<CodecAnalyticsData>({
    queryKey: ['/api/codec-analytics'],
    refetchInterval: 5 * 60 * 1000,
  });

  const d = data;
  const sortedCarriers = d ? [...d.byCarrier].sort((a, b) =>
    carrierSort === 'transcode' ? b.transcodePct - a.transcodePct : b.totalCalls - a.totalCalls
  ) : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-purple-400" />
          <div>
            <h1 className="text-base font-semibold">Codec Negotiation Analytics</h1>
            <p className="text-xs text-muted-foreground">
              Codec usage from CDR data · {d?.windowHours ?? 72}h rolling window
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 inline-block ml-1 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed">
                    Codec data is sourced from Sippy CDRs. The codec field reflects the codec
                    negotiated for the call leg, not guaranteed RTP stream codec.
                    Non-G.711 usage is used as a proxy for transcoding cost.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 text-xs hover:bg-muted/30 transition-colors disabled:opacity-50"
          data-testid="btn-refresh-codec"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Calls Analysed', value: (d?.totalCalls ?? 0).toLocaleString(), color: 'text-foreground' },
          { label: 'Unique Codecs',        value: (d?.uniqueCodecs ?? 0).toString(),     color: 'text-purple-400' },
          { label: 'Est. Transcode Rate',  value: `${(d?.transcodePct ?? 0).toFixed(1)}%`, color: d?.transcodePct && d.transcodePct > 20 ? 'text-amber-400' : 'text-emerald-400' },
          { label: 'Window',               value: `${d?.windowHours ?? 72}h`,            color: 'text-muted-foreground' },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/40 rounded-xl p-4">
            <div className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Transcoding alert */}
      {d && d.transcodePct > 30 && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium text-amber-300">High transcoding rate detected</span>
            <span className="text-muted-foreground ml-2">
              {d.transcodePct.toFixed(1)}% of calls used non-G.711 codecs. Vendors forcing codec
              conversion add CPU cost and potential quality degradation.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Codec Distribution Pie */}
        <div className="bg-card border border-border/40 rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-4">Codec Distribution</h2>
          {d && d.breakdown.length > 0 ? (
            <div className="flex gap-4 items-center">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie
                    data={d.breakdown}
                    dataKey="calls"
                    nameKey="codec"
                    cx="50%" cy="50%"
                    outerRadius={80}
                    strokeWidth={0}
                  >
                    {d.breakdown.map((entry, i) => (
                      <Cell key={i} fill={codecColor(entry.codec)} />
                    ))}
                  </Pie>
                  <RcTooltip
                    contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => [`${v.toLocaleString()} calls`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 flex-1">
                {d.breakdown.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: codecColor(entry.codec) }} />
                    <span className="font-mono font-medium">{entry.codec}</span>
                    <span className="text-muted-foreground ml-auto">{entry.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">
              No codec data in CDR window
            </div>
          )}
        </div>

        {/* Codec Usage Bar */}
        <div className="bg-card border border-border/40 rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-4">Calls by Codec</h2>
          {d && d.breakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.breakdown} layout="vertical" margin={{ left: 16, right: 24 }}>
                <CartesianGrid {...BSE_GRID_PROPS} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: '#6b7280' }} />
                <YAxis type="category" dataKey="codec" tick={{ fontSize: 10, fill: '#9ca3af' }} width={52} />
                <BseTooltip formatter={(v: number) => v.toLocaleString()} />
                <Bar dataKey="calls" radius={[0, 3, 3, 0]}>
                  {d.breakdown.map((entry, i) => (
                    <Cell key={i} fill={codecColor(entry.codec)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Per-carrier transcoding table */}
      <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Per-Carrier Codec Breakdown</h2>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground mr-2">Sort by:</span>
            {(['transcode', 'calls'] as const).map(s => (
              <button
                key={s}
                onClick={() => setCarrierSort(s)}
                className={`px-2.5 py-1 rounded-md transition-colors ${carrierSort === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40 text-muted-foreground'}`}
                data-testid={`sort-${s}`}
              >
                {s === 'transcode' ? 'Transcode %' : 'Call Volume'}
              </button>
            ))}
          </div>
        </div>

        {sortedCarriers.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-muted-foreground/50 text-sm">
            No carrier codec data
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border/40 bg-muted/20">
                <tr>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Carrier</th>
                  <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Calls</th>
                  <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">
                    <span className="flex items-center justify-end gap-1">
                      Est. Transcode %
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3 h-3 cursor-help text-muted-foreground/50" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Percentage of calls using non-G.711 codecs — used as a proxy for transcoding cost.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Codec Mix</th>
                </tr>
              </thead>
              <tbody>
                {sortedCarriers.map((c, i) => (
                  <tr key={c.carrier} className="border-b border-border/20 hover:bg-muted/20 transition-colors" data-testid={`carrier-codec-${i}`}>
                    <td className="px-4 py-2.5 font-medium">{c.carrier}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{c.totalCalls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-mono font-bold ${c.transcodePct > 50 ? 'text-red-400' : c.transcodePct > 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {c.transcodePct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {c.codecs.slice(0, 4).map((ck, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
                            style={{ backgroundColor: `${codecColor(ck.codec)}22`, color: codecColor(ck.codec) }}
                          >
                            {ck.codec} <span className="opacity-70">{ck.pct.toFixed(0)}%</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
