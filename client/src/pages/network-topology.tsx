import { Suspense, useRef, useState, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Html, Stars, Line } from "@react-three/drei";
import * as THREE from "three";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Network, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Info, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

interface TooltipData {
  name: string;
  stability: number | null;
  asr: number | null;
  pdd: number | null;
  failRate: number | null;
  trend: string | null;
  samples: number;
  x: number;
  y: number;
}

// ── Color helpers ──────────────────────────────────────────────────────────────

function scoreToColor(score: number | null): THREE.Color {
  const s = score ?? 0;
  if (s >= 75) return new THREE.Color(0x22c55e);  // green-500
  if (s >= 50) return new THREE.Color(0xf59e0b);  // amber-500
  return new THREE.Color(0xef4444);               // red-500
}

function scoreToEmissive(score: number | null): THREE.Color {
  const s = score ?? 0;
  if (s >= 75) return new THREE.Color(0x166534);
  if (s >= 50) return new THREE.Color(0x78350f);
  return new THREE.Color(0x7f1d1d);
}

// ── Carrier node placement ─────────────────────────────────────────────────────

function carrierPosition(index: number, total: number, radius = 5): [number, number, number] {
  const angle = (index / total) * Math.PI * 2;
  return [Math.cos(angle) * radius, (Math.sin(index * 1.3) * 1.2), Math.sin(angle) * radius];
}

// ── Animated traffic particle ─────────────────────────────────────────────────

function TrafficParticle({ from, to, color, speed = 1 }: {
  from: [number, number, number];
  to:   [number, number, number];
  color: THREE.Color;
  speed?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const progress = useRef(Math.random()); // stagger start

  useFrame((_, delta) => {
    progress.current = (progress.current + delta * speed * 0.35) % 1;
    const t = progress.current;
    ref.current.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.4,
      from[2] + (to[2] - from[2]) * t,
    );
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.06, 6, 6]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
    </mesh>
  );
}

// ── Edge (route line) ─────────────────────────────────────────────────────────

function RouteEdge({ from, to, color, opacity = 0.35 }: {
  from: [number, number, number];
  to:   [number, number, number];
  color: THREE.Color;
  opacity?: number;
}) {
  const points = useMemo(
    () => [new THREE.Vector3(...from), new THREE.Vector3(...to)],
    [from, to]
  );
  return (
    <Line
      points={points}
      color={color}
      lineWidth={1}
      transparent
      opacity={opacity}
    />
  );
}

// ── Hub node (Platform center) ─────────────────────────────────────────────────

function HubNode() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    ref.current.rotation.y = clock.elapsedTime * 0.3;
    const s = 1 + Math.sin(clock.elapsedTime * 1.5) * 0.04;
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref} position={[0, 0, 0]}>
      <octahedronGeometry args={[0.5, 1]} />
      <meshStandardMaterial
        color={new THREE.Color(0x7c3aed)}
        emissive={new THREE.Color(0x4c1d95)}
        emissiveIntensity={0.8}
        wireframe={false}
        roughness={0.2}
        metalness={0.8}
      />
    </mesh>
  );
}

// ── Carrier node ──────────────────────────────────────────────────────────────

