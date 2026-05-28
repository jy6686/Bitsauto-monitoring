import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, KeyRound, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MfaVerifyPage() {
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState("");

  const verifyMutation = useMutation({
    mutationFn: (data: { token?: string; backupCode?: string }) =>
      apiRequest("POST", "/api/security/mfa/validate", data),
    onSuccess: () => navigate("/"),
    onError: () => setError("Invalid code. Please try again."),
  });

  const handleSubmit = () => {
    setError("");
    if (useBackup) {
      verifyMutation.mutate({ backupCode: code });
    } else {
      verifyMutation.mutate({ token: code.replace(/\s/g, "") });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <ShieldCheck className="h-10 w-10 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
          <p className="text-sm text-muted-foreground">
            {useBackup
              ? "Enter one of your backup codes to continue"
              : "Enter the 6-digit code from your authenticator app"}
          </p>
        </div>

        {/* Code input */}
        <div className="space-y-3">
          <Input
            placeholder={useBackup ? "XXXX-XXXX" : "000 000"}
            value={code}
            onChange={e => {
              if (useBackup) setCode(e.target.value.toUpperCase().slice(0, 9));
              else setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6));
            }}
            className={cn(
              "text-center text-2xl tracking-widest font-mono h-14",
              error && "border-rose-500"
            )}
            maxLength={useBackup ? 9 : 6}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            autoFocus
            data-testid="input-mfa-verify-code"
          />
          {error && <p className="text-xs text-rose-400 text-center">{error}</p>}

          <Button
            onClick={handleSubmit}
            disabled={verifyMutation.isPending || code.length < (useBackup ? 9 : 6)}
            className="w-full h-11"
            data-testid="button-submit-mfa"
          >
            {verifyMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : "Verify & Continue"}
          </Button>
        </div>

        {/* Switch mode */}
        <div className="text-center">
          <button
            onClick={() => { setUseBackup(v => !v); setCode(""); setError(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 mx-auto"
            data-testid="button-toggle-backup-code"
          >
            <KeyRound className="h-3 w-3" />
            {useBackup ? "Use authenticator code instead" : "Use a backup code instead"}
          </button>
        </div>

        {/* Logout */}
        <div className="text-center pt-2 border-t border-border/20">
          <a href="/api/logout" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            Sign out and use a different account
          </a>
        </div>
      </div>
    </div>
  );
}
