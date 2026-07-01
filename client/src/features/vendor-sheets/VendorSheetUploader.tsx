import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, FileSpreadsheet, Check } from "lucide-react";

const VR_CANON = [
  { v: "",              l: "— skip —" },
  { v: "prefix",        l: "Dial Prefix *" },
  { v: "destination",   l: "Destination" },
  { v: "rate",          l: "Rate *" },
  { v: "currency",      l: "Currency" },
  { v: "effectiveDate", l: "Effective Date" },
  { v: "expiryDate",    l: "Expiry Date" },
  { v: "interval1",     l: "Billing Start (s)" },
  { v: "intervalN",     l: "Billing Ongoing (s)" },
  { v: "interconnect",  l: "Interconnect" },
];

function autoMap(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  headers.forEach(h => {
    const l = h.toLowerCase();
    if (/dest|country/.test(l))                                  m[h] = "destination";
    else if (/area.?code|prefix|dial|^cc$/.test(l))             m[h] = "prefix";
    else if (/new.?price|^rate$|^cost$/.test(l))                m[h] = "rate";
    else if (/valid.?from|effective|start.?date|^from$/.test(l)) m[h] = "effectiveDate";
    else if (/expir|end.?date|until|valid.?to/.test(l))         m[h] = "expiryDate";
    else if (/currency/.test(l))                                 m[h] = "currency";
  });
  return m;
}

