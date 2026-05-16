import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-client';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Globe, BarChart2, ArrowUpRight, X, Phone, Percent,
} from 'lucide-react';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type RevenueView = 'revenue' | 'cost' | 'margin' | 'calls';

export interface CountryRevenue {
  country:    string;
  numericId:  string | null;
  calls:      number;
  answered:   number;
  revenue:    number;
  cost:       number;
  margin:     number;
  asr:        number;
  carriers:   { carrier: string; calls: number; cost: number }[];
}

// ─── Color scales per view ────────────────────────────────────────────────────

function revColor(val: number, max: number, view: RevenueView): string {
  if (max === 0) return '#1e293b';
  const ratio = Math.min(val / max, 1);
  if (view === 'cost') {
    if (ratio >= 0.8) return '#dc2626';
    if (ratio >= 0.5) return '#f97316';
    if (ratio >= 0.2) return '#facc15';
    if (ratio >= 0.05) return '#fde68a';
    return '#1e293b';
  }
  if (view === 'margin') {
    if (val < 0) return '#dc2626';
    if (ratio >= 0.8) return '#10b981';
    if (ratio >= 0.5) return '#34d399';
    if (ratio >= 0.2) return '#6ee7b7';
    if (ratio >= 0.05) return '#d1fae5';
    return '#1e293b';
  }
  if (view === 'calls') {
    if (ratio >= 0.8) return '#7c3aed';
    if (ratio >= 0.5) return '#8b5cf6';
    if (ratio >= 0.2) return '#6366f1';
    if (ratio >= 0.05) return '#3b82f6';
    return '#1e293b';
  }
  // revenue
  if (ratio >= 0.8) return '#10b981';
  if (ratio >= 0.5) return '#34d399';
  if (ratio >= 0.2) return '#6ee7b7';
  if (ratio >= 0.05) return '#a7f3d0';
  return '#1e293b';
}

function revOpacity(val: number, max: number): number {
  if (max === 0) return 0.15;
  const r = val / max;
  if (r >= 0.5) return 0.90;
  if (r >= 0.2) return 0.78;
  if (r >= 0.1) return 0.65;
  if (r >= 0.05) return 0.52;
  if (r > 0) return 0.38;
  return 0.15;
}

