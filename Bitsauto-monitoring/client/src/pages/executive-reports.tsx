import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { BarChart3, Play, Eye, Send, RefreshCw, FileText, Calendar } from "lucide-react";

interface ReportJob {
  id:             number;
  reportType:     string;
  title?:         string;
  periodStart?:   string;
  periodEnd?:     string;
  deliveryStatus: string;
  generatedAt?:   string;
  sentAt?:        string;
  htmlContent?:   string;
  createdAt:      string;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const YEARS = [2024, 2025, 2026];

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    generated: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    sent:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed:    "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize text-xs ${cfg[status] ?? cfg.generated}`}>
      {status}
    </Badge>
  );
}

export default function ExecutiveReportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const now = new Date();
  const [year,  setYear]   = useState(String(now.getFullYear()));
  const [month, setMonth]  = useState(String(now.getMonth() + 1));
  const [previewId, setPreviewId] = useState<number | null>(null);

  const { data: reports = [], isLoading } = useQuery<ReportJob[]>({
    queryKey: ["/api/executive-reports"],
    queryFn: () => apiRequest("GET", "/api/executive-reports").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: preview } = useQuery<ReportJob>({
    queryKey: ["/api/executive-reports", previewId],
    queryFn: () => apiRequest("GET", `/api/executive-reports/${previewId}`).then(r => r.json()),
    enabled: previewId != null,
  });

  const generateMutation = useMutation({
    mutationFn: (opts: { year: number; month: number }) =>
      apiRequest("POST", "/api/executive-reports/generate", opts).then(r => r.json()),
    onSuccess: (data: ReportJob) => {
      queryClient.invalidateQueries({ queryKey: ["/api/executive-reports"] });
      setPreviewId(data.id);
      toast({ title: `Report generated: ${data.title}` });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Executive Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Monthly telecom intelligence reports. Intelligence presentation — not financial truth generation.
          </p>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger data-testid="select-month" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger data-testid="select-year" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            data-testid="button-generate"
            onClick={() => generateMutation.mutate({ year: Number(year), month: Number(month) })}
            disabled={generateMutation.isPending}
          >
            <Play className={`h-4 w-4 mr-2 ${generateMutation.isPending ? "animate-pulse" : ""}`} />
            {generateMutation.isPending ? "Generating…" : "Generate Report"}
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Reports", value: reports.length, icon: <FileText className="h-4 w-4 text-blue-400" /> },
          { label: "Sent", value: reports.filter(r => r.deliveryStatus === 'sent').length, icon: <Send className="h-4 w-4 text-emerald-400" /> },
          { label: "Latest", value: reports[0]?.periodStart?.slice(0, 7) ?? "—", icon: <Calendar className="h-4 w-4 text-slate-400" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                {s.icon}
              </div>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Report list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Generated Reports</CardTitle>
          <CardDescription className="text-xs">{reports.length} report(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : reports.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No reports yet. Select a month and click "Generate Report".</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map(r => (
                  <TableRow key={r.id} data-testid={`row-report-${r.id}`}>
                    <TableCell className="font-medium">{r.title ?? "Executive Report"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {r.periodStart ?? "—"} → {r.periodEnd ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.generatedAt ? new Date(r.generatedAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell><StatusBadge status={r.deliveryStatus} /></TableCell>
                    <TableCell>
                      <Button
                        data-testid={`button-preview-${r.id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewId(r.id)}
                      >
                        <Eye className="h-4 w-4 mr-1" />Preview
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={previewId != null} onOpenChange={open => !open && setPreviewId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {preview?.title ?? "Executive Report"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded border border-border">
            {preview?.htmlContent ? (
              <iframe
                data-testid="iframe-report-preview"
                srcDoc={preview.htmlContent}
                className="w-full min-h-[600px]"
                title="Report Preview"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="text-center py-10 text-muted-foreground">Loading report…</div>
            )}
          </div>
          {preview && (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const w = window.open('', '_blank');
                  if (w && preview.htmlContent) {
                    w.document.write(preview.htmlContent);
                    w.document.close();
                  }
                }}
              >
                <Eye className="h-4 w-4 mr-2" />Open Full Page
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
