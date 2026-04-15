
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard, Upload, Trash2, RefreshCw, Plus, FileText,
  ChevronDown, ChevronRight, PenLine,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type RateCard = {
  id: number;
  vendorName: string;
  name: string;
  currency: string;
  effectiveDate: string | null;
  entryCount: number;
  createdAt: string;
};

type RateCardEntry = {
  id: number;
  rateCardId: number;
  prefix: string;
  country: string | null;
  breakout: string | null;
  ratePerMin: number;
};

type ClientProfile = {
  id: number;
  name: string;
  type: string;
};

const CUSTOM_VENDOR = "__custom__";

// ── Main Page ──────────────────────────────────────────────────────────────

export default function RateCardsPage() {
  const { toast } = useToast();
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Create form state
  const [selectedVendor, setSelectedVendor] = useState('');
  const [customVendor, setCustomVendor] = useState('');
  const [newName, setNewName] = useState('');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newDate, setNewDate] = useState('');

  const [uploadCardId, setUploadCardId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: cards = [], isLoading, refetch } = useQuery<RateCard[]>({
    queryKey: ["/api/rate-cards"],
    refetchOnWindowFocus: false,
  });

  const { data: clients = [] } = useQuery<ClientProfile[]>({
    queryKey: ["/api/clients"],
    refetchOnWindowFocus: false,
  });

  const { data: entries = [], isFetching: entriesLoading } = useQuery<RateCardEntry[]>({
    queryKey: ["/api/rate-cards", expandedCardId, "entries"],
    queryFn: () => fetch(`/api/rate-cards/${expandedCardId}/entries`).then(r => r.json()),
    enabled: expandedCardId !== null,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/rate-cards", data).then(r => r.json()),
    onSuccess: () => {
      setCreateOpen(false);
      setSelectedVendor(''); setCustomVendor(''); setNewName(''); setNewCurrency('USD'); setNewDate('');
      queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] });
      toast({ title: "Rate card created" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/rate-cards/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] });
      toast({ title: "Rate card deleted" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ||
        file.type.includes('spreadsheet') || file.type.includes('excel');

      let body: BodyInit;
      let contentType: string;

      if (isExcel) {
        body = await file.arrayBuffer();
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        body = await file.text();
        contentType = 'text/plain';
      }

      const res = await fetch(`/api/rate-cards/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rate-cards"] });
      toast({ title: `Imported ${data.inserted} entries` });
      setUploadCardId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const resolvedVendorName = selectedVendor === CUSTOM_VENDOR ? customVendor : selectedVendor;
  const canCreate = resolvedVendorName.trim() && newName.trim() && !createMutation.isPending;

  function handleSubmitCreate() {
    createMutation.mutate({
      vendorName: resolvedVendorName.trim(),
      name: newName.trim(),
      currency: newCurrency || 'USD',
      effectiveDate: newDate || null,
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && uploadCardId !== null) {
      uploadMutation.mutate({ id: uploadCardId, file });
    }
    e.target.value = '';
  }

  // All unique vendor names already in rate cards (for badge colouring etc.)
  const vendorOptions = clients.map(c => c.name);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-emerald-400" />
            Carrier Rate Cards
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage buy-rate sheets from your vendors — upload CSV or Excel to import prefix rates
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-ratecards" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-ratecard" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />New Rate Card
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Rate Card</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">

                {/* Vendor / Client selection */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Vendor / Client</Label>
                  {vendorOptions.length > 0 ? (
                    <>
                      <Select value={selectedVendor} onValueChange={setSelectedVendor} data-testid="select-vendor">
                        <SelectTrigger data-testid="trigger-vendor-select">
                          <SelectValue placeholder="Select a vendor or client…" />
                        </SelectTrigger>
                        <SelectContent>
                          {vendorOptions.map(name => (
                            <SelectItem key={name} value={name} data-testid={`vendor-option-${name}`}>
                              {name}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_VENDOR} data-testid="vendor-option-custom">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <PenLine className="h-3.5 w-3.5" />Enter manually…
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {selectedVendor === CUSTOM_VENDOR && (
                        <Input
                          className="mt-2"
                          value={customVendor}
                          onChange={e => setCustomVendor(e.target.value)}
                          placeholder="e.g. Callntalk"
                          data-testid="input-custom-vendor"
                          autoFocus
                        />
                      )}
                    </>
                  ) : (
                    <Input
                      value={customVendor}
                      onChange={e => setCustomVendor(e.target.value)}
                      placeholder="e.g. Callntalk"
                      data-testid="input-vendor-name"
                    />
                  )}
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Rate Card Name</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Q2 2026 Standard Rates" data-testid="input-card-name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Currency</Label>
                    <Input value={newCurrency} onChange={e => setNewCurrency(e.target.value)} placeholder="USD" data-testid="input-currency" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Effective Date</Label>
                    <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} data-testid="input-effective-date" />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleSubmitCreate}
                  disabled={!canCreate}
                  data-testid="button-submit-ratecard"
                >
                  {createMutation.isPending ? "Creating…" : "Create Rate Card"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Upload Format Hint */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3 items-start">
        <FileText className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="text-blue-300 font-medium mb-1">CSV &amp; Excel Upload Format</div>
          <div className="text-muted-foreground text-xs font-mono">prefix, country, breakout, rate</div>
          <div className="text-muted-foreground text-xs font-mono mt-0.5">252, Somalia, Africa, 0.1250</div>
          <div className="text-muted-foreground text-xs mt-1">
            Accepts <span className="text-blue-300 font-medium">.csv</span> or <span className="text-blue-300 font-medium">.xlsx</span> — column names are auto-detected. Rate = per-minute cost in the card's currency.
          </div>
        </div>
      </div>

      {/* Rate Cards List */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading rate cards…</div>
      ) : cards.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 bg-card border border-border rounded-xl">
          <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <div className="font-medium mb-1">No rate cards yet</div>
          <div className="text-sm">Create a rate card and upload a CSV or Excel file to get started</div>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map(card => {
            const isExpanded = expandedCardId === card.id;
            return (
              <div key={card.id} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Card header row */}
                <div className="flex items-center gap-4 p-4">
                  <button
                    onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`toggle-card-${card.id}`}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" data-testid={`card-name-${card.id}`}>{card.name}</span>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-xs">{card.vendorName}</Badge>
                      <Badge className="bg-muted text-muted-foreground border-0 text-xs">{card.currency}</Badge>
                      {card.effectiveDate && (
                        <Badge className="bg-blue-500/20 text-blue-400 border-0 text-xs">
                          Effective {new Date(card.effectiveDate).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {card.entryCount} prefix entries · Created {new Date(card.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => { setUploadCardId(card.id); fileInputRef.current?.click(); }}
                      disabled={uploadMutation.isPending && uploadCardId === card.id}
                      data-testid={`button-upload-${card.id}`}
                      className="gap-1.5 text-xs"
                    >
                      <Upload className="h-3 w-3" />
                      {uploadMutation.isPending && uploadCardId === card.id ? "Uploading…" : "Upload CSV / Excel"}
                    </Button>
                    <button
                      onClick={() => deleteMutation.mutate(card.id)}
                      data-testid={`button-delete-card-${card.id}`}
                      className="text-muted-foreground hover:text-red-400 transition-colors p-1.5 rounded"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded entries */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {entriesLoading ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">Loading entries…</div>
                    ) : entries.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">
                        <Upload className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        No entries yet. Upload a CSV or Excel file to import prefix rates.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/50">
                          Showing first 200 of {entries.length} entries
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                              <th className="px-4 py-2 text-left">Prefix</th>
                              <th className="px-4 py-2 text-left">Country</th>
                              <th className="px-4 py-2 text-left">Breakout</th>
                              <th className="px-4 py-2 text-right">Rate/Min ({card.currency})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.slice(0, 200).map(e => (
                              <tr key={e.id} className="border-b border-border/30 hover:bg-muted/20">
                                <td className="px-4 py-1.5 font-mono text-xs text-emerald-400">{e.prefix}</td>
                                <td className="px-4 py-1.5 text-xs">{e.country ?? "—"}</td>
                                <td className="px-4 py-1.5 text-xs text-muted-foreground">{e.breakout ?? "—"}</td>
                                <td className="px-4 py-1.5 text-right font-mono text-xs">{e.ratePerMin.toFixed(4)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden file input — accepts CSV and Excel */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={handleFileChange}
        data-testid="file-input-upload"
      />
    </div>
  );
}
