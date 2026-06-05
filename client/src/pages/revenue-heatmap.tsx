import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-client';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Globe, BarChart2, X, Phone, Activity, Layers, ShieldAlert, Users, FileSpreadsheet,
} from 'lucide-react';
import { exportToExcel } from '@/lib/export-excel';
import { cn } from '@/lib/utils';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type RevenueView = 'revenue' | 'cost' | 'margin' | 'calls' | 'q-score' | 'concentration' | 'fas-risk';

export interface CountryRevenue {
  country: string; numericId: string | null;
  calls: number; answered: number; revenue: number; cost: number;
  margin: number; asr: number;
  carriers: { carrier: string; calls: number; cost: number }[];
}

export interface GeoCountry {
  country: string; numericId: string | null;
  calls: number; answered: number; revenue: number; cost: number; margin: number; asr: number;
  avgQScore: number | null; concentrationScore: number; fasRisk: 'high' | 'medium' | 'low';
  carrierCount: number;
  carriers: { carrier: string; calls: number; share: number; stabilityScore: number | null }[];
}

type GeoData = { countries: GeoCountry[]; generatedAt: string };

// ─── View config ──────────────────────────────────────────────────────────────

const VIEW_OPTIONS: { key: RevenueView; label: string; icon: any; color: string; group: 'financial' | 'intelligence' }[] = [
  { key: 'revenue',       label: 'Revenue',       icon: DollarSign,  color: 'text-emerald-400', group: 'financial'    },
  { key: 'cost',          label: 'Cost',          icon: TrendingDown,color: 'text-red-400',     group: 'financial'    },
  { key: 'margin',        label: 'Margin',        icon: TrendingUp,  color: 'text-blue-400',    group: 'financial'    },
  { key: 'calls',         label: 'Calls',         icon: Phone,       color: 'text-purple-400',  group: 'financial'    },
  { key: 'q-score',       label: 'Q-Score',       icon: Activity,    color: 'text-fuchsia-400', group: 'intelligence' },
  { key: 'concentration', label: 'Concentration', icon: Users,       color: 'text-cyan-400',    group: 'intelligence' },
  { key: 'fas-risk',      label: 'FAS Risk',      icon: ShieldAlert, color: 'text-orange-400',  group: 'intelligence' },
];

// ─── Color scales ─────────────────────────────────────────────────────────────

function revColor(val: number, max: number, view: RevenueView): string {
  if (max === 0) return '#1e293b';
  const ratio = Math.min(val / max, 1);
  if (view === 'cost') {
    if (ratio >= 0.8) return '#dc2626'; if (ratio >= 0.5) return '#f97316';
    if (ratio >= 0.2) return '#facc15'; if (ratio >= 0.05) return '#fde68a'; return '#1e293b';
  }
  if (view === 'margin') {
    if (val < 0) return '#dc2626';
    if (ratio >= 0.8) return '#10b981'; if (ratio >= 0.5) return '#34d399';
    if (ratio >= 0.2) return '#6ee7b7'; if (ratio >= 0.05) return '#d1fae5'; return '#1e293b';
  }
  if (view === 'calls') {
    if (ratio >= 0.8) return '#7c3aed'; if (ratio >= 0.5) return '#8b5cf6';
    if (ratio >= 0.2) return '#6366f1'; if (ratio >= 0.05) return '#3b82f6'; return '#1e293b';
  }
  // revenue
  if (ratio >= 0.8) return '#10b981'; if (ratio >= 0.5) return '#34d399';
  if (ratio >= 0.2) return '#6ee7b7'; if (ratio >= 0.05) return '#a7f3d0'; return '#1e293b';
}

function qScoreColor(score: number | null): string {
  if (score == null) return '#1e293b';
  if (score >= 80) return '#10b981';
  if (score >= 65) return '#84cc16';
  if (score >= 50) return '#eab308';
  if (score >= 35) return '#f97316';
  return '#ef4444';
}

function concentrationColor(score: number): string {
  if (score >= 80) return '#dc2626'; // monopoly — high risk
  if (score >= 60) return '#f97316';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#22d3ee';
  return '#10b981'; // distributed — low risk
}

function fasRiskColor(risk: 'high' | 'medium' | 'low'): string {
  if (risk === 'high')   return '#dc2626';
  if (risk === 'medium') return '#f97316';
  return '#22c55e';
}

