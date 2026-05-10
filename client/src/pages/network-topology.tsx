import { Suspense, useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Html, Stars, Line } from "@react-three/drei";
import * as THREE from "three";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Network, RefreshCw, Info, Globe, AlertOctagon,
  Activity, Zap, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CarrierScore {
  id: number;
  carrierId: string;
  carrierName: string;
  stabilityScore: number | null;
  rollingAsr: number | null;
  avgPddMs: number | null;
  failureRate: number | null;
  trend: string | null;
  sampleCount: number;
}

interface FasEvent {
  id: number;
  callId: string;
  caller: string | null;
  callee: string | null;
  vendor: string | null;
  pddSecs: number | null;
  billSecs: number | null;
  sipCode: number | null;
  reason: string | null;
  fraudScore: number | null;
  detectedAt: string | null;
}

interface LiveCall {
  id: string;
  vendor: string | null;
  caller: string;
  callee: string;
  duration: number;
  destCountry: string | null;
  destBreakout: string | null;
}

interface TooltipData {
  name: string;
  stability: number | null;
  asr: number | null;
  pdd: number | null;
  failRate: number | null;
  trend: string | null;
  samples: number;
  hasFasAlert: boolean;
  liveCallCount: number;
  x: number;
  y: number;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function scoreToColor(score: number | null): THREE.Color {
  const s = score ?? 0;
  if (s >= 75) return new THREE.Color(0x22c55e);
  if (s >= 50) return new THREE.Color(0xf59e0b);
  return new THREE.Color(0xef4444);
}

function scoreToEmissive(score: number | null): THREE.Color {
  const s = score ?? 0;
  if (s >= 75) return new THREE.Color(0x166534);
  if (s >= 50) return new THREE.Color(0x78350f);
  return new THREE.Color(0x7f1d1d);
}

// ── Carrier node placement ────────────────────────────────────────────────────

function carrierPosition(index: number, total: number, radius = 5.5): [number, number, number] {
  const angle = (index / total) * Math.PI * 2;
  const yJitter = Math.sin(index * 1.7) * 1.5;
  return [Math.cos(angle) * radius, yJitter, Math.sin(angle) * radius];
}

// ── Traffic particle ──────────────────────────────────────────────────────────

function TrafficParticle({ from, to, color, speed = 1, size = 0.06 }: {
  from: [number, number, number];
  to: [number, number, number];
  color: THREE.Color;
  speed?: number;
  size?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const progress = useRef(Math.random());
  useFrame((_, delta) => {
    progress.current = (progress.current + delta * speed * 0.35) % 1;
    const t = progress.current;
    ref.current.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.5,
      from[2] + (to[2] - from[2]) * t,
    );
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 6, 6]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} />
    </mesh>
  );
}

// ── Route edge ────────────────────────────────────────────────────────────────

function RouteEdge({ from, to, color, opacity = 0.25 }: {
  from: [number, number, number];
  to: [number, number, number];
  color: THREE.Color;
  opacity?: number;
}) {
  const points = useMemo(() => [new THREE.Vector3(...from), new THREE.Vector3(...to)], [from, to]);
  return <Line points={points} color={color} lineWidth={1} transparent opacity={opacity} />;
}

// ── Hub node ──────────────────────────────────────────────────────────────────

function HubNode({ liveCount }: { liveCount: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    ref.current.rotation.y = clock.elapsedTime * 0.35;
    const pulse = 1 + Math.sin(clock.elapsedTime * 1.5) * (0.04 + (liveCount > 0 ? 0.06 : 0));
    ref.current.scale.setScalar(pulse);
  });
  return (
    <group>
      <mesh ref={ref} position={[0, 0, 0]}>
        <octahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial
          color={new THREE.Color(0x7c3aed)}
          emissive={new THREE.Color(liveCount > 0 ? 0x5b21b6 : 0x4c1d95)}
          emissiveIntensity={liveCount > 0 ? 1.2 : 0.8}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      {/* Live call ring */}
      {liveCount > 0 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.9, 0.03, 6, 48]} />
          <meshStandardMaterial color={new THREE.Color(0x7c3aed)} emissive={new THREE.Color(0x7c3aed)} emissiveIntensity={2} transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}

