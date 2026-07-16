/**
 * workspace-selector.tsx — Multi-portal workspace selector (Sprint 1).
 *
 * Shown when a portal_only user has access to 2+ portals.
 * Displays portal cards; clicking one navigates to that portal.
 */
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, LayoutDashboard } from "lucide-react";

// Friendly display name for each known portal slug
const PORTAL_LABELS: Record<string, string> = {
  noc:        "NOC Portal",
  commercial: "Commercial Portal",
  finance:    "Finance Portal",
  admin:      "Admin Portal",
};

export default function WorkspaceSelectorPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    setLocation("/login");
    return null;
  }

  const portals: string[] = (user as any).portals ?? [];

  if (!portals.length) {
    setLocation("/welcome");
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Select Your Workspace</h1>
        <p className="text-muted-foreground text-sm">
          You have access to {portals.length} portals. Choose where to start.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-2xl">
        {portals.map((slug) => (
          <button
            key={slug}
            onClick={() => setLocation(`/${slug}`)}
            className="flex flex-col items-center gap-3 p-6 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/40 hover:shadow-lg transition-all group text-center"
          >
            <div className="p-3 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <LayoutDashboard className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">
                {PORTAL_LABELS[slug] ?? `${slug.replace(/-/g, " ")} Portal`}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Click to open
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
