import { Loader2, ShieldCheck, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { resolvePortalDestination } from "@/lib/portal-resolver";

// Error codes returned by POST /api/auth/login
const ERROR_MESSAGES: Record<string, string> = {
  account_not_found: "No account found with that email or username.",
  wrong_password:    "Incorrect password. Please try again.",
  account_disabled:  "Your account has been disabled. Contact your administrator.",
  no_password:       'This account requires "Sign in with Replit".',
  missing_identifier:"Email or username is required.",
  missing_password:  "Password is required.",
};

function validateIdentifier(v: string): string | null {
  if (!v.trim()) return "Email or username is required.";
  return null;
}

function validatePassword(v: string): string | null {
  if (!v) return "Password is required.";
  return null;
}

export default function LoginPage() {
  const [, navigate]                        = useLocation();
  const [identifier, setIdentifier]         = useState("");
  const [password, setPassword]             = useState("");
  const [showPassword, setShowPassword]     = useState(false);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [fieldErrors, setFieldErrors]       = useState<{ identifier?: string; password?: string }>({});
  const [touched, setTouched]               = useState<{ identifier?: boolean; password?: boolean }>({});

  const identifierError = touched.identifier ? validateIdentifier(identifier) : null;
  const passwordError   = touched.password   ? validatePassword(password)   : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Mark all fields touched so errors show immediately on submit attempt
    setTouched({ identifier: true, password: true });

    const idErr  = validateIdentifier(identifier);
    const pwErr  = validatePassword(password);
    if (idErr || pwErr) {
      setFieldErrors({ identifier: idErr ?? undefined, password: pwErr ?? undefined });
      return;
    }
    setFieldErrors({});
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        const code = data.code as string | undefined;
        setError(
          (code && ERROR_MESSAGES[code])
            ? ERROR_MESSAGES[code]
            : (data.message ?? "Login failed. Please try again.")
        );
        return;
      }

      // Fetch the full user profile (includes assignedPortals) to resolve landing route
      const profileRes = await fetch("/api/auth/user", { credentials: "include" });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        const resolution = resolvePortalDestination({
          platformAccessType: profile.platformAccessType ?? "full_platform",
          portals:            profile.assignedPortals ?? profile.portals ?? [],
          defaultPortal:      profile.defaultPortal ?? null,
        });
        navigate(resolution.destination);
      } else {
        // Fallback: /welcome handles the resolution via WelcomePage
        navigate("/welcome");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full px-3 py-2.5 rounded-lg bg-background border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-all text-sm ${
      hasError
        ? "border-destructive focus:ring-destructive/30 focus:border-destructive"
        : "border-border focus:ring-primary/50 focus:border-primary"
    }`;

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
            <p className="text-muted-foreground text-sm">
              Sign in to access the Bitsauto Monitoring Dashboard
            </p>
          </div>
        </div>

        <div className="bg-card border border-border p-8 rounded-xl shadow-lg shadow-black/5">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email / Username */}
            <div className="space-y-1.5 text-left">
              <label className="text-sm font-medium text-foreground" htmlFor="identifier">
                Email or Username
              </label>
              <input
                id="identifier"
                data-testid="input-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, identifier: true }))}
                placeholder="you@company.com"
                className={inputClass(!!(identifierError || fieldErrors.identifier))}
                disabled={loading}
              />
              {(identifierError || fieldErrors.identifier) && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-1" data-testid="error-identifier">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {identifierError || fieldErrors.identifier}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5 text-left">
              <label className="text-sm font-medium text-foreground" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  placeholder="••••••••"
                  className={`${inputClass(!!(passwordError || fieldErrors.password))} pr-10`}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {(passwordError || fieldErrors.password) && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-1" data-testid="error-password">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {passwordError || fieldErrors.password}
                </p>
              )}
            </div>

            {/* Global error (from server) */}
            {error && (
              <div
                className="px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm text-left flex items-start gap-2"
                data-testid="error-global"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              data-testid="button-submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none shadow-md shadow-primary/20 mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* DEV-only Replit fallback — never visible in production */}
          {import.meta.env.DEV && (
            <div className="mt-6 pt-6 border-t border-border">
              <button
                onClick={() => { window.location.href = "/api/login"; }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                data-testid="button-dev-login"
              >
                Developer Login (Replit)
              </button>
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>

      <div className="absolute bottom-8 text-xs text-muted-foreground/50 font-mono">
        Secured by Bitsauto Auth
      </div>
    </div>
  );
}
