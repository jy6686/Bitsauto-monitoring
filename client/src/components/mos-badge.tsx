import { cn } from "@/lib/utils";

export function MosBadge({ value }: { value: number }) {
  let colorClass = "bg-gray-500/10 text-gray-500 border-gray-500/20";
  
  if (value >= 4.0) {
    colorClass = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-[0_0_10px_-3px_rgba(16,185,129,0.3)]";
  } else if (value >= 3.0) {
    colorClass = "bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-[0_0_10px_-3px_rgba(245,158,11,0.3)]";
  } else {
    colorClass = "bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-[0_0_10px_-3px_rgba(244,63,94,0.3)]";
  }

  return (
    <div className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border",
      colorClass
    )}>
      MOS: {value.toFixed(2)}
    </div>
  );
}