// ── FAS Heat ring ─────────────────────────────────────────────────────────────

function FasHeatRing({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    ref.current.scale.setScalar(1 + Math.sin(t * 2.5) * 0.18);
    if (matRef.current) matRef.current.opacity = 0.35 + Math.sin(t * 3.5) * 0.25;
  });
  return (
    <mesh ref={ref} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.6, 0.055, 6, 40]} />
      <meshStandardMaterial ref={matRef}
        color={new THREE.Color(0xef4444)}
        emissive={new THREE.Color(0x7f1d1d)}
        emissiveIntensity={2.5}
        transparent opacity={0.5}
      />
    </mesh>
  );
}

// ── Live call indicator ───────────────────────────────────────────────────────

function LiveCallIndicator({ position, count }: { position: [number, number, number]; count: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.12);
  });
  return (
    <group position={[position[0], position[1] + 0.7, position[2]]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshStandardMaterial color={new THREE.Color(0x22c55e)} emissive={new THREE.Color(0x14532d)} emissiveIntensity={2} />
      </mesh>
      <Html center distanceFactor={6}>
        <div className="bg-green-500/90 text-white text-[8px] font-bold px-1 py-0 rounded-full -mt-3 select-none">
          {count}
        </div>
      </Html>
    </group>
  );
}

// ── Carrier node ──────────────────────────────────────────────────────────────

function CarrierNode({ carrier, position, onHover, onLeave, onClick, selected, hasFasAlert, liveCallCount }: {
  carrier: CarrierScore;
  position: [number, number, number];
  onHover: (data: TooltipData | null) => void;
  onLeave: () => void;
  onClick: (name: string) => void;
  selected: boolean;
  hasFasAlert: boolean;
  liveCallCount: number;
}) {
  const ref     = useRef<THREE.Mesh>(null!);
  const color   = useMemo(() => scoreToColor(carrier.stabilityScore), [carrier.stabilityScore]);
  const emissive = useMemo(() => scoreToEmissive(carrier.stabilityScore), [carrier.stabilityScore]);
  const { gl }  = useThree();

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.elapsedTime * 1.8 + position[0]) * (0.05 + (liveCallCount > 0 ? 0.04 : 0));
    ref.current.scale.setScalar(selected ? 1.35 : pulse);
  });

  return (
    <group position={position}>
      <mesh ref={ref}
        onClick={() => onClick(carrier.carrierName)}
        onPointerOver={e => {
          e.stopPropagation();
          const rect = gl.domElement.getBoundingClientRect();
          onHover({
            name: carrier.carrierName, stability: carrier.stabilityScore,
            asr: carrier.rollingAsr, pdd: carrier.avgPddMs,
            failRate: carrier.failureRate, trend: carrier.trend,
            samples: carrier.sampleCount, hasFasAlert, liveCallCount,
            x: e.clientX - rect.left, y: e.clientY - rect.top,
          });
        }}
        onPointerOut={() => onLeave()}
      >
        <sphereGeometry args={[0.35, 18, 18]} />
        <meshStandardMaterial
          color={color} emissive={emissive}
          emissiveIntensity={selected ? 1.4 : (liveCallCount > 0 ? 1 : 0.6)}
          roughness={0.3} metalness={0.5}
        />
      </mesh>

      {/* FAS alert ring */}
      {hasFasAlert && <FasHeatRing position={[0, 0, 0]} />}

      {/* Degraded glow ring */}
      {!hasFasAlert && (carrier.stabilityScore ?? 100) < 60 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.46, 0.04, 6, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} transparent opacity={0.7} />
        </mesh>
      )}

      {/* Live call badge */}
      {liveCallCount > 0 && <LiveCallIndicator position={[0, 0, 0]} count={liveCallCount} />}

      {/* Name label */}
      <Text position={[0, -0.58, 0]} fontSize={0.22} color="#94a3b8" anchorX="center" anchorY="top" maxWidth={2.2}>
        {carrier.carrierName.slice(0, 14)}
      </Text>

      {/* Score label */}
      <Text position={[0, 0, 0.41]} fontSize={0.2} color={color.getStyle()} anchorX="center" anchorY="middle">
        {carrier.stabilityScore?.toFixed(0) ?? "?"}
      </Text>
    </group>
  );
}

