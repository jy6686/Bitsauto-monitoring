import { useState } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Plus, Search, Trash2, Settings2, Wifi, ChevronRight, ChevronLeft,
  Building2, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  DollarSign, Network, ArrowLeft, Eye, EyeOff, Copy, Pencil, Power,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────────

interface SippyVendor {
  iVendor:      number;
  name:         string;
  balance?:     number;
  baseCurrency?: string;
  email?:       string;
  companyName?: string;
}

interface SippyVendorConnection {
  iConnection:          number;
  name:                 string;
  destination:          string;
  username?:            string;
  capacity?:            number;
  enforceCapacity?:     boolean;
  maxCps?:              number;
  blocked?:             boolean;
  iProtoTransport?:     number;
  iMediaRelayType?:     number;
  huntstopScodes?:      string;
  timeout100?:          number;
  translationRule?:     string;
  cliTranslationRule?:  string;
  outboundProxy?:       string;
  outboundIp?:          string;
  ignoreLrn?:           boolean;
  singleOutboundPort?:  boolean;
  acceptRedirects?:     boolean;
  redirectDepthLimit?:  number;
  fromDomain?:          string;
  enableDiversion?:     boolean;
  diversionTranslation?: string;
  iPrivacyMode?:        number;
  useAssertedId?:       boolean;
  assertedIdTranslation?: string;
  randomCallId?:        boolean;
  passRuriParams?:      string;
  qmonAcdEnabled?:      boolean;
  qmonAsrEnabled?:      boolean;
  qmonStatWindow?:      number;
  qmonAcdThreshold?:    number;
  qmonAsrThreshold?:    number;
  qmonRetryInterval?:   number;
  qmonRetryBatch?:      number;
  qmonAction?:          string;
  qmonNotificationEnabled?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtBalance(b?: number, currency = "USD") {
  if (b === undefined || b === null) return "—";
  const sign = b >= 0 ? "" : "-";
  return `${sign}${currency} ${Math.abs(b).toFixed(7)}`;
}

function sectionHeader(title: string) {
  return (
    <div className="col-span-full">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">{title}</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ── Vendor Form Helpers ─────────────────────────────────────────────────────────

function generatePassword(len = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&";
  let pwd = "";
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

function deriveLogin(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

// ── Vendor Form (Add / Edit) ────────────────────────────────────────────────────

type VendorFormData = {
  name: string;
  webLogin: string;
  webPassword: string;
  baseCurrency: string;
  balance: string;
  iTimeZone: string;
  iLang: string;
  iExportType: string;
  roundUp: string;
  costRoundUp: string;
  decimalPrecision: string;
  iPasswordPolicy: string;
  companyName: string;
  salutation: string;
  firstName: string;
  midInit: string;
  lastName: string;
  streetAddr: string;
  state: string;
  postalCode: string;
  city: string;
  country: string;
  contact: string;
  phone: string;
  fax: string;
  altPhone: string;
  altContact: string;
  email: string;
  cc: string;
  bcc: string;
};

const EMPTY_VENDOR_FORM: VendorFormData = {
  name: "", webLogin: "", webPassword: "", baseCurrency: "USD",
  balance: "0.0000000", iTimeZone: "1", iLang: "1", iExportType: "1",
  roundUp: "1", costRoundUp: "1", decimalPrecision: "20", iPasswordPolicy: "1",
  companyName: "", salutation: "", firstName: "", midInit: "", lastName: "",
  streetAddr: "", state: "", postalCode: "", city: "", country: "",
  contact: "", phone: "", fax: "", altPhone: "", altContact: "",
  email: "", cc: "", bcc: "",
};

function VendorDialog({
  open,
  onClose,
  editVendor,
}: {
  open: boolean;
  onClose: () => void;
  editVendor?: SippyVendor;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<VendorFormData>(EMPTY_VENDOR_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [loginEdited, setLoginEdited] = useState(false);

  const set = (k: keyof VendorFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setV = (k: keyof VendorFormData, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    setForm(f => ({
      ...f,
      name,
      webLogin: loginEdited ? f.webLogin : deriveLogin(name),
    }));
  }

  function handleLoginChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLoginEdited(true);
    setForm(f => ({ ...f, webLogin: e.target.value }));
  }

  function regeneratePassword() {
    setForm(f => ({ ...f, webPassword: generatePassword() }));
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() =>
      toast({ title: `${label} copied to clipboard` })
    );
  }

  const createMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest("POST", "/api/sippy/vendors", body)).json(),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: "Vendor created", description: `Vendor #${data.iVendor} created successfully.` });
        qc.invalidateQueries({ queryKey: ["/api/sippy/vendors"] });
        onClose();
      } else {
        toast({ title: "Error", description: data?.error || data?.message || "Failed to create vendor.", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest("PATCH", `/api/sippy/vendors/${editVendor?.iVendor}`, body)).json(),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: "Vendor updated" });
        qc.invalidateQueries({ queryKey: ["/api/sippy/vendors"] });
        onClose();
      } else {
        toast({ title: "Error", description: data?.error || data?.message || "Failed to update vendor.", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isEdit = !!editVendor;
  const isPending = createMut.isPending || updateMut.isPending;

  function handleOpen(o: boolean) {
    if (o) {
      setLoginEdited(false);
      setShowPassword(false);
      if (editVendor) {
        setForm({
          ...EMPTY_VENDOR_FORM,
          name: editVendor.name || "",
          baseCurrency: editVendor.baseCurrency || "USD",
          balance: editVendor.balance?.toFixed(7) ?? "0.0000000",
          email: editVendor.email || "",
          companyName: editVendor.companyName || "",
        });
      } else {
        setForm({ ...EMPTY_VENDOR_FORM, webPassword: generatePassword() });
      }
    }
  }

  function handleSave() {
    if (!form.name.trim()) { toast({ title: "Vendor Name is required.", variant: "destructive" }); return; }
    if (!isEdit && !form.webLogin.trim()) { toast({ title: "Web Login is required.", variant: "destructive" }); return; }
    if (!isEdit && !form.webPassword.trim()) { toast({ title: "Web Password is required.", variant: "destructive" }); return; }
    const body: Record<string, any> = {
      name: form.name, baseCurrency: form.baseCurrency,
      iTimeZone: parseInt(form.iTimeZone) || 1,
      iLang: parseInt(form.iLang) || 1,
      iExportType: parseInt(form.iExportType) || 1,
      roundUp: parseInt(form.roundUp) || 1,
      costRoundUp: parseInt(form.costRoundUp) || 1,
      decimalPrecision: parseInt(form.decimalPrecision) || 20,
      iPasswordPolicy: parseInt(form.iPasswordPolicy) || 1,
    };
    if (!isEdit) { body.webLogin = form.webLogin; body.webPassword = form.webPassword; }
    if (form.companyName) body.companyName = form.companyName;
    if (form.salutation) body.salutation = form.salutation;
    if (form.firstName) body.firstName = form.firstName;
    if (form.midInit) body.midInit = form.midInit;
    if (form.lastName) body.lastName = form.lastName;
    if (form.streetAddr) body.streetAddr = form.streetAddr;
    if (form.state) body.state = form.state;
    if (form.postalCode) body.postalCode = form.postalCode;
    if (form.city) body.city = form.city;
    if (form.country) body.country = form.country;
    if (form.contact) body.contact = form.contact;
    if (form.phone) body.phone = form.phone;
    if (form.fax) body.fax = form.fax;
    if (form.altPhone) body.altPhone = form.altPhone;
    if (form.altContact) body.altContact = form.altContact;
    if (form.email) body.email = form.email;
    if (form.cc) body.cc = form.cc;
    if (form.bcc) body.bcc = form.bcc;
    if (isEdit) updateMut.mutate(body); else createMut.mutate(body);
  }

  return (
    <Dialog open={open} onOpenChange={o => { handleOpen(o); if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Vendor — ${editVendor?.name}` : "Add New Vendor"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 py-2">
          {sectionHeader("Basic Parameters")}

          <Field label="Vendor Name *">
            <Input value={form.name} onChange={handleNameChange} placeholder="e.g. BICS-PR-PR" data-testid="input-vendor-name" />
          </Field>
          <Field label={`Base Currency${isEdit ? " (read-only)" : ""}`}>
            <Select value={form.baseCurrency} onValueChange={v => setV("baseCurrency", v)} disabled={isEdit}>
              <SelectTrigger data-testid="select-vendor-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">US Dollar (USD)</SelectItem>
                <SelectItem value="EUR">Euro (EUR)</SelectItem>
                <SelectItem value="GBP">British Pound (GBP)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {!isEdit && (
            <Field label="Web Login *">
              <div className="relative">
                <Input
                  value={form.webLogin}
                  onChange={handleLoginChange}
                  placeholder="auto-generated from name"
                  data-testid="input-vendor-login"
                  className="pr-8"
                />
                {form.webLogin && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(form.webLogin, "Web Login")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    title="Copy login"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </Field>
          )}
          <Field label="Time Zone">
            <Select value={form.iTimeZone} onValueChange={v => setV("iTimeZone", v)}>
              <SelectTrigger data-testid="select-vendor-tz"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Etc/UTC (1)</SelectItem>
                <SelectItem value="2">US/Eastern (2)</SelectItem>
                <SelectItem value="3">US/Central (3)</SelectItem>
                <SelectItem value="4">US/Mountain (4)</SelectItem>
                <SelectItem value="5">US/Pacific (5)</SelectItem>
                <SelectItem value="6">Europe/London (6)</SelectItem>
                <SelectItem value="7">Europe/Paris (7)</SelectItem>
                <SelectItem value="8">Asia/Dubai (8)</SelectItem>
                <SelectItem value="9">Asia/Kolkata (9)</SelectItem>
                <SelectItem value="10">Asia/Singapore (10)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {!isEdit && (
            <Field label="Web Password *">
              <div className="relative flex items-center gap-1">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.webPassword}
                    onChange={set("webPassword")}
                    data-testid="input-vendor-pass"
                    className="pr-8 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(form.webPassword, "Password")}
                  className="shrink-0 text-muted-foreground hover:text-foreground p-1.5 rounded border border-input bg-background"
                  title="Copy password"
                  data-testid="btn-copy-password"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={regeneratePassword}
                  className="shrink-0 text-muted-foreground hover:text-foreground p-1.5 rounded border border-input bg-background"
                  title="Generate new password"
                  data-testid="btn-regen-password"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </Field>
          )}
          <Field label="Language">
            <Select value={form.iLang} onValueChange={v => setV("iLang", v)}>
              <SelectTrigger data-testid="select-vendor-lang"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">English</SelectItem>
                <SelectItem value="2">Russian</SelectItem>
                <SelectItem value="3">German</SelectItem>
                <SelectItem value="4">French</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {sectionHeader("Advanced Parameters")}

          <Field label="Download Format">
            <Select value={form.iExportType} onValueChange={v => setV("iExportType", v)}>
              <SelectTrigger data-testid="select-vendor-export"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Excel</SelectItem>
                <SelectItem value="2">CSV</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Calls Cost">
            <Select value={form.costRoundUp} onValueChange={v => setV("costRoundUp", v)}>
              <SelectTrigger data-testid="select-vendor-cost"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Round</SelectItem>
                <SelectItem value="0">Truncate</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Password Policy">
            <Select value={form.iPasswordPolicy} onValueChange={v => setV("iPasswordPolicy", v)}>
              <SelectTrigger data-testid="select-vendor-pwpolicy"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Default</SelectItem>
                <SelectItem value="2">Strong</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cost Decimal Precision">
            <Input value={form.decimalPrecision} onChange={set("decimalPrecision")} type="number" data-testid="input-vendor-precision" />
          </Field>

          <Field label="Calls Duration">
            <Select value={form.roundUp} onValueChange={v => setV("roundUp", v)}>
              <SelectTrigger data-testid="select-vendor-duration"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Round</SelectItem>
                <SelectItem value="0">Truncate</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {sectionHeader("Address Info")}

          <Field label="Company Name">
            <Input value={form.companyName} onChange={set("companyName")} data-testid="input-vendor-company" />
          </Field>
          <Field label="Contact">
            <Input value={form.contact} onChange={set("contact")} data-testid="input-vendor-contact" />
          </Field>

          <div className="flex gap-2">
            <Field label="Mr./Ms." className="w-24">
              <Input value={form.salutation} onChange={set("salutation")} data-testid="input-vendor-salutation" />
            </Field>
          </div>
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} data-testid="input-vendor-phone" />
          </Field>

          <div className="flex gap-2">
            <Field label="First Name" className="flex-1">
              <Input value={form.firstName} onChange={set("firstName")} data-testid="input-vendor-first-name" />
            </Field>
            <Field label="M.I." className="w-16">
              <Input value={form.midInit} onChange={set("midInit")} data-testid="input-vendor-mi" />
            </Field>
          </div>
          <Field label="Fax">
            <Input value={form.fax} onChange={set("fax")} data-testid="input-vendor-fax" />
          </Field>

          <Field label="Last Name">
            <Input value={form.lastName} onChange={set("lastName")} data-testid="input-vendor-last-name" />
          </Field>
          <Field label="Alt. Phone">
            <Input value={form.altPhone} onChange={set("altPhone")} data-testid="input-vendor-alt-phone" />
          </Field>

          <Field label="Address" className="col-span-full md:col-span-1">
            <Input value={form.streetAddr} onChange={set("streetAddr")} data-testid="input-vendor-address" />
          </Field>
          <div className="space-y-3">
            <Field label="Alt. Contact">
              <Input value={form.altContact} onChange={set("altContact")} data-testid="input-vendor-alt-contact" />
            </Field>
            <Field label="E-Mail">
              <Input value={form.email} onChange={set("email")} type="email" data-testid="input-vendor-email" />
            </Field>
          </div>

          <Field label="Province/State">
            <Input value={form.state} onChange={set("state")} data-testid="input-vendor-state" />
          </Field>
          <Field label="CC">
            <Input value={form.cc} onChange={set("cc")} data-testid="input-vendor-cc" />
          </Field>

          <Field label="Postal Code">
            <Input value={form.postalCode} onChange={set("postalCode")} data-testid="input-vendor-postal" />
          </Field>
          <Field label="BCC">
            <Input value={form.bcc} onChange={set("bcc")} data-testid="input-vendor-bcc" />
          </Field>

          <Field label="City">
            <Input value={form.city} onChange={set("city")} data-testid="input-vendor-city" />
          </Field>

          <Field label="Country/Region">
            <Input value={form.country} onChange={set("country")} data-testid="input-vendor-country" />
          </Field>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} data-testid="btn-vendor-discard">
            Discard & Close
          </Button>
          <Button onClick={handleSave} disabled={isPending} data-testid="btn-vendor-save">
            {isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {isEdit ? "Save Changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Connection Form (Add / Edit) ────────────────────────────────────────────────

type ConnFormData = {
  name: string;
  destination: string;
  connUsername: string;
  connPassword: string;
  protocol: string;
  capacity: string;
  enforceCapacity: boolean;
  maxCps: string;
  blocked: boolean;
  replyTimeout: string;
  huntstopScodes: string;
  outboundProxy: string;
  outboundIp: string;
  fromDomain: string;
  ignoreLrn: boolean;
  singleOutboundPort: boolean;
  acceptRedirects: boolean;
  redirectDepthLimit: string;
  randomCallId: boolean;
  enableDiversion: boolean;
  useAssertedId: boolean;
  iPrivacyMode: string;
  passRuriParams: string;
  translationRule: string;
  cliTranslationRule: string;
  assertedIdTranslation: string;
  diversionTranslation: string;
  qmonEnabled: boolean;
  qmonAcdThreshold: string;
  qmonAsrThreshold: string;
  qmonRetryInterval: string;
  qmonRetryBatch: string;
  qmonStatWindow: string;
  qmonAction: string;
  qmonNotificationEnabled: boolean;
};

const EMPTY_CONN_FORM: ConnFormData = {
  name: "", destination: "", connUsername: "", connPassword: "",
  protocol: "SIP", capacity: "2", enforceCapacity: true, maxCps: "0",
  blocked: false, replyTimeout: "5", huntstopScodes: "",
  outboundProxy: "", outboundIp: "[Auto]", fromDomain: "",
  ignoreLrn: false, singleOutboundPort: true, acceptRedirects: false,
  redirectDepthLimit: "1", randomCallId: false, enableDiversion: false,
  useAssertedId: false, iPrivacyMode: "0", passRuriParams: "",
  translationRule: "", cliTranslationRule: "",
  assertedIdTranslation: "", diversionTranslation: "",
  qmonEnabled: false, qmonAcdThreshold: "30", qmonAsrThreshold: "15",
  qmonRetryInterval: "600", qmonRetryBatch: "10", qmonStatWindow: "20",
  qmonAction: "make_last_in_routing", qmonNotificationEnabled: false,
};

function connFormFromData(c: SippyVendorConnection): ConnFormData {
  return {
    name: c.name || "",
    destination: c.destination || "",
    connUsername: c.username || "",
    connPassword: "",
    protocol: c.iProtoTransport === 2 ? "TCP" : c.iProtoTransport === 3 ? "TLS" : "SIP",
    capacity: String(c.capacity ?? "2"),
    enforceCapacity: c.enforceCapacity ?? true,
    maxCps: String(c.maxCps ?? "0"),
    blocked: c.blocked ?? false,
    replyTimeout: String(c.timeout100 ?? "5"),
    huntstopScodes: c.huntstopScodes || "",
    outboundProxy: c.outboundProxy || "",
    outboundIp: c.outboundIp || "[Auto]",
    fromDomain: c.fromDomain || "",
    ignoreLrn: c.ignoreLrn ?? false,
    singleOutboundPort: c.singleOutboundPort ?? true,
    acceptRedirects: c.acceptRedirects ?? false,
    redirectDepthLimit: String(c.redirectDepthLimit ?? "1"),
    randomCallId: c.randomCallId ?? false,
    enableDiversion: c.enableDiversion ?? false,
    useAssertedId: c.useAssertedId ?? false,
    iPrivacyMode: String(c.iPrivacyMode ?? "0"),
    passRuriParams: c.passRuriParams || "",
    translationRule: c.translationRule || "",
    cliTranslationRule: c.cliTranslationRule || "",
    assertedIdTranslation: c.assertedIdTranslation || "",
    diversionTranslation: c.diversionTranslation || "",
    qmonEnabled: c.qmonAcdEnabled ?? false,
    qmonAcdThreshold: String(c.qmonAcdThreshold ?? "30"),
    qmonAsrThreshold: String(c.qmonAsrThreshold ?? "15"),
    qmonRetryInterval: String(c.qmonRetryInterval ?? "600"),
    qmonRetryBatch: String(c.qmonRetryBatch ?? "10"),
    qmonStatWindow: String(c.qmonStatWindow ?? "20"),
    qmonAction: c.qmonAction || "make_last_in_routing",
    qmonNotificationEnabled: c.qmonNotificationEnabled ?? false,
  };
}

function ConnectionDialog({
  open,
  onClose,
  vendorId,
  editConn,
}: {
  open: boolean;
  onClose: () => void;
  vendorId: number;
  editConn?: SippyVendorConnection;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<ConnFormData>(EMPTY_CONN_FORM);

  const set = (k: keyof ConnFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setV = (k: keyof ConnFormData, v: any) =>
    setForm(f => ({ ...f, [k]: v }));

  const isEdit = !!editConn;
  const mutUrl = isEdit
    ? `/api/sippy/connections/${editConn!.iConnection}`
    : `/api/sippy/vendors/${vendorId}/connections`;
  const method = isEdit ? "PATCH" : "POST";

  const saveMut = useMutation({
    mutationFn: async (body: object) => (await apiRequest(method, mutUrl, body)).json(),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: isEdit ? "Connection updated" : "Connection created" });
        qc.invalidateQueries({ queryKey: ["/api/sippy/vendors", vendorId, "connections"] });
        onClose();
      } else {
        toast({ title: "Error", description: data?.message || "Operation failed.", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleOpen(o: boolean) {
    if (o) setForm(editConn ? connFormFromData(editConn) : EMPTY_CONN_FORM);
  }

  function handleSave() {
    if (!form.name.trim()) { toast({ title: "Connection Name is required.", variant: "destructive" }); return; }
    if (!form.destination.trim()) { toast({ title: "Destination is required.", variant: "destructive" }); return; }
    const protoMap: Record<string, number> = { SIP: 1, TCP: 2, TLS: 3 };
    const body: Record<string, any> = {
      name: form.name, destination: form.destination,
      iProtoTransport: protoMap[form.protocol] ?? 1,
      capacity: parseInt(form.capacity) || 2,
      enforceCapacity: form.enforceCapacity,
      blocked: form.blocked,
      timeout100: parseFloat(form.replyTimeout) || 5,
      singleOutboundPort: form.singleOutboundPort,
      acceptRedirects: form.acceptRedirects,
      redirectDepthLimit: parseInt(form.redirectDepthLimit) || 1,
      randomCallId: form.randomCallId,
      enableDiversion: form.enableDiversion,
      useAssertedId: form.useAssertedId,
      ...(parseInt(form.iPrivacyMode) > 0 ? { iPrivacyMode: parseInt(form.iPrivacyMode) } : {}),
      ignoreLrn: form.ignoreLrn,
      qmonAcdEnabled: form.qmonEnabled,
      qmonAsrEnabled: form.qmonEnabled,
      qmonStatWindow: parseInt(form.qmonStatWindow) || 20,
      qmonAcdThreshold: parseFloat(form.qmonAcdThreshold) || 30,
      qmonAsrThreshold: parseFloat(form.qmonAsrThreshold) || 15,
      qmonRetryInterval: parseInt(form.qmonRetryInterval) || 600,
      qmonRetryBatch: parseInt(form.qmonRetryBatch) || 10,
      qmonAction: form.qmonAction,
      qmonNotificationEnabled: form.qmonNotificationEnabled,
    };
    if (parseInt(form.maxCps) > 0) body.maxCps = parseInt(form.maxCps);
    if (form.connUsername) body.connUsername = form.connUsername;
    if (form.connPassword) body.connPassword = form.connPassword;
    if (form.outboundProxy) body.outboundProxy = form.outboundProxy;
    if (form.outboundIp && form.outboundIp !== "[Auto]") body.outboundIp = form.outboundIp;
    if (form.fromDomain) body.fromDomain = form.fromDomain;
    if (form.huntstopScodes) body.huntstopScodes = form.huntstopScodes;
    if (form.passRuriParams) body.passRuriParams = form.passRuriParams;
    if (form.translationRule) body.translationRule = form.translationRule;
    if (form.cliTranslationRule) body.cliTranslationRule = form.cliTranslationRule;
    if (form.assertedIdTranslation) body.assertedIdTranslation = form.assertedIdTranslation;
    if (form.diversionTranslation) body.diversionTranslation = form.diversionTranslation;
    saveMut.mutate(body);
  }

  return (
    <Dialog open={open} onOpenChange={o => { handleOpen(o); if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit Connection — ${editConn?.name}` : "Add Connection"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 py-2">
          {sectionHeader("Basic Parameters")}

          <Field label="Connection Name *">
            <Input value={form.name} onChange={set("name")} data-testid="input-conn-name" />
          </Field>
          <Field label="Protocol">
            <Select value={form.protocol} onValueChange={v => setV("protocol", v)}>
              <SelectTrigger data-testid="select-conn-protocol"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SIP">SIP</SelectItem>
                <SelectItem value="TCP">TCP</SelectItem>
                <SelectItem value="TLS">TLS</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Username">
            <Input value={form.connUsername} onChange={set("connUsername")} data-testid="input-conn-username" />
          </Field>
          <Field label="Destination *">
            <Input value={form.destination} onChange={set("destination")} placeholder="SIP:host or IP" data-testid="input-conn-destination" />
          </Field>

          <Field label="Password">
            <Input type="password" value={form.connPassword} onChange={set("connPassword")} data-testid="input-conn-password" />
          </Field>

          {sectionHeader("Advanced Parameters")}

          <Field label="Max CPS">
            <Select value={form.maxCps} onValueChange={v => setV("maxCps", v)}>
              <SelectTrigger data-testid="select-conn-maxcps"><SelectValue placeholder="Unlimited" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Unlimited</SelectItem>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reply Timeout, sec">
            <Input value={form.replyTimeout} onChange={set("replyTimeout")} type="number" data-testid="input-conn-reply-timeout" />
          </Field>

          <Field label="Capacity">
            <Select value={form.capacity} onValueChange={v => setV("capacity", v)}>
              <SelectTrigger data-testid="select-conn-capacity"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,5,10,20,50,100,200,500].map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Huntstop SIP Codes">
            <Input value={form.huntstopScodes} onChange={set("huntstopScodes")} data-testid="input-conn-huntstop" />
          </Field>

          <div className="flex flex-col gap-2 mt-1">
            {[
              ["enforceCapacity", "Enforce Capacity"] as const,
              ["blocked", "Blocked"] as const,
              ["randomCallId", "Random Call-Id"] as const,
              ["ignoreLrn", "Ignore LRN"] as const,
              ["useAssertedId", "Use CLI As P-Asserted-Id"] as const,
            ].map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`ck-${key}`}
                  checked={form[key] as boolean}
                  onCheckedChange={v => setV(key, !!v)}
                  data-testid={`ck-conn-${key}`}
                />
                <label htmlFor={`ck-${key}`} className="text-sm text-muted-foreground cursor-pointer">{label}</label>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 mt-1">
            <Field label="Outbound Proxy">
              <Input value={form.outboundProxy} onChange={set("outboundProxy")} data-testid="input-conn-proxy" />
            </Field>
            <Field label="Outbound IP">
              <Select value={form.outboundIp} onValueChange={v => setV("outboundIp", v)}>
                <SelectTrigger data-testid="select-conn-outbound-ip"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="[Auto]">[Auto]</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="From Domain">
              <Input value={form.fromDomain} onChange={set("fromDomain")} data-testid="input-conn-from-domain" />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            {[
              ["singleOutboundPort", "Single Outbound Port"] as const,
              ["enableDiversion", "Enable Diversion"] as const,
            ].map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`ck2-${key}`}
                  checked={form[key] as boolean}
                  onCheckedChange={v => setV(key, !!v)}
                  data-testid={`ck-conn-${key}`}
                />
                <label htmlFor={`ck2-${key}`} className="text-sm text-muted-foreground cursor-pointer">{label}</label>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Checkbox
                id="ck-acceptRedirects"
                checked={form.acceptRedirects}
                onCheckedChange={v => setV("acceptRedirects", !!v)}
                data-testid="ck-conn-acceptRedirects"
              />
              <label htmlFor="ck-acceptRedirects" className="text-sm text-muted-foreground cursor-pointer">Accept 3xx Redirects</label>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Field label="Redirect Depth Limit">
              <Select value={form.redirectDepthLimit} onValueChange={v => setV("redirectDepthLimit", v)}>
                <SelectTrigger data-testid="select-conn-rdl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,5].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Privacy Mode">
              <Select value={form.iPrivacyMode} onValueChange={v => setV("iPrivacyMode", v)}>
                <SelectTrigger data-testid="select-conn-privacy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Off</SelectItem>
                  <SelectItem value="1">Strict</SelectItem>
                  <SelectItem value="2">Relaxed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Allowed RURI Params">
              <Input value={form.passRuriParams} onChange={set("passRuriParams")} data-testid="input-conn-ruri" />
            </Field>
          </div>

          {sectionHeader("Number Translation")}

          <Field label="CLD Translation Rule">
            <Input value={form.translationRule} onChange={set("translationRule")} placeholder="s/^1/108011/" data-testid="input-conn-cld-rule" />
          </Field>
          <Field label="CLI Translation Rule">
            <Input value={form.cliTranslationRule} onChange={set("cliTranslationRule")} data-testid="input-conn-cli-rule" />
          </Field>
          <Field label="Asserted-Id Tr. Rule">
            <Input value={form.assertedIdTranslation} onChange={set("assertedIdTranslation")} data-testid="input-conn-asserted" />
          </Field>
          <Field label="Diversion Header Tr. Rule">
            <Input value={form.diversionTranslation} onChange={set("diversionTranslation")} data-testid="input-conn-diversion" />
          </Field>

          {sectionHeader("Quality Monitoring")}

          <Field label="Quality Monitoring">
            <Select value={form.qmonEnabled ? "enabled" : "disabled"} onValueChange={v => setV("qmonEnabled", v === "enabled")}>
              <SelectTrigger data-testid="select-conn-qmon"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">Disabled</SelectItem>
                <SelectItem value="enabled">Enabled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Retry Interval, sec">
            <Input value={form.qmonRetryInterval} onChange={set("qmonRetryInterval")} type="number" data-testid="input-conn-retry-interval" />
          </Field>

          <Field label="ACD Threshold, sec">
            <Input value={form.qmonAcdThreshold} onChange={set("qmonAcdThreshold")} type="number" data-testid="input-conn-acd-threshold" />
          </Field>
          <Field label="Retry Batch">
            <Input value={form.qmonRetryBatch} onChange={set("qmonRetryBatch")} type="number" data-testid="input-conn-retry-batch" />
          </Field>

          <Field label="ASR Threshold, %">
            <Input value={form.qmonAsrThreshold} onChange={set("qmonAsrThreshold")} type="number" data-testid="input-conn-asr-threshold" />
          </Field>
          <Field label="Statistics Window">
            <Input value={form.qmonStatWindow} onChange={set("qmonStatWindow")} type="number" data-testid="input-conn-stat-window" />
          </Field>

          <Field label="Bad Quality Action">
            <Select value={form.qmonAction} onValueChange={v => setV("qmonAction", v)}>
              <SelectTrigger data-testid="select-conn-qmon-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="make_last_in_routing">Make Last In Routing</SelectItem>
                <SelectItem value="block">Block Connection</SelectItem>
                <SelectItem value="notify_only">Notify Only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center gap-2 mt-4">
            <Checkbox
              id="ck-qmon-notify"
              checked={form.qmonNotificationEnabled}
              onCheckedChange={v => setV("qmonNotificationEnabled", !!v)}
              data-testid="ck-conn-qmon-notify"
            />
            <label htmlFor="ck-qmon-notify" className="text-sm text-muted-foreground cursor-pointer">Notify On Status Change</label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saveMut.isPending} data-testid="btn-conn-discard">
            Discard & Close
          </Button>
          <Button onClick={handleSave} disabled={saveMut.isPending} data-testid="btn-conn-save">
            {saveMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {isEdit ? "Save Changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Vendor List ─────────────────────────────────────────────────────────────────

function VendorListView({ onSelect }: { onSelect: (v: SippyVendor) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SippyVendor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SippyVendor | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const { data, isLoading, refetch } = useQuery<{ vendors: SippyVendor[]; error?: string }>({
    queryKey: ["/api/sippy/vendors"],
    staleTime: 30_000,
  });

  const vendors = (data?.vendors ?? []).filter(v =>
    !search || v.name.toLowerCase().includes(search.toLowerCase())
  );
  const pages = Math.max(1, Math.ceil(vendors.length / PAGE_SIZE));
  const pageVendors = vendors.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/sippy/vendors/${id}`)).json(),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: "Vendor deleted" });
        qc.invalidateQueries({ queryKey: ["/api/sippy/vendors"] });
      } else {
        toast({ title: "Error", description: data?.message || "Failed to delete.", variant: "destructive" });
      }
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Filter by vendor name…"
              className="pl-8 w-56"
              data-testid="input-vendor-search"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} data-testid="btn-vendors-refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={() => setAddOpen(true)} data-testid="btn-add-vendor">
          <Plus className="h-4 w-4 mr-1.5" /> Add Vendor
        </Button>
      </div>

      {data?.error && (
        <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{data.error}</span>
        </div>
      )}

      <div className="rounded-xl border border-border/50 overflow-hidden bg-card/60">
        {/* Header */}
        <div className="grid px-4 py-2.5 bg-muted/40 border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: "1fr 160px 220px" }}>
          <span>Vendor Name</span>
          <span className="text-right">Balance (USD)</span>
          <span className="text-center">Action</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : pageVendors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Building2 className="h-10 w-10 opacity-30" />
            <p className="text-sm">{search ? "No vendors match your filter." : "No vendors found in Sippy."}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {pageVendors.map((v, i) => (
              <div
                key={v.iVendor}
                className="grid px-4 py-2.5 items-center hover:bg-muted/20 transition-colors"
                style={{ gridTemplateColumns: "1fr 160px 220px" }}
                data-testid={`row-vendor-${v.iVendor}`}
              >
                <button
                  className="text-left text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  onClick={() => onSelect(v)}
                  data-testid={`btn-vendor-name-${v.iVendor}`}
                >
                  {v.name}
                </button>
                <span className={cn("text-right text-sm tabular-nums font-mono",
                  (v.balance ?? 0) > 0 ? "text-emerald-400" : "text-muted-foreground"
                )} data-testid={`text-vendor-balance-${v.iVendor}`}>
                  {fmtBalance(v.balance, v.baseCurrency)}
                </span>
                <div className="flex items-center justify-center gap-1.5">
                  <Link href={`/vendors/${encodeURIComponent(v.name)}`}>
                    <button
                      className="flex items-center gap-1 text-xs font-medium text-sky-500 hover:text-sky-400 transition-colors px-2 py-1 rounded border border-sky-500/30 hover:border-sky-500/60"
                      data-testid={`btn-vendor-profile-${v.iVendor}`}
                    >
                      <Eye className="h-3 w-3" /> Profile
                    </button>
                  </Link>
                  <button
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/70 transition-colors px-2 py-1 rounded border border-primary/30 hover:border-primary/60"
                    onClick={() => onSelect(v)}
                    data-testid={`btn-open-conns-${v.iVendor}`}
                  >
                    <Network className="h-3 w-3" /> Connections
                  </button>
                  <button
                    className="p-1.5 text-muted-foreground/50 hover:text-foreground rounded transition-colors"
                    onClick={() => setEditTarget(v)}
                    title="Edit Vendor"
                    data-testid={`btn-edit-vendor-${v.iVendor}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="p-1.5 text-rose-400/50 hover:text-rose-400 rounded transition-colors"
                    onClick={() => setDeleteTarget(v)}
                    title="Delete Vendor"
                    data-testid={`btn-delete-vendor-${v.iVendor}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {vendors.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/40 bg-muted/20 text-xs text-muted-foreground">
            <span>Page {page + 1} of {pages}, total {vendors.length} rows</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(0)} disabled={page === 0} data-testid="btn-page-first">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} data-testid="btn-page-prev">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} data-testid="btn-page-next">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Add Vendor dialog */}
      <VendorDialog open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Edit Vendor dialog */}
      {editTarget && (
        <VendorDialog open={!!editTarget} onClose={() => setEditTarget(null)} editVendor={editTarget} />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vendor</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete vendor <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-delete-vendor-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.iVendor)}
              disabled={deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-delete-vendor-confirm"
            >
              {deleteMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Vendor Connections View ─────────────────────────────────────────────────────

function VendorConnectionsView({
  vendor,
  onBack,
}: {
  vendor: SippyVendor;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SippyVendorConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SippyVendorConnection | null>(null);

  const { data, isLoading, refetch } = useQuery<{ connections: SippyVendorConnection[]; error?: string }>({
    queryKey: ["/api/sippy/vendors", vendor.iVendor, "connections"],
    staleTime: 30_000,
  });

  const connections = (data?.connections ?? []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.destination?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleBlockMut = useMutation({
    mutationFn: async ({ id, blocked }: { id: number; blocked: boolean }) =>
      (await apiRequest("PATCH", `/api/sippy/connections/${id}`, { blocked })).json(),
    onSuccess: (data: any, vars) => {
      if (data?.success || data?.ok) {
        toast({ title: vars.blocked ? "Connection disabled" : "Connection enabled" });
        qc.invalidateQueries({ queryKey: ["/api/sippy/vendors", vendor.iVendor, "connections"] });
      } else {
        toast({ title: "Failed", description: data?.message ?? "Sippy returned an error", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Error", description: "Could not update connection", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/sippy/connections/${id}`)).json(),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: "Connection deleted" });
        qc.invalidateQueries({ queryKey: ["/api/sippy/vendors", vendor.iVendor, "connections"] });
      } else {
        toast({ title: "Error", description: data?.message || "Failed to delete.", variant: "destructive" });
      }
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={onBack} className="flex items-center gap-1 hover:text-foreground transition-colors" data-testid="btn-back-to-vendors">
          <ArrowLeft className="h-3.5 w-3.5" /> Vendors
        </button>
        <ChevronRight className="h-3.5 w-3.5 opacity-40" />
        <span className="text-foreground font-medium">{vendor.name}</span>
        <ChevronRight className="h-3.5 w-3.5 opacity-40" />
        <span>Connections</span>
      </div>

      {/* Header card */}
      <div className="flex items-center gap-4 bg-card/60 border border-border/50 rounded-xl px-5 py-3.5">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{vendor.name}</p>
          <p className="text-xs text-muted-foreground">
            Balance: <span className={cn("font-mono", (vendor.balance ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {fmtBalance(vendor.balance, vendor.baseCurrency)}
            </span>
            {vendor.companyName && <> · {vendor.companyName}</>}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{connections.length} connection{connections.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name or destination…"
              className="pl-8 w-64"
              data-testid="input-conn-search"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} data-testid="btn-conns-refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={() => setAddOpen(true)} data-testid="btn-add-conn">
          <Plus className="h-4 w-4 mr-1.5" /> Add Connection
        </Button>
      </div>

      {data?.error && (
        <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{data.error}</span>
        </div>
      )}

      <div className="rounded-xl border border-border/50 overflow-hidden bg-card/60">
        <div className="grid px-4 py-2.5 bg-muted/40 border-b border-border/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: "40px 1fr 180px 1fr 1fr 120px" }}>
          <span>Status</span>
          <span>Name</span>
          <span>Destination</span>
          <span>CLD Translation Rule</span>
          <span>CLI Translation Rule</span>
          <span className="text-center">Action</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Wifi className="h-10 w-10 opacity-30" />
            <p className="text-sm">{search ? "No connections match your filter." : "No connections for this vendor."}</p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="mt-1">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add First Connection
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {connections.map((c, i) => (
              <div
                key={c.iConnection}
                className="grid px-4 py-2.5 items-center hover:bg-muted/20 transition-colors text-sm"
                style={{ gridTemplateColumns: "40px 1fr 180px 1fr 1fr 120px" }}
                data-testid={`row-conn-${c.iConnection}`}
              >
                <div className="flex items-center justify-center">
                  {c.blocked
                    ? <XCircle className="h-4 w-4 text-rose-400" data-testid={`status-conn-blocked-${c.iConnection}`} />
                    : <CheckCircle2 className="h-4 w-4 text-emerald-400" data-testid={`status-conn-active-${c.iConnection}`} />
                  }
                </div>
                <button
                  className="text-left font-medium text-primary hover:text-primary/80 transition-colors truncate"
                  onClick={() => setEditTarget(c)}
                  data-testid={`btn-conn-name-${c.iConnection}`}
                >
                  {c.name}
                </button>
                <span className="text-muted-foreground font-mono text-xs truncate" data-testid={`text-conn-dest-${c.iConnection}`}>
                  {c.destination || "—"}
                </span>
                <span className="text-muted-foreground font-mono text-xs truncate" data-testid={`text-conn-cld-${c.iConnection}`}>
                  {c.translationRule || "—"}
                </span>
                <span className="text-muted-foreground font-mono text-xs truncate" data-testid={`text-conn-cli-${c.iConnection}`}>
                  {c.cliTranslationRule || "—"}
                </span>
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => toggleBlockMut.mutate({ id: c.iConnection, blocked: !c.blocked })}
                    disabled={toggleBlockMut.isPending}
                    className={`p-1.5 rounded transition-colors ${c.blocked ? 'text-rose-400/60 hover:text-rose-400' : 'text-emerald-400/60 hover:text-emerald-400'}`}
                    title={c.blocked ? "Enable Connection" : "Disable Connection"}
                    data-testid={`btn-toggle-conn-${c.iConnection}`}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditTarget(c)}
                    className="p-1.5 text-muted-foreground/50 hover:text-foreground rounded transition-colors"
                    title="Edit Connection"
                    data-testid={`btn-edit-conn-${c.iConnection}`}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(c)}
                    className="p-1.5 text-rose-400/50 hover:text-rose-400 rounded transition-colors"
                    title="Delete Connection"
                    data-testid={`btn-delete-conn-${c.iConnection}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Connection dialog */}
      <ConnectionDialog open={addOpen} onClose={() => setAddOpen(false)} vendorId={vendor.iVendor} />

      {/* Edit Connection dialog */}
      {editTarget && (
        <ConnectionDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          vendorId={vendor.iVendor}
          editConn={editTarget}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete connection <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-delete-conn-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.iConnection)}
              disabled={deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="btn-delete-conn-confirm"
            >
              {deleteMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function VendorsPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const vendorIdParam = params.get("id");

  const [selectedVendor, setSelectedVendor] = useState<SippyVendor | null>(null);

  function handleSelectVendor(v: SippyVendor) {
    setSelectedVendor(v);
    navigate(`/vendors?id=${v.iVendor}`);
  }

  function handleBack() {
    setSelectedVendor(null);
    navigate("/vendors");
  }

  const isConnectionsView = !!vendorIdParam;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight" data-testid="heading-vendors">
                {isConnectionsView && selectedVendor ? (
                  <span className="text-muted-foreground font-normal">
                    Vendors / <span className="text-foreground font-bold">{selectedVendor.name}</span> — Connections
                  </span>
                ) : "Vendor Connections"}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isConnectionsView ? "Manage trunk connections for this vendor" : "Manage vendor accounts and their SIP connections on Sippy Softswitch"}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {isConnectionsView && selectedVendor ? (
          <VendorConnectionsView vendor={selectedVendor} onBack={handleBack} />
        ) : isConnectionsView && !selectedVendor ? (
          // URL has id but state doesn't have vendor — handle via query
          <VendorIdLoader vendorId={parseInt(vendorIdParam!, 10)} onBack={handleBack} />
        ) : (
          <VendorListView onSelect={handleSelectVendor} />
        )}
    </div>
  );
}

// ── VendorIdLoader — handles deep-link /vendors?id=123 ─────────────────────────

function VendorIdLoader({ vendorId, onBack }: { vendorId: number; onBack: () => void }) {
  const { data, isLoading } = useQuery<{ vendors: SippyVendor[]; error?: string }>({
    queryKey: ["/api/sippy/vendors"],
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const vendor = data?.vendors.find(v => v.iVendor === vendorId);
  if (!vendor) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <AlertTriangle className="h-10 w-10 text-amber-400/50" />
        <p className="text-sm">Vendor #{vendorId} not found.</p>
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Vendors</Button>
      </div>
    );
  }

  return <VendorConnectionsView vendor={vendor} onBack={onBack} />;
}
