import { useSettings, useUpdateSettings, useResetSimulation } from "@/hooks/use-settings";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema } from "@shared/schema";
import { z } from "zod";
import { Loader2, Save, RefreshCw } from "lucide-react";

// Only picking what we need for the form
const formSchema = insertSettingsSchema.pick({
  jitterThreshold: true,
  latencyThreshold: true,
  packetLossThreshold: true,
  simulationEnabled: true,
  monitoredIp: true,
});

type FormValues = z.infer<typeof formSchema>;

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const resetMutation = useResetSimulation();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: settings || {
      jitterThreshold: 30,
      latencyThreshold: 150,
      packetLossThreshold: 1.0,
      simulationEnabled: true,
      monitoredIp: '45.59.163.182',
    },
  });

  const onSubmit = (data: FormValues) => {
    updateMutation.mutate(data);
  };

  if (isLoading) return <div className="p-8">Loading settings...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Configuration</h2>
        <p className="text-muted-foreground mt-1">Adjust monitoring thresholds and simulation parameters.</p>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm p-6 md:p-8">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div className="grid gap-6">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Monitored IP Address</label>
              <p className="text-xs text-muted-foreground">
                IP address to probe for live call extraction and real latency measurements.
              </p>
              <input 
                {...form.register("monitoredIp")}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="text"
                placeholder="e.g. 45.59.163.182"
                data-testid="input-monitored-ip"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Jitter Threshold (ms)</label>
              <p className="text-xs text-muted-foreground">Alert when jitter exceeds this value.</p>
              <input 
                {...form.register("jitterThreshold", { valueAsNumber: true })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="number"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Latency Threshold (ms)</label>
              <p className="text-xs text-muted-foreground">Alert when round-trip delay exceeds this value.</p>
              <input 
                {...form.register("latencyThreshold", { valueAsNumber: true })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="number"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Packet Loss Threshold (%)</label>
              <p className="text-xs text-muted-foreground">Alert when packet loss percentage exceeds this value.</p>
              <input 
                {...form.register("packetLossThreshold", { valueAsNumber: true })}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                type="number"
                step="0.1"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
              <div>
                <label className="text-sm font-medium block">Simulation Enabled</label>
                <p className="text-xs text-muted-foreground mt-0.5">Generate synthetic VoIP traffic.</p>
              </div>
              <input 
                {...form.register("simulationEnabled")}
                type="checkbox"
                className="h-5 w-5 rounded border-border bg-background text-primary focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4 border-t border-border/50">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>

      <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-destructive">Danger Zone</h3>
          <p className="text-sm text-destructive/80 mt-1">Reset all simulation data and clear alerts.</p>
        </div>
        <button
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Reset Simulation
        </button>
      </div>
    </div>
  );
}