function CarrierNode({ carrier, position, onHover, onLeave, onClick, selected }: {
  carrier: CarrierScore;
  position: [number, number, number];
  onHover: (data: TooltipData | null) => void;
  onLeave: () => void;
  onClick: (name: string) => void;
  selected: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const color   = useMemo(() => scoreToColor(carrier.stabilityScore), [carrier.stabilityScore]);
  const emissive = useMemo(() => scoreToEmissive(carrier.stabilityScore), [carrier.stabilityScore]);

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.elapsedTime * 1.8 + position[0]) * 0.05;
    ref.current.scale.setScalar(selected ? 1.35 : pulse);
  });

  const { gl } = useThree();

  return (
    <group position={position}>
      <mesh
        ref={ref}
        onClick={() => onClick(carrier.carrierName)}
        onPointerOver={e => {
          e.stopPropagation();
          const rect = gl.domElement.getBoundingClientRect();
          onHover({
            name: carrier.carrierName,
            stability: carrier.stabilityScore,
            asr: carrier.rollingAsr,
            pdd: carrier.avgPddMs,
            failRate: carrier.failureRate,
            trend: carrier.trend,
            samples: carrier.sampleCount,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
        }}
        onPointerOut={() => onLeave()}
      >
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={selected ? 1.2 : 0.6}
          roughness={0.3}
          metalness={0.5}
        />
      </mesh>

      {/* Glow ring for degraded/critical */}
      {(carrier.stabilityScore ?? 100) < 60 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.42, 0.04, 6, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={1.5}
            transparent
            opacity={0.7}
          />
        </mesh>
      )}

      <Text
        position={[0, -0.55, 0]}
        fontSize={0.22}
        color="#94a3b8"
        anchorX="center"
        anchorY="top"
        maxWidth={2}
      >
        {carrier.carrierName.slice(0, 14)}
      </Text>

      <Text
        position={[0, 0, 0.38]}
        fontSize={0.2}
        color={color.getStyle()}
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {carrier.stabilityScore?.toFixed(0) ?? "?"}
      </Text>
    </group>
  );
}

// ── Scene ──────────────────────────────────────────────────────────────────────

function Scene({ scores, selectedCarrier, setSelectedCarrier, setTooltip }: {
  scores: CarrierScore[];
  selectedCarrier: string | null;
  setSelectedCarrier: (n: string | null) => void;
  setTooltip: (d: TooltipData | null) => void;
}) {
  const hub: [number, number, number] = [0, 0, 0];
  const n = scores.length;

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 4, 0]} intensity={1.2} color={0x7c3aed} />
      <pointLight position={[0, -4, 0]} intensity={0.5} color={0x1e40af} />
      <Stars radius={40} depth={30} count={1500} factor={3} fade speed={0.5} />

      <HubNode />
      <Text position={[0, 0.75, 0]} fontSize={0.2} color="#8b5cf6" anchorX="center">Platform</Text>

      {scores.map((carrier, i) => {
        const pos = carrierPosition(i, n);
        const color = scoreToColor(carrier.stabilityScore);
        const isSelected = selectedCarrier === carrier.carrierName;
        return (
          <group key={carrier.carrierId}>
            <RouteEdge
              from={hub}
              to={pos}
              color={color}
              opacity={isSelected ? 0.7 : 0.22}
            />
            {/* Traffic particles — more for higher sample count */}
            {Array.from({ length: Math.min(Math.ceil(carrier.sampleCount / 3) + 1, 4) }).map((_, pi) => (
              <TrafficParticle
                key={pi}
                from={hub}
                to={pos}
                color={color}
                speed={0.6 + pi * 0.2}
              />
            ))}
            <CarrierNode
              carrier={carrier}
              position={pos}
              onHover={setTooltip}
              onLeave={() => setTooltip(null)}
              onClick={n => setSelectedCarrier(selectedCarrier === n ? null : n)}
              selected={isSelected}
            />
          </group>
        );
      })}

      <OrbitControls enablePan={false} minDistance={4} maxDistance={18} autoRotate autoRotateSpeed={0.4} />
    </>
  );
}

// ── Tooltip overlay ───────────────────────────────────────────────────────────

