
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Mail, Users, Filter, Send, CheckSquare, Square, AlertTriangle,
  CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Eye,
  RefreshCw, Info, DollarSign, MinusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────

type KamAccount = {
  id: number;
  kamId: number;
  accountId: string;
  clientName: string | null;
  alertEmail: string | null;
  dropThreshold: number | null;
};

type Kam = {
  id: number;
  name: string;
  email: string;
  title: string | null;
  accounts: KamAccount[];
};

type SippyAccount = {
  iAccount: number;
  username: string;
  description: string;
  balance: number;
  creditLimit: number;
};

type Recipient = {
  accountId: string;
  name: string;
  email: string;
  balance: number;
  creditLimit: number;
  kamName: string;
  kamId: number | null;
};

type SendResult = {
  accountId: string;
  name: string;
  email: string;
  status: "sent" | "no_email" | "error";
  error?: string;
};

type BalanceFilter = "all" | "low" | "zero" | "negative";

// ── Templates ──────────────────────────────────────────────────────────────

const TEMPLATES: { id: string; label: string; subject: string; body: string }[] = [
  {
    id: "low_balance",
    label: "Low Balance Warning",
    subject: "⚠️ Low Balance Alert — {name}",
    body: `Dear {name},

This is a courtesy notice that your account balance has dropped to {balance}, which is below your credit limit of {credit_limit}.

To avoid any service interruption, please top up your account at your earliest convenience.

If you have already made a payment, please disregard this message.

Best regards,
Bitsauto Support Team`,
  },
  {
    id: "zero_balance",
    label: "Zero Balance Alert",
    subject: "🚨 Account Suspended — {name}",
    body: `Dear {name},

Your account balance has reached zero. Outgoing calls may be suspended until your balance is replenished.

Current Balance: {balance}
Credit Limit: {credit_limit}

Please top up your account immediately to restore service.

For urgent assistance, please contact your account manager.

Best regards,
Bitsauto Support Team`,
  },
  {
    id: "topup_reminder",
    label: "Top-Up Reminder",
    subject: "💳 Friendly Reminder — Please Top Up Your Account",
    body: `Dear {name},

We wanted to remind you that your current balance is {balance}.

To ensure uninterrupted service, we recommend maintaining a healthy balance above your threshold.

Please log in to your account portal or contact {kam} to arrange a top-up.

Best regards,
Bitsauto Support Team`,
  },
  {
    id: "custom",
    label: "Custom Message",
    subject: "",
    body: "",
  },
];

const TOKEN_HINTS = [
  { token: "{name}",         desc: "Account / client name" },
  { token: "{account}",      desc: "Sippy account ID" },
  { token: "{balance}",      desc: "Current balance (e.g. $45.20)" },
  { token: "{credit_limit}", desc: "Credit limit (e.g. $500.00)" },
  { token: "{kam}",          desc: "KAM name assigned to this account" },
];

// ── Balance helpers ────────────────────────────────────────────────────────

function balancePct(balance: number, creditLimit: number): number | null {
  if (!creditLimit) return null;
  return (balance / creditLimit) * 100;
}

function balanceColor(balance: number, creditLimit: number): string {
  const pct = balancePct(balance, creditLimit);
  if (balance <= 0)   return "text-rose-400";
  if (pct === null)   return "text-muted-foreground";
  if (pct < 15)       return "text-rose-400";
  if (pct < 30)       return "text-amber-400";
  return "text-green-400";
}

