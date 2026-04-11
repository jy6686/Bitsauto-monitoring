import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-client';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Globe, RefreshCw, Loader2, BarChart2, Clock, Phone, TrendingUp, AlertCircle,
} from 'lucide-react';

// Fix Leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface CountryRow {
  name: string;
  numericId: string | null;
  calls: number;
  answered: number;
  pct: number;
  asr: number;
  avgDurSecs: number;
  totalMins: number;
}

interface TrafficData {
  countries: CountryRow[];
  total: number;
  hours: number;
}

// ─── Color scale ──────────────────────────────────────────────────────────────

function trafficColor(pct: number): string {
  if (pct >= 30) return '#7c3aed';   // deep violet – dominant traffic
  if (pct >= 20) return '#8b5cf6';   // violet
  if (pct >= 10) return '#6366f1';   // indigo
  if (pct >=  5) return '#3b82f6';   // blue
  if (pct >=  2) return '#06b6d4';   // cyan
  if (pct >=  0.5) return '#10b981'; // emerald
  return '#1e293b';                   // near-invisible for unmapped
}

function trafficOpacity(pct: number): number {
  if (pct >= 20) return 0.92;
  if (pct >= 10) return 0.85;
  if (pct >=  5) return 0.75;
  if (pct >=  2) return 0.65;
  if (pct >=  0.5) return 0.55;
  return 0.18;
}

// ─── Legend component ─────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { label: '≥ 30%',  color: '#7c3aed' },
  { label: '20–30%', color: '#8b5cf6' },
  { label: '10–20%', color: '#6366f1' },
  { label: '5–10%',  color: '#3b82f6' },
  { label: '2–5%',   color: '#06b6d4' },
  { label: '0.5–2%', color: '#10b981' },
  { label: '< 0.5%', color: '#1e293b' },
];