function TooltipOverlay({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  const healthLabel = (data.stability ?? 0) >= 75 ? "Healthy" : (data.stability ?? 0) >= 50 ? "Degraded" : "Critical";
  const healthColor = (data.stability ?? 0) >= 75 ? "text-green-400" : (data.stability ?? 0) >= 50 ? "text-amber-400" : "text-red-400";
  return (
    <div
      className="absolute pointer-events-none z-20 bg-card/95 backdrop-blur-md border border-border/60 rounded-xl px-3 py-2.5 shadow-xl min-w-[160px]"
      style={{ left: data.x + 12, top: data.y - 80 }}
    >
      <p className="font-semibold text-sm mb-1.5">{data.name}</p>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Status</span>
          <span className={cn("font-medium", healthColor)}>{healthLabel}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Stability</span>
          <span className="font-bold">{data.stability?.toFixed(0) ?? "—"}/100</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">ASR</span>
          <span>{data.asr?.toFixed(1) ?? "—"}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Avg PDD</span>
          <span>{data.pdd != null ? `${data.pdd.toFixed(0)}ms` : "—"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Fail Rate</span>
          <span>{data.failRate?.toFixed(1) ?? "—"}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Samples</span>
          <span>{data.samples}</span>
        </div>
      </div>
    </div>
  );
}

// ── Selected carrier detail panel ─────────────────────────────────────────────

function DetailPanel({ carrier, onClose }: { carrier: CarrierScore | null; onClose: () => void }) {
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
              <p className="text-xs text-muted-foreground">24h window · {carrier.sampleCount} calls</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">✕</button>
          </div>

          {/* Stability bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Stability Score</span>
              <span className="font-bold">{carrier.stabilityScore?.toFixed(0) ?? "—"}/100</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full", (carrier.stabilityScore ?? 0) >= 75 ? "bg-green-500" : (carrier.stabilityScore ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500")}
                initial={{ width: 0 }}
                animate={{ width: `${carrier.stabilityScore ?? 0}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NetworkTopologyPage() {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);

  const { data: scores = [], isLoading, refetch } = useQuery<CarrierScore[]>({
    queryKey: ["/api/carrier-scores", 24],
    queryFn: () => fetch("/api/carrier-scores?window=24").then(r => r.json()),
    refetchInterval: 120_000,
  });

  const scores24   = scores;
  const selected   = scores24.find(s => s.carrierName === selectedCarrier) ?? null;
  const healthy    = scores24.filter(s => (s.stabilityScore ?? 0) >= 75).length;
  const degraded   = scores24.filter(s => { const v = s.stabilityScore ?? 100; return v >= 50 && v < 75; }).length;
  const critical   = scores24.filter(s => (s.stabilityScore ?? 100) < 50).length;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border/50 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-semibold">3D Network Topology</h1>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/30 tracking-wide">New</span>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{healthy} healthy
          </span>
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
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          <span>Drag to rotate · Scroll to zoom · Click node for detail</span>
        </div>

        <button
          onClick={() => refetch()}
          className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative bg-[#06080f]">
        {scores24.length === 0 && !isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            No carrier scores yet — run a synthetic test campaign to populate the topology
          </div>
        ) : (
          <>
            <Canvas camera={{ position: [0, 4, 12], fov: 55 }} gl={{ antialias: true, alpha: false }}>
              <color attach="background" args={["#06080f"]} />
              <Suspense fallback={null}>
                <Scene
                  scores={scores24}
                  selectedCarrier={selectedCarrier}
                  setSelectedCarrier={setSelectedCarrier}
                  setTooltip={setTooltip}
                />
              </Suspense>
            </Canvas>

            <TooltipOverlay data={tooltip} />
            <DetailPanel carrier={selected} onClose={() => setSelectedCarrier(null)} />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 text-[10px] text-muted-foreground bg-black/40 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/[0.06]">
              <p className="font-bold uppercase tracking-widest mb-1 text-muted-foreground/60">Stability</p>
              {[
                { color: "bg-green-500", label: "Healthy (≥75)" },
                { color: "bg-amber-500", label: "Degraded (50–74)" },
                { color: "bg-red-500",   label: "Critical (<50)" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full flex-shrink-0", l.color)} />
                  {l.label}
                </div>
              ))}
              <div className="border-t border-white/10 mt-1 pt-1.5">
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />Platform Hub</div>
                <div className="flex items-center gap-2 mt-1"><span className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0" />Traffic flow</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
