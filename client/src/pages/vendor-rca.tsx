import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart2, RefreshCw, ChevronRight, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VendorRcaDrawer } from "@/components/vendor-rca-drawer";

interface VendorListResponse { vendors: string[] }

const qColor = (q: number) =>
  q >= 75 ? 'text-emerald-400' : q >= 55 ? 'text-sky-400' : q >= 35 ? 'text-amber-400' : 'text-rose-400';

const urgencyColor: Record<string, string> = {
  immediate: 'text-rose-400', today: 'text-amber-400',
  monitor: 'text-sky-400', healthy: 'text-emerald-400',
};

function VendorListItem({ vendor, active, onSelect }: { vendor: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      data-testid={`vendor-select-${vendor}`}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all",
        active
          ? "border-violet-500/50 bg-violet-500/8 ring-1 ring-violet-500/20"
          : "border-border/30 bg-card/30 hover:border-border/60 hover:bg-muted/5"
      )}
    >
      <Activity className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
      <span className="text-xs font-semibold text-foreground truncate flex-1">{vendor}</span>
      <ChevronRight className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors", active ? 'text-violet-400' : 'text-muted-foreground/30')} />
    </button>
  );
}

export default function VendorRcaPage() {
  const qc                       = useQueryClient();
  const [activeVendor, setActive] = useState<string | null>(null);
  const [drawerOpen, setDrawer]   = useState(false);

  const { data, isLoading, isFetching } = useQuery<VendorListResponse>({
    queryKey: ['/api/vendor-rca'],
    queryFn:  async () => {
      const r = await fetch('/api/vendor-rca');
      if (!r.ok) throw new Error('Failed to load vendors');
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const vendors = data?.vendors ?? [];

  const handleSelect = (v: string) => {
    setActive(v);
    setDrawer(true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <div className="border-b border-border/40 bg-card/30">
        <div className="max-w-[1200px] mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <BarChart2 className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Vendor RCA Drilldown</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Root cause analysis · Select a vendor to examine all intelligence layers
                </p>
              </div>
            </div>
            <Button
              size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['/api/vendor-rca'] });
                if (activeVendor) qc.invalidateQueries({ queryKey: ['/api/vendor-rca', activeVendor] });
              }}
              data-testid="btn-refresh-vendors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Info banner */}
        <div className="mb-5 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 flex items-start gap-3">
          <BarChart2 className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
          <div className="text-[11px] text-muted-foreground/80">
            <span className="font-semibold text-foreground/90">Select any vendor</span> to open its full RCA panel — covering Q-score decomposition, prefix breakdown, stability history, recommendations, incidents, and FAS signals. All assembled from existing intelligence layers with zero new Sippy calls.
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading vendor list…
          </div>
        ) : vendors.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Activity className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm font-semibold text-muted-foreground">No Vendors Found</p>
            <p className="text-xs text-muted-foreground/60 max-w-sm">
              Vendors appear here once CDR activity is detected. The CDR cache refreshes every few minutes.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-3">
              {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} with recent activity
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {vendors.map(v => (
                <VendorListItem
                  key={v}
                  vendor={v}
                  active={activeVendor === v && drawerOpen}
                  onSelect={() => handleSelect(v)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── RCA Drawer ── */}
      {drawerOpen && (
        <VendorRcaDrawer
          vendor={activeVendor}
          onClose={() => { setDrawer(false); }}
        />
      )}
    </div>
  );
}