function fmt$(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`;
}

// ─── Map layer component ──────────────────────────────────────────────────────

interface MapLayerProps {
  data: CountryRevenue[];
  view: RevenueView;
  onSelect: (c: CountryRevenue | null) => void;
  selected: CountryRevenue | null;
}

function RevenueMapLayer({ data, view, onSelect, selected }: MapLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  const byCountry = useMemo(() => {
    const m = new Map<string, CountryRevenue>();
    for (const r of data) if (r.numericId) m.set(r.numericId, r);
    return m;
  }, [data]);

  const maxVal = useMemo(() => {
    return Math.max(1, ...data.map(r =>
      view === 'cost' ? r.cost : view === 'margin' ? Math.max(0, r.margin) : view === 'calls' ? r.calls : r.revenue
    ));
  }, [data, view]);

  useEffect(() => {
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }

    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then((topo: Topology) => {
        const geo = topojson.feature(topo, topo.objects['countries'] as GeometryCollection);
        const layer = L.geoJSON(geo as any, {
          style: (feature: any) => {
            const numId = String(feature?.id ?? '').padStart(3, '0');
            const row = byCountry.get(numId);
            const val = row ? (view === 'cost' ? row.cost : view === 'margin' ? row.margin : view === 'calls' ? row.calls : row.revenue) : 0;
            const isSelected = selected?.numericId === numId;
            return {
              fillColor:   row && val > 0 ? revColor(val, maxVal, view) : '#1e293b',
              fillOpacity: row && val > 0 ? revOpacity(val, maxVal) : 0.15,
              color:       isSelected ? '#f59e0b' : '#334155',
              weight:      isSelected ? 2 : 0.5,
            };
          },
          onEachFeature: (feature: any, layer: any) => {
            const numId = String(feature?.id ?? '').padStart(3, '0');
            const row = byCountry.get(numId);
            layer.on('click', () => onSelect(row ?? null));
            if (row) {
              const val = view === 'cost' ? row.cost : view === 'margin' ? row.margin : view === 'calls' ? row.calls : row.revenue;
              layer.bindTooltip(
                `<div class="text-xs font-mono"><strong>${row.country}</strong><br/>${view.charAt(0).toUpperCase() + view.slice(1)}: ${view === 'calls' ? row.calls.toLocaleString() : fmt$(val)}</div>`,
                { sticky: true, className: 'leaflet-tooltip-dark' }
              );
            }
          },
        }).addTo(map);
        layerRef.current = layer;
      });

    return () => { if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; } };
  }, [map, byCountry, view, maxVal, selected]);

  return null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const VIEW_OPTIONS: { key: RevenueView; label: string; icon: any; color: string }[] = [
  { key: 'revenue', label: 'Revenue',  icon: DollarSign, color: 'text-emerald-400' },
  { key: 'cost',    label: 'Cost',     icon: TrendingDown, color: 'text-red-400'   },
  { key: 'margin',  label: 'Margin',   icon: TrendingUp, color: 'text-blue-400'   },
  { key: 'calls',   label: 'Calls',    icon: Phone,      color: 'text-purple-400' },
];

export default function RevenueHeatmapPage() {
  const [view,     setView]     = useState<RevenueView>('revenue');
  const [selected, setSelected] = useState<CountryRevenue | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<CountryRevenue[]>({
    queryKey: ['/api/revenue-heatmap'],
    refetchInterval: 5 * 60 * 1000,
  });

  const rows = data ?? [];

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const val = (r: CountryRevenue) => view === 'cost' ? r.cost : view === 'margin' ? r.margin : view === 'calls' ? r.calls : r.revenue;
    return val(b) - val(a);
  }), [rows, view]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, cost: acc.cost + r.cost, calls: acc.calls + r.calls }),
    { revenue: 0, cost: 0, calls: 0 }
  ), [rows]);
  const totalMargin = totals.revenue - totals.cost;

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card/40 shrink-0">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-emerald-400" />
          <div>
            <h1 className="text-base font-semibold">Geographic Revenue Heatmap</h1>
            <p className="text-xs text-muted-foreground">CDR-based financial layer · 72h rolling window</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
            {VIEW_OPTIONS.map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                data-testid={`view-${v.key}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === v.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
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

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-px bg-border/30 border-b border-border/30 shrink-0">
        {[
          { label: 'Total Revenue', value: fmt$(totals.revenue), color: 'text-emerald-400' },
          { label: 'Total Cost',    value: fmt$(totals.cost),    color: 'text-red-400'     },
          { label: 'Net Margin',    value: fmt$(totalMargin),    color: totalMargin >= 0 ? 'text-blue-400' : 'text-rose-400' },
          { label: 'Countries',     value: rows.length.toString(), color: 'text-purple-400' },
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
              center={[20, 0]}
              zoom={2}
              minZoom={1}
              maxZoom={6}
              style={{ height: '100%', width: '100%', background: '#0f172a' }}
              zoomControl={true}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              <RevenueMapLayer data={rows} view={view} onSelect={setSelected} selected={selected} />
            </MapContainer>
          )}

          {/* Legend */}
          <div className="absolute bottom-6 left-4 z-[1000] bg-card/90 border border-border/60 rounded-lg p-3 text-xs backdrop-blur">
            <div className="font-medium mb-2 text-muted-foreground uppercase tracking-wide">
              {VIEW_OPTIONS.find(v => v.key === view)?.label}
            </div>
            <div className="flex flex-col gap-1">
              {view !== 'calls' ? (
                ['High', 'Medium', 'Low', 'None'].map((l, i) => (
                  <div key={l} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{
                      backgroundColor: [
                        revColor(1, 1, view), revColor(0.3, 1, view), revColor(0.1, 1, view), '#1e293b'
                      ][i]
                    }} />
                    <span className="text-muted-foreground">{l}</span>
                  </div>
                ))
              ) : (
                ['High volume', 'Medium', 'Low', 'None'].map((l, i) => (
                  <div key={l} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: ['#7c3aed','#6366f1','#3b82f6','#1e293b'][i] }} />
                    <span className="text-muted-foreground">{l}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right panel: country list / detail */}
        <div className="w-80 shrink-0 border-l border-border/40 bg-card/30 flex flex-col overflow-hidden">
          {selected ? (
            /* Country drill-down */
            <div className="flex flex-col h-full overflow-y-auto">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 sticky top-0 bg-card/80 backdrop-blur z-10">
                <span className="font-semibold text-sm">{selected.country}</span>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-muted/40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: 'Revenue',  value: fmt$(selected.revenue),  color: 'text-emerald-400' },
                  { label: 'Cost',     value: fmt$(selected.cost),     color: 'text-red-400'     },
                  { label: 'Margin',   value: fmt$(selected.margin),   color: selected.margin >= 0 ? 'text-blue-400' : 'text-rose-400' },
                  { label: 'Calls',    value: selected.calls.toLocaleString(), color: 'text-foreground' },
                  { label: 'Answered', value: selected.answered.toLocaleString(), color: 'text-emerald-400' },
                  { label: 'ASR',      value: `${selected.asr.toFixed(1)}%`,    color: selected.asr >= 50 ? 'text-emerald-400' : 'text-amber-400' },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border/20">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className={`text-sm font-mono font-bold ${s.color}`}>{s.value}</span>
                  </div>
                ))}

                {selected.carriers.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Carrier Breakdown</div>
                    <div className="space-y-1.5">
                      {selected.carriers.slice(0, 8).map((c, i) => (
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
          ) : (
            /* Country list */
            <div className="flex flex-col h-full overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5" />
                  Top Countries by {VIEW_OPTIONS.find(v => v.key === view)?.label}
                </div>
              </div>
              <div className="overflow-y-auto flex-1">
                {sorted.slice(0, 50).map((r, i) => {
                  const val = view === 'cost' ? r.cost : view === 'margin' ? r.margin : view === 'calls' ? r.calls : r.revenue;
                  const maxV = sorted[0] ? (view === 'cost' ? sorted[0].cost : view === 'margin' ? sorted[0].margin : view === 'calls' ? sorted[0].calls : sorted[0].revenue) : 1;
                  const barPct = maxV > 0 ? (val / maxV) * 100 : 0;
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
                          <span className={`text-xs font-mono font-bold ml-2 shrink-0 ${
                            view === 'cost' ? 'text-red-400' : view === 'margin' ? (r.margin >= 0 ? 'text-blue-400' : 'text-rose-400') : view === 'calls' ? 'text-purple-400' : 'text-emerald-400'
                          }`}>
                            {view === 'calls' ? val.toLocaleString() : fmt$(val)}
                          </span>
                        </div>
                        <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${barPct}%`,
                              backgroundColor: revColor(val, maxV, view),
                            }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
                {rows.length === 0 && !isLoading && (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground/50 text-sm gap-2">
                    <Globe className="w-8 h-8 opacity-30" />
                    <span>No CDR data yet</span>
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
