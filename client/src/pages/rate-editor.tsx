import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import * as XLSX from "xlsx";
import {
  Table2, Plus, Trash2, Save, Upload, Download, RefreshCw, Search,
  ChevronDown, CheckCircle2, XCircle, Loader2, Pencil, X, AlertCircle,
} from "lucide-react";

interface Switch {
  id: number;
  name: string;
  type: string;
  portalUrl: string | null;
  enabled: boolean;
}
interface Tariff {
  id: string;
  name: string;
  type: string;
}
interface RateEntry {
  prefix: string;
  destination: string;
  rate: number;
  effectiveFrom: string;
  effectiveTill: string;
  _dirty?: boolean;
  _new?: boolean;
  _deleting?: boolean;
}

const EMPTY_ROW: Omit<RateEntry, '_dirty' | '_new' | '_deleting'> = {
  prefix: '', destination: '', rate: 0, effectiveFrom: '', effectiveTill: '',
};

function fmtRate(r: number) {
  return '$' + r.toFixed(4);
}

function parseCSV(text: string): RateEntry[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  const rows: RateEntry[] = [];
  let dataStart = 0;
  // Skip header if first line has no numbers
  if (lines.length > 0 && !/^\d/.test(lines[0].trim())) dataStart = 1;
  for (let i = dataStart; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t;]/);
    if (parts.length < 2) continue;
    const prefix = parts[0]?.trim() ?? '';
    const dest   = parts[1]?.trim() ?? '';
    const rate   = parseFloat(parts[2]?.trim() ?? '0') || 0;
    const from   = parts[3]?.trim() ?? '';
    const till   = parts[4]?.trim() ?? '';
    if (!prefix) continue;
    rows.push({ prefix, destination: dest, rate, effectiveFrom: from, effectiveTill: till });
  }
  return rows;
}

function toCSV(rates: RateEntry[]): string {
  const header = 'Prefix,Destination,Rate/min,Eff. From,Eff. Till';
  const rows = rates.map(r =>
    [r.prefix, `"${r.destination}"`, r.rate, r.effectiveFrom, r.effectiveTill].join(',')
  );
  return [header, ...rows].join('\n');
}

