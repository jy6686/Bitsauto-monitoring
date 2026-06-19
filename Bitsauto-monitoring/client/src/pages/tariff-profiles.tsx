import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2, FileSpreadsheet, CheckCircle2, Download } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToggleFieldConfig { enable: boolean; cell: string; title: string; }

interface HeaderConfig {
  technicalPrefix: ToggleFieldConfig;
  kamName: ToggleFieldConfig;
  kamEmail: ToggleFieldConfig;
  increaseEffectiveDate: ToggleFieldConfig;
  decreaseEffectiveDate: ToggleFieldConfig;
  productName: ToggleFieldConfig;
  companyName: ToggleFieldConfig;
  sendDate: ToggleFieldConfig;
  sendTime: ToggleFieldConfig;
  organizationLogo: ToggleFieldConfig;
  newCodeStatus: ToggleFieldConfig;
  noChangeCodeStatus: ToggleFieldConfig;
  increaseCodeStatus: ToggleFieldConfig;
  decreaseCodeStatus: ToggleFieldConfig;
  pendingIncreaseCodeStatus: ToggleFieldConfig;
  pendingDecreaseCodeStatus: ToggleFieldConfig;
}

interface ColumnField { enable: boolean; column: string; title: string; }

interface SingleSheetConfig {
  name: string; startRow: number;
  country: ColumnField; destination: ColumnField; timeBand: ColumnField;
  oldRate: ColumnField; newRate: ColumnField; changeRate: ColumnField;
  billingIncrement: ColumnField; fullCode: ColumnField; countryCode: ColumnField;
  areaCode: ColumnField; status: ColumnField; effectiveDateTime: ColumnField;
  expirationDateTime: ColumnField;
}

interface AttachmentConfig {
  sheetType: "SS" | "MS";
  singleSheet: SingleSheetConfig;
}

interface DialCodeFormatConfig {
  dialCodePrefix: string; stripPrefix: boolean;
  minLength: number | null; maxLength: number | null;
}

interface DateTimeConfig {
  dateFormat: string; timeFormat: string; dateTimeFormat: string;
}

interface StatusConfig {
  newCode: string; noChange: string; increase: string;
  decrease: string; pendingIncrease: string; pendingDecrease: string;
}

interface TemplateConfig {
  header: Record<string, any>;
  attachment: AttachmentConfig;
  dialCodeFormat: DialCodeFormatConfig;
  dateTime: DateTimeConfig;
  status: StatusConfig;
}

interface TariffProfile {
  id: number; name: string; config: TemplateConfig;
  created_at: string; updated_at: string;
}

// ── Default config ────────────────────────────────────────────────────────────