function meetsFilter(r: Recipient, filter: BalanceFilter): boolean {
  if (filter === "all")      return true;
  if (filter === "negative") return r.balance < 0;
  if (filter === "zero")     return r.balance <= 0;
  if (filter === "low") {
    if (r.creditLimit > 0) return r.balance / r.creditLimit < 0.20;
    return r.balance < 10;
  }
  return true;
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function EmailCentrePage() {
  const { toast } = useToast();

  // Data fetching
  const { data: kams = [], isLoading: kamsLoading } = useQuery<Kam[]>({
    queryKey: ["/api/kam"],
  });

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: SippyAccount[] }>({
    queryKey: ["/api/sippy/accounts"],
  });

  const sippyAccounts = accountsData?.accounts ?? [];

  // Filters
  const [selectedKamId, setSelectedKamId] = useState<string>("all");
  const [balanceFilter, setBalanceFilter]  = useState<BalanceFilter>("all");

  // Composition
  const [templateId, setTemplateId]    = useState("low_balance");
  const [subject, setSubject]          = useState(TEMPLATES[0].subject);
  const [body, setBody]                = useState(TEMPLATES[0].body);
  const [showPreview, setShowPreview]  = useState(false);
  const [showTokens, setShowTokens]    = useState(false);

  // Send results
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);

  // Build combined recipient list
  const allRecipients = useMemo<Recipient[]>(() => {
    const sippyMap = new Map<string, SippyAccount>();
    for (const a of sippyAccounts) sippyMap.set(String(a.iAccount), a);

    const out: Recipient[] = [];
    for (const kam of kams) {
      for (const ka of kam.accounts) {
        const sippy = sippyMap.get(ka.accountId);
        out.push({
          accountId:   ka.accountId,
          name:        ka.clientName || sippy?.description || sippy?.username || ka.accountId,
          email:       ka.alertEmail ?? "",
          balance:     sippy?.balance     ?? 0,
          creditLimit: sippy?.creditLimit ?? 0,
          kamName:     kam.name,
          kamId:       kam.id,
        });
      }
    }

    // Also include Sippy accounts not assigned to any KAM
    const assignedIds = new Set(kams.flatMap(k => k.accounts.map(a => a.accountId)));
    for (const sippy of sippyAccounts) {
      const id = String(sippy.iAccount);
      if (!assignedIds.has(id)) {
        out.push({
          accountId:   id,
          name:        sippy.description || sippy.username || id,
          email:       "",
          balance:     sippy.balance,
          creditLimit: sippy.creditLimit,
          kamName:     "",
          kamId:       null,
        });
      }
    }

    return out;
  }, [kams, sippyAccounts]);

  // Apply filters
  const filteredRecipients = useMemo<Recipient[]>(() => {
    return allRecipients.filter(r => {
      if (selectedKamId !== "all" && String(r.kamId) !== selectedKamId) return false;
      return meetsFilter(r, balanceFilter);
    });
  }, [allRecipients, selectedKamId, balanceFilter]);

  // Selected subset (checked accounts)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Sync checked IDs when filter changes — auto-check visible recipients
  const visibleIds = useMemo(() => new Set(filteredRecipients.map(r => r.accountId)), [filteredRecipients]);
  const selectedRecipients = filteredRecipients.filter(r => checkedIds.has(r.accountId));

  function toggleAll() {
    if (selectedRecipients.length === filteredRecipients.length) {
      setCheckedIds(prev => {
        const next = new Set(prev);
        for (const r of filteredRecipients) next.delete(r.accountId);
        return next;
      });
    } else {
      setCheckedIds(prev => {
        const next = new Set(prev);
        for (const r of filteredRecipients) next.add(r.accountId);
        return next;
      });
    }
  }

  function toggleOne(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tmpl = TEMPLATES.find(t => t.id === id);
    if (tmpl && id !== "custom") {
      setSubject(tmpl.subject);
      setBody(tmpl.body);
    }
  }

  // Preview with first selected recipient's tokens
  const previewRecipient = selectedRecipients[0] ?? filteredRecipients[0];
  function applyTokens(text: string, r?: Recipient): string {
    if (!r) return text;
    return text
      .replace(/\{name\}/gi, r.name)
      .replace(/\{account\}/gi, r.accountId)
      .replace(/\{balance\}/gi, `$${r.balance.toFixed(2)}`)
      .replace(/\{credit_limit\}/gi, `$${r.creditLimit.toFixed(2)}`)
      .replace(/\{kam\}/gi, r.kamName);
  }

  // Send mutation
  const sendMut = useMutation({
    mutationFn: (payload: { recipients: Recipient[]; subject: string; body: string }) =>
      apiRequest("POST", "/api/email/bulk-send", payload).then(r => r.json()),
    onSuccess: (data: { results: SendResult[]; sent: number; failed: number; skipped: number }) => {
      setSendResults(data.results);
      toast({
        title: `Email sent to ${data.sent} recipient${data.sent !== 1 ? "s" : ""}`,
        description: `${data.skipped} skipped (no email), ${data.failed} failed`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const recipientsWithEmail = selectedRecipients.filter(r => r.email);
  const recipientsNoEmail   = selectedRecipients.filter(r => !r.email);
  const canSend = selectedRecipients.length > 0 && subject.trim() && body.trim() && !sendMut.isPending;

  const isLoading = kamsLoading || accountsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" />
          Email Centre
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compose and send KAM-filtered bulk email notifications to your customers
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* ── Left: Account selector ── */}
        <div className="xl:col-span-2 space-y-4">
          {/* Filters */}
          <div className="bg-card rounded-xl border border-border/50 p-4 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" /> Filters
            </h3>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">KAM</Label>
              <Select value={selectedKamId} onValueChange={setSelectedKamId}>
                <SelectTrigger data-testid="select-kam-filter" className="text-sm">
                  <SelectValue placeholder="All KAMs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All KAMs</SelectItem>
                  {kams.map(k => (
                    <SelectItem key={k.id} value={String(k.id)}>
                      {k.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="null">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Balance</Label>
              <Select value={balanceFilter} onValueChange={v => setBalanceFilter(v as BalanceFilter)}>
                <SelectTrigger data-testid="select-balance-filter" className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  <SelectItem value="low">Low Balance (&lt; 20%)</SelectItem>
                  <SelectItem value="zero">Zero / Depleted</SelectItem>
                  <SelectItem value="negative">Negative Balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Account list */}
          <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
              <span className="text-sm font-medium">
                Accounts
                <Badge variant="secondary" className="ml-2 text-xs">{filteredRecipients.length}</Badge>
              </span>
              <button
                data-testid="btn-toggle-all"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline">
                {selectedRecipients.length === filteredRecipients.length && filteredRecipients.length > 0
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading accounts…</span>
              </div>
            ) : filteredRecipients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Users className="h-8 w-8 opacity-30" />
                <p className="text-sm">No accounts match the current filters</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30 max-h-[420px] overflow-y-auto">
                {filteredRecipients.map(r => {
                  const checked = checkedIds.has(r.accountId);
                  return (
                    <button
                      key={r.accountId}
                      data-testid={`account-row-${r.accountId}`}
                      onClick={() => toggleOne(r.accountId)}
                      className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors hover:bg-muted/30 ${
                        checked ? "bg-primary/5" : ""
                      }`}>
                      <div className="mt-0.5 shrink-0 text-primary">
                        {checked
                          ? <CheckSquare className="h-4 w-4" />
                          : <Square className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{r.name}</span>
                          {!r.email && (
                            <span className="text-xs text-amber-500 shrink-0">(no email)</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs font-mono ${balanceColor(r.balance, r.creditLimit)}`}>
                            ${r.balance.toFixed(2)}
                          </span>
                          {r.kamName && (
                            <span className="text-xs text-muted-foreground truncate">· {r.kamName}</span>
                          )}
                        </div>
                        {r.email && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{r.email}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selection summary */}
            {selectedRecipients.length > 0 && (
              <div className="px-4 py-2 bg-primary/5 border-t border-border/40 text-xs text-muted-foreground flex gap-3">
                <span className="text-primary font-medium">{selectedRecipients.length} selected</span>
                {recipientsWithEmail.length > 0 && (
                  <span className="text-green-400">{recipientsWithEmail.length} have email</span>
                )}
                {recipientsNoEmail.length > 0 && (
                  <span className="text-amber-400">{recipientsNoEmail.length} no email (skipped)</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Compose ── */}
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-card rounded-xl border border-border/50 p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Compose Message
            </h3>

            {/* Template picker */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Template</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    data-testid={`template-${t.id}`}
                    onClick={() => applyTemplate(t.id)}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors text-left ${
                      templateId === t.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/40 hover:border-primary/40 text-muted-foreground hover:text-foreground"
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <Label htmlFor="email-subject" className="text-xs text-muted-foreground uppercase tracking-wide">Subject</Label>
              <Input
                id="email-subject"
                data-testid="input-email-subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. ⚠️ Low Balance Alert — {name}"
                className="text-sm"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="email-body" className="text-xs text-muted-foreground uppercase tracking-wide">Message Body</Label>
                <button
                  data-testid="btn-toggle-tokens"
                  onClick={() => setShowTokens(v => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-3.5 w-3.5" />
                  Variables
                  {showTokens ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>
              {showTokens && (
                <div className="grid grid-cols-2 gap-1.5 p-3 bg-muted/30 rounded-lg border border-border/30 text-xs">
                  {TOKEN_HINTS.map(t => (
                    <div key={t.token} className="flex items-center gap-2">
                      <code
                        className="font-mono text-primary cursor-pointer hover:underline"
                        onClick={() => setBody(b => b + t.token)}
                        title="Click to insert">
                        {t.token}
                      </code>
                      <span className="text-muted-foreground">{t.desc}</span>
                    </div>
                  ))}
                </div>
              )}
              <Textarea
                id="email-body"
                data-testid="input-email-body"
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={10}
                placeholder="Write your message here. Use {name}, {balance}, {credit_limit}, {kam} for personalisation."
                className="text-sm font-mono resize-none"
              />
            </div>

            {/* Preview toggle */}
            <div>
              <button
                data-testid="btn-toggle-preview"
                onClick={() => setShowPreview(v => !v)}
                className="flex items-center gap-2 text-sm text-primary hover:underline">
                <Eye className="h-4 w-4" />
                {showPreview ? "Hide preview" : "Preview with tokens applied"}
                {showPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showPreview && previewRecipient && (
                <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Preview for: <span className="font-semibold text-foreground">{previewRecipient.name}</span>
                  </p>
                  <p className="text-sm font-semibold">{applyTokens(subject, previewRecipient)}</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground mt-2">{applyTokens(body, previewRecipient)}</pre>
                </div>
              )}
            </div>

            {/* Send button */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                data-testid="btn-send-emails"
                onClick={() => sendMut.mutate({ recipients: selectedRecipients, subject, body })}
                disabled={!canSend}
                className="gap-2">
                {sendMut.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</>
                  : <><Send className="h-4 w-4" />Send to {recipientsWithEmail.length} recipient{recipientsWithEmail.length !== 1 ? "s" : ""}</>}
              </Button>
              {selectedRecipients.length === 0 && (
                <p className="text-xs text-muted-foreground">Select accounts on the left to send</p>
              )}
              {selectedRecipients.length > 0 && recipientsWithEmail.length === 0 && (
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  No email addresses on selected accounts
                </p>
              )}
            </div>
          </div>

          {/* Send results */}
          {sendResults && (
            <div className="bg-card rounded-xl border border-border/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  Send Results
                </h3>
                <button
                  data-testid="btn-clear-results"
                  onClick={() => setSendResults(null)}
                  className="text-xs text-muted-foreground hover:text-foreground">
                  Dismiss
                </button>
              </div>

              {/* Summary badges */}
              <div className="flex gap-2 flex-wrap">
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                  {sendResults.filter(r => r.status === "sent").length} sent
                </Badge>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                  {sendResults.filter(r => r.status === "no_email").length} skipped
                </Badge>
                {sendResults.some(r => r.status === "error") && (
                  <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">
                    {sendResults.filter(r => r.status === "error").length} failed
                  </Badge>
                )}
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {sendResults.map((r, i) => (
                  <div
                    key={i}
                    data-testid={`result-row-${r.accountId}`}
                    className="flex items-center gap-2 text-xs py-1.5 border-b border-border/20 last:border-0">
                    {r.status === "sent"     && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />}
                    {r.status === "no_email" && <MinusCircle  className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                    {r.status === "error"    && <XCircle      className="h-3.5 w-3.5 text-rose-400  shrink-0" />}
                    <span className="font-medium">{r.name}</span>
                    {r.email && <span className="text-muted-foreground font-mono">{r.email}</span>}
                    {r.status === "no_email" && <span className="text-amber-400 ml-auto">No email address</span>}
                    {r.status === "error"    && <span className="text-rose-400 ml-auto truncate max-w-[200px]">{r.error}</span>}
                    {r.status === "sent"     && <span className="text-green-400 ml-auto">Sent</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