export default function RateEditorPage() {
  const [selectedSwitch, setSelectedSwitch] = useState<number | null>(null);
  const [selectedTariff, setSelectedTariff] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<RateEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<RateEntry | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // Load switches
  const { data: switchesData } = useQuery<Switch[]>({
    queryKey: ['/api/switches'],
  });
  const switches = switchesData ?? [];

  // Load tariffs (per selected switch)
  const { data: tariffData, isFetching: loadingTariffs, refetch: refetchTariffs } = useQuery<{ tariffs: Tariff[] }>({
    queryKey: ['/api/sippy/tariffs', selectedSwitch],
    enabled: false,
  });
  const tariffs = tariffData?.tariffs ?? [];

  // Load rates
  const { isFetching: loadingRates, refetch: refetchRates } = useQuery<{ rates: RateEntry[]; error?: string }>({
    queryKey: ['/api/sippy/rates', selectedTariff, selectedSwitch],
    enabled: false,
  });

  const handleLoad = async () => {
    if (!selectedTariff) return;
    setLoaded(false);
    const res = await fetch(
      `/api/sippy/rates?tariffId=${encodeURIComponent(selectedTariff)}${selectedSwitch ? `&switchId=${selectedSwitch}` : ''}`,
      { credentials: 'include' }
    );
    const data = await res.json();
    if (data.error && !data.rates?.length) {
      showToast(false, data.error);
    }
    setRows((data.rates ?? []).map((r: RateEntry) => ({ ...r })));
    setLoaded(true);
  };

  const handleLoadTariffs = async () => {
    const url = `/api/sippy/tariffs${selectedSwitch ? `?switchId=${selectedSwitch}` : ''}`;
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (data.tariffs) {
      queryClient.setQueryData(['/api/sippy/tariffs', selectedSwitch], data);
    } else {
      showToast(false, data.error ?? 'Could not load tariffs');
    }
  };

  // Save single row to Sippy
  const saveMut = useMutation({
    mutationFn: (entry: RateEntry) =>
      apiRequest('POST', '/api/sippy/rates', {
        tariffId: selectedTariff,
        switchId: selectedSwitch,
        prefix: entry.prefix,
        rate: entry.rate,
        effectiveFrom: entry.effectiveFrom || undefined,
        effectiveTill: entry.effectiveTill || undefined,
      }),
    onSuccess: (data: any, entry: RateEntry) => {
      if (data.success) {
        setRows(prev => prev.map(r => r.prefix === entry.prefix ? { ...r, _dirty: false, _new: false } : r));
        showToast(true, `${entry.prefix} → ${data.message}`);
      } else {
        showToast(false, data.message || 'Save failed');
      }
    },
    onError: (e: any) => showToast(false, e.message),
  });

  // Delete row from Sippy
  const deleteMut = useMutation({
    mutationFn: (prefix: string) =>
      apiRequest('DELETE', '/api/sippy/rates', {
        tariffId: selectedTariff,
        switchId: selectedSwitch,
        prefix,
      }),
    onSuccess: (data: any, prefix: string) => {
      setRows(prev => prev.filter(r => r.prefix !== prefix));
      showToast(data.success, data.message || 'Deleted');
    },
    onError: (e: any) => showToast(false, e.message),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.prefix.toLowerCase().includes(q) ||
      r.destination.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const startEdit = (idx: number) => {
    setEditIdx(idx);
    setEditRow({ ...filtered[idx] });
  };

  const commitEdit = () => {
    if (editIdx === null || !editRow) return;
    const orig = filtered[editIdx];
    setRows(prev => prev.map(r => r.prefix === orig.prefix ? { ...editRow, _dirty: true } : r));
    setEditIdx(null);
    setEditRow(null);
  };

  const cancelEdit = () => { setEditIdx(null); setEditRow(null); };

  const addRow = () => {
    const newRow: RateEntry = { ...EMPTY_ROW, _new: true };
    setRows(prev => [newRow, ...prev]);
    setEditIdx(0);
    setEditRow({ ...newRow });
  };

  const importCSV = () => {
    const parsed = parseCSV(csvText);
    if (parsed.length === 0) { showToast(false, 'No valid rows found in CSV'); return; }
    setRows(prev => {
      const existing = new Map(prev.map(r => [r.prefix, r]));
      for (const r of parsed) existing.set(r.prefix, { ...r, _dirty: true, _new: !existing.has(r.prefix) });
      return Array.from(existing.values());
    });
    setCsvOpen(false);
    setCsvText('');
    showToast(true, `${parsed.length} rates imported — save to push to Sippy`);
  };

  const exportCSV = () => {
    const csv = toCSV(rows);
    // Excel export (default format)
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r: any) => Object.values(r))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `rates_${selectedTariff}_${Date.now()}.xlsx`);
  };

  const saveAll = async () => {
    const dirty = rows.filter(r => r._dirty || r._new);
    if (!dirty.length) { showToast(false, 'No unsaved changes'); return; }
    for (const r of dirty) await saveMut.mutateAsync(r);
  };

  const dirtyCount = rows.filter(r => r._dirty || r._new).length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <Table2 className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Rate Editor</h1>
              <p className="text-xs text-muted-foreground">View and edit tariff rate entries on your Sippy switch</p>
            </div>
          </div>
          {loaded && (
            <div className="flex items-center gap-2">
              {dirtyCount > 0 && (
                <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                  {dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}
                </span>
              )}
              <button
                data-testid="button-export-csv"
                onClick={exportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export Excel
              </button>
              <button
                data-testid="button-import-csv"
                onClick={() => setCsvOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" /> Import CSV
              </button>
              <button
                data-testid="button-add-rate"
                onClick={addRow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/40 text-xs text-violet-400 hover:bg-violet-500/10 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Rate
              </button>
              {dirtyCount > 0 && (
                <button
                  data-testid="button-save-all"
                  onClick={saveAll}
                  disabled={saveMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white transition-colors disabled:opacity-50"
                >
                  {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save All
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-border px-6 py-3 bg-background/30">
        <div className="flex flex-wrap items-end gap-3">
          {/* Switch selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Switch</label>
            <div className="relative">
              <select
                data-testid="select-switch"
                value={selectedSwitch ?? ''}
                onChange={e => { setSelectedSwitch(e.target.value ? Number(e.target.value) : null); setSelectedTariff(''); setRows([]); setLoaded(false); }}
                className="h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 min-w-[180px]"
              >
                <option value="">Primary (Settings)</option>
                {switches.filter(s => s.enabled && s.type === 'sippy').map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Load tariffs */}
          <button
            data-testid="button-load-tariffs"
            onClick={handleLoadTariffs}
            disabled={loadingTariffs}
            className="h-9 flex items-center gap-1.5 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors self-end disabled:opacity-50"
          >
            {loadingTariffs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Load Tariffs
          </button>

          {/* Tariff selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tariff / Product</label>
            <div className="relative">
              <select
                data-testid="select-tariff"
                value={selectedTariff}
                onChange={e => { setSelectedTariff(e.target.value); setRows([]); setLoaded(false); }}
                className="h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 min-w-[240px]"
              >
                <option value="">— Select tariff —</option>
                {tariffs.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Load rates */}
          <button
            data-testid="button-load-rates"
            onClick={handleLoad}
            disabled={!selectedTariff || loadingRates}
            className="h-9 flex items-center gap-1.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white transition-colors self-end disabled:opacity-50"
          >
            {loadingRates ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Load Rates
          </button>

          {loaded && (
            <div className="relative self-end ml-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                data-testid="input-search-rates"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search prefix / destination…"
                className="h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 w-56"
              />
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`flex-shrink-0 flex items-center gap-2 px-6 py-2 text-sm ${toast.ok ? 'bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-b border-rose-500/20'}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        {!loaded ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Table2 className="w-10 h-10 opacity-20" />
            <p className="text-sm">Select a switch + tariff and click Load Rates</p>
            <p className="text-xs opacity-60">First click "Load Tariffs" to populate the tariff dropdown</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <AlertCircle className="w-8 h-8 opacity-20" />
            <p className="text-sm">No rates found for this tariff</p>
            <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300">
              <Plus className="w-3.5 h-3.5" /> Add the first rate
            </button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/20 sticky top-0">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-32">Prefix</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Destination</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-28">Rate / min</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-36">Eff. From (UTC)</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-36">Eff. Till (UTC)</th>
                <th className="px-4 py-2.5 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const isEditing = editIdx === idx;
                const isDirty   = row._dirty || row._new;
                return (
                  <tr
                    key={row.prefix || idx}
                    data-testid={`row-rate-${idx}`}
                    className={`border-b border-border/50 transition-colors ${
                      isEditing ? 'bg-violet-500/5' :
                      isDirty   ? 'bg-amber-500/5' :
                      'hover:bg-muted/20'
                    }`}
                  >
                    {isEditing && editRow ? (
                      <>
                        <td className="px-3 py-1.5">
                          <input
                            data-testid="input-edit-prefix"
                            value={editRow.prefix}
                            onChange={e => setEditRow(r => r ? { ...r, prefix: e.target.value } : r)}
                            placeholder="+92"
                            className="w-full h-8 rounded border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            data-testid="input-edit-destination"
                            value={editRow.destination}
                            onChange={e => setEditRow(r => r ? { ...r, destination: e.target.value } : r)}
                            placeholder="Pakistan"
                            className="w-full h-8 rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            data-testid="input-edit-rate"
                            type="number"
                            step="0.0001"
                            min="0"
                            value={editRow.rate}
                            onChange={e => setEditRow(r => r ? { ...r, rate: parseFloat(e.target.value) || 0 } : r)}
                            className="w-full h-8 rounded border border-border bg-background px-2 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            data-testid="input-edit-from"
                            value={editRow.effectiveFrom}
                            onChange={e => setEditRow(r => r ? { ...r, effectiveFrom: e.target.value } : r)}
                            placeholder="YYYY-MM-DD"
                            className="w-full h-8 rounded border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            data-testid="input-edit-till"
                            value={editRow.effectiveTill}
                            onChange={e => setEditRow(r => r ? { ...r, effectiveTill: e.target.value } : r)}
                            placeholder="YYYY-MM-DD or blank"
                            className="w-full h-8 rounded border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              data-testid="button-confirm-edit"
                              onClick={commitEdit}
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-[11px] text-white transition-colors"
                            >
                              <Save className="w-3 h-3" /> OK
                            </button>
                            <button
                              data-testid="button-cancel-edit"
                              onClick={cancelEdit}
                              className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-violet-300">{row.prefix}</span>
                          {isDirty && (
                            <span className="ml-1.5 text-[9px] text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded">unsaved</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.destination || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-400">{fmtRate(row.rate)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{row.effectiveFrom || '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{row.effectiveTill || 'No expiry'}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 hover:opacity-100">
                            {isDirty && (
                              <button
                                data-testid={`button-save-rate-${idx}`}
                                onClick={() => saveMut.mutate(row)}
                                disabled={saveMut.isPending}
                                title="Save to Sippy"
                                className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-400 transition-colors"
                              >
                                {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            <button
                              data-testid={`button-edit-rate-${idx}`}
                              onClick={() => startEdit(idx)}
                              title="Edit"
                              className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              data-testid={`button-delete-rate-${idx}`}
                              onClick={() => { if (confirm(`Delete rate for ${row.prefix}?`)) deleteMut.mutate(row.prefix); }}
                              disabled={deleteMut.isPending}
                              title="Delete"
                              className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      {loaded && rows.length > 0 && (
        <div className="flex-shrink-0 border-t border-border px-6 py-2 flex items-center justify-between text-xs text-muted-foreground bg-card/30">
          <span>{filtered.length} of {rows.length} rate{rows.length !== 1 ? 's' : ''}</span>
          <span>Tariff ID: <span className="font-mono text-muted-foreground/80">{selectedTariff}</span></span>
        </div>
      )}

      {/* CSV Import modal */}
      {csvOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-violet-400" />
                <h2 className="font-semibold">Import Rates from CSV</h2>
              </div>
              <button onClick={() => setCsvOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground">
                CSV columns: <span className="font-mono text-foreground">Prefix, Destination, Rate/min, Eff.From, Eff.Till</span><br />
                The first row is treated as a header if it doesn't start with a digit.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" /> Load file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = ev => setCsvText(ev.target?.result as string ?? '');
                    reader.readAsText(f);
                  }}
                />
                <button
                  onClick={() => setCsvText('+92,Pakistan,0.0010,2026-01-01,\n+880,Bangladesh,0.0070,2026-01-01,\n+1,USA,0.0005,2026-01-01,')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Example
                </button>
              </div>
              <textarea
                data-testid="textarea-csv-import"
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                placeholder="+92,Pakistan,0.0010,2026-01-01,&#10;+880,Bangladesh,0.0070,2026-01-01,"
                rows={10}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setCsvOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                <button
                  data-testid="button-confirm-import"
                  onClick={importCSV}
                  disabled={!csvText.trim()}
                  className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  Import {csvText.trim() ? `(${parseCSV(csvText).length} rows)` : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