// ── 3D Scene ──────────────────────────────────────────────────────────────────

function Scene({ scores, selectedCarrier, setSelectedCarrier, setTooltip, fasAffected, liveCallsByCarrier, liveCount }: {
  scores: CarrierScore[];
  selectedCarrier: string | null;
  setSelectedCarrier: (n: string | null) => void;
  setTooltip: (d: TooltipData | null) => void;
  fasAffected: Set<string>;
  liveCallsByCarrier: Map<string, number>;
  liveCount: number;
}) {
  const hub: [number, number, number] = [0, 0, 0];
  const n = scores.length;

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 5, 0]}  intensity={1.4} color={0x7c3aed} />
      <pointLight position={[0, -5, 0]} intensity={0.6} color={0x1e40af} />
      {fasAffected.size > 0 && <pointLight position={[3, 2, 3]} intensity={0.8} color={0xef4444} />}
      <Stars radius={40} depth={30} count={1800} factor={3} fade speed={0.4} />

      <HubNode liveCount={liveCount} />
      <Text position={[0, 0.9, 0]} fontSize={0.22} color="#8b5cf6" anchorX="center">Platform</Text>

      {scores.map((carrier, i) => {
        const pos          = carrierPosition(i, n);
        const color        = scoreToColor(carrier.stabilityScore);
        const isSelected   = selectedCarrier === carrier.carrierName;
        const hasFasAlert  = fasAffected.has(carrier.carrierName);
        const liveCallCount = liveCallsByCarrier.get(carrier.carrierName) ?? 0;

        // Particle count: base 1, +1 per active call, more for high sample count
        const particleCount = Math.min(
          1 + liveCallCount * 2 + Math.ceil(carrier.sampleCount / 50),
          6,
        );

        return (
          <group key={carrier.carrierId}>
            <RouteEdge
              from={hub} to={pos}
              color={hasFasAlert ? new THREE.Color(0xef4444) : color}
              opacity={isSelected ? 0.75 : hasFasAlert ? 0.45 : 0.22}
            />

            {Array.from({ length: particleCount }).map((_, pi) => (
              <TrafficParticle
                key={pi}
                from={hub} to={pos}
                color={liveCallCount > 0 ? new THREE.Color(0x22c55e) : color}
                speed={0.5 + pi * 0.18}
                size={liveCallCount > 0 ? 0.08 : 0.055}
              />
            ))}

            <CarrierNode
              carrier={carrier}
              position={pos}
              onHover={setTooltip}
              onLeave={() => setTooltip(null)}
              onClick={n => setSelectedCarrier(selectedCarrier === n ? null : n)}
              selected={isSelected}
              hasFasAlert={hasFasAlert}
              liveCallCount={liveCallCount}
            />
          </group>
        );
      })}

      <OrbitControls enablePan={false} minDistance={5} maxDistance={20} autoRotate autoRotateSpeed={0.35} />
    </>
  );
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────

