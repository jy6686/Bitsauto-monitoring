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
  GripVertical, Plus, Pencil, Trash2, Check, X, ChevronRight,
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
      className="touch-none p-1 text-muted-foreground/30 hover:text-muted-foreground/70 cursor-grab active:cursor-grabbing"
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

// ── Main Component ─────────────────────────────────────────────────────────────
export default function NavigationGovernancePage() {
  const { toast } = useToast();

  const [selectedPortal, setSelectedPortal] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<PortalSection | null>(null);
  const [editPortalSlug, setEditPortalSlug] = useState<string | null>(null);
  const [editPortalDraft, setEditPortalDraft] = useState<{ theme?: string; icon?: string; isActive?: boolean } | null>(null);
  const [editSectionId, setEditSectionId] = useState<number | null>(null);
  const [editSectionDraft, setEditSectionDraft] = useState<{ title?: string; icon?: string }>({});
  const [addSectionTitle, setAddSectionTitle] = useState("");
  const [addSectionIcon, setAddSectionIcon] = useState("circle");
  const [showAddSection, setShowAddSection] = useState(false);
  const [editAssignmentId, setEditAssignmentId] = useState<number | null>(null);
  const [editAssignmentDraft, setEditAssignmentDraft] = useState<{
    displayLabel?: string; adapter?: string; visibility?: string; isPinned?: boolean;
    adapterType?: string; widgetProfile?: string; accessScope?: string;
    realtimeEnabled?: boolean; densityMode?: string; defaultTimeRange?: string;
  }>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Queries
  const { data: portals = [] } = useQuery<PortalDefinition[]>({
    queryKey: [PORTAL_PKEY],
    staleTime: 30_000,
  });

  const { data: sections = [], isLoading: sectionsLoading } = useQuery<PortalSection[]>({
    queryKey: [SECTION_PKEY, selectedPortal],
    enabled: !!selectedPortal,
    staleTime: 10_000,
  });

  const { data: assignedModules = [], isLoading: modulesLoading } = useQuery<PortalModuleWithMeta[]>({
    queryKey: [MODULES_PKEY, selectedPortal],
    enabled: !!selectedPortal,
    staleTime: 10_000,
  });

  const { data: allNavModules = [] } = useQuery<NavigationModule[]>({
    queryKey: ["/api/governance/modules"],
    staleTime: 60_000,
  });

  // Derived: modules in selected section
  const sectionModules = selectedSection
    ? assignedModules
        .filter(m => m.section === selectedSection.sectionKey)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    : [];

  // Derived: modules not yet assigned to this portal+section
  const assignedModuleIds = new Set(assignedModules.map(m => m.moduleId));
  const unassignedModules = allNavModules.filter(m => !assignedModuleIds.has(m.id));

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
      setAddSectionTitle('');
      setAddSectionIcon('circle');
      setShowAddSection(false);
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
      if (selectedSection?.id === editSectionId) setSelectedSection(null);
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
    mutationFn: (orderedIds: number[]) =>
      apiRequest('POST', '/api/governance/assignments/reorder', {
        portalId: selectedPortal,
        sectionKey: selectedSection?.sectionKey,
        orderedIds,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [MODULES_PKEY, selectedPortal] }),
  });

  // DnD handlers
  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sections.map(s => String(s.id));
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    const reordered = arrayMove(sections, oldIdx, newIdx);
    reorderSectionsMut.mutate(reordered.map(s => s.id));
  }

  function handleModuleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sectionModules.map(m => String(m.id));
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    const reordered = arrayMove(sectionModules, oldIdx, newIdx);
    reorderModulesMut.mutate(reordered.map(m => m.id));
  }

  const portalConfig = portals.find(p => p.slug === selectedPortal);

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

        {/* 3-Column Layout */}
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
                    "group mx-1.5 mb-0.5 rounded-lg border transition-all",
                    isSelected
                      ? "border-white/[0.1] bg-white/[0.06]"
                      : "border-transparent hover:bg-white/[0.03]",
                  )}>
                    <button
                      onClick={() => {
                        setSelectedPortal(portal.slug);
                        setSelectedSection(null);
                        setEditPortalSlug(null);
                      }}
                      data-testid={`select-portal-${portal.slug}`}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left"
                    >
                      <span className={cn("h-2 w-2 rounded-full flex-shrink-0", THEME_DOT[portal.theme] ?? 'bg-slate-400')} />
                      <span className={cn(
                        "flex-1 text-xs font-medium truncate",
                        isSelected ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground/80",
                      )}>
                        {portal.name}
                      </span>
                      {isSelected && <ChevronRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />}
                    </button>

                    {isSelected && !isEditing && (
                      <div className="px-2.5 pb-2 flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setEditPortalSlug(portal.slug);
                            setEditPortalDraft({ theme: portal.theme, icon: portal.icon, isActive: portal.isActive });
                          }}
                          data-testid={`edit-portal-${portal.slug}`}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <span className={cn(
                          "ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide",
                          portal.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                        )}>
                          {portal.isActive ? "Active" : "Off"}
                        </span>
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
                        <div>
                          <p className="text-[9px] text-muted-foreground/50 mb-1 uppercase tracking-wide">Active</p>
                          <button
                            onClick={() => setEditPortalDraft(d => d ? { ...d, isActive: !d.isActive } : d)}
                            className={cn(
                              "flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md transition-colors",
                              editPortalDraft.isActive
                                ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                            )}
                          >
                            {editPortalDraft.isActive ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            {editPortalDraft.isActive ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                        <div className="flex gap-1.5 pt-1">
                          <button
                            onClick={() => updatePortalMut.mutate({ slug: portal.slug, data: editPortalDraft })}
                            data-testid={`save-portal-${portal.slug}`}
                            className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                          >
                            <Save className="h-3 w-3" /> Save
                          </button>
                          <button
                            onClick={() => setEditPortalSlug(null)}
                            className="px-2 py-1 rounded-md text-[10px] text-muted-foreground hover:bg-white/[0.05] transition-colors"
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

          {/* ── CENTER: Section Manager ────────────────────────────────────────── */}
          <div className="w-64 border-r border-white/[0.06] flex flex-col flex-shrink-0">
            <div className="px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Sections</p>
                {portalConfig && (
                  <p className={cn("text-[11px] font-semibold mt-0.5", THEME_ACCENT[portalConfig.theme] ?? "text-muted-foreground")}>
                    {portalConfig.name}
                  </p>
                )}
              </div>
              {selectedPortal && (
                <button
                  onClick={() => setShowAddSection(v => !v)}
                  data-testid="add-section-btn"
                  className="p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
                  title="Add section"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {!selectedPortal ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-muted-foreground/40 text-center px-4">Select a portal<br/>to manage sections</p>
              </div>
            ) : sectionsLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="h-4 w-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                  <SortableContext items={sections.map(s => String(s.id))} strategy={verticalListSortingStrategy}>
                    <div className="py-1.5">
                      {sections.map(section => {
                        const isSelected = selectedSection?.id === section.id;
                        const isEditing  = editSectionId === section.id;
                        return (
                          <SortableItem key={section.id} id={section.id}>
                            {(handle) => (
                              <div className={cn(
                                "group mx-1.5 mb-0.5 rounded-lg border transition-all",
                                isSelected
                                  ? "border-white/[0.1] bg-white/[0.05]"
                                  : "border-transparent hover:bg-white/[0.03]",
                              )}>
                                <div className="flex items-center gap-1 pl-1 pr-2 py-2">
                                  {handle}
                                  <button
                                    onClick={() => { setSelectedSection(section); setEditSectionId(null); }}
                                    data-testid={`select-section-${section.sectionKey}`}
                                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                                  >
                                    <Icon k={section.icon} className={cn("h-3.5 w-3.5 flex-shrink-0",
                                      isSelected ? (THEME_ACCENT[portalConfig?.theme ?? "neutral"] ?? "text-indigo-400") : "text-muted-foreground/50"
                                    )} />
                                    <span className={cn(
                                      "text-xs font-medium truncate",
                                      isSelected ? "text-foreground" : "text-muted-foreground/70",
                                    )}>
                                      {section.title}
                                    </span>
                                  </button>
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditSectionId(section.id); setEditSectionDraft({ title: section.title, icon: section.icon }); }}
                                      data-testid={`edit-section-${section.id}`}
                                      className="p-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${section.title}"?`)) deleteSectionMut.mutate(section.id); }}
                                      data-testid={`delete-section-${section.id}`}
                                      className="p-1 rounded text-muted-foreground/40 hover:text-rose-400 transition-colors"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>

                                {isEditing && (
                                  <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/[0.05] pt-2">
                                    <input
                                      className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-400/40"
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
                                              "p-1 rounded transition-colors",
                                              editSectionDraft.icon === ic
                                                ? "bg-indigo-500/20 text-indigo-300"
                                                : "text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.05]"
                                            )}
                                            title={ic}
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
                                        className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                                      >
                                        <Check className="h-3 w-3" /> Save
                                      </button>
                                      <button onClick={() => setEditSectionId(null)} className="px-2 py-1 rounded-md text-[10px] text-muted-foreground hover:bg-white/[0.05]">
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
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

                {/* Add Section Form */}
                {showAddSection && (
                  <div className="mx-1.5 mb-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-2">
                    <p className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wide">New Section</p>
                    <input
                      className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-400/40"
                      value={addSectionTitle}
                      onChange={e => setAddSectionTitle(e.target.value)}
                      placeholder="Section name"
                      data-testid="new-section-title"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && addSectionTitle.trim()) {
                          createSectionMut.mutate({ portalId: selectedPortal, title: addSectionTitle.trim(), icon: addSectionIcon });
                        }
                      }}
                    />
                    <div>
                      <p className="text-[9px] text-muted-foreground/40 mb-1 uppercase tracking-wide">Icon</p>
                      <div className="flex flex-wrap gap-1">
                        {ICON_OPTIONS.slice(0, 12).map(ic => (
                          <button
                            key={ic}
                            onClick={() => setAddSectionIcon(ic)}
                            className={cn(
                              "p-1 rounded transition-colors",
                              addSectionIcon === ic
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
                        onClick={() => {
                          if (addSectionTitle.trim()) {
                            createSectionMut.mutate({ portalId: selectedPortal, title: addSectionTitle.trim(), icon: addSectionIcon });
                          }
                        }}
                        data-testid="create-section-submit"
                        disabled={!addSectionTitle.trim() || createSectionMut.isPending}
                        className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Add Section
                      </button>
                      <button onClick={() => setShowAddSection(false)} className="px-2 py-1 rounded-md text-muted-foreground hover:bg-white/[0.05]">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}

                {sections.length === 0 && !showAddSection && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Layers className="h-6 w-6 text-muted-foreground/20" />
                    <p className="text-xs text-muted-foreground/40 text-center">No sections yet.<br/>Click + to add one.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: Module Manager ──────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Modules</p>
                {selectedSection && (
                  <p className="text-[11px] font-semibold text-foreground mt-0.5">
                    {portalConfig?.name} → {selectedSection.title}
                  </p>
                )}
              </div>
              {selectedSection && (
                <span className="text-[10px] text-muted-foreground/40">
                  {sectionModules.length} module{sectionModules.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {!selectedSection ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Layers className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/40">Select a section to manage modules</p>
                </div>
              </div>
            ) : modulesLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="h-5 w-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:hidden">
                {/* Assigned modules — sortable */}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
                  <SortableContext items={sectionModules.map(m => String(m.id))} strategy={verticalListSortingStrategy}>
                    <div className="p-3 space-y-1.5">
                      {sectionModules.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 border border-dashed border-white/[0.08] rounded-xl">
                          <AlertCircle className="h-5 w-5 text-muted-foreground/20" />
                          <p className="text-xs text-muted-foreground/40">No modules in this section</p>
                        </div>
                      )}
                      {sectionModules.map(mod => {
                        const isEditing = editAssignmentId === mod.id;
                        return (
                          <SortableItem key={mod.id} id={mod.id}>
                            {(handle) => (
                              <div className={cn(
                                "rounded-xl border transition-all",
                                isEditing ? "border-indigo-500/30 bg-indigo-500/5" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                              )}>
                                <div className="flex items-center gap-2 px-3 py-2.5">
                                  {handle}
                                  <Icon k={mod.icon} className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                      {mod.displayLabel ?? mod.title}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5">
                                      {mod.route}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {mod.adapter && (
                                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                        {mod.adapter}
                                      </span>
                                    )}
                                    {mod.visibility === 'read_only' && (
                                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                        RO
                                      </span>
                                    )}
                                    {mod.isPinned && (
                                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
                                        ★ pinned
                                      </span>
                                    )}
                                    <button
                                      onClick={() => {
                                        if (isEditing) {
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
                                      className="p-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (selectedPortal) {
                                          unassignModuleMut.mutate({ portalId: selectedPortal, moduleId: mod.moduleId });
                                        }
                                      }}
                                      data-testid={`remove-module-${mod.id}`}
                                      className="p-1 rounded text-muted-foreground/40 hover:text-rose-400 transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {isEditing && (
                                  <div className="px-3 pb-3 border-t border-white/[0.05] pt-2.5 space-y-2">
                                    {/* Row 1: Label + Adapter */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Display label</label>
                                        <input
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.displayLabel ?? ''}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, displayLabel: e.target.value }))}
                                          placeholder={mod.title}
                                          data-testid="edit-assignment-label"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Adapter type</label>
                                        <select
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.adapterType ?? ''}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, adapterType: e.target.value }))}
                                          data-testid="edit-assignment-adapter-type"
                                        >
                                          <option value="">— none —</option>
                                          {['kam', 'noc', 'finance', 'client', 'partner', 'admin'].map(a => <option key={a} value={a}>{a}</option>)}
                                        </select>
                                      </div>
                                    </div>
                                    {/* Row 2: Widget profile + Access scope */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Widget profile</label>
                                        <select
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.widgetProfile ?? 'standard'}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, widgetProfile: e.target.value }))}
                                          data-testid="edit-assignment-widget-profile"
                                        >
                                          {['compact', 'standard', 'detailed', 'live'].map(p => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Access scope</label>
                                        <select
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.accessScope ?? 'global'}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, accessScope: e.target.value }))}
                                          data-testid="edit-assignment-access-scope"
                                        >
                                          {['global', 'client', 'vendor'].map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                      </div>
                                    </div>
                                    {/* Row 3: Density + Time range */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Density mode</label>
                                        <select
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.densityMode ?? 'standard'}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, densityMode: e.target.value }))}
                                          data-testid="edit-assignment-density"
                                        >
                                          {['dense', 'standard'].map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Default time range</label>
                                        <select
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.defaultTimeRange ?? '24h'}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, defaultTimeRange: e.target.value }))}
                                          data-testid="edit-assignment-time-range"
                                        >
                                          {['1h', '24h', '7d', 'billing_month'].map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                      </div>
                                    </div>
                                    {/* Row 4: Visibility + Realtime + Pinned */}
                                    <div className="grid grid-cols-3 gap-2">
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Visibility</label>
                                        <select
                                          className="w-full text-xs bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-foreground outline-none focus:border-indigo-400/40"
                                          value={editAssignmentDraft.visibility ?? 'full'}
                                          onChange={e => setEditAssignmentDraft(d => ({ ...d, visibility: e.target.value }))}
                                          data-testid="edit-assignment-visibility"
                                        >
                                          {VISIBILITY_OPTS.map(v => <option key={v} value={v}>{v === 'full' ? 'Full' : 'Read only'}</option>)}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Realtime</label>
                                        <button
                                          onClick={() => setEditAssignmentDraft(d => ({ ...d, realtimeEnabled: !d.realtimeEnabled }))}
                                          className={cn(
                                            "flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md transition-colors w-full",
                                            editAssignmentDraft.realtimeEnabled
                                              ? "bg-emerald-500/15 text-emerald-300"
                                              : "bg-white/[0.04] text-muted-foreground/50 hover:bg-white/[0.07]"
                                          )}
                                          data-testid="edit-assignment-realtime"
                                        >
                                          {editAssignmentDraft.realtimeEnabled ? '⚡ On' : '— Off'}
                                        </button>
                                      </div>
                                      <div>
                                        <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wide block mb-1">Pinned</label>
                                        <button
                                          onClick={() => setEditAssignmentDraft(d => ({ ...d, isPinned: !d.isPinned }))}
                                          className={cn(
                                            "flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-md transition-colors w-full",
                                            editAssignmentDraft.isPinned
                                              ? "bg-violet-500/15 text-violet-300"
                                              : "bg-white/[0.04] text-muted-foreground/50 hover:bg-white/[0.07]"
                                          )}
                                          data-testid="edit-assignment-pinned"
                                        >
                                          {editAssignmentDraft.isPinned ? '★ Yes' : '☆ No'}
                                        </button>
                                      </div>
                                    </div>
                                    <div className="flex gap-2 pt-1">
                                      <button
                                        onClick={() => updateAssignmentMut.mutate({ id: mod.id, data: editAssignmentDraft })}
                                        data-testid={`save-assignment-${mod.id}`}
                                        className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                                      >
                                        <Check className="h-3.5 w-3.5" /> Save changes
                                      </button>
                                      <button
                                        onClick={() => setEditAssignmentId(null)}
                                        className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-white/[0.05]"
                                      >
                                        Cancel
                                      </button>
                                    </div>
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

                {/* Assign from available modules */}
                {unassignedModules.length > 0 && (
                  <div className="px-3 pb-4">
                    <div className="rounded-xl border border-dashed border-white/[0.08] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-2">
                        Assign from module registry
                      </p>
                      <div className="space-y-0.5 max-h-52 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                        {unassignedModules.map(mod => (
                          <button
                            key={mod.id}
                            onClick={() => {
                              if (selectedPortal && selectedSection) {
                                assignModuleMut.mutate({
                                  portalId: selectedPortal,
                                  moduleId: mod.id,
                                  section: selectedSection.sectionKey,
                                  displayOrder: sectionModules.length,
                                  displayLabel: mod.title,
                                });
                              }
                            }}
                            data-testid={`assign-module-${mod.id}`}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-white/[0.04] transition-colors group"
                          >
                            <Icon k={mod.icon} className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground/70 group-hover:text-foreground/80 truncate transition-colors">{mod.title}</p>
                              <p className="text-[9px] text-muted-foreground/30 truncate">{mod.route}</p>
                            </div>
                            <Plus className="h-3 w-3 text-muted-foreground/30 group-hover:text-indigo-400 flex-shrink-0 transition-colors" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
