import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search, SlidersHorizontal, Save, Eye, EyeOff,
  ChevronDown, Lock, CheckCheck, ShieldOff,
} from "lucide-react";
import { SIDEBAR_GROUPS } from "@/components/layout-shell";

const ALWAYS_VISIBLE = new Set(['/', '/chat', '/account', '/sidebar-settings']);

const GROUP_COLORS: Record<string, { badge: string; dot: string }> = {
  live_ops:         { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
  routing:          { badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',          dot: 'bg-blue-400'    },
  analytics:        { badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20',    dot: 'bg-violet-400'  },
  intelligence:     { badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',          dot: 'bg-cyan-400'    },
  security_finance: { badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20',          dot: 'bg-rose-400'    },
  platform:         { badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20',       dot: 'bg-slate-400'   },
};

export default function SidebarSettingsPage() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SIDEBAR_GROUPS.map(g => [g.key, true]))
  );
  const [localHidden, setLocalHidden] = useState<Set<string> | null>(null);

  const { data: visibilityData, isLoading } = useQuery<{ hiddenItems: string[] }>({
    queryKey: ['/api/settings/sidebar-visibility'],
    staleTime: 30_000,
  });

  useEffect(() => {
    if (visibilityData && localHidden === null) {
      setLocalHidden(new Set(visibilityData.hiddenItems));
    }
  }, [visibilityData]);

  const hiddenItems: Set<string> = localHidden ?? new Set(visibilityData?.hiddenItems ?? []);

  const saveMutation = useMutation({
    mutationFn: (hidden: string[]) =>
      apiRequest('POST', '/api/settings/sidebar-visibility', { hiddenItems: hidden }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings/sidebar-visibility'] });
      toast({ title: 'Sidebar configuration saved', description: 'Changes are now live for all users.' });
    },
    onError: () =>
      toast({ title: 'Save failed', description: 'Could not save sidebar configuration.', variant: 'destructive' }),
  });

  const allConfigurableItems = useMemo(
    () => SIDEBAR_GROUPS.flatMap(g => g.items.filter(item => !ALWAYS_VISIBLE.has(item.href))),
    []
  );

  const totalItems = allConfigurableItems.length;
  const hiddenCount = [...hiddenItems].filter(h => !ALWAYS_VISIBLE.has(h)).length;
  const visibleCount = totalItems - hiddenCount;

  const toggleItem = (href: string) => {
    if (ALWAYS_VISIBLE.has(href)) return;
    setLocalHidden(prev => {
      const next = new Set(prev ?? hiddenItems);
      if (next.has(href)) next.delete(href); else next.add(href);
      return next;
    });
  };

  const enableAll = () => setLocalHidden(new Set());

  const hideAll = () => {
    setLocalHidden(new Set(allConfigurableItems.map(i => i.href)));
  };

  const enableGroup = (groupKey: string) => {
    const group = SIDEBAR_GROUPS.find(g => g.key === groupKey);
    if (!group) return;
    setLocalHidden(prev => {
      const next = new Set(prev ?? hiddenItems);
      group.items.forEach(item => { if (!ALWAYS_VISIBLE.has(item.href)) next.delete(item.href); });
      return next;
    });
  };

  const disableGroup = (groupKey: string) => {
    const group = SIDEBAR_GROUPS.find(g => g.key === groupKey);
    if (!group) return;
    setLocalHidden(prev => {
      const next = new Set(prev ?? hiddenItems);
      group.items.forEach(item => { if (!ALWAYS_VISIBLE.has(item.href)) next.add(item.href); });
      return next;
    });
  };

  const handleSave = () => {
    saveMutation.mutate([...hiddenItems].filter(h => !ALWAYS_VISIBLE.has(h)));
  };

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return SIDEBAR_GROUPS;
    const q = search.toLowerCase();
    return SIDEBAR_GROUPS.map(g => ({
      ...g,
      items: g.items.filter(item => item.label.toLowerCase().includes(q) || item.href.toLowerCase().includes(q)),
    })).filter(g => g.items.length > 0);
  }, [search]);

  const toggleGroup = (key: string) =>
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  if (role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
        <ShieldOff className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <SlidersHorizontal className="h-5 w-5 text-violet-400" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Sidebar Menu Configuration</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Choose which features appear in the sidebar. Hidden items stay accessible by direct URL.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={enableAll} className="gap-1.5 text-xs" data-testid="button-show-all">
            <Eye className="h-3.5 w-3.5" /> Show All
          </Button>
          <Button variant="outline" size="sm" onClick={hideAll} className="gap-1.5 text-xs text-rose-400 border-rose-500/20 hover:bg-rose-500/10" data-testid="button-hide-all">
            <EyeOff className="h-3.5 w-3.5" /> Hide All
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="gap-1.5"
            data-testid="button-save-sidebar"
          >
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Visible in Sidebar',  val: visibleCount, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/20'    },
          { label: 'Hidden from Sidebar', val: hiddenCount,  color: 'text-rose-400',    bg: 'bg-rose-500/5 border-rose-500/20'          },
          { label: 'Total Features',      val: totalItems,   color: 'text-foreground',  bg: 'bg-muted/20 border-border/30'              },
        ].map(s => (
          <div key={s.label} className={cn("rounded-xl border p-4 text-center", s.bg)} data-testid={`stat-${s.label.toLowerCase().replace(/ /g, '-')}`}>
            <div className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
        <Input
          placeholder="Search features by name or path…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-features"
        />
      </div>

      {/* ── Always-visible note ── */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-muted/20 border border-border/30 text-sm text-muted-foreground">
        <Lock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
        <span>
          <span className="font-medium text-foreground/70">Dashboard</span>,{' '}
          <span className="font-medium text-foreground/70">Team Chat</span>, and{' '}
          <span className="font-medium text-foreground/70">My Account</span>{' '}
          are always visible and cannot be hidden.
        </span>
      </div>

      {/* ── Groups ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(group => {
            const isOpen = expandedGroups[group.key] !== false;
            const groupTotal   = group.items.length;
            const groupVisible = group.items.filter(item =>
              ALWAYS_VISIBLE.has(item.href) || !hiddenItems.has(item.href)
            ).length;
            const colors = GROUP_COLORS[group.key] ?? GROUP_COLORS.platform;
            const allOn  = group.items.every(i => ALWAYS_VISIBLE.has(i.href) || !hiddenItems.has(i.href));
            const allOff = group.items.every(i => !ALWAYS_VISIBLE.has(i.href) && hiddenItems.has(i.href));

            return (
              <div key={group.key} className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">

                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-muted/10">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-2.5 flex-1 text-left min-w-0"
                    data-testid={`sidebar-group-toggle-${group.key}`}
                  >
                    <ChevronDown className={cn(
                      "h-4 w-4 text-muted-foreground/50 transition-transform flex-shrink-0",
                      isOpen && "rotate-180"
                    )} />
                    <div className={cn("w-2 h-2 rounded-full flex-shrink-0", colors.dot)} />
                    <span className="font-semibold text-sm">{group.label}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4 leading-none border flex-shrink-0", colors.badge)}>
                      {groupVisible}/{groupTotal}
                    </Badge>
                    {allOn  && <span className="text-[10px] text-emerald-400/60">all visible</span>}
                    {allOff && <span className="text-[10px] text-rose-400/60">all hidden</span>}
                  </button>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => enableGroup(group.key)}
                      className="text-[11px] px-2.5 py-1 rounded-md text-emerald-400 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20 transition-colors"
                      data-testid={`button-enable-group-${group.key}`}
                    >
                      All On
                    </button>
                    <button
                      onClick={() => disableGroup(group.key)}
                      className="text-[11px] px-2.5 py-1 rounded-md text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                      data-testid={`button-disable-group-${group.key}`}
                    >
                      All Off
                    </button>
                  </div>
                </div>

                {/* Items */}
                {isOpen && (
                  <div className="divide-y divide-border/20">
                    {group.items.map(item => {
                      const isLocked  = ALWAYS_VISIBLE.has(item.href);
                      const isVisible = isLocked || !hiddenItems.has(item.href);
                      const Icon      = item.icon;

                      return (
                        <div
                          key={item.href}
                          className={cn(
                            "flex items-center gap-3 px-4 py-3 transition-colors select-none",
                            isLocked
                              ? "opacity-45"
                              : isVisible
                                ? "hover:bg-white/[0.03] cursor-pointer"
                                : "hover:bg-white/[0.02] cursor-pointer bg-muted/[0.015]"
                          )}
                          onClick={isLocked ? undefined : () => toggleItem(item.href)}
                          data-testid={`sidebar-item-${item.href.replace(/\//g, '-').slice(1) || 'home'}`}
                        >
                          {/* Icon */}
                          <div className={cn(
                            "p-1.5 rounded-md flex-shrink-0 transition-colors",
                            isVisible ? "bg-white/[0.07]" : "bg-white/[0.02]"
                          )}>
                            <Icon className={cn(
                              "h-3.5 w-3.5 transition-colors",
                              isVisible ? "text-foreground/75" : "text-muted-foreground/25"
                            )} />
                          </div>

                          {/* Label + path */}
                          <div className="flex-1 min-w-0">
                            <div className={cn(
                              "text-[13px] font-medium leading-tight transition-colors",
                              isVisible ? "text-foreground/90" : "text-muted-foreground/35"
                            )}>
                              {item.label}
                            </div>
                            <div className="text-[11px] text-muted-foreground/35 font-mono mt-0.5">{item.href}</div>
                          </div>

                          {/* Badges */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {item.isNew && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 tracking-wide leading-none">
                                NEW
                              </span>
                            )}
                            {item.status === 'planned' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground/40 border border-border/20 leading-none">
                                SOON
                              </span>
                            )}
                            {item.status === 'live' && (
                              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            )}

                            {/* Toggle or lock */}
                            {isLocked ? (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35">
                                <Lock className="h-3 w-3" />
                                <span>Always on</span>
                              </div>
                            ) : (
                              <Switch
                                checked={isVisible}
                                onCheckedChange={() => toggleItem(item.href)}
                                onClick={e => e.stopPropagation()}
                                data-testid={`toggle-${item.href.replace(/\//g, '-').slice(1) || 'home'}`}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {filteredGroups.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No features match "{search}"
            </div>
          )}
        </div>
      )}

      {/* ── Footer save bar ── */}
      <div className="flex items-center justify-between pt-4 pb-4 border-t border-border/20 sticky bottom-0 bg-background/80 backdrop-blur-sm -mx-1 px-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCheck className="h-3.5 w-3.5 text-emerald-400/60" />
          <span>
            <span className="font-medium text-foreground/60">{visibleCount}</span> of{' '}
            <span className="font-medium text-foreground/60">{totalItems}</span> features visible
          </span>
        </div>
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="gap-1.5"
          data-testid="button-save-sidebar-footer"
        >
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
