import { LucideIcon, ArrowUp, ArrowDown, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean; // good is true (e.g. up for calls, down for latency)
  };
  className?: string;
  description?: string;
}

export function StatCard({ title, value, icon: Icon, trend, className, description }: StatCardProps) {
  return (
    <div className={cn(
      "bg-card border border-border/50 rounded-xl p-6 shadow-lg shadow-black/5 hover:border-border transition-all duration-300 relative overflow-hidden group",
      className
    )}>
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-500 transform group-hover:scale-110">
        <Icon className="w-24 h-24" />
      </div>

      <div className="flex items-center justify-between mb-4 relative z-10">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className="p-2 bg-secondary/50 rounded-lg group-hover:bg-primary/10 transition-colors">
          <Icon className="w-4 h-4 text-foreground group-hover:text-primary" />
        </div>
      </div>

      <div className="space-y-1 relative z-10">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight tabular-nums">{value}</span>
          {trend && (
            <span className={cn(
              "text-xs font-medium flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-opacity-10",
              trend.isPositive ? "text-emerald-400 bg-emerald-400/10" : "text-rose-400 bg-rose-400/10"
            )}>
              {trend.value > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(trend.value)}%
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
