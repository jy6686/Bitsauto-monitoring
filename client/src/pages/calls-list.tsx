import { useCalls } from "@/hooks/use-calls";
import { MosBadge } from "@/components/mos-badge";
import { Link } from "wouter";
import { Phone, Clock, Search } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function CallsListPage() {
  const { data: calls, isLoading } = useCalls();
  const [search, setSearch] = useState("");

  const filteredCalls = calls?.filter(call => 
    call.caller.includes(search) || call.callee.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Active Calls</h2>
          <p className="text-muted-foreground mt-1">Real-time monitoring of all active sessions.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            type="text"
            placeholder="Search by number..."
            className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading calls...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/40 text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="px-6 py-4 font-medium">Caller ID</th>
                  <th className="px-6 py-4 font-medium">Destination</th>
                  <th className="px-6 py-4 font-medium">Duration</th>
                  <th className="px-6 py-4 font-medium">Quality (MOS)</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredCalls?.map((call) => (
                  <tr key={call.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <Phone className="w-4 h-4" />
                        </div>
                        <span className="font-mono">{call.caller}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono">{call.callee}</td>
                    <td className="px-6 py-4 text-muted-foreground flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      {call.startTime ? format(new Date(call.startTime), 'HH:mm:ss') : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <MosBadge value={call.latestMetric?.mos || 0} />
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/calls/${call.id}`} className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium bg-secondary hover:bg-secondary/80 transition-colors">
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredCalls?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      No active calls found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