function defaultConfig(): TemplateConfig {
  return {
    header: {
      technicalPrefixEnable: false, technicalPrefixCell: "B6", technicalPrefixTitle: "Prefix",
      kamNameEnable: false, kamNameCell: "B5", kamNameTitle: "KAM Name",
      kamEmailEnable: false, kamEmailCell: "E5", kamEmailTitle: "KAM Email",
      increaseEffectiveDateEnable: false, increaseEffectiveDateCell: "B6", increaseEffectiveDateTitle: "Increase Effective Date",
      decreaseEffectiveDateEnable: false, decreaseEffectiveDateCell: "B7", decreaseEffectiveDateTitle: "Decrease Effective Date",
      productNameEnable: true, productNameCell: "B5", productNameTitle: "Product",
      companyNameEnable: true, companyNameCell: "B3", companyNameTitle: "Confidential Pricing to:",
      sendDateEnable: true, sendDateCell: "B4", sendDateTitle: "Date Sent:",
      sendTimeEnable: false, sendTimeCell: "B11", sendTimeTitle: "Send Time",
      organizationLogoEnable: false, organizationLogoCell: "A1",
      newCodeStatusEnable: true, newCodeStatusCell: "F3", newCodeStatusTitle: "New Code",
      noChangeCodeStatusEnable: true, noChangeCodeStatusCell: "F4", noChangeCodeStatusTitle: "No Change",
      increaseCodeStatusEnable: true, increaseCodeStatusCell: "F5", increaseCodeStatusTitle: "Increase",
      decreaseCodeStatusEnable: true, decreaseCodeStatusCell: "F6", decreaseCodeStatusTitle: "Decrease",
      pendingIncreaseCodeStatusEnable: true, pendingIncreaseCodeStatusCell: "F7", pendingIncreaseCodeStatusTitle: "Pending Increase",
      pendingDecreaseCodeStatusEnable: true, pendingDecreaseCodeStatusCell: "F8", pendingDecreaseCodeStatusTitle: "Pending Decrease",
    },
    attachment: {
      sheetType: "SS",
      singleSheet: {
        name: "Rates", startRow: 13,
        country: { enable: true, column: "A", title: "Country" },
        destination: { enable: true, column: "B", title: "Destination" },
        timeBand: { enable: false, column: "C", title: "Time Band" },
        oldRate: { enable: false, column: "D", title: "Rate - Old" },
        newRate: { enable: true, column: "E", title: "Rate(USD/min)" },
        changeRate: { enable: false, column: "F", title: "Rate - Change" },
        billingIncrement: { enable: false, column: "G", title: "Billing Increment" },
        fullCode: { enable: true, column: "C", title: "Dial Code" },
        countryCode: { enable: false, column: "I", title: "Country Code" },
        areaCode: { enable: false, column: "J", title: "Area Code" },
        status: { enable: true, column: "H", title: "Status" },
        effectiveDateTime: { enable: true, column: "I", title: "Effective DateTime" },
        expirationDateTime: { enable: false, column: "J", title: "Expiration DateTime" },
      },
    },
    dialCodeFormat: { dialCodePrefix: "", stripPrefix: false, minLength: null, maxLength: null },
    dateTime: { dateFormat: "%d-%b-%y", timeFormat: "%I:%M %p", dateTimeFormat: "%d-%b-%y %I:%M %p" },
    status: { newCode: "NEW", noChange: "NO CHANGE", increase: "INCREASE", decrease: "DECREASE", pendingIncrease: "PENDING INCREASE", pendingDecrease: "PENDING DECREASE" },
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface HeaderRowProps { label: string; enableKey: string; cellKey: string; titleKey: string; header: Record<string, any>; onChange: (k: string, v: any) => void; }

function HeaderRow({ label, enableKey, cellKey, titleKey, header, onChange }: HeaderRowProps) {
  return (
    <div className="grid grid-cols-[180px_60px_100px_1fr] gap-3 items-center py-2 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Switch data-testid={`switch-${enableKey}`} checked={!!header[enableKey]} onCheckedChange={v => onChange(enableKey, v)} />
      <Input data-testid={`input-${cellKey}`} value={header[cellKey] ?? ""} onChange={e => onChange(cellKey, e.target.value)} placeholder="Cell" className="h-8 text-xs font-mono" disabled={!header[enableKey]} />
      <Input data-testid={`input-${titleKey}`} value={header[titleKey] ?? ""} onChange={e => onChange(titleKey, e.target.value)} placeholder="Title" className="h-8 text-sm" disabled={!header[enableKey]} />
    </div>
  );
}

interface ColFieldRowProps { label: string; field: ColumnField; onChange: (f: Partial<ColumnField>) => void; }

function ColFieldRow({ label, field, onChange }: ColFieldRowProps) {
  return (
    <div className="grid grid-cols-[200px_60px_80px_1fr] gap-3 items-center py-2 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Switch data-testid={`switch-col-${label}`} checked={!!field.enable} onCheckedChange={v => onChange({ enable: v })} />
      <Input data-testid={`input-col-${label}`} value={field.column} onChange={e => onChange({ column: e.target.value })} placeholder="Col" className="h-8 text-xs font-mono w-16" disabled={!field.enable} />
      <Input data-testid={`input-title-${label}`} value={field.title} onChange={e => onChange({ title: e.target.value })} placeholder="Column title" className="h-8 text-sm" disabled={!field.enable} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TariffProfilesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [profileName, setProfileName] = useState("");
  const [config, setConfig] = useState<TemplateConfig>(defaultConfig());

  const { data, isLoading } = useQuery<{ success: boolean; profiles: TariffProfile[] }>({
    queryKey: ["/api/tariff-profiles"],
  });
  const profiles = data?.profiles ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/tariff-profiles", { name: profileName, config });
      return r.json();
    },
    onSuccess: (d) => {
      if (!d.success) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      qc.invalidateQueries({ queryKey: ["/api/tariff-profiles"] });
      toast({ title: "Template created", description: `"${profileName}" saved.` });
      setEditorOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("PUT", `/api/tariff-profiles/${editingId}`, { name: profileName, config });
      return r.json();
    },
    onSuccess: (d) => {
      if (!d.success) { toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      qc.invalidateQueries({ queryKey: ["/api/tariff-profiles"] });
      toast({ title: "Template saved", description: `"${profileName}" updated.` });
      setEditorOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/tariff-profiles/${id}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tariff-profiles"] });
      toast({ title: "Deleted", description: "Template removed." });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setProfileName("");
    setConfig(defaultConfig());
    setEditorOpen(true);
  }

  function openEdit(p: TariffProfile) {
    setEditingId(p.id);
    setProfileName(p.name);
    setConfig(p.config ?? defaultConfig());
    setEditorOpen(true);
  }

  function handleSave() {
    if (!profileName.trim()) { toast({ title: "Name required", description: "Enter a template name.", variant: "destructive" }); return; }
    if (editingId) updateMutation.mutate();
    else createMutation.mutate();
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Header tab helpers ──
  const setHeader = (key: string, value: any) => setConfig(c => ({ ...c, header: { ...c.header, [key]: value } }));

  // ── Attachment tab helpers ──
  const setSheetType = (v: "SS" | "MS") => setConfig(c => ({ ...c, attachment: { ...c.attachment, sheetType: v } }));
  const setSS = (updates: Partial<SingleSheetConfig>) => setConfig(c => ({ ...c, attachment: { ...c.attachment, singleSheet: { ...c.attachment.singleSheet, ...updates } } }));
  const setColField = (field: keyof SingleSheetConfig, updates: Partial<ColumnField>) => {
    setConfig(c => ({ ...c, attachment: { ...c.attachment, singleSheet: { ...c.attachment.singleSheet, [field]: { ...(c.attachment.singleSheet[field] as ColumnField), ...updates } } } }));
  };

  const ss = config.attachment.singleSheet;

  return (
    <div className="p-6 space-y-5 max-w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <FileSpreadsheet className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tariff Profile Templates</h1>
          <p className="text-sm text-muted-foreground">Define Excel/PDF rate sheet layouts and column mappings</p>
        </div>
        <Button data-testid="button-create-template" onClick={openCreate} className="ml-auto gap-2 h-9">
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {/* List */}
      <Card className="border-border/50">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading templates…</span>
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">No templates yet. Create your first one.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/40">
                <TableHead className="w-12">#</TableHead>
                <TableHead>Template Name</TableHead>
                <TableHead className="w-28">Sheet Type</TableHead>
                <TableHead className="w-24 text-center">Status</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id} data-testid={`row-profile-${p.id}`} className="border-border/30 hover:bg-muted/30">
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.id}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {p.config?.attachment?.sheetType === "MS" ? "Multi Sheet" : "Single Sheet"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 inline-block" />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button data-testid={`button-edit-${p.id}`} variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button data-testid={`button-delete-${p.id}`} variant="ghost" size="icon" className="h-7 w-7 text-rose-400 hover:text-rose-300" onClick={() => setDeleteId(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The template will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-rose-600 hover:bg-rose-700">
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={(o) => !o && setEditorOpen(false)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-violet-400" />
              {editingId ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>

          {/* Template name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Template Name <span className="text-rose-400">*</span></Label>
            <Input data-testid="input-template-name" value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="e.g. Default Rate Sheet - FULL" className="h-9" />
          </div>

          {/* 5-tab form */}
          <Tabs defaultValue="header" className="mt-2">
            <TabsList className="grid grid-cols-5 w-full h-9">
              <TabsTrigger value="header" className="text-xs">Header</TabsTrigger>
              <TabsTrigger value="attachment" className="text-xs">Attachment</TabsTrigger>
              <TabsTrigger value="dialcode" className="text-xs">Dial-Code</TabsTrigger>
              <TabsTrigger value="datetime" className="text-xs">Date & Time</TabsTrigger>
              <TabsTrigger value="status" className="text-xs">Status</TabsTrigger>
            </TabsList>

            {/* ── Header Tab ── */}
            <TabsContent value="header" className="mt-4 space-y-0">
              <div className="rounded-lg border border-border/40 overflow-hidden">
                <div className="grid grid-cols-[180px_60px_100px_1fr] gap-3 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <span>Field</span><span>Enable</span><span>Cell</span><span>Title</span>
                </div>
                <div className="px-4 divide-y-0">
                  {[
                    ["Technical Prefix", "technicalPrefixEnable", "technicalPrefixCell", "technicalPrefixTitle"],
                    ["KAM Name", "kamNameEnable", "kamNameCell", "kamNameTitle"],
                    ["KAM Email", "kamEmailEnable", "kamEmailCell", "kamEmailTitle"],
                    ["Inc. Effective Date", "increaseEffectiveDateEnable", "increaseEffectiveDateCell", "increaseEffectiveDateTitle"],
                    ["Dec. Effective Date", "decreaseEffectiveDateEnable", "decreaseEffectiveDateCell", "decreaseEffectiveDateTitle"],
                    ["Product Name", "productNameEnable", "productNameCell", "productNameTitle"],
                    ["Company Name", "companyNameEnable", "companyNameCell", "companyNameTitle"],
                    ["Send Date", "sendDateEnable", "sendDateCell", "sendDateTitle"],
                    ["Send Time", "sendTimeEnable", "sendTimeCell", "sendTimeTitle"],
                    ["Org Logo", "organizationLogoEnable", "organizationLogoCell", "organizationLogoCell"],
                    ["New Code Status", "newCodeStatusEnable", "newCodeStatusCell", "newCodeStatusTitle"],
                    ["No Change Status", "noChangeCodeStatusEnable", "noChangeCodeStatusCell", "noChangeCodeStatusTitle"],
                    ["Increase Status", "increaseCodeStatusEnable", "increaseCodeStatusCell", "increaseCodeStatusTitle"],
                    ["Decrease Status", "decreaseCodeStatusEnable", "decreaseCodeStatusCell", "decreaseCodeStatusTitle"],
                    ["Pend. Increase Status", "pendingIncreaseCodeStatusEnable", "pendingIncreaseCodeStatusCell", "pendingIncreaseCodeStatusTitle"],
                    ["Pend. Decrease Status", "pendingDecreaseCodeStatusEnable", "pendingDecreaseCodeStatusCell", "pendingDecreaseCodeStatusTitle"],
                  ].map(([label, ek, ck, tk]) => (
                    <HeaderRow key={ek} label={label} enableKey={ek} cellKey={ck} titleKey={tk} header={config.header} onChange={setHeader} />
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ── Attachment Tab ── */}
            <TabsContent value="attachment" className="mt-4 space-y-4">
              {/* Sheet type */}
              <div className="flex items-center gap-4">
                <Label className="text-sm font-medium">Sheet Type</Label>
                <div className="flex gap-3">
                  {(["SS", "MS"] as const).map(v => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="sheetType" checked={config.attachment.sheetType === v} onChange={() => setSheetType(v)} className="accent-violet-500" data-testid={`radio-sheet-${v}`} />
                      <span className="text-sm">{v === "SS" ? "Single Sheet" : "Multi Sheet"}</span>
                    </label>
                  ))}
                </div>
              </div>

              {config.attachment.sheetType === "SS" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Sheet Name</Label>
                      <Input data-testid="input-sheet-name" value={ss.name} onChange={e => setSS({ name: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Starting Row</Label>
                      <Input data-testid="input-start-row" type="number" value={ss.startRow} onChange={e => setSS({ startRow: parseInt(e.target.value) || 1 })} className="h-8 text-sm" />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <div className="grid grid-cols-[200px_60px_80px_1fr] gap-3 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <span>Column</span><span>Enable</span><span>Col Letter</span><span>Title</span>
                    </div>
                    <div className="px-4 divide-y-0">
                      {([
                        ["Country", "country"], ["Destination", "destination"], ["Time Band", "timeBand"],
                        ["Old Rate", "oldRate"], ["New Rate", "newRate"], ["Change Rate", "changeRate"],
                        ["Billing Increment", "billingIncrement"], ["Full Code", "fullCode"],
                        ["Country Code", "countryCode"], ["Area Code", "areaCode"], ["Status", "status"],
                        ["Effective DateTime", "effectiveDateTime"], ["Expiration DateTime", "expirationDateTime"],
                      ] as [string, keyof SingleSheetConfig][]).map(([label, key]) => (
                        <ColFieldRow key={key} label={label} field={ss[key] as ColumnField} onChange={u => setColField(key, u)} />
                      ))}
                    </div>
                  </div>
                </>
              )}

              {config.attachment.sheetType === "MS" && (
                <div className="rounded-lg border border-border/40 p-6 text-center text-muted-foreground text-sm">
                  <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Multi-sheet configuration assigns each destination a separate worksheet tab.
                  <br />Use Single Sheet for most use cases.
                </div>
              )}
            </TabsContent>

            {/* ── Dial-Code Format Tab ── */}
            <TabsContent value="dialcode" className="mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Dial Code Prefix</Label>
                  <Input data-testid="input-dialcode-prefix" value={config.dialCodeFormat.dialCodePrefix} onChange={e => setConfig(c => ({ ...c, dialCodeFormat: { ...c.dialCodeFormat, dialCodePrefix: e.target.value } }))} placeholder="e.g. +" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Strip Prefix</Label>
                  <div className="flex items-center gap-2 h-9">
                    <Switch data-testid="switch-strip-prefix" checked={config.dialCodeFormat.stripPrefix} onCheckedChange={v => setConfig(c => ({ ...c, dialCodeFormat: { ...c.dialCodeFormat, stripPrefix: v } }))} />
                    <span className="text-sm text-muted-foreground">Remove prefix when exporting</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Min Length</Label>
                  <Input data-testid="input-min-length" type="number" value={config.dialCodeFormat.minLength ?? ""} onChange={e => setConfig(c => ({ ...c, dialCodeFormat: { ...c.dialCodeFormat, minLength: e.target.value ? parseInt(e.target.value) : null } }))} placeholder="No minimum" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Max Length</Label>
                  <Input data-testid="input-max-length" type="number" value={config.dialCodeFormat.maxLength ?? ""} onChange={e => setConfig(c => ({ ...c, dialCodeFormat: { ...c.dialCodeFormat, maxLength: e.target.value ? parseInt(e.target.value) : null } }))} placeholder="No maximum" className="h-9" />
                </div>
              </div>
            </TabsContent>

            {/* ── Date & Time Tab ── */}
            <TabsContent value="datetime" className="mt-4">
              <div className="grid grid-cols-1 gap-4">
                {[
                  ["Date Format", "dateFormat", "%d-%b-%y", "e.g. %d-%b-%y → 05-Jun-26"],
                  ["Time Format", "timeFormat", "%I:%M %p", "e.g. %I:%M %p → 11:44 AM"],
                  ["DateTime Format", "dateTimeFormat", "%d-%b-%y %I:%M %p", "e.g. %d-%b-%y %I:%M %p"],
                ].map(([label, key, placeholder, hint]) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs font-medium">{label}</Label>
                    <Input data-testid={`input-${key}`} value={(config.dateTime as any)[key]} onChange={e => setConfig(c => ({ ...c, dateTime: { ...c.dateTime, [key]: e.target.value } }))} placeholder={placeholder} className="h-9 font-mono text-sm" />
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── Status Tab ── */}
            <TabsContent value="status" className="mt-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  ["New Code", "newCode"], ["No Change", "noChange"],
                  ["Increase", "increase"], ["Decrease", "decrease"],
                  ["Pending Increase", "pendingIncrease"], ["Pending Decrease", "pendingDecrease"],
                ].map(([label, key]) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs font-medium">{label}</Label>
                    <Input data-testid={`input-status-${key}`} value={(config.status as any)[key]} onChange={e => setConfig(c => ({ ...c, status: { ...c.status, [key]: e.target.value } }))} className="h-9 text-sm" />
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex items-center gap-2 pt-2 border-t border-border/30">
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => toast({ title: "Coming soon", description: "Excel export will be available in the next release." })}>
              <Download className="h-3.5 w-3.5" /> Download Excel
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => toast({ title: "Coming soon", description: "PDF export will be available in the next release." })}>
              <Download className="h-3.5 w-3.5" /> Download PDF
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button data-testid="button-save-template" onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
