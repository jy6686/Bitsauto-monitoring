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
  Info, Zap,
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
  cli: z.string().min(1, "Caller number (CLI) is required").max(64),
  cld: z.string().min(1, "Called number (CLD) is required").max(64),
  iAccount: z.string().optional(),
  billingCode: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

type CallResult = {
  success: boolean;
  callId?: string;
  message: string;
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
      billingCode: "",
    },
  });

  // Re-populate when URL changes (click-to-call from another page)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("cli")) form.setValue("cli", p.get("cli")!);
    if (p.get("cld")) form.setValue("cld", p.get("cld")!);
  }, [window.location.search]);

  // Sippy accounts list for the account picker
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

  // Recent test call history
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
        billingCode: values.billingCode || undefined,
      }),
    onSuccess: async (res) => {
      const data: CallResult = await res.json();
      setCallResult(data);
      qc.invalidateQueries({ queryKey: ["/api/sippy/test-call-logs"] });
      if (data?.success) {
        toast({ title: "Call launched", description: data.message });
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* ── Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <PhoneCall className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Test Call Launcher</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Originate a call via Sippy Softswitch — logs result and call ID
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Left: Form */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-card border border-border rounded-xl p-6">
              <h2 className="text-sm font-semibold mb-5 flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Launch Call
              </h2>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="cli" render={({ field }) => (
                      <FormItem>
                        <FormLabel>From (CLI)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. +441234567890"
                            data-testid="input-cli"
                            className="font-mono"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="cld" render={({ field }) => (
                      <FormItem>
                        <FormLabel>To (CLD)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. +449876543210"
                            data-testid="input-cld"
                            className="font-mono"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="iAccount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing Account <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-account">
                            <SelectValue placeholder="Select Sippy account…" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">No account / use default</SelectItem>
                          {accounts.map(a => (
                            <SelectItem key={a.iAccount} value={String(a.iAccount)}>
                              #{a.iAccount} — {a.username}
                              {a.balance ? ` ($${a.balance})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="billingCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing Code <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. TEST-001" data-testid="input-billing-code" />
                      </FormControl>
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
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Launching…</>
                      ) : (
                        <><PhoneCall className="h-4 w-4 mr-2" /> Launch Call</>
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
                    {callResult.success ? "Call Initiated Successfully" : "Call Failed"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{callResult.message}</p>
                  {callResult.callId && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Call ID:</span>
                      <code className="text-xs font-mono bg-background px-2 py-0.5 rounded border border-border text-emerald-300">
                        {callResult.callId}
                      </code>
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
                  Enter the caller (CLI) and called (CLD) phone numbers in E.164 or local format.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                  Optionally select a billing account — Sippy will route the call through that account's tariff.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                  Click Launch. The request hits Sippy's <code className="bg-background px-1 rounded">makeCall</code> XML-RPC endpoint.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5">4</span>
                  On success, a call ID is returned and the call appears in the Live Calls dashboard.
                </li>
              </ul>
            </div>

            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
              <p className="text-xs text-amber-400/80 leading-relaxed">
                <strong className="text-amber-400">Note:</strong> This sends a real call origination request to the Sippy switch.
                Use test numbers or internal extensions to avoid unexpected charges.
              </p>
            </div>
          </div>
        </div>

        {/* ── History Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" /> Recent Test Calls
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/sippy/test-call-logs"] })}
              data-testid="button-refresh-logs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading history…
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Phone className="h-8 w-8 opacity-30" />
              <p className="text-sm">No test calls yet. Launch one above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Time", "From (CLI)", "To (CLD)", "Account", "Call ID", "Status", "Message", ""].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      data-testid={`row-testcall-${log.id}`}
                      className="hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                      <td className="px-3 py-2 font-mono text-foreground/80">{log.cli}</td>
                      <td className="px-3 py-2 font-mono text-foreground/80">{log.cld}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {log.iAccount ? `#${log.iAccount}` : <span className="opacity-40">—</span>}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {log.callId
                          ? <code className="text-emerald-400 text-[10px]">{log.callId}</code>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {log.status === "success" ? (
                          <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/5 text-[10px]">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Success
                          </Badge>
                        ) : log.status === "error" ? (
                          <Badge variant="outline" className="text-rose-400 border-rose-500/30 bg-rose-500/5 text-[10px]">
                            <XCircle className="h-2.5 w-2.5 mr-1" /> Error
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 bg-yellow-500/5 text-[10px]">
                            <Clock className="h-2.5 w-2.5 mr-1" /> Pending
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate" title={log.message || ""}>
                        {log.message || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => prefillFromLog(log)}
                          data-testid={`button-reuse-${log.id}`}
                          title="Re-use these numbers"
                          className="text-primary/60 hover:text-primary transition-colors"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
