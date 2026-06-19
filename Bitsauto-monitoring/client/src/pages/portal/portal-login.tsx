import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Eye, EyeOff } from "lucide-react";

export default function PortalLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);

  const loginMutation = useMutation({
    mutationFn: (accessCode: string) =>
      apiRequest("POST", "/api/portal/auth/login", { accessCode }).then(r => r.json()),
    onSuccess: () => setLocation("/portal/dashboard"),
    onError: () =>
      toast({ title: "Invalid access code", description: "Please check your code and try again.", variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Partner Portal</h1>
          <p className="text-muted-foreground text-sm">Enter your access code to view your account</p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sign In</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="access-code">Access Code</Label>
              <div className="relative">
                <Input
                  id="access-code"
                  data-testid="input-access-code"
                  type={showCode ? "text" : "password"}
                  placeholder="Enter your access code"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && code && loginMutation.mutate(code)}
                  className="pr-10 font-mono"
                />
                <button
                  type="button"
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCode(!showCode)}
                >
                  {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              className="w-full"
              data-testid="button-portal-login"
              disabled={!code || loginMutation.isPending}
              onClick={() => loginMutation.mutate(code)}
            >
              {loginMutation.isPending ? "Verifying…" : "Access Portal"}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Don't have an access code? Contact your account manager.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
