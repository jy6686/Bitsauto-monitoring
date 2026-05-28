import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { LayoutShell } from "@/components/layout-shell";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Plus, Pencil, Trash2, Check, X, ChevronDown,
  Circle, Eye, EyeOff, Layers, AlertCircle, Shield, Save,
  LayoutDashboard, Users, Activity, BarChart3, FileText, Wallet,
  SendHorizonal, GitBranch, Megaphone, MessageSquare, BarChart2,
  ClipboardList, ReceiptText, Phone, Bell, Monitor, Radio, ShieldAlert,
  Settings, Key, Lock, Banknote, ArrowRightLeft, FileSpreadsheet,
  TrendingDown, BrainCircuit, SlidersHorizontal, HeartPulse, Zap, Wrench,
} from "lucide-react";
import type { PortalDefinition, PortalSection, PortalModuleWithMeta, NavigationModule } from "@shared/schema";

// ── Icon registry ──────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard, "users": Users, "heart-pulse": HeartPulse,
  "zap": Zap, "activity": Activity, "bar-chart-3": BarChart3, "file-text": FileText,
  "wallet": Wallet, "send-horizonal": SendHorizonal, "git-branch": GitBranch,
  "megaphone": Megaphone, "message-square": MessageSquare, "bar-chart-2": BarChart2,
  "clipboard-list": ClipboardList, "receipt-text": ReceiptText, "phone": Phone,
  "bell": Bell, "monitor": Monitor, "radio": Radio, "shield-alert": ShieldAlert,
  "shield-check": ShieldAlert, "settings": Settings, "layers": Layers, "key": Key,
  "lock": Lock, "sliders-horizontal": SlidersHorizontal, "banknote": Banknote,
  "arrow-right-left": ArrowRightLeft, "file-spreadsheet": FileSpreadsheet,
  "trending-down": TrendingDown, "brain-circuit": BrainCircuit, "wrench": Wrench,
};
function Icon({ k, className }: { k: string; className?: string }) {
  const C = ICON_MAP[k] ?? Circle;
  return <C className={className} />;
}

const THEME_DOT: Record<string, string> = {
  purple: "bg-purple-400", blue: "bg-blue-400", green: "bg-emerald-400",
  indigo: "bg-indigo-400", slate: "bg-slate-400", white: "bg-sky-400", neutral: "bg-violet-400",
};
const THEME_RING: Record<string, string> = {
  purple: "ring-purple-400/40", blue: "ring-blue-400/40", green: "ring-emerald-400/40",
  indigo: "ring-indigo-400/40", slate: "ring-slate-400/40", white: "ring-sky-400/40", neutral: "ring-violet-400/40",
};
const THEME_ACCENT: Record<string, string> = {
  purple: "text-purple-400", blue: "text-blue-400", green: "text-emerald-400",
  indigo: "text-indigo-400", slate: "text-slate-400", white: "text-sky-400", neutral: "text-violet-400",
};
const THEME_ACCENT_BG: Record<string, string> = {
  purple: "bg-purple-500/10 text-purple-300", blue: "bg-blue-500/10 text-blue-300",
  green: "bg-emerald-500/10 text-emerald-300", indigo: "bg-indigo-500/10 text-indigo-300",
  slate: "bg-slate-500/10 text-slate-300", white: "bg-sky-500/10 text-sky-300",
  neutral: "bg-violet-500/10 text-violet-300",
};
const THEME_OPTIONS = ["purple", "blue", "green", "indigo", "slate", "neutral"];
const ICON_OPTIONS = [
  "layout-dashboard", "users", "activity", "bar-chart-3", "file-text", "wallet",
  "send-horizonal", "git-branch", "megaphone", "message-square", "clipboard-list",
  "receipt-text", "phone", "bell", "monitor", "radio", "shield-alert", "settings",
  "layers", "key", "banknote", "arrow-right-left", "file-spreadsheet",
  "trending-down", "brain-circuit", "sliders-horizontal", "wrench", "zap",
];

