import { useState, useEffect } from "react";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-client';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Globe, RefreshCw, Loader2, BarChart2, Clock, Phone, TrendingUp, AlertCircle, MapPin,
  Activity, Timer, CheckCircle2, X, CalendarDays,
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
  if (pct >= 30) return '#7c3aed';
  if (pct >= 20) return '#8b5cf6';
  if (pct >= 10) return '#6366f1';
  if (pct >=  5) return '#3b82f6';
  if (pct >=  2) return '#06b6d4';
  if (pct >=  0.5) return '#10b981';
  return '#1e293b';
}

function trafficOpacity(pct: number): number {
  if (pct >= 20) return 0.92;
  if (pct >= 10) return 0.85;
  if (pct >=  5) return 0.75;
  if (pct >=  2) return 0.65;
  if (pct >=  0.5) return 0.55;
  return 0.18;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

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

// ─── Country Layer (raw Leaflet, reliable style updates + fly-to) ─────────────

interface CountryLayerProps {
  geoJson: GeoJSON.FeatureCollection;
  trafficMap: Map<string, CountryRow>;
  onHover: (row: CountryRow | null) => void;
  onClick: (row: CountryRow) => void;
  flyToTarget: string | null;          // country name to fly to
  onFlyComplete: () => void;
}

function CountryLayer({ geoJson, trafficMap, onHover, onClick, flyToTarget, onFlyComplete }: CountryLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  // name → bounds, also numericId → bounds
  const boundsMapRef = useRef<Map<string, L.LatLngBounds>>(new Map());

  // Build / rebuild the GeoJSON layer whenever geoJson or trafficMap changes
  useEffect(() => {
    if (!map) return;

    // Remove existing layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    boundsMapRef.current.clear();

    const layer = L.geoJSON(geoJson, {
      style: (feature?: GeoJSON.Feature): L.PathOptions => {
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
      },
      onEachFeature: (feature: GeoJSON.Feature, l: L.Layer) => {
        const id = String(feature.id ?? '');
        const row = trafficMap.get(id);

        // Store bounds for fly-to (by numeric ID and by name)
        try {
          const bounds = (l as L.Polygon).getBounds();
          if (bounds && bounds.isValid()) {
            boundsMapRef.current.set(id, bounds);
            if (row?.name) boundsMapRef.current.set(row.name.toLowerCase(), bounds);
          }
        } catch { /* not a polygon */ }

        (l as L.Path).on({
          mouseover: (e) => {
            const target = e.target as L.Path;
            const curOpacity = row ? trafficOpacity(row.pct) : 0.08;
            target.setStyle({ weight: 2.5, color: '#fff', fillOpacity: Math.min(1, curOpacity + 0.15) });
            target.bringToFront();
            onHover(row ?? null);
          },
          mouseout: (e) => {
            layer.resetStyle(e.target);
            onHover(null);
          },
          click: () => {
            if (row) {
              onHover(row);
              onClick(row);
            }
          },
        });

        // Tooltip on hover
        if (row) {
          l.bindTooltip(
            `<div style="font-weight:700;font-size:13px;margin-bottom:4px;">${row.name}</div>` +
            `<div style="font-size:11px;opacity:0.8;">${row.pct.toFixed(1)}% · ${row.calls.toLocaleString()} calls · ${row.asr}% ASR</div>`,
            { sticky: true, className: 'leaflet-traffic-tooltip' }
          );
        }
      },
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (map && layer) map.removeLayer(layer);
    };
  }, [geoJson, trafficMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to country when flyToTarget changes
  useEffect(() => {
    if (!flyToTarget || !map) return;
    const key = flyToTarget.toLowerCase();
    const bounds = boundsMapRef.current.get(key);
    if (bounds && bounds.isValid()) {
      map.flyToBounds(bounds.pad(0.25), { duration: 1.2, maxZoom: 6 });
    }
    onFlyComplete();
  }, [flyToTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── Hover tooltip overlay ────────────────────────────────────────────────────

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

// ─── Period presets ───────────────────────────────────────────────────────────

const PERIOD_PRESETS = [
  { label: '3h',        hours: 3   },
  { label: '6h',        hours: 6   },
  { label: '12h',       hours: 12  },
  { label: '24h',       hours: 24  },
  { label: '48h',       hours: 48  },
  { label: '72h',       hours: 72  },
];

// ─── Country Detail Panel ─────────────────────────────────────────────────────

function CountryDetailPanel({ row, hours, onClose }: { row: CountryRow; hours: number; onClose: () => void }) {
  const formatMins = (m: number) => {
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m} min`;
  };
  const formatDur = (s: number) => {
    if (s <= 0) return '—';
    const m = Math.floor(s / 60), sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };
  const asrColor = row.asr >= 70 ? 'text-emerald-400' : row.asr >= 50 ? 'text-amber-400' : 'text-red-400';
  const asrBg    = row.asr >= 70 ? 'bg-emerald-500/10 border-emerald-500/20' : row.asr >= 50 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div className="bg-card border border-violet-500/30 rounded-xl overflow-hidden shadow-xl ring-1 ring-violet-500/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-violet-500/10 border-b border-violet-500/20">
        <div className="flex items-center gap-2.5">
          <MapPin className="w-4 h-4 text-violet-400 animate-pulse" />
          <span className="font-bold text-base text-violet-200">{row.name}</span>
          <span className="text-[10px] text-violet-400/60 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
            {hours}h window
          </span>
        </div>
        <button
          onClick={onClose}
          data-testid="button-close-country-detail"
          className="text-muted-foreground/50 hover:text-foreground transition-colors p-1 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
        <div className="bg-muted/20 border border-border/40 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
            <Phone className="w-3 h-3" /> Total Calls
          </div>
          <p className="text-xl font-bold">{row.calls.toLocaleString()}</p>
          <p className="text-[10px] text-violet-400 font-medium">{row.pct.toFixed(1)}% of traffic</p>
        </div>

        <div className={`border rounded-lg p-3 space-y-1 ${asrBg}`}>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
            <CheckCircle2 className="w-3 h-3" /> Answered
          </div>
          <p className={`text-xl font-bold ${asrColor}`}>{row.answered.toLocaleString()}</p>
          <p className={`text-[10px] font-semibold ${asrColor}`}>ASR: {row.asr}%</p>
        </div>

        <div className="bg-muted/20 border border-border/40 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
            <Activity className="w-3 h-3 text-cyan-400" /> Total Minutes
          </div>
          <p className="text-xl font-bold text-cyan-300">{formatMins(row.totalMins)}</p>
          <p className="text-[10px] text-muted-foreground/40">{row.totalMins.toLocaleString()} raw mins</p>
        </div>

        <div className="bg-muted/20 border border-border/40 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
            <Timer className="w-3 h-3 text-amber-400" /> Avg Duration
          </div>
          <p className="text-xl font-bold text-amber-300">{formatDur(row.avgDurSecs)}</p>
          <p className="text-[10px] text-muted-foreground/40">per answered call</p>
        </div>
      </div>

      {/* Traffic share bar */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 mb-1.5">
          <span>Traffic share</span>
          <span className="text-violet-400 font-bold">{row.pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, row.pct * 3)}%`,
              background: `linear-gradient(90deg, #7c3aed, #06b6d4)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function TrafficMapPage() {
  const [hours, setHours] = useState(24);
  const [hovered, setHovered] = useState<CountryRow | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<string | null>(null);
  const [activeDestination, setActiveDestination] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<CountryRow | null>(null);

  const { data: traffic, isLoading: trafficLoading, refetch, dataUpdatedAt } = useQuery<TrafficData>({
    queryKey: ['/api/traffic-map', hours],
    queryFn: () => fetch(`/api/traffic-map?hours=${hours}`).then(r => r.json()),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: topoJson, isLoading: topoLoading } = useQuery({
    queryKey: ['/api/geo/world'],
    queryFn: () => fetch('/api/geo/world').then(r => r.json()),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const geoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!topoJson) return null;
    try {
      const topo = topoJson as Topology;
      return topojson.feature(topo, topo.objects.countries as GeometryCollection) as GeoJSON.FeatureCollection;
    } catch {
      return null;
    }
  }, [topoJson]);

  const trafficMap = useMemo<Map<string, CountryRow>>(() => {
    const m = new Map<string, CountryRow>();
    for (const row of traffic?.countries ?? []) {
      if (row.numericId) m.set(row.numericId, row);
    }
    return m;
  }, [traffic]);

  const countries  = traffic?.countries ?? [];
  const totalCalls = traffic?.total ?? 0;
  const isLoading  = trafficLoading || topoLoading;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '—';

  function handleDestinationClick(row: CountryRow) {
    setActiveDestination(row.name);
    setFlyToTarget(row.name);
    setSelectedRow(row);
  }

  return (
    <div className="space-y-4">
      {/* Tooltip CSS injected inline */}
      <style>{`.leaflet-traffic-tooltip { background: rgba(15,23,42,0.95) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 8px !important; color: #fff !important; font-size: 11px !important; padding: 8px 12px !important; box-shadow: 0 4px 24px rgba(0,0,0,0.5) !important; } .leaflet-traffic-tooltip::before { display:none; }`}</style>

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
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarDays className="w-3 h-3" /> Period:
          </span>
          {PERIOD_PRESETS.map(({ label, hours: h }) => (
            <button
              key={label}
              onClick={() => setHours(h)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                hours === h
                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                  : 'text-muted-foreground border-border/50 hover:border-border'
              }`}
              data-testid={`button-map-${label}`}
            >
              {label}
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

          {/* Hover tooltip overlay */}
          <div className="absolute inset-0 pointer-events-none z-[999]">
            <HoverTooltip row={hovered} />
          </div>

          {geoJson && (
            <MapContainer
              center={[20, 10]}
              zoom={2}
              minZoom={2}
              maxZoom={7}
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
                onClick={handleDestinationClick}
                flyToTarget={flyToTarget}
                onFlyComplete={() => setFlyToTarget(null)}
              />
              <MapLegend />
            </MapContainer>
          )}

          <div className="absolute bottom-1 left-2 text-[9px] text-white/20 z-[400] pointer-events-none">
            © CartoDB · Natural Earth
          </div>
        </div>

        {/* Top destinations sidebar */}
        <div className="w-72 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-violet-400" />
            <span className="font-semibold text-sm">Top Destinations</span>
            <span className="ml-auto text-[10px] text-muted-foreground/40 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> click to locate
            </span>
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
              const isActive = activeDestination === row.name;
              const isHov    = hovered?.name === row.name;
              return (
                <button
                  key={row.name}
                  type="button"
                  data-testid={`destination-row-${i}`}
                  onClick={() => handleDestinationClick(row)}
                  className={`w-full text-left px-4 py-3 transition-all group ${
                    isActive
                      ? 'bg-violet-500/10 border-l-2 border-violet-500'
                      : isHov
                        ? 'bg-violet-500/5'
                        : 'hover:bg-muted/20 border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground/30 w-5 text-right flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className={`text-sm font-medium flex-1 truncate transition-colors ${isActive ? 'text-violet-300' : 'text-foreground/90 group-hover:text-foreground'}`}>
                      {row.name}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isActive && <MapPin className="w-3 h-3 text-violet-400 animate-bounce" />}
                      <span className="text-xs font-bold text-violet-400">{row.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  {/* Traffic bar */}
                  <div className="ml-7 h-1.5 rounded-full bg-muted/30 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${barW}%`,
                        background: trafficColor(row.pct),
                        opacity: isActive ? 1 : 0.8,
                      }}
                    />
                  </div>
                  {/* Stats */}
                  <div className="ml-7 flex items-center gap-3 text-[10px] text-muted-foreground/50">
                    <span>{row.calls.toLocaleString()} calls</span>
                    <span className="text-muted-foreground/20">·</span>
                    <span className={row.asr >= 70 ? 'text-emerald-400/70' : row.asr >= 50 ? 'text-amber-400/70' : 'text-red-400/70'}>
                      {row.asr}% ASR
                    </span>
                    <span className="text-muted-foreground/20">·</span>
                    <span>{row.totalMins} min</span>
                  </div>
                </button>
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

      {/* Country detail drill-down panel — appears when a destination is selected */}
      {selectedRow && (
        <CountryDetailPanel
          row={selectedRow}
          hours={hours}
          onClose={() => { setSelectedRow(null); setActiveDestination(null); }}
        />
      )}
    </div>
  );
}