function intelColor(row: GeoCountry, view: RevenueView): string {
  if (view === 'q-score')       return qScoreColor(row.avgQScore);
  if (view === 'concentration') return concentrationColor(row.concentrationScore);
  if (view === 'fas-risk')      return fasRiskColor(row.fasRisk);
  return '#1e293b';
}

function revOpacity(val: number, max: number): number {
  if (max === 0) return 0.15;
  const r = val / max;
  if (r >= 0.5) return 0.90; if (r >= 0.2) return 0.78; if (r >= 0.1) return 0.65;
  if (r >= 0.05) return 0.52; if (r > 0) return 0.38; return 0.15;
}

function fmt$(v: number) { return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`; }

const INTEL_VIEWS = new Set<RevenueView>(['q-score', 'concentration', 'fas-risk']);

// ─── Map layer ────────────────────────────────────────────────────────────────

interface MapLayerProps {
  revData:   CountryRevenue[];
  geoData:   GeoCountry[];
  view:      RevenueView;
  onSelect:  (c: CountryRevenue | GeoCountry | null) => void;
  selected:  CountryRevenue | GeoCountry | null;
}

function RevenueMapLayer({ revData, geoData, view, onSelect, selected }: MapLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  const revByCountry = useMemo(() => {
    const m = new Map<string, CountryRevenue>();
    for (const r of revData) if (r.numericId) m.set(r.numericId, r);
    return m;
  }, [revData]);

  const geoByCountry = useMemo(() => {
    const m = new Map<string, GeoCountry>();
    for (const r of geoData) if (r.numericId) m.set(r.numericId, r);
    return m;
  }, [geoData]);

  const isIntel = INTEL_VIEWS.has(view);

  const maxVal = useMemo(() => {
    if (isIntel) return 1;
    return Math.max(1, ...revData.map(r =>
      view === 'cost' ? r.cost : view === 'margin' ? Math.max(0, r.margin)
      : view === 'calls' ? r.calls : r.revenue
    ));
  }, [revData, geoData, view, isIntel]);

  useEffect(() => {
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }

    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then((topo: Topology) => {
        const geo = topojson.feature(topo, topo.objects['countries'] as GeometryCollection);
        const layer = L.geoJSON(geo as any, {
          style: (feature: any) => {
            const numId = String(feature?.id ?? '').padStart(3, '0');
            const isSelected = (selected as any)?.numericId === numId;

            if (isIntel) {
              const row = geoByCountry.get(numId);
              if (!row) return { fillColor: '#1e293b', fillOpacity: 0.15, color: '#334155', weight: 0.5 };
              return {
                fillColor:   intelColor(row, view),
                fillOpacity: 0.75,
                color:       isSelected ? '#f59e0b' : '#334155',
                weight:      isSelected ? 2 : 0.5,
              };
            }

            const row = revByCountry.get(numId);
            const val = row ? (view === 'cost' ? row.cost : view === 'margin' ? row.margin : view === 'calls' ? row.calls : row.revenue) : 0;
            return {
              fillColor:   row && val > 0 ? revColor(val, maxVal, view) : '#1e293b',
              fillOpacity: row && val > 0 ? revOpacity(val, maxVal) : 0.15,
              color:       isSelected ? '#f59e0b' : '#334155',
              weight:      isSelected ? 2 : 0.5,
            };
          },
          onEachFeature: (feature: any, lyr: any) => {
            const numId = String(feature?.id ?? '').padStart(3, '0');
            if (isIntel) {
              const row = geoByCountry.get(numId);
              lyr.on('click', () => onSelect(row ?? null));
              if (row) {
                const tip = view === 'q-score'
                  ? `Q-Score: ${row.avgQScore != null ? row.avgQScore : '—'}`
                  : view === 'concentration'
                  ? `Concentration: ${row.concentrationScore}% (${row.carrierCount} carriers)`
                  : `FAS Risk: ${row.fasRisk} (ASR ${row.asr.toFixed(1)}%)`;
                lyr.bindTooltip(
                  `<div class="text-xs font-mono"><strong>${row.country}</strong><br/>${tip}</div>`,
                  { sticky: true, className: 'leaflet-tooltip-dark' }
                );
              }
            } else {
              const row = revByCountry.get(numId);
              lyr.on('click', () => onSelect(row ?? null));
              if (row) {
                const val = view === 'cost' ? row.cost : view === 'margin' ? row.margin : view === 'calls' ? row.calls : row.revenue;
                lyr.bindTooltip(
                  `<div class="text-xs font-mono"><strong>${row.country}</strong><br/>${view.charAt(0).toUpperCase() + view.slice(1)}: ${view === 'calls' ? row.calls.toLocaleString() : fmt$(val)}</div>`,
                  { sticky: true, className: 'leaflet-tooltip-dark' }
                );
              }
            }
          },
        }).addTo(map);
        layerRef.current = layer;
      });

    return () => { if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; } };
  }, [map, revByCountry, geoByCountry, view, maxVal, selected, isIntel]);

  return null;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function MapLegend({ view }: { view: RevenueView }) {
  const entries: { color: string; label: string }[] = useMemo(() => {
    if (view === 'q-score') return [
      { color: '#10b981', label: 'Healthy (80+)'  },
      { color: '#84cc16', label: 'Good (65–79)'   },
      { color: '#eab308', label: 'Watch (50–64)'  },
      { color: '#f97316', label: 'Weak (35–49)'   },
      { color: '#ef4444', label: 'Critical (<35)' },
    ];
    if (view === 'concentration') return [
      { color: '#10b981', label: 'Distributed (<20%)'  },
      { color: '#22d3ee', label: 'Low (20–39%)'        },
      { color: '#eab308', label: 'Moderate (40–59%)'   },
      { color: '#f97316', label: 'High (60–79%)'       },
      { color: '#dc2626', label: 'Monopoly (80%+)'     },
    ];
    if (view === 'fas-risk') return [
      { color: '#22c55e', label: 'Low risk'    },
      { color: '#f97316', label: 'Medium risk' },
      { color: '#dc2626', label: 'High risk'   },
    ];
    if (view === 'cost') return [
      { color: '#dc2626', label: 'Very high' }, { color: '#f97316', label: 'High'   },
      { color: '#facc15', label: 'Medium'    }, { color: '#fde68a', label: 'Low'    },
      { color: '#1e293b', label: 'None'      },
    ];
    if (view === 'margin') return [
      { color: '#10b981', label: 'High'     }, { color: '#34d399', label: 'Medium' },
      { color: '#6ee7b7', label: 'Low'      }, { color: '#dc2626', label: 'Loss'   },
      { color: '#1e293b', label: 'None'     },
    ];
    if (view === 'calls') return [
      { color: '#7c3aed', label: 'Very high' }, { color: '#8b5cf6', label: 'High'   },
      { color: '#6366f1', label: 'Medium'    }, { color: '#3b82f6', label: 'Low'    },
      { color: '#1e293b', label: 'None'      },
    ];
    return [
      { color: '#10b981', label: 'Very high' }, { color: '#34d399', label: 'High'   },
      { color: '#6ee7b7', label: 'Medium'    }, { color: '#a7f3d0', label: 'Low'    },
      { color: '#1e293b', label: 'None'      },
    ];
  }, [view]);

  return (
    <div className="absolute bottom-6 left-4 z-[1000] bg-card/90 border border-border/60 rounded-lg p-3 text-xs backdrop-blur">
      <div className="font-medium mb-2 text-muted-foreground uppercase tracking-wide">
        {VIEW_OPTIONS.find(v => v.key === view)?.label}
      </div>
      <div className="flex flex-col gap-1">
        {entries.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Detail panel: revenue country ───────────────────────────────────────────

function RevCountryDetail({ row, onClose }: { row: CountryRevenue; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 sticky top-0 bg-card/80 backdrop-blur z-10">
        <span className="font-semibold text-sm">{row.country}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted/40"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4 space-y-3">
        {[
          { label: 'Revenue',  value: fmt$(row.revenue), color: 'text-emerald-400'  },
          { label: 'Cost',     value: fmt$(row.cost),    color: 'text-red-400'      },
          { label: 'Margin',   value: fmt$(row.margin),  color: row.margin >= 0 ? 'text-blue-400' : 'text-rose-400' },
          { label: 'Calls',    value: row.calls.toLocaleString(),   color: 'text-foreground'   },
          { label: 'Answered', value: row.answered.toLocaleString(), color: 'text-emerald-400' },
          { label: 'ASR',      value: `${row.asr.toFixed(1)}%`,     color: row.asr >= 50 ? 'text-emerald-400' : 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border/20">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className={`text-sm font-mono font-bold ${s.color}`}>{s.value}</span>
          </div>
        ))}
        {row.carriers.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Carrier Breakdown</div>
            <div className="space-y-1.5">
              {row.carriers.slice(0, 8).map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-muted/20 rounded px-2 py-1.5">
                  <span className="truncate text-foreground/80 max-w-[120px]">{c.carrier}</span>
                  <div className="flex gap-3 shrink-0">
                    <span className="text-muted-foreground">{c.calls} calls</span>
                    <span className="text-red-400 font-mono">{fmt$(c.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail panel: intelligence country ──────────────────────────────────────

function GeoCountryDetail({ row, view, onClose }: { row: GeoCountry; view: RevenueView; onClose: () => void }) {
  const fasColor = row.fasRisk === 'high' ? 'text-red-400' : row.fasRisk === 'medium' ? 'text-orange-400' : 'text-emerald-400';
  const qColor   = row.avgQScore == null ? 'text-muted-foreground'
    : row.avgQScore >= 80 ? 'text-emerald-400' : row.avgQScore >= 60 ? 'text-yellow-400' : row.avgQScore >= 40 ? 'text-orange-400' : 'text-red-400';
  const conColor = row.concentrationScore >= 80 ? 'text-red-400' : row.concentrationScore >= 60 ? 'text-orange-400' : row.concentrationScore >= 40 ? 'text-yellow-400' : 'text-emerald-400';

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 sticky top-0 bg-card/80 backdrop-blur z-10">
        <div>
          <span className="font-semibold text-sm">{row.country}</span>
          <span className="ml-2 text-xs text-fuchsia-400 bg-fuchsia-500/10 px-1.5 py-0.5 rounded">Intelligence</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted/40"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between py-1.5 border-b border-border/20">
          <span className="text-xs text-muted-foreground">Avg Q-Score</span>
          <span className={`text-sm font-mono font-bold ${qColor}`}>{row.avgQScore != null ? row.avgQScore : '—'}/100</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border/20">
          <span className="text-xs text-muted-foreground">Carrier Concentration</span>
          <span className={`text-sm font-mono font-bold ${conColor}`}>{row.concentrationScore}%</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border/20">
          <span className="text-xs text-muted-foreground">FAS Risk</span>
          <span className={`text-sm font-bold capitalize ${fasColor}`}>{row.fasRisk}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border/20">
          <span className="text-xs text-muted-foreground">Carrier Count</span>
          <span className="text-sm font-mono font-bold">{row.carrierCount}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border/20">
          <span className="text-xs text-muted-foreground">ASR</span>
          <span className={`text-sm font-mono font-bold ${row.asr >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{row.asr.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border/20">
          <span className="text-xs text-muted-foreground">Revenue</span>
          <span className="text-sm font-mono font-bold text-emerald-400">{fmt$(row.revenue)}</span>
        </div>
        {row.carriers.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Carrier Intelligence</div>
            <div className="space-y-1.5">
              {row.carriers.map((c, i) => (
                <div key={i} className="bg-muted/20 rounded px-2 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate text-foreground/80 max-w-[120px]">{c.carrier}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{c.share}% share</span>
                  </div>
                  {c.stabilityScore != null && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="flex-1 h-1 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${c.stabilityScore}%`,
                            backgroundColor: c.stabilityScore >= 80 ? '#10b981' : c.stabilityScore >= 60 ? '#eab308' : c.stabilityScore >= 40 ? '#f97316' : '#ef4444',
                          }}
                        />
                      </div>
                      <span className={`text-xs font-mono ${c.stabilityScore >= 80 ? 'text-emerald-400' : c.stabilityScore >= 60 ? 'text-yellow-400' : 'text-orange-400'}`}>
                        {Math.round(c.stabilityScore)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RevenueHeatmapPage() {
  const [view,     setView]     = useState<RevenueView>('revenue');
  const [selected, setSelected] = useState<CountryRevenue | GeoCountry | null>(null);

  const isIntel = INTEL_VIEWS.has(view);

  const { data: revData = [], isLoading: revLoading, isFetching: revFetching, refetch: revRefetch } = useQuery<CountryRevenue[]>({
    queryKey: ['/api/revenue-heatmap'],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: geoRaw, isLoading: geoLoading, isFetching: geoFetching, refetch: geoRefetch } = useQuery<GeoData>({
    queryKey: ['/api/geo-intelligence'],
    refetchInterval: 5 * 60 * 1000,
  });
  const geoData = geoRaw?.countries ?? [];

  const isLoading  = isIntel ? geoLoading  : revLoading;
  const isFetching = isIntel ? geoFetching : revFetching;
  const refetch    = isIntel ? geoRefetch  : revRefetch;

  const activeRows = isIntel ? geoData : revData;

  const sorted = useMemo(() => {
    if (isIntel) {
      return [...geoData].sort((a, b) => {
        if (view === 'q-score')       return (b.avgQScore ?? 0) - (a.avgQScore ?? 0);
        if (view === 'concentration') return b.concentrationScore - a.concentrationScore;
        // fas-risk
        const rOrder = { high: 2, medium: 1, low: 0 };
        return (rOrder[b.fasRisk] ?? 0) - (rOrder[a.fasRisk] ?? 0);
      });
    }
    return [...revData].sort((a, b) => {
      const val = (r: CountryRevenue) => view === 'cost' ? r.cost : view === 'margin' ? r.margin : view === 'calls' ? r.calls : r.revenue;
      return val(b) - val(a);
    });
  }, [activeRows, view, isIntel]);

  const totals = useMemo(() => revData.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, cost: acc.cost + r.cost, calls: acc.calls + r.calls }),
    { revenue: 0, cost: 0, calls: 0 }
  ), [revData]);
  const totalMargin = totals.revenue - totals.cost;

  const handleSelect = (c: CountryRevenue | GeoCountry | null) => setSelected(c);

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card/40 shrink-0">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-emerald-400" />
          <div>
            <h1 className="text-base font-semibold">Geographic Revenue Intelligence</h1>
            <p className="text-xs text-muted-foreground">
              {isIntel ? 'Telecom intelligence overlay · Carrier quality & risk signals' : 'CDR-based financial layer · 72h rolling window'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View groups */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
            {/* Financial group */}
            {VIEW_OPTIONS.filter(v => v.group === 'financial').map(v => (
              <button
                key={v.key}
                onClick={() => { setView(v.key); setSelected(null); }}
                data-testid={`view-${v.key}`}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  view === v.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <v.icon className={`w-3 h-3 ${view === v.key ? v.color : ''}`} />
                {v.label}
              </button>
            ))}
            <div className="w-px h-4 bg-border/50 mx-0.5" />
            {/* Intelligence group */}
            {VIEW_OPTIONS.filter(v => v.group === 'intelligence').map(v => (
              <button
                key={v.key}
                onClick={() => { setView(v.key); setSelected(null); }}
                data-testid={`view-${v.key}`}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  view === v.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <v.icon className={`w-3 h-3 ${view === v.key ? v.color : ''}`} />
                {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg hover:bg-muted/40 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-heatmap"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Intelligence mode badge */}
      {isIntel && (
        <div className="flex items-center gap-2 px-6 py-2 bg-fuchsia-950/30 border-b border-fuchsia-500/20 shrink-0">
          <Layers className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
          <p className="text-xs text-fuchsia-300/80">
            <span className="font-semibold text-fuchsia-300">Intelligence overlay.</span>{" "}
            {view === 'q-score'       && 'Countries coloured by average carrier stability Q-score. Lower scores indicate degraded routing quality.'}
            {view === 'concentration' && 'Carrier concentration index per destination. High concentration = single-carrier dependency risk.'}
            {view === 'fas-risk'      && 'FAS/IRSF risk proxy derived from ASR patterns. High-risk destinations warrant fraud review.'}
          </p>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-px bg-border/30 border-b border-border/30 shrink-0">
        {[
          { label: 'Total Revenue', value: fmt$(totals.revenue),       color: 'text-emerald-400' },
          { label: 'Total Cost',    value: fmt$(totals.cost),          color: 'text-red-400'     },
          { label: 'Net Margin',    value: fmt$(totalMargin),          color: totalMargin >= 0 ? 'text-blue-400' : 'text-rose-400' },
          { label: isIntel ? 'Intel Countries' : 'Countries',
            value: (isIntel ? geoData.length : revData.length).toString(), color: 'text-purple-400' },
        ].map(k => (
          <div key={k.label} className="bg-card/60 px-5 py-3">
            <div className={`text-xl font-bold font-mono ${k.color}`}>{k.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Map + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            </div>
          ) : (
            <MapContainer
              center={[20, 0]} zoom={2} minZoom={1} maxZoom={6}
              style={{ height: '100%', width: '100%', background: '#0f172a' }}
              zoomControl={true}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              <RevenueMapLayer
                revData={revData} geoData={geoData} view={view}
                onSelect={handleSelect} selected={selected}
              />
            </MapContainer>
          )}
          <MapLegend view={view} />
        </div>

        {/* Right panel */}
        <div className="w-80 shrink-0 border-l border-border/40 bg-card/30 flex flex-col overflow-hidden">
          {selected ? (
            isIntel
              ? <GeoCountryDetail row={selected as GeoCountry} view={view} onClose={() => setSelected(null)} />
              : <RevCountryDetail row={selected as CountryRevenue} onClose={() => setSelected(null)} />
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5" />
                  {isIntel ? `Top Countries — ${VIEW_OPTIONS.find(v => v.key === view)?.label}` : `Top Countries by ${VIEW_OPTIONS.find(v => v.key === view)?.label}`}
                </div>
              </div>
              <div className="overflow-y-auto flex-1">
                {(sorted as any[]).slice(0, 50).map((r: any, i: number) => {
                  let val: number, displayVal: string, barColor: string, barPct: number;

                  if (isIntel) {
                    const gr = r as GeoCountry;
                    if (view === 'q-score') {
                      val = gr.avgQScore ?? 0;
                      displayVal = gr.avgQScore != null ? `${gr.avgQScore}/100` : '—';
                      barColor = qScoreColor(gr.avgQScore);
                      barPct = gr.avgQScore ?? 0;
                    } else if (view === 'concentration') {
                      val = gr.concentrationScore;
                      displayVal = `${gr.concentrationScore}%`;
                      barColor = concentrationColor(gr.concentrationScore);
                      barPct = gr.concentrationScore;
                    } else {
                      val = gr.fasRisk === 'high' ? 3 : gr.fasRisk === 'medium' ? 2 : 1;
                      displayVal = gr.fasRisk.charAt(0).toUpperCase() + gr.fasRisk.slice(1);
                      barColor = fasRiskColor(gr.fasRisk);
                      barPct = val === 3 ? 100 : val === 2 ? 60 : 25;
                    }
                  } else {
                    const rv = r as CountryRevenue;
                    val = view === 'cost' ? rv.cost : view === 'margin' ? rv.margin : view === 'calls' ? rv.calls : rv.revenue;
                    const maxV = (sorted[0] as CountryRevenue) ? (view === 'cost' ? (sorted[0] as CountryRevenue).cost : view === 'margin' ? (sorted[0] as CountryRevenue).margin : view === 'calls' ? (sorted[0] as CountryRevenue).calls : (sorted[0] as CountryRevenue).revenue) : 1;
                    displayVal = view === 'calls' ? val.toLocaleString() : fmt$(val);
                    barColor = revColor(val, maxV || 1, view);
                    barPct = maxV > 0 ? (val / maxV) * 100 : 0;
                  }

                  return (
                    <button
                      key={r.country}
                      onClick={() => setSelected(r)}
                      data-testid={`country-row-${i}`}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors border-b border-border/20 text-left"
                    >
                      <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium truncate">{r.country}</span>
                          <span className="text-xs font-mono font-bold ml-2 shrink-0" style={{ color: barColor }}>{displayVal}</span>
                        </div>
                        <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, backgroundColor: barColor }} />
                        </div>
                      </div>
                    </button>
                  );
                })}
                {activeRows.length === 0 && !isLoading && (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/50 text-sm gap-2">
                    <Globe className="w-8 h-8 opacity-30" />
                    <span>{isIntel ? 'No carrier data yet' : 'No CDR data yet'}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
