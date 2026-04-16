import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Phone, PhoneCall, PhoneOff, Clock, CheckCircle2, XCircle,
  Loader2, ArrowRight, History, Trash2, RefreshCw, ChevronDown,
  Info, Zap, AlertTriangle, ExternalLink, Settings, KeyRound, ShieldAlert, WrenchIcon, ArrowRightLeft,
} from "lucide-react";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  cli: z.string().min(1, "Your phone number (first leg) is required").max(64),
  cld: z.string().min(1, "Destination number is required").max(64),
  iAccount: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

type CallResult = {
  success: boolean;
  callId?: string;
  message: string;
  errorType?: string;
  apiUser?: string;
} | null;

type TestCallLog = {
  id: number;
  cli: string;
  cld: string;
  iAccount: number | null;
  callId: string | null;
  status: string;
  message: string | null;
  createdAt: string;
};

type SippyAccount = {
  iAccount: number;
  username: string;
  balance?: string;
  tariff?: string;
  status?: string;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TestCallPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [callResult, setCallResult] = useState<CallResult>(null);

  // Read pre-filled values from query string (?cli=X&cld=Y)
  const params = new URLSearchParams(window.location.search);
  const prefilledCli = params.get("cli") || "";
  const prefilledCld = params.get("cld") || "";

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cli: prefilledCli,
      cld: prefilledCld,
      iAccount: "__none__",
    },
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("cli")) form.setValue("cli", p.get("cli")!);
    if (p.get("cld")) form.setValue("cld", p.get("cld")!);
  }, [window.location.search]);

  const { data: accounts = [] } = useQuery<SippyAccount[]>({
    queryKey: ["/api/sippy/accounts"],
    queryFn: async () => {
      const res = await fetch("/api/sippy/accounts?iCustomer=1", { credentials: "include" });
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : Array.isArray(d?.accounts) ? d.accounts : [];
    },
    staleTime: 60000,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<TestCallLog[]>({
    queryKey: ["/api/sippy/test-call-logs"],
    refetchInterval: 10000,
  });

  const makeMutation = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest("POST", "/api/sippy/make-call", {
        cli: values.cli.trim(),
        cld: values.cld.trim(),
        iAccount: values.iAccount && values.iAccount !== "__none__" ? Number(values.iAccount) : undefined,
      }),
    onSuccess: async (res) => {
      const data: CallResult = await res.json();
      setCallResult(data);
      qc.invalidateQueries({ queryKey: ["/api/sippy/test-call-logs"] });
      if (data?.success) {
        toast({ title: "Callback initiated", description: data.message });
      } else {
        toast({ title: "Call failed", description: data?.message, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    },
  });

  function onSubmit(values: FormValues) {
    setCallResult(null);
    makeMutation.mutate(values);
  }

  function prefillFromLog(log: TestCallLog) {
    form.setValue("cli", log.cli);
    form.setValue("cld", log.cld);
    if (log.iAccount) form.setValue("iAccount", String(log.iAccount));
    setCallResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const callErrorMsg = callResult?.message?.toLowerCase() ?? '';
  const isModuleError = !callResult?.success && callResult?.errorType === 'call_error' &&
    (callErrorMsg.includes('callback module') || callErrorMsg.includes('module is not available') || callErrorMsg.includes('not available'));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* ── Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Test Call — 2-Way Callback</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Sippy calls your phone first, then bridges you to the destination via <code className="text-xs bg-muted px-1 rounded">make2WayCallback</code>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Left: Form */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-sm font-semibold mb-5 flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Initiate Callback
              </h2>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                  {/* Flow diagram */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-4 py-3 border border-border">
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center font-bold shrink-0">1</span>
                      Sippy calls <strong className="text-foreground/80">your phone</strong>
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center font-bold shrink-0">2</span>
                      You answer → Sippy dials <strong className="text-foreground/80">destination</strong>
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center font-bold shrink-0">✓</span>
                      Bridged
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="cli" render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Your Phone <span className="text-muted-foreground font-normal text-xs">(first leg / CLI)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. +441234567890"
                            data-testid="input-cli"
                            className="font-mono"
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">Sippy will call this number first</p>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="cld" render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Destination <span className="text-muted-foreground font-normal text-xs">(second leg / CLD)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. +449876543210"
                            data-testid="input-cld"
                            className="font-mono"
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">Dialled after you answer</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="iAccount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Billing Account <span className="text-muted-foreground font-normal">(authname source)</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-account">
                            <SelectValue placeholder="Select Sippy account…" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">Auto (first cached account)</SelectItem>
                          {accounts.map(a => (
                            <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                              #{a.iAccount} — {a.username}
                              {a.balance ? ` ($${a.balance})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        The selected account's username is sent as <code className="bg-muted px-0.5 rounded">authname</code> to Sippy
                      </p>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="pt-2 flex gap-3">
                    <Button
                      type="submit"
                      disabled={makeMutation.isPending}
                      data-testid="button-launch-call"
                      className="flex-1 sm:flex-none"
                    >
                      {makeMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Initiating…</>
                      ) : (
                        <><PhoneCall className="h-4 w-4 mr-2" /> Start Callback</>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { form.reset(); setCallResult(null); }}
                      data-testid="button-clear-form"
                    >
                      Clear
                    </Button>
                  </div>
                </form>
              </Form>
            </div>

            {/* ── Result Card */}
            {callResult && (
              <div data-testid="call-result-card" className={`rounded-xl border p-5 flex items-start gap-4 ${
                callResult.success
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-rose-500/5 border-rose-500/20"
              }`}>
                {callResult.success
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                  : <XCircle className="h-5 w-5 text-rose-400 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${callResult.success ? "text-emerald-400" : "text-rose-400"}`}>
                    {callResult.success ? "Callback Initiated — Check Your Phone" : "Call Failed"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{callResult.message}</p>
                  {callResult.callId && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Callback Request ID:</span>
                      <code className="text-xs font-mono bg-background px-2 py-0.5 rounded border border-border text-emerald-300">
                        {callResult.callId}
                      </code>
                    </div>
                  )}
                  {callResult.success && (
                    <div className="mt-3 text-xs text-muted-foreground bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 space-y-1">
                      <p className="font-semibold text-emerald-400/80">What happens next:</p>
                      <p>Your phone will ring in a few seconds. Answer it — Sippy will then dial the destination and bridge the two legs together.</p>
                    </div>
                  )}

                  {!callResult.success && callResult.errorType === 'call_error' && isModuleError && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-2">
                        <WrenchIcon className="h-3.5 w-3.5" /> Callback module not enabled on this Sippy switch
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Sippy returned: <em className="text-foreground/70">&ldquo;{callResult.message}&rdquo;</em>
                      </p>
                      <p className="text-xs font-semibold text-foreground/60">To enable in Sippy Admin:</p>
                      <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                        <li>Log in to Sippy as a system administrator</li>
                        <li>Go to <strong className="text-foreground/70">Applications → Callback</strong> (or <strong className="text-foreground/70">System → Applications</strong>)</li>
                        <li>Enable the <strong className="text-foreground/70">Callback</strong> application / module</li>
                        <li>Ensure the billing account selected has <strong className="text-foreground/70">Callback service</strong> enabled under its plan</li>
                      </ol>
                      <p className="text-xs text-muted-foreground">
                        Alternatively, ask your Sippy reseller or Sippy support to activate the Callback module on this switch.
                      </p>
                    </div>
                  )}

                  {!callResult.success && callResult.errorType === 'call_error' && !isModuleError && (
                    <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 space-y-2">
                      <p className="text-xs font-semibold text-rose-400 flex items-center gap-2">
                        <ShieldAlert className="h-3.5 w-3.5" /> Sippy rejected the callback request
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Sippy fault: <em className="text-foreground/70">&ldquo;{callResult.message}&rdquo;</em>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Common reasons: the <code className="bg-background px-1 rounded font-mono">authname</code> account doesn't exist or has no credit,
                        no route for this destination, the CLI/CLD is blocked, or the account has call limits.
                      </p>
                    </div>
                  )}

                  {!callResult.success && callResult.errorType === 'no_authname' && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" /> No billing account selected
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Select a billing account from the dropdown — its username will be used as the <code className="bg-background px-1 rounded font-mono">authname</code> for Sippy's callback API.
                      </p>
                    </div>
                  )}

                  {!callResult.success && !callResult.errorType && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" /> Callback could not be initiated
                      </p>
                      <p className="text-xs text-muted-foreground">{callResult.message}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Info panel */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-400" /> How it works
              </h3>
              <ul className="text-xs text-muted-foreground space-y-2.5">
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                  Enter your phone number in <strong className="text-foreground/70">Your Phone</strong>. Sippy will call this number first (first leg / CLI).
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                  Enter the number you want to test in <strong className="text-foreground/70">Destination</strong>. Sippy dials this after you answer (second leg / CLD).
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                  Select a <strong className="text-foreground/70">Billing Account</strong> — its Sippy username is sent as <code className="bg-muted px-0.5 rounded">authname</code> to route and bill the call.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center shrink-0 mt-0.5">✓</span>
                  Uses Sippy's official <code className="bg-muted px-0.5 rounded">make2WayCallback</code> XML-RPC method (docs 107448). Requires the API user to have callback origination permission.
                </li>
              </ul>
            </div>

            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-400" /> Permission needed
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                In <strong className="text-foreground/70">Sippy Admin</strong> the API user needs permission to call <code className="bg-muted px-0.5 rounded">make2WayCallback</code>:
              </p>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>System → Administrators → <em>api-user</em></li>
                <li>API Access → enable <strong className="text-foreground/70">Allow XML-RPC call origination</strong></li>
              </ol>
            </div>

            {/* ── History */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" /> Recent Calls
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground"
                  onClick={() => qc.invalidateQueries({ queryKey: ["/api/sippy/test-call-logs"] })}
                  data-testid="button-refresh-logs"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>

              {logsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : logs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No calls yet</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {logs.map(log => (
                    <div
                      key={log.id}
                      data-testid={`log-entry-${log.id}`}
                      className="rounded-lg border border-border bg-background/50 p-3 text-xs cursor-pointer hover:border-primary/30 transition-colors group"
                      onClick={() => prefillFromLog(log)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {log.status === 'success'
                            ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                            : <XCircle className="h-3 w-3 text-rose-400 shrink-0" />}
                          <span className="font-mono truncate text-foreground/80">
                            {log.cli} <ArrowRight className="inline h-2.5 w-2.5" /> {log.cld}
                          </span>
                        </div>
                        <span className="text-muted-foreground/60 shrink-0 whitespace-nowrap">{fmtDate(log.createdAt)}</span>
                      </div>
                      {log.callId && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-muted-foreground/60">Request ID:</span>
                          <code className="font-mono text-emerald-400/80">{log.callId}</code>
                        </div>
                      )}
                      {log.message && log.status !== 'success' && (
                        <p className="mt-1.5 text-rose-400/80 truncate">{log.message.slice(0, 80)}</p>
                      )}
                      <p className="mt-1.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity">
                        Click to re-use these numbers ↑
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
