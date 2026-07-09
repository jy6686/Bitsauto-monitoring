/**
 * ProductMappingTab.tsx
 * Day 4 – Product Mapping Catalog within Global Code Set (destination-catalog.tsx)
 *
 * Rendered as: {activeTab === "product-mapping" && <ProductMappingTab />}
 *
 * Zero changes to existing Destination Catalog workflow or rate-send path.
 * All backend calls use routes registered by routes-product-mapping.ts (Day 3).
 */

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Upload, Package, CheckCircle2, Clock, Archive,
  Loader2, RefreshCw, AlertTriangle, History,
  Zap, ChevronDown, ChevronRight, FileSpreadsheet,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MappingProduct {
  productId: number;
  productName: string;
  activeVersionId: number | null;
  activeVersionLabel: string | null;
  activatedAt: string | null;
  prefixCount: number;
}

interface MappingVersion {
  id: number;
  productId: number;
  label: string;
  status: "active" | "archived" | "draft";
  prefixCount: number;
  uploadedAt: string;
  activatedAt: string | null;
  uploadedBy: string | null;
}

interface HealthStats {
  resolverVersion: string;
  cacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
  lastRefreshDuration: number | null;
  duplicateCount: number;
}

// ── Upload Dialog ─────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  productId,
  productName,
  onClose,
}: {
  open: boolean;
  productId: number;
  productName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [dragging, setDragging] = useState(false);

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("productId", String(productId));
      fd.append("label", label.trim() || `v${new Date().toISOString().slice(0, 10)}`);
      const res = await fetch("/api/product-mapping/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/products"] });
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/health"] });
      toast({
        title: `Uploaded — ${data.prefixCount ?? 0} prefixes`,
        description: `Version: ${data.label}`,
      });
      onClose();
      setFile(null);
      setLabel("");
    },
    onError: (e: any) =>
      toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => {
    if (!uploadMut.isPending) {
      onClose();
      setFile(null);
      setLabel("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Upload className="w-4 h-4 text-violet-400" />
            Import Mapping Version — {productName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            CSV or XLSX with a "Dial Prefix" column. After upload, activate the version to
            load it into the resolver cache.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Version Label{" "}
              <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={`v${new Date().toISOString().slice(0, 10)}`}
              className="h-8 text-sm"
            />
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
            />
            <FileSpreadsheet
              className={cn("w-9 h-9", dragging ? "text-primary" : "text-muted-foreground")}
            />
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(file.size / 1024).toFixed(1)} KB — click to change
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium">Drop mapping file here</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  .csv or .xlsx — must contain "Dial Prefix" column
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={uploadMut.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => uploadMut.mutate()}
            disabled={!file || uploadMut.isPending}
            className="gap-1.5"
          >
            {uploadMut.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Upload className="w-3.5 h-3.5" />}
            Upload & Parse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Version Row ───────────────────────────────────────────────────────────────

function VersionRow({
  v,
  onActivate,
  onArchive,
  busy,
}: {
  v: MappingVersion;
  onActivate: (id: number) => void;
  onArchive: (id: number) => void;
  busy: boolean;
}) {
  return (
    <tr className="border-b border-border/40 hover:bg-muted/20">
      <td className="py-2 px-4 font-mono text-xs font-medium">{v.label}</td>
      <td className="py-2 px-4">
        {v.status === "active" ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-2.5 h-2.5" />active
          </span>
        ) : v.status === "archived" ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400 border border-zinc-500/30">
            <Archive className="w-2.5 h-2.5" />archived
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Clock className="w-2.5 h-2.5" />draft
          </span>
        )}
      </td>
      <td className="py-2 px-4 text-xs tabular-nums">
        {(v.prefixCount ?? 0).toLocaleString()}
      </td>
      <td className="py-2 px-4 text-xs text-muted-foreground">
        {new Date(v.uploadedAt).toLocaleDateString()}
      </td>
      <td className="py-2 px-4">
        <div className="flex items-center gap-1.5 justify-end">
          {v.status !== "active" && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs gap-1"
              onClick={() => onActivate(v.id)}
              disabled={busy}
            >
              <Zap className="w-2.5 h-2.5 text-emerald-400" />
              Activate
            </Button>
          )}
          {v.status === "draft" && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs gap-1 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/10"
              onClick={() => onArchive(v.id)}
              disabled={busy}
            >
              <Archive className="w-2.5 h-2.5" />
              Archive
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: MappingProduct }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: versions = [], isFetching: vFetching } = useQuery<MappingVersion[]>({
    queryKey: ["/api/product-mapping/versions", product.productId],
    queryFn: () =>
      apiRequest("GET", `/api/product-mapping/versions?productId=${product.productId}`)
        .then(r => r.json()),
    enabled: historyOpen,
    staleTime: 30_000,
  });

  const activateMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/product-mapping/versions/${id}/activate`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/products"] });
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/versions", product.productId] });
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/health"] });
      toast({ title: "Version activated — resolver cache refreshed" });
    },
    onError: (e: any) =>
      toast({ title: "Activate failed", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/product-mapping/versions/${id}/archive`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/versions", product.productId] });
      toast({ title: "Version archived" });
    },
    onError: (e: any) =>
      toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const busy = activateMut.isPending || archiveMut.isPending;

  return (
    <>
      <UploadDialog
        open={uploadOpen}
        productId={product.productId}
        productName={product.productName}
        onClose={() => setUploadOpen(false)}
      />

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <Package className="w-4 h-4 text-violet-400 shrink-0" />
            <span className="font-semibold text-sm">{product.productName}</span>
            {product.activeVersionId !== null ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="w-2.5 h-2.5" />ACTIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <AlertTriangle className="w-2.5 h-2.5" />NO MAPPING
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => setHistoryOpen(v => !v)}
            >
              <History className="w-3 h-3" />
              History
              {historyOpen
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="w-3 h-3" />
              Import New Version
            </Button>
          </div>
        </div>

        {/* Active version stats */}
        {product.activeVersionId !== null ? (
          <div className="px-4 py-3 grid grid-cols-3 gap-6 text-xs">
            <div>
              <p className="text-muted-foreground mb-0.5">Active Version</p>
              <p className="font-medium font-mono">
                {product.activeVersionLabel ?? `id:${product.activeVersionId}`}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Prefix Count</p>
              <p className="font-medium tabular-nums">
                {product.prefixCount.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Activated</p>
              <p className="font-medium">
                {product.activatedAt
                  ? new Date(product.activatedAt).toLocaleDateString()
                  : "—"}
              </p>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No active mapping. Upload a CSV/XLSX and activate a version to enable destination resolution.
          </div>
        )}

        {/* Version history */}
        {historyOpen && (
          <div className="border-t border-border">
            <div className="px-4 py-2 bg-muted/10 text-xs font-medium text-muted-foreground flex items-center gap-2">
              <History className="w-3 h-3" />
              Version History
              {vFetching && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
            </div>
            {versions.length === 0 && !vFetching ? (
              <div className="px-4 py-4 text-xs text-muted-foreground text-center">
                No versions uploaded yet.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/20 border-b border-border">
                  <tr>
                    {["Label", "Status", "Prefixes", "Uploaded", ""].map(h => (
                      <th
                        key={h}
                        className="text-left py-2 px-4 font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {versions.map(v => (
                    <VersionRow
                      key={v.id}
                      v={v}
                      onActivate={id => activateMut.mutate(id)}
                      onArchive={id => archiveMut.mutate(id)}
                      busy={busy}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── ProductMappingTab (exported) ──────────────────────────────────────────────

export function ProductMappingTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: productsData, isLoading } = useQuery<{ products: MappingProduct[] }>({
    queryKey: ["/api/product-mapping/products"],
    queryFn: () =>
      apiRequest("GET", "/api/product-mapping/products").then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: healthData } = useQuery<{ resolver: HealthStats }>({
    queryKey: ["/api/product-mapping/health"],
    queryFn: () =>
      apiRequest("GET", "/api/product-mapping/health").then(r => r.json()),
    staleTime: 60_000,
  });

  const refreshMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/product-mapping/refresh").then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/products"] });
      qc.invalidateQueries({ queryKey: ["/api/product-mapping/health"] });
      toast({ title: "Resolver cache refreshed" });
    },
    onError: (e: any) =>
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const products = productsData?.products ?? [];
  const stats = healthData?.resolver;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold">Product Mapping Catalog</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dial prefix → product mappings per tier. Activate a version to load it into the resolver cache.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={() => refreshMut.mutate()}
          disabled={refreshMut.isPending}
        >
          {refreshMut.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh Cache
        </Button>
      </div>

      {/* Resolver health strip */}
      {stats && (
        <div className="flex flex-wrap items-center gap-5 px-5 py-2 border-b border-border bg-muted/10 text-xs text-muted-foreground">
          <span>
            Resolver{" "}
            <span className="font-mono text-foreground">{stats.resolverVersion}</span>
          </span>
          <span>
            Cache entries:{" "}
            <span className="font-mono text-foreground">
              {stats.cacheEntries.toLocaleString()}
            </span>
          </span>
          <span>
            Hits / Misses:{" "}
            <span className="font-mono text-emerald-400">{stats.cacheHits}</span>
            {" / "}
            <span className="font-mono text-amber-400">{stats.cacheMisses}</span>
          </span>
          {stats.lastRefreshDuration != null && (
            <span>
              Last refresh:{" "}
              <span className="font-mono text-foreground">{stats.lastRefreshDuration}ms</span>
            </span>
          )}
          {stats.duplicateCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              {stats.duplicateCount} duplicate prefix
              {stats.duplicateCount !== 1 ? "es" : ""}
            </span>
          )}
        </div>
      )}

      {/* Product cards */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && products.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Package className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No products found. Ensure product_registry table is seeded.
            </p>
          </div>
        )}
        {products.map(p => (
          <ProductCard key={p.productId} product={p} />
        ))}
      </div>
    </div>
  );
}
