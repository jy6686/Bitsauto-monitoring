import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();

  const handleLogin = () => {
    setLoading(true);
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md space-y-8 text-center">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="p-4 bg-primary/10 rounded-2xl ring-1 ring-primary/20 shadow-2xl shadow-primary/10">
            <ShieldCheck className="w-12 h-12 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Welcome Back</h1>
            <p className="text-muted-foreground text-sm">Sign in to access the Bitsauto Monitoring Dashboard</p>
          </div>
        </div>

        <div className="bg-card border border-border p-8 rounded-xl shadow-lg shadow-black/5">
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none shadow-md shadow-primary/20"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign in with Replit"}
          </button>
          
          <p className="mt-6 text-xs text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>

      <div className="absolute bottom-8 text-xs text-muted-foreground/50 font-mono">
        Secured by Replit Auth
      </div>
    </div>
  );
}