const VISIBILITY_OPTS = ["full", "read_only"] as const;
const SECTION_PKEY = "/api/portal/sections";
const MODULES_PKEY = "/api/portal/modules";
const PORTAL_PKEY  = "/api/portal/definitions";

// ── Sortable Item Wrapper ──────────────────────────────────────────────────────
function SortableItem({ id, children }: { id: string | number; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(id) });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      className="touch-none p-1 text-muted-foreground/25 hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing"
      tabIndex={-1}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle)}
    </div>
  );
}

// ── Module Edit Panel ──────────────────────────────────────────────────────────
type AssignmentDraft = {
  displayLabel?: string; adapter?: string; visibility?: string; isPinned?: boolean;
  adapterType?: string; widgetProfile?: string; accessScope?: string;
  realtimeEnabled?: boolean; densityMode?: string; defaultTimeRange?: string;
};

function ModuleEditPanel({
  mod,
  draft,
  setDraft,
  onSave,
  onCancel,
  isPending,
}: {
  mod: PortalModuleWithMeta;
  draft: AssignmentDraft;
  setDraft: (fn: (d: AssignmentDraft) => AssignmentDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="mx-3 mb-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Display label</label>
          <input
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.displayLabel ?? ''}
            onChange={e => setDraft(d => ({ ...d, displayLabel: e.target.value }))}
            placeholder={mod.title}
            data-testid="edit-assignment-label"
          />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Adapter type</label>
          <select
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.adapterType ?? ''}
            onChange={e => setDraft(d => ({ ...d, adapterType: e.target.value }))}
            data-testid="edit-assignment-adapter-type"
          >
            <option value="">— none —</option>
            {['kam', 'noc', 'finance', 'client', 'partner', 'admin'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Widget profile</label>
          <select
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.widgetProfile ?? 'standard'}
            onChange={e => setDraft(d => ({ ...d, widgetProfile: e.target.value }))}
            data-testid="edit-assignment-widget-profile"
          >
            {['compact', 'standard', 'detailed', 'live'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Access scope</label>
          <select
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.accessScope ?? 'global'}
            onChange={e => setDraft(d => ({ ...d, accessScope: e.target.value }))}
            data-testid="edit-assignment-access-scope"
          >
            {['global', 'client', 'vendor'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Density mode</label>
          <select
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.densityMode ?? 'standard'}
            onChange={e => setDraft(d => ({ ...d, densityMode: e.target.value }))}
            data-testid="edit-assignment-density"
          >
            {['dense', 'standard'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Default time range</label>
          <select
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.defaultTimeRange ?? '24h'}
            onChange={e => setDraft(d => ({ ...d, defaultTimeRange: e.target.value }))}
            data-testid="edit-assignment-time-range"
          >
            {['1h', '24h', '7d', 'billing_month'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Visibility</label>
          <select
            className="w-full text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40 transition-colors"
            value={draft.visibility ?? 'full'}
            onChange={e => setDraft(d => ({ ...d, visibility: e.target.value }))}
            data-testid="edit-assignment-visibility"
          >
            {VISIBILITY_OPTS.map(v => <option key={v} value={v}>{v === 'full' ? 'Full' : 'Read only'}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Realtime</label>
          <button
            onClick={() => setDraft(d => ({ ...d, realtimeEnabled: !d.realtimeEnabled }))}
            className={cn(
              "flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors w-full",
              draft.realtimeEnabled
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                : "bg-white/[0.04] text-muted-foreground/50 hover:bg-white/[0.07] border border-white/[0.06]"
            )}
            data-testid="edit-assignment-realtime"
          >
            {draft.realtimeEnabled ? '⚡ On' : '— Off'}
          </button>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Pinned</label>
          <button
            onClick={() => setDraft(d => ({ ...d, isPinned: !d.isPinned }))}
            className={cn(
              "flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors w-full",
              draft.isPinned
                ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
                : "bg-white/[0.04] text-muted-foreground/50 hover:bg-white/[0.07] border border-white/[0.06]"
            )}
            data-testid="edit-assignment-pinned"
          >
            {draft.isPinned ? '★ Pinned' : '☆ No'}
          </button>
        </div>
      </div>
      <div className="flex gap-2 pt-0.5">
        <button
          onClick={onSave}
          disabled={isPending}
          data-testid={`save-assignment-${mod.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border border-indigo-500/20 transition-colors disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> Save changes
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground/60 hover:bg-white/[0.05] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function NavigationGovernancePage() {
  const { toast } = useToast();

  const [selectedPortal, setSelectedPortal]   = useState<string | null>(null);
  const [openSectionId,  setOpenSectionId]    = useState<number | null>(null);
  const [editPortalSlug, setEditPortalSlug]   = useState<string | null>(null);
  const [editPortalDraft, setEditPortalDraft] = useState<{ theme?: string; icon?: string; isActive?: boolean } | null>(null);
  const [editSectionId,  setEditSectionId]    = useState<number | null>(null);
  const [editSectionDraft, setEditSectionDraft] = useState<{ title?: string; icon?: string }>({});
  const [showAddSection, setShowAddSection]   = useState(false);
  const [addSectionTitle, setAddSectionTitle] = useState("");
  const [addSectionIcon,  setAddSectionIcon]  = useState("circle");
  const [editAssignmentId, setEditAssignmentId] = useState<number | null>(null);
  const [editAssignmentDraft, setEditAssignmentDraft] = useState<AssignmentDraft>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: portals = [] } = useQuery<PortalDefinition[]>({
    queryKey: [PORTAL_PKEY], staleTime: 30_000,
  });
  const { data: sections = [], isLoading: sectionsLoading } = useQuery<PortalSection[]>({
    queryKey: [SECTION_PKEY, selectedPortal], enabled: !!selectedPortal, staleTime: 10_000,
  });
  const { data: assignedModules = [], isLoading: modulesLoading } = useQuery<PortalModuleWithMeta[]>({
    queryKey: [MODULES_PKEY, selectedPortal], enabled: !!selectedPortal, staleTime: 10_000,
  });
  const { data: allNavModules = [] } = useQuery<NavigationModule[]>({
    queryKey: ["/api/governance/modules"], staleTime: 60_000,
  });

  const portalConfig = portals.find(p => p.slug === selectedPortal);
  const theme = portalConfig?.theme ?? "indigo";

  // Mutations
  const updatePortalMut = useMutation({
    mutationFn: ({ slug, data }: { slug: string; data: any }) =>
      apiRequest('PUT', `/api/governance/portals/${slug}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PORTAL_PKEY] });
      toast({ title: 'Portal updated' });
      setEditPortalSlug(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const createSectionMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/governance/sections', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SECTION_PKEY, selectedPortal] });
      setAddSectionTitle(''); setAddSectionIcon('circle'); setShowAddSection(false);
      toast({ title: 'Section created' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const updateSectionMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/governance/sections/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SECTION_PKEY, selectedPortal] });
      setEditSectionId(null);
      toast({ title: 'Section updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const deleteSectionMut = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/governance/sections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SECTION_PKEY, selectedPortal] });
      toast({ title: 'Section deleted' });
    },
  });
  const reorderSectionsMut = useMutation({
    mutationFn: (orderedIds: number[]) =>
      apiRequest('POST', '/api/governance/sections/reorder', { portalSlug: selectedPortal, orderedIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [SECTION_PKEY, selectedPortal] }),
  });
  const assignModuleMut = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/governance/assignments', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MODULES_PKEY, selectedPortal] });
      toast({ title: 'Module assigned' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const unassignModuleMut = useMutation({
    mutationFn: ({ portalId, moduleId }: { portalId: string; moduleId: number }) =>
      apiRequest('DELETE', '/api/governance/assignments/0', { portalId, moduleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MODULES_PKEY, selectedPortal] });
      toast({ title: 'Module removed' });
    },
  });
  const updateAssignmentMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/governance/assignments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MODULES_PKEY, selectedPortal] });
      setEditAssignmentId(null);
      toast({ title: 'Module updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const reorderModulesMut = useMutation({
    mutationFn: ({ orderedIds, sectionKey }: { orderedIds: number[]; sectionKey: string }) =>
      apiRequest('POST', '/api/governance/assignments/reorder', {
        portalId: selectedPortal, sectionKey, orderedIds,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [MODULES_PKEY, selectedPortal] }),
  });

  // DnD — section reorder
  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sections.map(s => String(s.id));
    const reordered = arrayMove(sections, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    reorderSectionsMut.mutate(reordered.map(s => s.id));
  }

  // DnD — module reorder within a section
  function handleModuleDragEnd(event: DragEndEvent, sectionKey: string, mods: PortalModuleWithMeta[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = mods.map(m => String(m.id));
    const reordered = arrayMove(mods, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    reorderModulesMut.mutate({ orderedIds: reordered.map(m => m.id), sectionKey });
  }

  const assignedModuleIds = new Set(assignedModules.map(m => m.moduleId));
  const unassignedModules = allNavModules.filter(m => !assignedModuleIds.has(m.id));

  function getModulesForSection(sectionKey: string) {
    return assignedModules
      .filter(m => m.section === sectionKey)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }

  function toggleSection(id: number) {
    setOpenSectionId(prev => prev === id ? null : id);
    setEditAssignmentId(null);
    setEditSectionId(null);
  }

  return (
    <LayoutShell>
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Layers className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">Navigation Governance</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage portals, sections, and module assignments without SQL
              </p>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── LEFT: Portal List ──────────────────────────────────────────────── */}
          <div className="w-52 border-r border-white/[0.06] flex flex-col flex-shrink-0 bg-black/[0.15]">
            <div className="px-3 py-2.5 border-b border-white/[0.06]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Portals</p>
            </div>
            <div className="flex-1 overflow-y-auto py-1.5 [&::-webkit-scrollbar]:hidden">
              {portals.map(portal => {
                const isSelected = portal.slug === selectedPortal;
                const isEditing  = editPortalSlug === portal.slug;
                return (
                  <div key={portal.slug} className={cn(
                    "group mx-1.5 mb-0.5 rounded-xl border transition-all duration-150",
                    isSelected ? "border-white/[0.1] bg-white/[0.06]" : "border-transparent hover:bg-white/[0.03]",
                  )}>
                    <button
                      onClick={() => {
                        setSelectedPortal(portal.slug);
                        setOpenSectionId(null);
                        setEditPortalSlug(null);
                      }}
                      data-testid={`select-portal-${portal.slug}`}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2.5 text-left"
                    >
                      <span className={cn("h-2 w-2 rounded-full flex-shrink-0", THEME_DOT[portal.theme] ?? 'bg-slate-400')} />
                      <span className={cn(
                        "flex-1 text-xs font-medium truncate",
                        isSelected ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground/80",
                      )}>
                        {portal.name}
                      </span>
                      <span className={cn(
                        "text-[9px] font-semibold px-1 py-0.5 rounded uppercase tracking-wide flex-shrink-0",
                        portal.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                      )}>
                        {portal.isActive ? "On" : "Off"}
                      </span>
                    </button>

                    {isSelected && !isEditing && (
                      <div className="px-2.5 pb-2">
                        <button
                          onClick={() => {
                            setEditPortalSlug(portal.slug);
                            setEditPortalDraft({ theme: portal.theme, icon: portal.icon, isActive: portal.isActive });
                          }}
                          data-testid={`edit-portal-${portal.slug}`}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit portal
                        </button>
                      </div>
                    )}

                    {isEditing && editPortalDraft && (
                      <div className="px-2.5 pb-2.5 space-y-2">
                        <div>
                          <p className="text-[9px] text-muted-foreground/50 mb-1 uppercase tracking-wide">Theme</p>
                          <div className="flex flex-wrap gap-1">
                            {THEME_OPTIONS.map(t => (
                              <button
                                key={t}
                                onClick={() => setEditPortalDraft(d => d ? { ...d, theme: t } : d)}
                                className={cn(
                                  "h-4 w-4 rounded-full transition-all",
                                  THEME_DOT[t],
                                  editPortalDraft.theme === t ? "ring-2 ring-offset-1 ring-offset-background " + THEME_RING[t] : "opacity-50",
                                )}
                                title={t}
                              />
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => setEditPortalDraft(d => d ? { ...d, isActive: !d.isActive } : d)}
                          className={cn(
                            "flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg w-full transition-colors",
                            editPortalDraft.isActive
                              ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                          )}
                        >
                          {editPortalDraft.isActive ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          {editPortalDraft.isActive ? 'Enabled' : 'Disabled'}
                        </button>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updatePortalMut.mutate({ slug: portal.slug, data: editPortalDraft })}
                            data-testid={`save-portal-${portal.slug}`}
                            className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                          >
                            <Save className="h-3 w-3" /> Save
                          </button>
                          <button
                            onClick={() => setEditPortalSlug(null)}
                            className="px-2 py-1 rounded-lg text-[10px] text-muted-foreground hover:bg-white/[0.05] transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── RIGHT: Accordion Section Cards ────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* Panel header */}
            <div className="flex-shrink-0 px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {portalConfig && (
                  <span className={cn("h-2 w-2 rounded-full", THEME_DOT[portalConfig.theme] ?? 'bg-slate-400')} />
                )}
                <p className="text-sm font-semibold text-foreground">
                  {portalConfig ? portalConfig.name : "Select a portal"}
                </p>
                {portalConfig && sections.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/40 font-medium">
                    {sections.length} section{sections.length !== 1 ? 's' : ''} · {assignedModules.length} module{assignedModules.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {selectedPortal && (
                <button
                  onClick={() => setShowAddSection(v => !v)}
                  data-testid="add-section-btn"
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
                    showAddSection
                      ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/25"
                      : "text-muted-foreground/60 border-white/[0.07] hover:bg-white/[0.05] hover:text-foreground"
                  )}
                >
                  <Plus className="h-3.5 w-3.5" /> Add section
                </button>
              )}
            </div>

            {/* Body */}
            {!selectedPortal ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto">
                    <Layers className="h-5 w-5 text-muted-foreground/20" />
                  </div>
                  <p className="text-sm text-muted-foreground/40">Select a portal to manage sections</p>
                </div>
              </div>
            ) : sectionsLoading || modulesLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="h-5 w-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">

                {/* Add Section Form */}
                {showAddSection && (
                  <div className="mx-4 mt-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-4 space-y-3">
                    <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">New Section</p>
                    <input
                      className="w-full text-sm bg-white/[0.05] border border-white/[0.1] rounded-xl px-3 py-2 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-400/40 transition-colors"
                      value={addSectionTitle}
                      onChange={e => setAddSectionTitle(e.target.value)}
                      placeholder="Section name (e.g. Billing & Invoicing)"
                      data-testid="new-section-title"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && addSectionTitle.trim()) {
                          createSectionMut.mutate({ portalId: selectedPortal, title: addSectionTitle.trim(), icon: addSectionIcon });
                        }
                      }}
                    />
                    <div>
                      <p className="text-[9px] text-muted-foreground/40 mb-1.5 uppercase tracking-wide">Icon</p>
                      <div className="flex flex-wrap gap-1">
                        {ICON_OPTIONS.slice(0, 16).map(ic => (
                          <button
                            key={ic}
                            onClick={() => setAddSectionIcon(ic)}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors",
                              addSectionIcon === ic
                                ? "bg-indigo-500/20 text-indigo-300"
                                : "text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.05]"
                            )}
                          >
                            <Icon k={ic} className="h-3.5 w-3.5" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (addSectionTitle.trim()) {
                            createSectionMut.mutate({ portalId: selectedPortal, title: addSectionTitle.trim(), icon: addSectionIcon });
                          }
                        }}
                        data-testid="create-section-submit"
                        disabled={!addSectionTitle.trim() || createSectionMut.isPending}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Section
                      </button>
                      <button onClick={() => setShowAddSection(false)} className="px-3 py-2 rounded-xl text-muted-foreground hover:bg-white/[0.05] transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {sections.length === 0 && !showAddSection && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-dashed border-white/[0.08] flex items-center justify-center">
                      <Layers className="h-5 w-5 text-muted-foreground/20" />
                    </div>
                    <p className="text-sm text-muted-foreground/40 text-center">No sections yet.<br/>Click "Add section" to get started.</p>
                  </div>
                )}

                {/* Accordion cards — sortable by section */}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                  <SortableContext items={sections.map(s => String(s.id))} strategy={verticalListSortingStrategy}>
                    <div className="px-4 py-3 space-y-2.5">
                      {sections.map(section => {
                        const isOpen      = openSectionId === section.id;
                        const isEditingS  = editSectionId === section.id;
                        const sectionMods = getModulesForSection(section.sectionKey);
                        const accentColor = THEME_ACCENT[theme] ?? "text-indigo-400";

                        return (
                          <SortableItem key={section.id} id={section.id}>
                            {(handle) => (
                              <div className={cn(
                                "rounded-2xl border transition-all duration-150",
                                isOpen
                                  ? "border-white/[0.10] bg-white/[0.04] shadow-sm"
                                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.035] hover:border-white/[0.09]"
                              )}>
                                {/* ── Section Header ── */}
                                <div className="flex items-center gap-2 px-4 py-3">
                                  <span className="opacity-40 hover:opacity-70 transition-opacity">{handle}</span>

                                  {/* Expand/collapse toggle */}
                                  <button
                                    onClick={() => toggleSection(section.id)}
                                    data-testid={`toggle-section-${section.sectionKey}`}
                                    className="flex-1 flex items-center gap-3 min-w-0 text-left"
                                  >
                                    <div className={cn(
                                      "flex items-center justify-center w-7 h-7 rounded-xl flex-shrink-0 transition-colors",
                                      isOpen ? "bg-white/[0.08]" : "bg-white/[0.04]"
                                    )}>
                                      <Icon k={section.icon} className={cn("h-3.5 w-3.5", isOpen ? accentColor : "text-muted-foreground/50")} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className={cn(
                                        "text-sm font-semibold truncate transition-colors",
                                        isOpen ? "text-foreground" : "text-muted-foreground/80"
                                      )}>
                                        {section.title}
                                      </p>
                                    </div>
                                    {/* Module count badge */}
                                    <span className={cn(
                                      "text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 transition-colors",
                                      isOpen
                                        ? cn(THEME_ACCENT_BG[theme] ?? "bg-indigo-500/10 text-indigo-300")
                                        : "bg-white/[0.05] text-muted-foreground/50"
                                    )}>
                                      {sectionMods.length}/{sectionMods.length} visible
                                    </span>
                                    <ChevronDown className={cn(
                                      "h-4 w-4 text-muted-foreground/40 flex-shrink-0 transition-transform duration-150",
                                      isOpen ? "rotate-180" : "rotate-0"
                                    )} />
                                  </button>

                                  {/* Section actions */}
                                  <div className="flex items-center gap-0.5 flex-shrink-0">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isEditingS) {
                                          setEditSectionId(null);
                                        } else {
                                          setEditSectionId(section.id);
                                          setEditSectionDraft({ title: section.title, icon: section.icon });
                                          if (!isOpen) toggleSection(section.id);
                                        }
                                      }}
                                      data-testid={`edit-section-${section.id}`}
                                      className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-muted-foreground hover:bg-white/[0.06] transition-colors"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete "${section.title}"?`)) deleteSectionMut.mutate(section.id);
                                      }}
                                      data-testid={`delete-section-${section.id}`}
                                      className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-500/[0.07] transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* ── Section Edit Form ── */}
                                {isEditingS && (
                                  <div className="mx-4 mb-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
                                    <input
                                      className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 py-2 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-400/40 transition-colors"
                                      value={editSectionDraft.title ?? ''}
                                      onChange={e => setEditSectionDraft(d => ({ ...d, title: e.target.value }))}
                                      placeholder="Section name"
                                      data-testid="edit-section-title"
                                      autoFocus
                                    />
                                    <div>
                                      <p className="text-[9px] text-muted-foreground/40 mb-1 uppercase tracking-wide">Icon</p>
                                      <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                                        {ICON_OPTIONS.slice(0, 16).map(ic => (
                                          <button
                                            key={ic}
                                            onClick={() => setEditSectionDraft(d => ({ ...d, icon: ic }))}
                                            className={cn(
                                              "p-1 rounded-lg transition-colors",
                                              editSectionDraft.icon === ic
                                                ? "bg-indigo-500/20 text-indigo-300"
                                                : "text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.05]"
                                            )}
                                          >
                                            <Icon k={ic} className="h-3 w-3" />
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => updateSectionMut.mutate({ id: section.id, data: editSectionDraft })}
                                        data-testid={`save-section-${section.id}`}
                                        className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                                      >
                                        <Check className="h-3 w-3" /> Save
                                      </button>
                                      <button onClick={() => setEditSectionId(null)} className="px-2.5 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:bg-white/[0.05] transition-colors">
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* ── Expanded Module Body ── */}
                                {isOpen && (
                                  <div className="border-t border-white/[0.05] pt-1 pb-2">
                                    {/* Module list */}
                                    <DndContext
                                      sensors={sensors}
                                      collisionDetection={closestCenter}
                                      onDragEnd={(e) => handleModuleDragEnd(e, section.sectionKey, sectionMods)}
                                    >
                                      <SortableContext items={sectionMods.map(m => String(m.id))} strategy={verticalListSortingStrategy}>
                                        <div className="px-3 pt-1 pb-1 space-y-0.5">
                                          {sectionMods.length === 0 && (
                                            <div className="flex flex-col items-center justify-center py-6 gap-2 rounded-xl border border-dashed border-white/[0.06] my-2">
                                              <AlertCircle className="h-4 w-4 text-muted-foreground/20" />
                                              <p className="text-xs text-muted-foreground/30">No modules in this section</p>
                                            </div>
                                          )}
                                          {sectionMods.map(mod => {
                                            const isEditingMod = editAssignmentId === mod.id;
                                            return (
                                              <SortableItem key={mod.id} id={mod.id}>
                                                {(modHandle) => (
                                                  <div className={cn(
                                                    "rounded-xl border transition-all duration-150",
                                                    isEditingMod
                                                      ? "border-indigo-500/25 bg-indigo-500/[0.04]"
                                                      : "border-transparent hover:border-white/[0.06] hover:bg-white/[0.025]"
                                                  )}>
                                                    <div className="flex items-center gap-2 px-2 py-2">
                                                      <span className="opacity-30 hover:opacity-60 transition-opacity">{modHandle}</span>
                                                      <Icon k={mod.icon} className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
                                                      <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-medium text-foreground/90 truncate">
                                                          {mod.displayLabel ?? mod.title}
                                                        </p>
                                                        <p className="text-[10px] text-muted-foreground/35 truncate">
                                                          {mod.route}
                                                        </p>
                                                      </div>
                                                      {/* Badges */}
                                                      <div className="flex items-center gap-1 flex-shrink-0">
                                                        {(mod as any).adapterType && (
                                                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/15">
                                                            {(mod as any).adapterType}
                                                          </span>
                                                        )}
                                                        {mod.visibility === 'read_only' && (
                                                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/15">
                                                            RO
                                                          </span>
                                                        )}
                                                        {mod.isPinned && (
                                                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/15">
                                                            ★
                                                          </span>
                                                        )}
                                                        {(mod as any).realtimeEnabled && (
                                                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/15">
                                                            ⚡
                                                          </span>
                                                        )}
                                                      </div>
                                                      <button
                                                        onClick={() => {
                                                          if (isEditingMod) {
                                                            setEditAssignmentId(null);
                                                          } else {
                                                            setEditAssignmentId(mod.id);
                                                            setEditAssignmentDraft({
                                                              displayLabel: mod.displayLabel ?? '',
                                                              adapter: mod.adapter ?? '',
                                                              visibility: mod.visibility ?? 'full',
                                                              isPinned: mod.isPinned ?? false,
                                                              adapterType: (mod as any).adapterType ?? '',
                                                              widgetProfile: (mod as any).widgetProfile ?? 'standard',
                                                              accessScope: (mod as any).accessScope ?? 'global',
                                                              realtimeEnabled: (mod as any).realtimeEnabled ?? false,
                                                              densityMode: (mod as any).densityMode ?? 'standard',
                                                              defaultTimeRange: (mod as any).defaultTimeRange ?? '24h',
                                                            });
                                                          }
                                                        }}
                                                        data-testid={`edit-module-${mod.id}`}
                                                        className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-muted-foreground hover:bg-white/[0.06] transition-colors"
                                                      >
                                                        <Pencil className="h-3 w-3" />
                                                      </button>
                                                      <button
                                                        onClick={() => {
                                                          if (selectedPortal) {
                                                            unassignModuleMut.mutate({ portalId: selectedPortal, moduleId: mod.moduleId });
                                                          }
                                                        }}
                                                        data-testid={`remove-module-${mod.id}`}
                                                        className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-500/[0.07] transition-colors"
                                                      >
                                                        <Trash2 className="h-3 w-3" />
                                                      </button>
                                                    </div>

                                                    {/* Module edit panel */}
                                                    {isEditingMod && (
                                                      <ModuleEditPanel
                                                        mod={mod}
                                                        draft={editAssignmentDraft}
                                                        setDraft={setEditAssignmentDraft}
                                                        onSave={() => updateAssignmentMut.mutate({ id: mod.id, data: editAssignmentDraft })}
                                                        onCancel={() => setEditAssignmentId(null)}
                                                        isPending={updateAssignmentMut.isPending}
                                                      />
                                                    )}
                                                  </div>
                                                )}
                                              </SortableItem>
                                            );
                                          })}
                                        </div>
                                      </SortableContext>
                                    </DndContext>

                                    {/* Assign from registry */}
                                    {unassignedModules.length > 0 && (
                                      <div className="mx-3 mt-2">
                                        <div className="rounded-xl border border-dashed border-white/[0.07] p-3">
                                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30 mb-1.5">
                                            Assign from registry
                                          </p>
                                          <div className="space-y-0.5 max-h-40 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                                            {unassignedModules.map(mod => (
                                              <button
                                                key={mod.id}
                                                onClick={() => {
                                                  if (selectedPortal) {
                                                    assignModuleMut.mutate({
                                                      portalId: selectedPortal,
                                                      moduleId: mod.id,
                                                      section: section.sectionKey,
                                                      displayOrder: sectionMods.length,
                                                      displayLabel: mod.title,
                                                    });
                                                  }
                                                }}
                                                data-testid={`assign-module-${mod.id}`}
                                                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.04] transition-colors group"
                                              >
                                                <Icon k={mod.icon} className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                                                <span className="flex-1 text-xs text-muted-foreground/50 group-hover:text-foreground/70 truncate transition-colors">{mod.title}</span>
                                                <Plus className="h-3 w-3 text-muted-foreground/20 group-hover:text-indigo-400 flex-shrink-0 transition-colors" />
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </SortableItem>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
