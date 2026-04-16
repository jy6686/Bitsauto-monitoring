// Shared BitsEye-style chart primitives
// All charts across the app should use these constants and components
// to maintain visual consistency with the BitsEye drill-down analytics style.

// ── Grid ──────────────────────────────────────────────────────────────────────
export const BSE_GRID_PROPS = {
  horizontal: true,
  vertical: false,
  stroke: 'rgba(255,255,255,0.05)',
  strokeDasharray: '0',
} as const;

// ── Axis tick style ────────────────────────────────────────────────────────────
export const BSE_TICK = {
  fontSize: 8,
  fill: 'rgba(148,163,184,0.5)',
  fontFamily: 'monospace',
} as const;

export const BSE_AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tick: BSE_TICK,
} as const;

// ── Tooltip cursor ─────────────────────────────────────────────────────────────
export const BSE_CURSOR = {
  stroke: 'rgba(148,163,184,0.2)',
  strokeWidth: 1,
  strokeDasharray: '4 2',
} as const;

// ── Gradient stops helper ──────────────────────────────────────────────────────
// Usage: <defs><linearGradient id="myGrad" x1="0" y1="0" x2="0" y2="1">{bseGradStops('#10b981')}</linearGradient></defs>
export function BseGradStops({ color, primaryOpacity = 0.45 }: { color: string; primaryOpacity?: number }) {
  return (
    <>
      <stop offset="0%"   stopColor={color} stopOpacity={primaryOpacity} />
      <stop offset="75%"  stopColor={color} stopOpacity={0.08} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </>
  );
}

// ── Glassmorphic tooltip ───────────────────────────────────────────────────────
// formatter?: (value, dataKey, payload) => [formattedValue, label]
export function BseTooltip({
  active, payload, label, formatter,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  formatter?: (value: any, dataKey: string, p: any) => [string | number, string];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/50 bg-card/98 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-2xl z-50 min-w-[120px]">
      <p className="font-semibold text-muted-foreground/70 mb-2 truncate max-w-[180px] text-[10px] uppercase tracking-wide font-mono">
        {label}
      </p>
      {payload.map((p: any) => {
        const [val, name] = formatter
          ? formatter(p.value, p.dataKey, p)
          : [p.value, p.name ?? p.dataKey];
        return (
          <div key={p.dataKey + p.name} className="flex items-center justify-between gap-5 py-0.5">
            <span className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-sm inline-block flex-shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-muted-foreground/70 text-[10px]">{name}</span>
            </span>
            <span className="font-mono font-bold text-foreground tabular-nums">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── activeDot style ────────────────────────────────────────────────────────────
// Usage: activeDot={bseActiveDot(color)}
export function bseActiveDot(color: string, r = 4) {
  return { r, fill: color, stroke: 'hsl(var(--card))', strokeWidth: 2 };
}
