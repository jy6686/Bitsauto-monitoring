import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PortalShell from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";

interface PortalDispute {
  id: number; referenceId: string; subject: string; status: string; severity?: string;
  amountDisputed?: number; openedAt?: string; resolvedAt?: string; lastUpdatedAt?: string;
  timeline?: { action: string; note?: string; actorName?: string; createdAt: string }[];
}

const STATUS_CFG: Record<string, string> = {
  OPEN:             "text-amber-400 border-amber-400/30",
  INVESTIGATING:    "text-purple-400 border-purple-400/30",
  CUSTOMER_PENDING: "text-sky-400 border-sky-400/30",
  RESOLVED:         "text-emerald-400 border-emerald-400/30",
  CREDIT_ISSUED:    "text-emerald-400 border-emerald-400/30",
  REJECTED:         "text-red-400 border-red-400/30",
  CLOSED:           "text-slate-400 border-slate-400/30",
};

export default function PortalDisputesPage() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: disputes = [], isLoading } = useQuery<PortalDispute[]>({
    queryKey: ["/api/portal/disputes"],
    queryFn: () => apiRequest("GET", "/api/portal/disputes").then(r => r.json()),
  });

  const filtered = filterStatus === "all" ? disputes : disputes.filter(d => d.status === filterStatus);
  const openCount = disputes.filter(d => ["OPEN", "INVESTIGATING", "CUSTOMER_PENDING"].includes(d.status)).length;

  return (
    <PortalShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Shield className="h-5 w-5 text-orange-400" />Disputes</h1>
          {openCount > 0 && <p className="text-sm text-amber-400 mt-0.5">{openCount} active dispute{openCount > 1 ? "s" : ""} in progress</p>}
        </div>

        <div className="flex gap-1 flex-wrap">
          {["all", "OPEN", "INVESTIGATING", "CUSTOMER_PENDING", "RESOLVED", "CLOSED"].map(s => (
            <Button key={s} size="sm" variant={filterStatus === s ? "default" : "outline"} className="h-8 text-xs"
              onClick={() => setFilterStatus(s)}>
              {s === "all" ? "All" : s.replace("_", " ")}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Last Update</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <Shield className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-muted-foreground">No disputes found</p>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(d => {
                  const expanded = expandedId === d.id;
                  return [
                    <TableRow key={d.id} data-testid={`row-dispute-${d.id}`}
                      className="cursor-pointer hover:bg-muted/20"
                      onClick={() => setExpandedId(expanded ? null : d.id)}>
                      <TableCell>
                        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">{d.referenceId}</TableCell>
                      <TableCell className="text-sm max-w-[200px]"><p className="truncate">{d.subject}</p></TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${STATUS_CFG[d.status] ?? ""}`}>
                          {d.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {d.amountDisputed != null ? `$${d.amountDisputed.toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.openedAt ? new Date(d.openedAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.lastUpdatedAt ? new Date(d.lastUpdatedAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>,
                    expanded && d.timeline && d.timeline.length > 0 && (
                      <TableRow key={`${d.id}-timeline`} className="bg-muted/10">
                        <TableCell colSpan={7} className="py-3 pl-10 pr-6">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Dispute Timeline</p>
                          <div className="space-y-2">
                            {d.timeline.map((ev, i) => (
                              <div key={i} className="flex items-start gap-3 text-xs">
                                <span className="text-muted-foreground/60 tabular-nums w-24 shrink-0">
                                  {new Date(ev.createdAt).toLocaleDateString()}
                                </span>
                                <span className="font-medium text-muted-foreground">{ev.action.replace(/_/g, " ")}</span>
                                {ev.note && <span className="text-muted-foreground/80">{ev.note}</span>}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ),
                  ];
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}
