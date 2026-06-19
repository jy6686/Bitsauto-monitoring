import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Star, X, GripVertical } from "lucide-react";
import type { UserFavorite } from "@shared/schema";

export function FavoritesStrip() {
  const { user } = useAuth();
  const [location] = useLocation();

  const { data: favorites = [] } = useQuery<UserFavorite[]>({
    queryKey: ["/api/favorites"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const removeFav = useMutation({
    mutationFn: (moduleKey: string) => apiRequest("DELETE", `/api/favorites/${moduleKey}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/favorites"] }),
  });

  if (!user || favorites.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden flex-shrink-0">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30 px-1.5 flex-shrink-0">
        <Star className="h-2.5 w-2.5 inline-block" />
      </span>
      {favorites.map(fav => {
        const isActive = location === fav.route || location.startsWith(fav.route + "/");
        return (
          <div key={fav.moduleKey} className="group relative flex items-center flex-shrink-0">
            <Link
              href={fav.route}
              data-testid={`fav-${fav.moduleKey}`}
              className={cn(
                "flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap",
                isActive
                  ? "bg-white/[0.1] text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.06]"
              )}
            >
              {fav.label ?? fav.moduleKey}
            </Link>
            <button
              onClick={() => removeFav.mutate(fav.moduleKey)}
              data-testid={`remove-fav-${fav.moduleKey}`}
              className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-background border border-white/[0.1] text-muted-foreground/50 hover:text-rose-400 items-center justify-center hidden group-hover:flex transition-colors"
            >
              <X className="h-2 w-2" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Hook to add a favorite from anywhere in the app
export function useAddFavorite() {
  return useMutation({
    mutationFn: (data: { moduleKey: string; label: string; icon: string; route: string; portalKey?: string }) =>
      apiRequest("POST", "/api/favorites", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/favorites"] }),
  });
}
