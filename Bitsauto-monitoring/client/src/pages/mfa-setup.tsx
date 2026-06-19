import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, Smartphone, KeyRound, Copy, Check,
  ChevronRight, AlertTriangle, Lock, RefreshCw,
} from "lucide-react";

const STEPS = ["setup", "verify", "backup", "done"] as const;
type Step = typeof STEPS[number];

export default function MfaSetupPage() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("setup");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: mfaStatus, isLoading } = useQuery<{
    isEnabled: boolean;
    hasSecret: boolean;
    required: boolean;
  }>({ queryKey: ["/api/security/mfa/status"] });

  const { data: setupData, refetch: startSetup, isFetching: isStarting } = useQuery<{
    qrCode: string;
    secret: string;
    backupCodes: string[];
  }>({
    queryKey: ["/api/security/mfa/setup"],
    enabled: false,
  });

  const verifyMutation = useMutation({
    mutationFn: (token: string) => apiRequest("POST", "/api/security/mfa/verify-setup", { token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/security/mfa/status"] });
      setStep("backup");
    },
    onError: () => toast({ title: "Invalid code", description: "Check the authenticator app and try again.", variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: (token: string) => apiRequest("POST", "/api/security/mfa/disable", { token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/security/mfa/status"] });
      toast({ title: "MFA disabled" });
    },
    onError: () => toast({ title: "Invalid code", description: "Could not disable MFA.", variant: "destructive" }),
  });

  const handleStartSetup = async () => {
    await startSetup();
    setStep("setup");
  };

  const handleVerify = () => {
    if (code.replace(/\s/g, "").length !== 6) return;
    verifyMutation.mutate(code);
  };

  const handleCopySecret = () => {
    if (!setupData?.secret) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <ShieldCheck className="h-6 w-6 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
          <p className="text-sm text-muted-foreground">Protect your account with TOTP authentication</p>
        </div>
      </div>

      {/* Status card */}
      <div className={cn(
        "rounded-xl border p-4 flex items-center gap-3",
        mfaStatus?.isEnabled
          ? "bg-emerald-500/5 border-emerald-500/20"
          : mfaStatus?.required
            ? "bg-rose-500/5 border-rose-500/20"
            : "bg-muted/20 border-border/30"
      )}>
        <div className={cn("p-2 rounded-lg", mfaStatus?.isEnabled ? "bg-emerald-500/10" : "bg-muted/30")}>
          {mfaStatus?.isEnabled
            ? <ShieldCheck className="h-5 w-5 text-emerald-400" />
            : <AlertTriangle className="h-5 w-5 text-amber-400" />}
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">
            {mfaStatus?.isEnabled ? "MFA is active" : "MFA not configured"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {mfaStatus?.isEnabled
              ? "Your account is protected with two-factor authentication"
              : mfaStatus?.required
                ? "MFA is required for your role — please set it up now"
                : "Optional but strongly recommended for your account"}
          </div>
        </div>
        {mfaStatus?.isEnabled && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge>
        )}
        {mfaStatus?.required && !mfaStatus?.isEnabled && (
          <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">Required</Badge>
        )}
      </div>

      {/* Not yet started */}
      {!setupData && !mfaStatus?.isEnabled && (
        <div className="rounded-xl border border-border/40 bg-card/30 p-6 space-y-4">
          <div className="space-y-2">
            <h2 className="font-semibold">How it works</h2>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {[
                "Install an authenticator app (Google Authenticator, Aegis, Authy)",
                "Scan the QR code shown on the next screen",
                "Enter the 6-digit code to confirm setup",
                "Save your backup codes in a secure location",
              ].map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <Button onClick={handleStartSetup} disabled={isStarting} className="w-full gap-2" data-testid="button-start-mfa-setup">
            {isStarting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
            Begin MFA Setup
          </Button>
        </div>
      )}

      {/* Step 1: QR Code */}
      {setupData && step === "setup" && (
        <div className="rounded-xl border border-border/40 bg-card/30 p-6 space-y-5">
          <div className="text-sm font-semibold">Step 1 — Scan this QR code</div>
          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-xl">
              <img src={setupData.qrCode} alt="MFA QR code" className="w-48 h-48" data-testid="mfa-qr-code" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground text-center">Can't scan? Enter this code manually:</div>
            <div className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2 border border-border/30">
              <code className="flex-1 text-xs font-mono text-foreground/80 break-all">{setupData.secret}</code>
              <button onClick={handleCopySecret} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <Button onClick={() => setStep("verify")} className="w-full gap-2" data-testid="button-continue-to-verify">
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Step 2: Verify */}
      {setupData && step === "verify" && (
        <div className="rounded-xl border border-border/40 bg-card/30 p-6 space-y-5">
          <div className="text-sm font-semibold">Step 2 — Verify with your authenticator</div>
          <p className="text-sm text-muted-foreground">Open your authenticator app and enter the 6-digit code for BitsAuto NOC.</p>
          <Input
            placeholder="000 000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            className="text-center text-2xl tracking-widest font-mono"
            maxLength={6}
            data-testid="input-mfa-code"
            onKeyDown={e => e.key === "Enter" && handleVerify()}
          />
          <Button onClick={handleVerify} disabled={verifyMutation.isPending || code.length < 6} className="w-full" data-testid="button-verify-mfa">
            {verifyMutation.isPending ? "Verifying…" : "Verify & Enable MFA"}
          </Button>
        </div>
      )}

      {/* Step 3: Backup codes */}
      {step === "backup" && setupData && (
        <div className="rounded-xl border border-border/40 bg-card/30 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-400" />
            <div className="text-sm font-semibold">Step 3 — Save your backup codes</div>
          </div>
          <p className="text-sm text-muted-foreground">
            Store these codes somewhere safe. Each code can only be used once to recover access if you lose your device.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {setupData.backupCodes.map((c, i) => (
              <div key={i} className="font-mono text-sm px-3 py-2 bg-muted/20 rounded-lg border border-border/30 text-center tracking-wider" data-testid={`backup-code-${i}`}>
                {c}
              </div>
            ))}
          </div>
          <Button onClick={() => setStep("done")} className="w-full gap-2" data-testid="button-mfa-done">
            <Check className="h-4 w-4" /> I've saved my backup codes
          </Button>
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3">
          <ShieldCheck className="h-12 w-12 text-emerald-400 mx-auto" />
          <div className="font-bold text-lg">MFA is now active</div>
          <p className="text-sm text-muted-foreground">Your account is protected. You'll be asked for a code on your next login.</p>
        </div>
      )}

      {/* Disable MFA (if already enabled) */}
      {mfaStatus?.isEnabled && step === "setup" && !setupData && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-rose-400">
            <Lock className="h-4 w-4" /> Disable MFA
          </div>
          <p className="text-xs text-muted-foreground">Enter your current TOTP code to disable two-factor authentication.</p>
          <div className="flex gap-2">
            <Input
              placeholder="6-digit code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              className="font-mono text-center"
              maxLength={6}
              data-testid="input-disable-mfa-code"
            />
            <Button
              variant="destructive"
              onClick={() => disableMutation.mutate(code)}
              disabled={disableMutation.isPending || code.length < 6}
              data-testid="button-disable-mfa"
            >
              {disableMutation.isPending ? "…" : "Disable"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