const STATUS_META: Record<string, { label: string; cls: string; pulse?: boolean }> = {
  uploading:   { label: "Uploading",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  processing:  { label: "Processing",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  parsing:     { label: "Parsing",     cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  validating:  { label: "Validating",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  importing:   { label: "Importing",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  normalizing: { label: "Normalizing", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  matching:    { label: "Matching",    cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",   pulse: true },
  ready:       { label: "Ready",       cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"               },
  active:      { label: "● Active",    cls: "bg-green-500/15 text-green-400 border-green-500/30"            },
  archived:    { label: "Archived",    cls: "bg-amber-500/15 text-amber-400 border-amber-500/30"            },
  error:       { label: "Error",       cls: "bg-red-500/15 text-red-400 border-red-500/30"                  },
  failed:      { label: "Failed",      cls: "bg-red-500/15 text-red-400 border-red-500/30"                  },
};

function SheetBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: "bg-muted/50 text-muted-foreground border-border/50" };
  return (
    <span className={`text-[10px] border rounded-full px-2 py-0.5 ${m.cls} ${m.pulse ? "animate-pulse" : ""}`}>
      {m.label}
    </span>
  );
}

export function VendorSheetUploader() {
  const { toast } = useToast();
  const [wStep,     setWStep]     = useState<1|2|3>(1);
  const [wizOpen,   setWizOpen]   = useState(false);
  const [wVid,      setWVid]      = useState<number|null>(null);
  const [wFile,     setWFile]     = useState<{name:string;type:string;data:string}|null>(null);
  const [wSheets,   setWSheets]   = useState<{index:number;name:string;rowCount:number}[]>([]);
  const [wSheetIdx, setWSheetIdx] = useState<number|null>(null);
  const [wHeaders,  setWHdrs]     = useState<string[]>([]);
  const [wSample,   setWSample]   = useState<any[][]>([]);
  const [wTotal,    setWTotal]    = useState(0);
  const [wMap,      setWMap]      = useState<Record<string,string>>({});
  const [wSaveTpl,  setWSaveTpl]  = useState(false);
  const [wTplLabel, setWTplLabel] = useState("");
  const [wCcy,      setWCcy]      = useState("USD");
  const [wEffDate,  setWEffDate]  = useState("");
  const [wNotes,    setWNotes]    = useState("");
  const [busy,      setBusy]      = useState(false);

  const { data: vendors   = [] } = useQuery<any[]>({ queryKey: ["/api/vendor-rates/vendors"], staleTime: 5*60_000 });
  const { data: sheets    = [], refetch: refetchSheets } = useQuery<any[]>({ queryKey: ["/api/vendor-rates/sheets"], staleTime: 30_000 });
  const { data: savedMaps = [] } = useQuery<any[]>({ queryKey: [`/api/vendor-rates/column-maps/${wVid}`], enabled: !!wVid, staleTime: 60_000 });

  const resetWizard = () => {
    setWStep(1); setWizOpen(false); setWFile(null); setWVid(null); setWMap({});
    setWSheets([]); setWSheetIdx(null); setWHdrs([]); setWSample([]); setWTotal(0);
    setWCcy("USD"); setWEffDate(""); setWNotes(""); setWSaveTpl(false); setWTplLabel("");
  };

  const applyPreviewResult = (r: any) => {
    const hdrs: string[] = r.headers ?? [];
    setWHdrs(hdrs); setWSample(r.sampleRows ?? []); setWTotal(r.totalRows ?? 0);
    const mapped = autoMap(hdrs);
    const def = (savedMaps as any[]).find((m: any) => m.isDefault) ?? savedMaps[0] ?? null;
    setWMap(def ? (def.mappings as Record<string,string>) : mapped);
  };

  const onFile = (file: File) => {
    const rd = new FileReader();
    rd.onload = async (e) => {
      const b64 = (e.target?.result as string).split(",")[1];
      setWFile({ name: file.name, type: file.name.endsWith(".csv") ? "csv" : "xlsx", data: b64 });
      setBusy(true);
      try {
        const r = await fetch("/api/vendor-rates/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileData: b64 }),
        }).then(r => r.json());
        setWSheets(r.sheets ?? []);
        const RATE_KW = ["pricing", "rates", "rate", "tariff", "price"];
        const autoIdx = (r.sheets ?? []).findIndex((s: any) => RATE_KW.some(k => s.name.toLowerCase().includes(k)));
        setWSheetIdx(autoIdx >= 0 ? autoIdx : 0);
        applyPreviewResult(r);
        setWStep(2);
      } catch (err: any) {
        toast({ title: "Parse failed", description: err.message, variant: "destructive" });
      }
      setBusy(false);
    };
    rd.readAsDataURL(file);
  };

  const selectSheet = async (idx: number) => {
    setWSheetIdx(idx);
    const r = await fetch("/api/vendor-rates/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileData: wFile!.data, sheetIndex: idx }),
    }).then(x => x.json());
    applyPreviewResult(r);
  };

  const doImport = async () => {
    if (!wFile) { toast({ title: "No file selected", variant: "destructive" }); return; }
    if (!wVid)  { toast({ title: "Vendor required", description: "Select a vendor first.", variant: "destructive" }); return; }
    if (!Object.values(wMap).includes("prefix") || !Object.values(wMap).includes("rate")) {
      toast({ title: "Map required fields", description: "prefix and rate must be mapped", variant: "destructive" }); return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/vendor-rates/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileData: wFile.data, fileType: wFile.name.split(".").pop()?.slice(0,10) || "xlsx",
          vendorId: wVid, fileName: wFile.name, currency: wCcy,
          effectiveDate: wEffDate || undefined, notes: wNotes || undefined,
          columnMap: wMap, saveTemplate: wSaveTpl, templateLabel: wTplLabel || wFile.name,
          sheetIndex: wSheetIdx ?? undefined,
        }),
      }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      toast({ title: `Imported ${r.rowCount?.toLocaleString()} rows`,
        description: r.duplicatesSkipped ? `${r.duplicatesSkipped} duplicates skipped` : undefined });
      resetWizard(); refetchSheets();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
    setBusy(false);
  };

  const doActivate = async (id: number) => {
    await fetch(`/api/vendor-rates/sheets/${id}/activate`, { method: "POST" });
    refetchSheets(); toast({ title: "Sheet activated" });
  };

  const doDelete = async (id: number) => {
    if (!confirm("Delete this sheet and all its rows?")) return;
    await fetch(`/api/vendor-rates/sheets/${id}`, { method: "DELETE" });
    refetchSheets(); toast({ title: "Sheet deleted" });
  };

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
            Vendor Sheets
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Upload, normalize, and match vendor rate sheets before activation</p>
        </div>
        <button onClick={() => { setWizOpen(v => !v); if (wizOpen) resetWizard(); }}
          className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 font-medium">
          <Upload className="w-3.5 h-3.5" />
          {wizOpen ? "Cancel" : "Import Vendor Sheet"}
        </button>
      </div>

      {wizOpen && (
        <div className="border border-border rounded-lg shadow-sm bg-background overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/10">
            <span className="text-sm font-semibold">Upload Vendor Rate Sheet</span>
            <span className="text-xs text-muted-foreground">Step {wStep} of 3</span>
          </div>
          {wStep === 1 && (
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                <select value={wVid ?? ""} onChange={e => setWVid(Number(e.target.value))}
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm">
                  <option value="">Select vendor…</option>
                  {(vendors as any[]).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Rate Sheet (.xlsx or .csv)</label>
                <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${wVid ? "border-blue-500/40 hover:border-blue-500/60" : "border-border/40 opacity-50 pointer-events-none"}`}>
                  {busy ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-2" />
                    <span className="text-xs text-muted-foreground">Drop file or click to browse</span>
                    {wFile && <span className="text-xs text-blue-400 mt-1">{wFile.name}</span>}
                  </>}
                  <input type="file" accept=".xlsx,.csv,.xls" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f && wVid) onFile(f); }} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Currency</label>
                  <select value={wCcy} onChange={e => setWCcy(e.target.value)}
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm">
                    <option>USD</option><option>EUR</option><option>GBP</option><option>AUD</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Effective Date</label>
                  <input type="date" value={wEffDate} onChange={e => setWEffDate(e.target.value)}
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                <input type="text" value={wNotes} onChange={e => setWNotes(e.target.value)}
                  placeholder="e.g. July 2026 tariff update"
                  className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
          )}
          {wStep === 2 && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Select the sheet containing rate data.</p>
              <div className="divide-y divide-border/30 border border-border/50 rounded overflow-hidden">
                {wSheets.map(s => (
                  <button key={s.index} onClick={() => selectSheet(s.index)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/10 text-left transition-colors ${wSheetIdx === s.index ? "bg-blue-500/10 border-l-2 border-blue-500" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${wSheetIdx === s.index ? "bg-blue-400" : "bg-muted-foreground/30"}`} />
                      <span className="text-sm font-medium">{s.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{s.rowCount.toLocaleString()} rows</span>
                  </button>
                ))}
              </div>
              {wTotal > 0 && <p className="text-[11px] text-muted-foreground">{wTotal.toLocaleString()} data rows detected</p>}
            </div>
          )}
          {wStep === 3 && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Map columns to BitsAuto fields. <span className="text-amber-400">* required</span></p>
              <div className="border border-border/50 rounded overflow-hidden">
                <div className="grid grid-cols-2 bg-muted/20 py-1.5 px-3 border-b border-border/50 text-[11px] font-medium text-muted-foreground">
                  <span>Vendor Column</span><span>BitsAuto Field</span>
                </div>
                <div className="divide-y divide-border/30 max-h-56 overflow-auto">
                  {wHeaders.map(h => (
                    <div key={h} className="grid grid-cols-2 items-center px-3 py-1.5 hover:bg-muted/10">
                      <span className="text-xs font-mono truncate">{h || "(empty)"}</span>
                      <select value={wMap[h] ?? ""} onChange={e => setWMap(m => ({ ...m, [h]: e.target.value }))}
                        className="text-xs bg-muted/30 border border-border/50 rounded px-1.5 py-1">
                        {VR_CANON.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {(savedMaps as any[]).length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Templates:</span>
                  {(savedMaps as any[]).map((m: any) => (
                    <button key={m.id} onClick={() => setWMap(m.mappings as Record<string,string>)}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2">{m.label}</button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" id="wSaveTpl" checked={wSaveTpl} onChange={e => setWSaveTpl(e.target.checked)} />
                <label htmlFor="wSaveTpl" className="text-xs">Save as template</label>
                {wSaveTpl && (
                  <input type="text" value={wTplLabel} onChange={e => setWTplLabel(e.target.value)}
                    placeholder="Template name" className="flex-1 bg-muted/30 border border-border rounded px-2 py-1 text-xs" />
                )}
              </div>
              <div className="border border-border/40 rounded overflow-auto max-h-28">
                <table className="text-[10px] w-full">
                  <thead className="bg-muted/20 border-b border-border/40">
                    <tr>{wHeaders.map(h => <th key={h} className="py-1 px-2 text-left font-medium text-muted-foreground">{h}</th>)}</tr>
                  </thead>
                  <tbody>{wSample.slice(0,4).map((row, i) => (
                    <tr key={i} className="border-b border-border/20">
                      {wHeaders.map((_, j) => <td key={j} className="py-1 px-2 font-mono">{row[j] != null ? String(row[j]).slice(0,14) : "—"}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground">{wTotal.toLocaleString()} rows in file</p>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/5">
            <button onClick={() => wStep > 1 ? setWStep(s => (s-1) as 1|2|3) : resetWizard()}
              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted/30">
              {wStep === 1 ? "Cancel" : "← Back"}
            </button>
            {wStep === 1 && <button disabled={!wFile || busy} onClick={() => setWStep(2)}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-muted/30 disabled:text-muted-foreground text-white rounded px-3 py-1.5 font-medium">
              Select Sheet →</button>}
            {wStep === 2 && <button onClick={() => setWStep(3)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 font-medium">
              Map Columns →</button>}
            {wStep === 3 && <button disabled={busy} onClick={doImport}
              className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-muted/30 text-white rounded px-3 py-1.5 font-medium flex items-center gap-1.5">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              Import {wTotal.toLocaleString()} Rows
            </button>}
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {(sheets as any[]).length} sheet{(sheets as any[]).length !== 1 ? "s" : ""} imported
          </span>
          <button onClick={() => refetchSheets()} className="text-xs text-muted-foreground hover:text-foreground">Refresh</button>
        </div>
        {(sheets as any[]).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No vendor sheets imported yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click "Import Vendor Sheet" above to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>{["Vendor","File","Rows","Status","Effective","Uploaded","Actions"].map(h => (
                  <th key={h} className="text-left py-2 px-3 font-medium text-muted-foreground text-[11px]">{h}</th>
                ))}</tr>
              </thead>
              <tbody>{(sheets as any[]).map((s: any) => (
                <tr key={s.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="py-2 px-3 font-medium">{s.vendorName}</td>
                  <td className="py-2 px-3 text-muted-foreground max-w-[180px] truncate" title={s.fileName}>{s.fileName}</td>
                  <td className="py-2 px-3 tabular-nums">{s.rowCount?.toLocaleString()}</td>
                  <td className="py-2 px-3"><SheetBadge status={s.status} /></td>
                  <td className="py-2 px-3 text-muted-foreground">{s.effectiveDate ?? "—"}</td>
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{new Date(s.uploadedAt).toLocaleDateString()}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      {s.status !== "active"
                        ? <button onClick={() => doActivate(s.id)} className="text-[10px] text-green-400 hover:text-green-300">Activate</button>
                        : <span className="text-[10px] text-green-400 flex items-center gap-0.5"><Check className="w-3 h-3"/>Active</span>
                      }
                      <span className="text-border">|</span>
                      <button onClick={() => doDelete(s.id)} className="text-[10px] text-red-400/70 hover:text-red-400">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