function TooltipOverlay({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  const healthLabel = (data.stability ?? 0) >= 75 ? "Healthy" : (data.stability ?? 0) >= 50 ? "Degraded" : "Critical";
  const healthColor = (data.stability ?? 0) >= 75 ? "text-green-400" : (data.stability ?? 0) >= 50 ? "text-amber-400" : "text-red-400";
  return (
    <div className="absolute pointer-events-none z-20 bg-card/95 backdrop-blur-md border border-border/60 rounded-xl px-3 py-2.5 shadow-xl min-w-[170px]"
      style={{ left: data.x + 14, top: data.y - 90 }}>
      <div className="flex items-center gap-2 mb-1.5">
        <p className="font-semibold text-sm">{data.name}</p>
        {data.hasFasAlert && <Badge className="text-[9px] px-1 py-0 bg-red-500/15 text-red-400 border-red-500/30">FAS</Badge>}
        {data.liveCallCount > 0 && <Badge className="text-[9px] px-1 py-0 bg-green-500/15 text-green-400 border-green-500/30">{data.liveCallCount} live</Badge>}
      </div>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status</span><span className={cn("font-medium", healthColor)}>{healthLabel}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Stability</span><span className="font-bold">{data.stability?.toFixed(0) ?? "—"}/100</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">ASR</span><span>{data.asr?.toFixed(1) ?? "—"}%</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Avg PDD</span><span>{data.pdd != null ? `${data.pdd.toFixed(0)}ms` : "—"}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fail Rate</span><span>{data.failRate?.toFixed(1) ?? "—"}%</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Samples</span><span>{data.samples}</span></div>
      </div>
    </div>
  );
}

// ── Selected carrier detail panel ─────────────────────────────────────────────

function DetailPanel({ carrier, fasEvents, liveCallCount, onClose }: {
  carrier: CarrierScore | null;
  fasEvents: FasEvent[];
  liveCallCount: number;
  onClose: () => void;
}) {
  const recentFas = fasEvents.filter(e => e.vendor === carrier?.carrierName).slice(0, 5);
  return (
    <AnimatePresence>
      {carrier && (
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          className="absolute top-4 right-4 w-64 bg-card/95 backdrop-blur-xl border border-border/60 rounded-2xl p-4 shadow-2xl z-20"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-semibold text-sm">{carrier.carrierName}</p>
              <p className="text-xs text-muted-foreground">{carrier.sampleCount} calls · 24h window</p>
            </div>
            <div className="flex items-center gap-1.5">
              {liveCallCount > 0 && (
                <Badge className="text-[9px] px-1.5 py-0 bg-green-500/15 text-green-400 border-green-500/30">
                  {liveCallCount} live
                </Badge>
              )}
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Stability bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Stability Score</span>
              <span className="font-bold">{carrier.stabilityScore?.toFixed(0) ?? "—"}/100</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full",
                  (carrier.stabilityScore ?? 0) >= 75 ? "bg-green-500" :
                  (carrier.stabilityScore ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500")}
                initial={{ width: 0 }}
                animate={{ width: `${carrier.stabilityScore ?? 0}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            {[
              { label: "ASR",       value: carrier.rollingAsr  != null ? `${carrier.rollingAsr.toFixed(1)}%`  : "—" },
              { label: "Avg PDD",   value: carrier.avgPddMs    != null ? `${carrier.avgPddMs.toFixed(0)}ms`   : "—" },
              { label: "Fail Rate", value: carrier.failureRate != null ? `${carrier.failureRate.toFixed(1)}%` : "—" },
              { label: "Trend",     value: carrier.trend ?? "stable" },
            ].map(m => (
              <div key={m.label} className="rounded-lg bg-muted/30 p-2 text-center">
                <p className="text-muted-foreground text-[10px]">{m.label}</p>
                <p className="font-bold mt-0.5">{m.value}</p>
              </div>
            ))}
          </div>

          {/* FAS events for this carrier */}
          {recentFas.length > 0 && (
            <div className="border-t border-border/40 pt-3">
              <p className="text-[10px] text-red-400/80 uppercase tracking-widest font-bold mb-2 flex items-center gap-1">
                <AlertOctagon className="h-2.5 w-2.5" />
                Recent FAS Events ({recentFas.length})
              </p>
              <div className="space-y-1.5">
                {recentFas.map(e => (
                  <div key={e.id} className="rounded-lg bg-red-500/8 border border-red-500/20 px-2 py-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="font-mono text-red-300/70">{e.caller ?? "—"}</span>
                      <span className="text-red-400 font-bold">{e.fraudScore?.toFixed(0)}</span>
                    </div>
                    {e.reason && <p className="text-[9px] text-muted-foreground/50 mt-0.5">{e.reason.split(",")[0]}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Incident feed (bottom-left panel) ────────────────────────────────────────

function IncidentFeed({ fasEvents, liveCount, expanded, onToggle }: {
  fasEvents: FasEvent[];
  liveCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const recent = fasEvents.slice(0, 6);
  return (
    <div className="absolute bottom-4 left-4 w-60 z-20">
      <motion.div
        className="bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl"
        animate={{ height: "auto" }}
      >
        {/* Header */}
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.04] transition-colors"
        >
          <AlertOctagon className="h-3.5 w-3.5 text-red-400 shrink-0" />
          <span className="text-xs font-semibold text-left flex-1">Live Incidents</span>
          {recent.length > 0 && (
            <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full border border-red-500/30">
              {recent.length}
            </span>
          )}
          {liveCount > 0 && (
            <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full border border-green-500/30">
              {liveCount} live
            </span>
          )}
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronUp className="h-3 w-3 text-muted-foreground" />}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-3 pb-3 space-y-1.5">
                {recent.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/40 text-center py-3">
                    No FAS events detected
                  </p>
                ) : (
                  recent.map(e => (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg border border-red-500/20 bg-red-500/8 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-red-300/70 truncate flex-1">{e.caller ?? "?"}</span>
                        <span className="text-[9px] text-red-400 font-bold shrink-0">
                          {e.fraudScore?.toFixed(0) ?? "?"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-muted-foreground/50 truncate">
                          {e.vendor ?? "Unknown"} · {e.reason?.split(",")[0] ?? "—"}
                        </span>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NetworkTopologyPage() {
  const [tooltip,         setTooltip]         = useState<TooltipData | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);
  const [feedExpanded,    setFeedExpanded]    = useState(true);

  // Carrier quality scores (primary nodes)
  const { data: scores = [], isLoading, refetch } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Vendor fallback when no scores yet
  const { data: vendorData, isLoading: vendorsLoading } = useQuery<{ vendors: any[] }>({
    queryKey: ["/api/sippy/vendors"],
    staleTime: 300_000,
    enabled: scores.length === 0,
  });

  // FAS events — last 200 for incident feed + heat map
  const { data: fasEvents = [] } = useQuery<FasEvent[]>({
    queryKey: ["/api/fas-events"],
    queryFn: () => fetch("/api/fas-events?limit=200").then(r => r.json()).catch(() => []),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Live calls for traffic intensity
  const { data: liveCallsData } = useQuery<{ calls: LiveCall[] }>({
    queryKey: ["/api/sippy/live-calls"],
    queryFn: () => fetch("/api/sippy/live-calls").then(r => r.json()).catch(() => ({ calls: [] })),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // Synthesise carrier scores from vendor list if none exist
  const vendorScores: CarrierScore[] = useMemo(() => {
    if (scores.length > 0) return [];
    return (vendorData?.vendors ?? []).map((v: any, i: number) => ({
      id: v.iVendor ?? i,
      carrierId: String(v.iVendor ?? i),
      carrierName: v.name ?? `Vendor ${i + 1}`,
      stabilityScore: null, rollingAsr: null, avgPddMs: null, failureRate: null, trend: null, sampleCount: 0,
    }));
  }, [scores.length, vendorData]);

  const displayScores = scores.length > 0 ? scores : vendorScores;
  const usingFallback = scores.length === 0 && vendorScores.length > 0;

  // FAS-affected carriers (events in last 24h)
  const fasAffected = useMemo(() => {
    const cut24 = Date.now() - 24 * 3600_000;
    const set = new Set<string>();
    fasEvents
      .filter(e => new Date(e.detectedAt ?? 0).getTime() >= cut24)
      .forEach(e => { if (e.vendor) set.add(e.vendor); });
    return set;
  }, [fasEvents]);

  // Live calls per carrier
  const liveCallsByCarrier = useMemo(() => {
    const map = new Map<string, number>();
    (liveCallsData?.calls ?? []).forEach(c => {
      const v = c.vendor ?? "Unknown";
      map.set(v, (map.get(v) ?? 0) + 1);
    });
    return map;
  }, [liveCallsData]);

  const totalLiveCalls = liveCallsData?.calls?.length ?? 0;
  const selected   = displayScores.find(s => s.carrierName === selectedCarrier) ?? null;
  const healthy    = displayScores.filter(s => (s.stabilityScore ?? 0) >= 75).length;
  const degraded   = displayScores.filter(s => { const v = s.stabilityScore ?? 100; return v >= 50 && v < 75; }).length;
  const critical   = displayScores.filter(s => (s.stabilityScore ?? 100) < 50).length;
  const fasCount   = fasAffected.size;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border/50 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-semibold">3D Network Topology</h1>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30">New</span>
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {healthy > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{healthy} healthy
            </span>
          )}
          {degraded > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{degraded} degraded
            </span>
          )}
          {critical > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />{critical} critical
            </span>
          )}
          {fasCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-600/10 border border-red-600/30 text-red-300">
              <AlertOctagon className="h-3 w-3" />{fasCount} FAS alert{fasCount !== 1 ? "s" : ""}
            </span>
          )}
          {totalLiveCalls > 0 && (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-300">
              <Activity className="h-3 w-3" />{totalLiveCalls} live call{totalLiveCalls !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          <span className="hidden sm:block">
            {usingFallback ? "Showing Sippy vendors — run campaign for quality data" : "Drag · Scroll · Click node"}
          </span>
        </div>
        <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground">
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </button>
      </div>

      {/* 3D Canvas */}
      <div className="flex-1 relative bg-[#06080f]">
        {displayScores.length === 0 && !isLoading && !vendorsLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            No vendor data — check Sippy connection
          </div>
        ) : (
          <>
            {usingFallback && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 text-xs text-amber-300 text-center pointer-events-none">
                Showing live Sippy vendors — run a test campaign to populate carrier quality scores
              </div>
            )}

            <Canvas camera={{ position: [0, 4, 13], fov: 55 }} gl={{ antialias: true, alpha: false }}>
              <color attach="background" args={["#06080f"]} />
              <Suspense fallback={null}>
                <Scene
                  scores={displayScores}
                  selectedCarrier={selectedCarrier}
                  setSelectedCarrier={setSelectedCarrier}
                  setTooltip={setTooltip}
                  fasAffected={fasAffected}
                  liveCallsByCarrier={liveCallsByCarrier}
                  liveCount={totalLiveCalls}
                />
              </Suspense>
            </Canvas>

            <TooltipOverlay data={tooltip} />
            <DetailPanel
              carrier={selected}
              fasEvents={fasEvents}
              liveCallCount={selected ? (liveCallsByCarrier.get(selected.carrierName) ?? 0) : 0}
              onClose={() => setSelectedCarrier(null)}
            />
            <IncidentFeed
              fasEvents={fasEvents}
              liveCount={totalLiveCalls}
              expanded={feedExpanded}
              onToggle={() => setFeedExpanded(v => !v)}
            />

            {/* Legend */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 text-[10px] text-muted-foreground bg-black/50 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/[0.06] z-10">
              <p className="font-bold uppercase tracking-widest mb-0.5 text-muted-foreground/60">Legend</p>
              {[
                { color: "bg-green-500",  label: "Healthy (≥75)"  },
                { color: "bg-amber-500",  label: "Degraded (50–74)" },
                { color: "bg-red-500",    label: "Critical (<50)" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full flex-shrink-0", l.color)} />{l.label}
                </div>
              ))}
              <div className="border-t border-white/10 mt-1 pt-1.5 space-y-1">
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />Platform Hub</div>
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse" />FAS alert</div>
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />Live call</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
