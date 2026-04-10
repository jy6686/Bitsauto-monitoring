import { useAlerts } from "@/hooks/use-alerts";
import { AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { formatUTC } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export default function AlertsPage() {
  const { data: alerts, isLoading } = useAlerts();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Alerts</h2>
        <p className="text-muted-foreground mt-1">History of threshold breaches and system warnings.</p>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading alerts...</div>
        ) : (
          alerts?.map((alert) => (
            <div 
              key={alert.id} 
              className={cn(
                "group relative overflow-hidden rounded-xl border p-6 transition-all duration-200 hover:shadow-lg",
                alert.severity === 'critical' 
                  ? "bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40" 
                  : "bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40"
              )}
            >
              <div className="flex items-start gap-4">
                <div className={cn(
                  "p-3 rounded-full flex-shrink-0",
                  alert.severity === 'critical' ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"
                )}>
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-semibold">{alert.type.split('_').join(' ').toUpperCase()}</h3>
                    <span className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border",
                      alert.severity === 'critical' ? "text-rose-500 border-rose-500/30" : "text-amber-500 border-amber-500/30"
                    )}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{alert.message}</p>
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {alert.createdAt && formatUTC(new Date(alert.createdAt), 'MMM d, yyyy HH:mm:ss')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5" />
                      {alert.resolved ? "Resolved" : "Active Incident"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        {alerts?.length === 0 && (
           <div className="text-center py-24 border border-dashed border-border rounded-xl">
              <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                 <CheckCircle className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-medium">All Clear</h3>
              <p className="text-muted-foreground max-w-sm mx-auto mt-2">No alerts have been triggered recently. Your system is running smoothly.</p>
           </div>
        )}
      </div>
    </div>
  );
}