function MapLegend() {
  const map = useMap();
  useEffect(() => {
    const ctrl = new L.Control({ position: 'bottomright' });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create('div');
      div.style.cssText = 'background:rgba(15,23,42,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;color:#fff;font-size:11px;backdrop-filter:blur(8px);min-width:130px;';
      div.innerHTML = `<div style="font-weight:700;margin-bottom:8px;letter-spacing:.05em;opacity:.7;text-transform:uppercase;font-size:9px;">Traffic Share</div>` +
        LEGEND_ITEMS.map(l => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><span style="width:14px;height:14px;border-radius:3px;background:${l.color};flex-shrink:0;display:inline-block;opacity:0.85;"></span><span style="opacity:0.8;">${l.label}</span></div>`).join('');
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    ctrl.addTo(map);
    return () => { map.removeControl(ctrl); };
  }, [map]);
  return null;
}

// ─── GeoJSON layer that re-renders when traffic data changes ──────────────────

function CountryLayer({
  geoJson,
  trafficMap,
  onHover,
}: {
  geoJson: GeoJSON.FeatureCollection;
  trafficMap: Map<string, CountryRow>;
  onHover: (row: CountryRow | null) => void;
}) {
  const ref = useRef<L.GeoJSON | null>(null);

  const style = useCallback((feature?: GeoJSON.Feature): L.PathOptions => {
    const id = String(feature?.id ?? '');
    const row = trafficMap.get(id);
    const pct = row?.pct ?? 0;
    return {
      fillColor:   trafficColor(pct),
      fillOpacity: row ? trafficOpacity(pct) : 0.08,
      color:       '#334155',
      weight:      0.6,
      opacity:     0.5,
    };
  }, [trafficMap]);

  const onEachFeature = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const id = String(feature.id ?? '');
    const row = trafficMap.get(id);
    (layer as L.Path).on({
      mouseover: (e) => {
        const l = e.target as L.Path;
        l.setStyle({ weight: 2, color: '#fff', fillOpacity: Math.min(1, (row ? trafficOpacity(row.pct) : 0.08) + 0.12) });
        l.bringToFront();
        onHover(row ?? null);
      },
      mouseout: (e) => {
        ref.current?.resetStyle(e.target);
        onHover(null);
      },
    });
  }, [trafficMap, onHover]);

  return (
    <GeoJSON
      key={trafficMap.size}
      ref={ref}
      data={geoJson}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}

// ─── Tooltip overlay ──────────────────────────────────────────────────────────

function HoverTooltip({ row }: { row: CountryRow | null }) {
  if (!row) return null;
  const barW = Math.max(4, Math.min(100, row.pct * 3));
  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none"
      style={{ minWidth: 220 }}
    >
      <div className="bg-slate-900/95 border border-white/10 rounded-xl shadow-2xl px-5 py-4 text-white backdrop-blur">
        <p className="font-bold text-base mb-2">{row.name}</p>
        <div className="h-1.5 rounded-full bg-white/10 mb-3 overflow-hidden">
          <div className="h-full rounded-full bg-violet-500" style={{ width: `${barW}%`, transition: 'width 0.2s' }} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
          <div>
            <p className="text-white/40 uppercase tracking-wider text-[9px]">Traffic</p>
            <p className="font-bold text-violet-300 text-sm">{row.pct.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-white/40 uppercase tracking-wider text-[9px]">Calls</p>
            <p className="font-semibold">{row.calls.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-white/40 uppercase tracking-wider text-[9px]">ASR</p>
            <p className={`font-semibold ${row.asr >= 70 ? 'text-emerald-400' : row.asr >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{row.asr}%</p>
          </div>
          <div>
            <p className="text-white/40 uppercase tracking-wider text-[9px]">Total Mins</p>
            <p className="font-semibold">{row.totalMins.toLocaleString()} m</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrafficMapPage() {
  const [hours, setHours] = useState(24);
  const [hovered, setHovered] = useState<CountryRow | null>(null);

  // Fetch traffic data
  const { data: traffic, isLoading: trafficLoading, refetch, dataUpdatedAt } = useQuery<TrafficData>({
    queryKey: ['/api/traffic-map', hours],
    queryFn: () => fetch(`/api/traffic-map?hours=${hours}`).then(r => r.json()),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Fetch world TopoJSON (cached by browser)
  const { data: topoJson, isLoading: topoLoading } = useQuery({
    queryKey: ['/api/geo/world'],
    queryFn: () => fetch('/api/geo/world').then(r => r.json()),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Convert TopoJSON → GeoJSON once
  const geoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!topoJson) return null;
    try {
      const topo = topoJson as Topology;
      const geo = topojson.feature(topo, topo.objects.countries as GeometryCollection) as GeoJSON.FeatureCollection;
      return geo;
    } catch {
      return null;
    }
  }, [topoJson]);

  // Build a map from numeric country ID → row for fast lookup
  const trafficMap = useMemo<Map<string, CountryRow>>(() => {
    const m = new Map<string, CountryRow>();
    for (const row of traffic?.countries ?? []) {
      if (row.numericId) m.set(row.numericId, row);
    }
    return m;
  }, [traffic]);

  const countries   = traffic?.countries ?? [];
  const totalCalls  = traffic?.total ?? 0;
  const top10       = countries.slice(0, 10);
  const isLoading   = trafficLoading || topoLoading;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-violet-400" />
            Traffic Map
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Destination traffic distribution by country — {totalCalls.toLocaleString()} total calls
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Period:</span>
          {[3, 6, 12, 24, 48, 72].map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                hours === h
                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                  : 'text-muted-foreground border-border/50 hover:border-border'
              }`}
              data-testid={`button-map-${h}h`}
            >
              {h}h
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-card border border-border hover:bg-muted/40 transition-colors"
            data-testid="button-refresh-map"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/40">
            <Clock className="w-3 h-3" />
            <span>Updated {lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
            <Phone className="w-3 h-3" /> Total Calls
          </p>
          <p className="text-2xl font-bold">{totalCalls.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground/40">in last {hours}h</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-violet-400" /> Destinations
          </p>
          <p className="text-2xl font-bold">{countries.length}</p>
          <p className="text-[10px] text-muted-foreground/40">countries reached</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-cyan-400" /> Top Destination
          </p>
          <p className="text-lg font-bold truncate">{countries[0]?.name ?? '—'}</p>
          <p className={`text-[10px] font-medium ${countries[0] ? 'text-violet-400' : 'text-muted-foreground/40'}`}>
            {countries[0]?.pct.toFixed(1) ?? '0'}% of traffic
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1.5">
            <BarChart2 className="w-3 h-3 text-emerald-400" /> Top 3 Share
          </p>
          <p className="text-2xl font-bold text-emerald-400">
            {countries.slice(0, 3).reduce((s, c) => s + c.pct, 0).toFixed(1)}%
          </p>
          <p className="text-[10px] text-muted-foreground/40">combined</p>
        </div>
      </div>

      {/* Map + Sidebar */}
      <div className="flex gap-4 h-[560px]">
        {/* Map panel */}
        <div className="flex-1 relative bg-slate-900 rounded-xl border border-border shadow-lg overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
              <p className="text-sm text-muted-foreground">Loading map data…</p>
            </div>
          )}

          {/* Hover tooltip */}
          <div className="absolute inset-0 pointer-events-none z-[999]">
            <HoverTooltip row={hovered} />
          </div>

          {geoJson && (
            <MapContainer
              center={[20, 10]}
              zoom={2}
              minZoom={2}
              maxZoom={6}
              style={{ height: '100%', width: '100%', background: '#0f172a' }}
              worldCopyJump
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_matter_no_labels/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                subdomains="abcd"
                maxZoom={19}
              />
              <CountryLayer
                geoJson={geoJson}
                trafficMap={trafficMap}
                onHover={setHovered}
              />
              <MapLegend />
            </MapContainer>
          )}

          {/* Attribution */}
          <div className="absolute bottom-1 left-2 text-[9px] text-white/20 z-[400] pointer-events-none">
            © CartoDB · Natural Earth
          </div>
        </div>

        {/* Top destinations sidebar */}
        <div className="w-72 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-violet-400" />
            <span className="font-semibold text-sm">Top Destinations</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {countries.length === 0 && !trafficLoading && (
              <div className="p-8 text-center">
                <AlertCircle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No CDR data for this period</p>
              </div>
            )}
            {countries.map((row, i) => {
              const barW = Math.max(3, Math.min(100, row.pct * 3));
              const isHovered = hovered?.name === row.name;
              return (
                <div
                  key={row.name}
                  className={`px-4 py-3 transition-colors ${isHovered ? 'bg-violet-500/5' : 'hover:bg-muted/20'}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground/30 w-5 text-right flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground/90 flex-1 truncate">{row.name}</span>
                    <span className="text-xs font-bold text-violet-400 flex-shrink-0">{row.pct.toFixed(1)}%</span>
                  </div>
                  {/* Traffic bar */}
                  <div className="ml-7 h-1.5 rounded-full bg-muted/30 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barW}%`,
                        background: trafficColor(row.pct),
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  {/* Stats row */}
                  <div className="ml-7 flex items-center gap-3 text-[10px] text-muted-foreground/50">
                    <span>{row.calls.toLocaleString()} calls</span>
                    <span className="text-muted-foreground/20">·</span>
                    <span className={row.asr >= 70 ? 'text-emerald-400/70' : row.asr >= 50 ? 'text-amber-400/70' : 'text-red-400/70'}>
                      {row.asr}% ASR
                    </span>
                    <span className="text-muted-foreground/20">·</span>
                    <span>{row.totalMins} min</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 text-[10px] text-muted-foreground/40 flex items-center justify-between">
            <span>{countries.length} destinations</span>
            <span>auto-refreshes 60 s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
