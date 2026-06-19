import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { BseTooltip, BSE_GRID_PROPS, BSE_AXIS_PROPS, BSE_CURSOR, bseActiveDot } from "@/components/bse-chart";
import {
  TrendingUp, Users, Network, Radio, ArrowLeftRight, RefreshCw, Activity,
  Globe, AlertTriangle, UserCheck, Phone, Mail, Plus, Trash2, Edit2,
  ChevronDown, ChevronRight, X, Check, Loader2, TrendingDown, Minus,
  Bell, BellOff, ShieldAlert, Map as MapIcon, Eye, ExternalLink,
  Award, Zap, BarChart2, Gauge, Info,
} from "lucide-react";
import { Tooltip as InfoTooltip, TooltipContent as InfoTooltipContent, TooltipProvider as InfoTooltipProvider, TooltipTrigger as InfoTooltipTrigger } from "@/components/ui/tooltip";
import { AreaChart, Area, ReferenceLine } from "recharts";

interface LiveGraphsData {
  trend:            { time: string; avg: number; peak: number }[];
  byClient:         { name: string; calls: number }[];
  byVendor:         { name: string; calls: number }[];
  byCodec:          { name: string; calls: number }[];
  byDirection:      { name: string; calls: number }[];
  byDestination:    { name: string; calls: number }[];
  byBreakout:       { name: string; calls: number }[];
  byCountry:        { name: string; calls: number }[];
  cdrByDestination: { name: string; calls: number }[];
  cdrByCountry:     { name: string; calls: number }[];
  cdrByBreakout:    { name: string; calls: number }[];
  cdrTotal:         number;
  liveCount:        number;
  peakCount:        number;
  windowHours:      number;
  pointsCollected:  number;
  oldestPoint:      number | null;
}

interface KamAccount {
  id: number;
  kamId: number;
  accountId: string;
  clientName: string | null;
  dropThreshold: number | null;
}

interface Kam {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  active: boolean;
  accounts: KamAccount[];
}

interface TrafficAlert {
  id: number;
  clientName: string;
  accountId: string | null;
  kamId: number | null;
  alertType: string;
  prevCalls: number | null;
  currCalls: number | null;
  emailSent: boolean | null;
  emailSentAt: string | null;
  resolvedAt: string | null;
  triggeredAt: string | null;
}

const COLORS = [
  "#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444",
  "#06b6d4","#ec4899","#84cc16","#f97316","#6366f1",
  "#14b8a6","#a855f7","#22c55e","#eab308","#64748b",
];

const DIR_COLORS: Record<string, string> = {
  vendor:   "#3b82f6",
  customer: "#10b981",
  inbound:  "#10b981",
  outbound: "#3b82f6",
  unknown:  "#64748b",
};

const HOUR_OPTIONS = [1, 3, 6, 12, 24, 48];

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }: any) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground/60">{sub}</span>}
    </div>
  );
}

function HBar({ data, colors }: { data: { name: string; calls: number }[]; colors?: string[] }) {
  if (!data.length) return (
    <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No data yet</div>
  );
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid {...BSE_GRID_PROPS} horizontal={false} vertical={true} />
        <XAxis type="number" {...BSE_AXIS_PROPS} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={80} {...BSE_AXIS_PROPS} />
        <Tooltip content={<BseTooltip formatter={(v, key) => [v, 'Calls']} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={(colors ?? COLORS)[i % (colors ?? COLORS).length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Traffic Pulse Card (per-client live status) ────────────────────────────────
function ClientPulseCard({ client, calls, peakCalls }: {
  client: string; calls: number; peakCalls: number;
}) {
  const pct = peakCalls > 0 ? calls / peakCalls : 0;
  const isGone = calls === 0;
  const isLow = !isGone && pct < 0.5;
  const statusColor = isGone ? 'text-rose-400 border-rose-500/30 bg-rose-500/5'
    : isLow ? 'text-amber-400 border-amber-500/30 bg-amber-500/5'
    : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5';
  const dotColor = isGone ? 'bg-rose-500' : isLow ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse';
  const TrendIcon = isGone ? TrendingDown : isLow ? TrendingDown : TrendingUp;
  const trendColor = isGone ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div data-testid={`pulse-card-${client}`} className={`rounded-xl border p-4 ${statusColor}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold truncate max-w-[120px]">{client}</span>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      </div>
      <div className="flex items-end justify-between">
        <span className="text-3xl font-bold tabular-nums">{calls}</span>
        <div className="flex items-center gap-1">
          <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
          <span className="text-xs text-muted-foreground">
            {isGone ? 'GONE' : `peak ${peakCalls}`}
          </span>
        </div>
      </div>
      <div className="mt-2 h-1 rounded-full bg-border/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isGone ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground mt-1">{isGone ? '0%' : `${Math.round(pct * 100)}% of peak`}</div>
    </div>
  );
}

// ── KAM Dialog ────────────────────────────────────────────────────────────────
function KamDialog({ onClose, editKam }: {
  onClose: () => void;
  editKam?: Kam;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editKam?.name ?? '');
  const [email, setEmail] = useState(editKam?.email ?? '');
  const [phone, setPhone] = useState(editKam?.phone ?? '');
  const [title, setTitle] = useState(editKam?.title ?? '');
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () => editKam
      ? apiRequest('PATCH', `/api/kam/${editKam.id}`, { name, email, phone: phone || null, title: title || null })
      : apiRequest('POST', '/api/kam', { name, email, phone: phone || null, title: title || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/kam'] });
      onClose();
    },
    onError: (e: any) => setErr(e.message || 'Failed to save'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { setErr('Name and email are required'); return; }
    setErr('');
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">{editKam ? 'Edit KAM' : 'Add New KAM'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
            <input
              data-testid="input-kam-name"
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email Address *</label>
            <input
              data-testid="input-kam-email"
              type="email"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="kam@company.com"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
              <input
                data-testid="input-kam-phone"
                value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title / Role</label>
              <input
                data-testid="input-kam-title"
                value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Account Manager"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          </div>
          {err && <p className="text-xs text-rose-400">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted/40 transition-colors"
            >Cancel</button>
            <button
              data-testid="button-save-kam"
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {editKam ? 'Save Changes' : 'Add KAM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Assign Account Dialog ─────────────────────────────────────────────────────
function AssignAccountDialog({ kam, liveClients, onClose }: {
  kam: Kam;
  liveClients: { name: string; calls: number }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [clientName, setClientName] = useState('');
  const [err, setErr] = useState('');

  // Pre-fill clientName when accountId is changed to a known live client
  function handleClientSelect(name: string) {
    setClientName(name);
    setAccountId(name.toLowerCase().replace(/\s+/g, '_'));
  }

  const mutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/kam/${kam.id}/accounts`, {
      accountId: accountId.trim(),
      clientName: clientName.trim() || accountId.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/kam'] });
      onClose();
    },
    onError: (e: any) => setErr(e.message || 'Failed to assign'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId.trim()) { setErr('Account ID is required'); return; }
    setErr('');
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold">Assign Account to {kam.name}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {liveClients.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Quick select from live traffic</label>
              <div className="flex flex-wrap gap-1.5">
                {liveClients.map(c => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => handleClientSelect(c.name)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      clientName === c.name
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'border-border hover:bg-muted/40'
                    }`}
                  >
                    {c.name} ({c.calls})
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Client Name (display)</label>
            <input
              data-testid="input-assign-client-name"
              value={clientName} onChange={e => setClientName(e.target.value)}
              placeholder="e.g. PUSHTOTALK"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Account ID (Sippy iAccount)</label>
            <input
              data-testid="input-assign-account-id"
              value={accountId} onChange={e => setAccountId(e.target.value)}
              placeholder="e.g. 1 or PUSHTOTALK"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          {err && <p className="text-xs text-rose-400">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted/40">Cancel</button>
            <button
              data-testid="button-assign-account"
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Assign
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── KAM Card ──────────────────────────────────────────────────────────────────
function KamCard({ kam, liveClients, onEdit, onDelete }: {
  kam: Kam;
  liveClients: { name: string; calls: number }[];
  onEdit: (k: Kam) => void;
  onDelete: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  const removeAssignment = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/kam/accounts/${id}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/kam'] }),
  });

  // Find live call count for each assigned client
  const liveMap = new Map(liveClients.map(c => [c.name, c.calls]));
  const totalLiveCalls = kam.accounts.reduce((sum, a) => sum + (liveMap.get(a.clientName ?? '') ?? 0), 0);
  const hasActiveCalls = totalLiveCalls > 0;

  return (
    <>
      {showAssign && (
        <AssignAccountDialog
          kam={kam}
          liveClients={liveClients.filter(c => !kam.accounts.some(a => a.clientName === c.name))}
          onClose={() => setShowAssign(false)}
        />
      )}
      <div data-testid={`kam-card-${kam.id}`} className="bg-card border border-border/50 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{kam.name}</span>
              {kam.title && <span className="text-xs text-muted-foreground">{kam.title}</span>}
              {hasActiveCalls && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium">
                  {totalLiveCalls} live
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" />{kam.email}
              </span>
              {kam.phone && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" />{kam.phone}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/bitseye?view=kam&kamId=${kam.id}`}
              data-testid={`link-bitseye-kam-graphs-${kam.id}`}
              title="View in BitsEye"
              className="p-1.5 rounded-lg hover:bg-violet-500/10 text-muted-foreground hover:text-violet-400 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
            </Link>
            <button
              data-testid={`btn-edit-kam-${kam.id}`}
              onClick={() => onEdit(kam)}
              className="p-1.5 rounded-lg hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid={`btn-delete-kam-${kam.id}`}
              onClick={() => onDelete(kam.id)}
              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/40 px-4 py-3 bg-muted/5 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Assigned Clients ({kam.accounts.length})</span>
              <button
                data-testid={`btn-assign-account-${kam.id}`}
                onClick={() => setShowAssign(true)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors"
              >
                <Plus className="w-3 h-3" /> Assign Client
              </button>
            </div>
            {kam.accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 italic py-2">No clients assigned yet</p>
            ) : (
              <div className="space-y-1.5">
                {kam.accounts.map(a => {
                  const live = liveMap.get(a.clientName ?? '') ?? 0;
                  return (
                    <div key={a.id} className="flex items-center justify-between bg-background/60 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${live > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                        <span className="text-sm font-medium">{a.clientName ?? a.accountId}</span>
                        <span className="text-xs text-muted-foreground">ID: {a.accountId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${live > 0 ? 'text-emerald-400' : 'text-muted-foreground/50'}`}>
                          {live > 0 ? `${live} calls` : 'idle'}
                        </span>
                        <button
                          data-testid={`btn-remove-assignment-${a.id}`}
                          onClick={() => removeAssignment.mutate(a.id)}
                          disabled={removeAssignment.isPending}
                          className="p-1 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Alert Type Badge ──────────────────────────────────────────────────────────
function AlertTypeBadge({ type }: { type: string }) {
  if (type === 'traffic_gone') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 border border-rose-500/30 text-rose-400">
      <ShieldAlert className="w-3 h-3" /> GONE
    </span>
  );
  if (type === 'traffic_dropped') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400">
      <TrendingDown className="w-3 h-3" /> DROPPED
    </span>
  );
  if (type === 'traffic_decreasing') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/15 border border-violet-500/30 text-violet-400">
      <TrendingDown className="w-3 h-3" /> DECLINING
    </span>
  );
  if (type === 'traffic_restored') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
      <TrendingUp className="w-3 h-3" /> RESTORED
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted border border-border text-muted-foreground">
      <Minus className="w-3 h-3" /> {type}
    </span>
  );
}

// ── Destination Breakout Section ──────────────────────────────────────────────
interface DestEntity {
  name: string;
  daily: { label: string; total_calls: number; connected_calls: number }[];
  todayCalls: number;
  asr: number;
  trendPct: number;
  clients?: string[];
}

function DestBreakoutSection() {
  const [open, setOpen] = useState(true);
  const { data, isLoading, isFetching } = useQuery<{ entities: DestEntity[] }>({
    queryKey: ['/api/bitseye/per-entity', 'destinations'],
    queryFn: () => fetch('/api/bitseye/per-entity?category=destinations&aliveOnly=false').then(r => r.json()),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  const dests = data?.entities ?? [];

  return (
    <div className="bg-card border border-emerald-500/20 rounded-xl overflow-hidden shadow-lg shadow-black/5">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors"
        data-testid="btn-toggle-dest-breakout"
      >
        <MapIcon className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold">Destination Breakout Graphs</h2>
        <span className="text-xs text-muted-foreground/60">auto-created from CDR data · per destination time-series</span>
        {isFetching && <RefreshCw className="w-3 h-3 text-muted-foreground/40 animate-spin ml-1" />}
        <span className="ml-auto flex items-center gap-3">
          {dests.length > 0 && (
            <span className="text-xs text-muted-foreground">{dests.length} destination{dests.length !== 1 ? 's' : ''}</span>
          )}
          <Link
            href="/bitseye?view=destinations"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-emerald-400/70 hover:text-emerald-400 transition-colors"
            data-testid="link-bitseye-destinations"
          >
            <Eye className="w-3 h-3" /> BitsEye
          </Link>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border/30">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading destination data…
            </div>
          ) : dests.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground/50 text-sm">
              <Globe className="w-7 h-7 opacity-20" />
              <span>No destination data yet — appears automatically when CDR data arrives</span>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {dests.map((dest, idx) => {
                const hasData = dest.daily.some(d => d.total_calls > 0);
                const color = COLORS[idx % COLORS.length];
                const trend = dest.trendPct;
                return (
                  <div key={dest.name} className="border border-border/40 rounded-xl overflow-hidden bg-background/40">
                    {/* Dest card header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/20 bg-muted/10">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="font-semibold text-xs flex-1 truncate" title={dest.name}>{dest.name}</span>
                      {/* trend badge */}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                        trend > 10  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                        trend < -10 ? 'text-rose-400    bg-rose-500/10    border-rose-500/20'    :
                                      'text-amber-400   bg-amber-500/10   border-amber-500/20'
                      }`}>
                        {trend > 0 ? '+' : ''}{trend}%
                      </span>
                      <Link
                        href="/bitseye?view=destinations"
                        className="p-1 text-muted-foreground/30 hover:text-emerald-400 transition-colors flex-shrink-0"
                        title="View in BitsEye"
                      >
                        <ExternalLink className="w-2.5 h-2.5" />
                      </Link>
                    </div>
                    {/* KPIs */}
                    <div className="grid grid-cols-3 border-b border-border/15 divide-x divide-border/10">
                      <div className="flex flex-col items-center py-1.5">
                        <span className="text-[8px] text-muted-foreground/40 uppercase">Today</span>
                        <span className="text-xs font-bold tabular-nums">{dest.todayCalls || '-'}</span>
                      </div>
                      <div className="flex flex-col items-center py-1.5">
                        <span className="text-[8px] text-muted-foreground/40 uppercase">ASR</span>
                        <span className={`text-xs font-bold tabular-nums ${
                          dest.asr >= 60 ? 'text-emerald-400' : dest.asr >= 40 ? 'text-amber-400' : dest.asr > 0 ? 'text-rose-400' : 'text-muted-foreground/25'
                        }`}>{dest.asr > 0 ? `${dest.asr}%` : '-'}</span>
                      </div>
                      <div className="flex flex-col items-center py-1.5">
                        <span className="text-[8px] text-muted-foreground/40 uppercase">Clients</span>
                        <span className="text-xs font-bold tabular-nums">{dest.clients?.length ?? '-'}</span>
                      </div>
                    </div>
                    {/* Mini chart */}
                    {hasData ? (
                      <ResponsiveContainer width="100%" height={80}>
                        <LineChart data={dest.daily} margin={{ top: 4, right: 8, left: -30, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.2)" />
                          <XAxis dataKey="label" hide />
                          <YAxis tick={{ fontSize: 6, fill: 'hsl(var(--muted-foreground)/0.5)' }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                          <Tooltip
                            content={({ active, payload, label: lbl }) =>
                              active && payload?.length ? (
                                <div className="bg-card border border-border rounded px-2 py-1 text-[10px] shadow-lg">
                                  <p className="text-muted-foreground truncate max-w-[120px]">{lbl}</p>
                                  <p style={{ color }}>Calls: <b>{payload[0]?.value}</b></p>
                                </div>
                              ) : null
                            }
                          />
                          <Line type="monotone" dataKey="total_calls" stroke={color} strokeWidth={1.5} dot={false} />
                          <Line type="monotone" dataKey="connected_calls" stroke={color} strokeWidth={1} strokeDasharray="3 2" dot={false} opacity={0.5} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-20 flex items-center justify-center text-[10px] text-muted-foreground/25">No chart data yet</div>
                    )}
                    {/* Client pills */}
                    {dest.clients && dest.clients.length > 0 && (
                      <div className="px-2.5 py-1.5 border-t border-border/15 flex flex-wrap gap-1">
                        {dest.clients.slice(0, 4).map(c => (
                          <span key={c} className="text-[8px] px-1.5 py-0.5 rounded bg-muted/30 border border-border/25 text-muted-foreground/50">{c}</span>
                        ))}
                        {dest.clients.length > 4 && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/30">+{dest.clients.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function GraphsPage() {
  const [hours, setHours] = useState(3);
  const [showKamDialog, setShowKamDialog] = useState(false);
  const [editKam, setEditKam] = useState<Kam | undefined>();
  const [kamSectionOpen, setKamSectionOpen] = useState(true);
  const [alertSectionOpen, setAlertSectionOpen] = useState(true);
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<LiveGraphsData>({
    queryKey: ['/api/sippy/live-graphs', hours],
    queryFn: () => fetch(`/api/sippy/live-graphs?hours=${hours}`).then(r => r.json()),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: kams = [], isLoading: kamsLoading } = useQuery<Kam[]>({
    queryKey: ['/api/kam'],
    refetchInterval: 60_000,
  });

  const { data: trafficAlerts = [] } = useQuery<TrafficAlert[]>({
    queryKey: ['/api/traffic-alerts'],
    refetchInterval: 60_000,
  });

  const deleteKamMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/kam/${id}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/kam'] }),
  });

  // Viewer account filtering
  const { role } = useAuth();
  const { data: viewerAccounts } = useQuery<{ accountIds: string[]; clientNames: string[]; kamName: string | null }>({
    queryKey: ['/api/user/assigned-accounts'],
    enabled: role === 'viewer',
  });
  const viewerClientNames = new Set((viewerAccounts?.clientNames ?? []).map((n: string) => n.toLowerCase()));

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;
  const hasHistory = (data?.trend?.length ?? 0) > 0;
  const coverageMins = data?.oldestPoint
    ? Math.round((Date.now() - data.oldestPoint) / 60_000)
    : 0;

  const allLiveClients = data?.byClient ?? [];
  const liveClients = (role === 'viewer' && viewerClientNames.size > 0)
    ? allLiveClients.filter(c => viewerClientNames.has(c.name.toLowerCase()))
    : allLiveClients;
  const liveMap = new Map(liveClients.map(c => [c.name, c.calls]));

  // Compute peak per client in the last 48h (use peakCount as proxy for now)
  const peakByClient: Record<string, number> = {};
  for (const c of liveClients) peakByClient[c.name] = c.calls;

  // All unique clients that have had traffic (from KAM assignments + live)
  const allClientNames = Array.from(new Set([
    ...liveClients.map(c => c.name),
    ...kams.flatMap(k => k.accounts.map(a => a.clientName ?? a.accountId)),
  ]));

  // Open / recent alerts
  const openAlerts = trafficAlerts.filter(a => !a.resolvedAt && a.alertType !== 'traffic_restored');
  const recentAlerts = trafficAlerts.slice(0, 20);

  return (
    <div className="space-y-6 p-1">

      {/* Dialogs */}
      {(showKamDialog || editKam) && (
        <KamDialog
          editKam={editKam}
          onClose={() => { setShowKamDialog(false); setEditKam(undefined); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-400" />
            Live Call Graphs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time concurrent calls from Sippy Softswitch · auto-refreshes every 30 s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
            {HOUR_OPTIONS.map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                data-testid={`btn-hours-${h}`}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  hours === h
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh-graphs"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground/60">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${data?.liveCount ? 'bg-green-400 animate-pulse' : 'bg-muted'}`} />
          {updatedAt ? `Updated ${updatedAt}` : 'Loading…'}
        </span>
        {data?.pointsCollected !== undefined && (
          <span>{data.pointsCollected} snapshot{data.pointsCollected !== 1 ? 's' : ''} collected
            {coverageMins > 0 ? ` · ${coverageMins}m of history` : ''}</span>
        )}
        {openAlerts.length > 0 && (
          <span className="flex items-center gap-1 text-amber-400/80 font-medium">
            <Bell className="w-3 h-3 animate-pulse" />
            {openAlerts.length} open traffic alert{openAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
        {!isLoading && (data?.pointsCollected ?? 0) < 3 && (
          <span className="text-amber-400/80 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            History building — more data appears every 30 s
          </span>
        )}
      </div>

      {/* ── KPI stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Live Concurrent Calls"
          value={isLoading ? '…' : data?.liveCount ?? 0}
          sub="right now on Sippy"
          color="text-blue-400"
        />
        <StatCard
          label={`Peak — Last ${hours}h`}
          value={isLoading ? '…' : data?.peakCount ?? 0}
          sub="max concurrent calls"
          color="text-violet-400"
        />
        <StatCard
          label="Active Clients"
          value={isLoading ? '…' : liveClients.length}
          sub="with live traffic"
          color="text-emerald-400"
        />
        <StatCard
          label="Active Vendors"
          value={isLoading ? '…' : data?.byVendor?.length ?? 0}
          sub="carrying traffic"
          color="text-amber-400"
        />
      </div>

      {/* ── Client Traffic Pulse ───────────────────────────────────────── */}
      {allClientNames.length > 0 && (
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Client Traffic Pulse</h2>
            <span className="text-xs text-muted-foreground ml-auto">real-time concurrent calls per client</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {allClientNames.map(name => (
              <ClientPulseCard
                key={name}
                client={name}
                calls={liveMap.get(name) ?? 0}
                peakCalls={Math.max(liveMap.get(name) ?? 0, data?.peakCount ?? 0, 1)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Chart 1: Concurrent calls trend ──────────────────────────── */}
      <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold">Concurrent Calls Over Time</h2>
          <span className="text-xs text-muted-foreground ml-auto">last {hours}h · avg &amp; peak per bucket</span>
        </div>

        {isLoading ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
        ) : !hasHistory ? (
          <div className="h-56 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Collecting snapshots every 30 s — chart will appear shortly</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data!.trend} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid {...BSE_GRID_PROPS} />
              <XAxis
                dataKey="time"
                {...BSE_AXIS_PROPS}
                interval={data!.trend.length > 20 ? Math.floor(data!.trend.length / 10) : 0}
              />
              <YAxis
                {...BSE_AXIS_PROPS}
                allowDecimals={false}
                domain={[0, 'auto']}
              />
              <Tooltip content={<BseTooltip />} cursor={BSE_CURSOR} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(148,163,184,0.7)' }} />
              <Line type="monotone" dataKey="avg" name="Avg Concurrent" stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={bseActiveDot('#3b82f6')} strokeLinecap="round" />
              <Line type="monotone" dataKey="peak" name="Peak" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 2" dot={false} activeDot={bseActiveDot('#8b5cf6', 3)} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Charts 2 & 3: By Client + By Vendor ─────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Live Calls by Client</h2>
            <span className="text-xs text-muted-foreground ml-auto">
              {role === 'viewer' && viewerClientNames.size > 0
                ? `${liveClients.length} assigned account${liveClients.length !== 1 ? 's' : ''}`
                : 'max over last 5 polls'}
            </span>
          </div>
          {isLoading
            ? <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
            : liveClients.length === 0
              ? <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No active client traffic</div>
              : <HBar data={liveClients} />}
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold">Live Calls by Vendor</h2>
            <span className="text-xs text-muted-foreground ml-auto">max over last 5 polls</span>
          </div>
          {isLoading
            ? <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
            : <HBar data={data?.byVendor ?? []} colors={["#8b5cf6","#3b82f6","#06b6d4","#f59e0b","#ef4444","#10b981","#ec4899","#84cc16"]} />}
        </div>
      </div>

      {/* ── Charts 4 & 5: By Codec + By Direction ───────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold">Live Calls by Codec</h2>
            <span className="text-xs text-muted-foreground ml-auto">max over last 5 polls</span>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.byCodec?.length) ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No codec data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={data!.byCodec} dataKey="calls" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={<PieLabel />}>
                  {data!.byCodec.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [v, n]} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-4">
            <ArrowLeftRight className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Live Calls by Direction</h2>
            <span className="text-xs text-muted-foreground ml-auto">vendor vs customer legs</span>
          </div>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.byDirection?.length) ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground/50 text-sm">No direction data yet</div>
          ) : (
            <HBar data={data!.byDirection} colors={data!.byDirection.map(d => DIR_COLORS[d.name] ?? COLORS[0])} />
          )}
        </div>
      </div>

      {/* ── Destinations section ────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold">Top Destinations — CDR History</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Based on {data?.cdrTotal ? data.cdrTotal.toLocaleString() + ' completed calls' : 'CDR cache'} in last {hours}h
          </p>
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.cdrByDestination?.length) ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>CDR cache warming up…</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, data!.cdrByDestination.length * 38)}>
              <BarChart data={data!.cdrByDestination} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <Tooltip content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="font-semibold">{label}</p>
                      <p style={{ color: payload[0]?.fill }}>
                        Calls: <b>{payload[0]?.value?.toLocaleString()}</b>
                        {data?.cdrTotal ? <span className="text-muted-foreground ml-1">({((Number(payload[0]?.value) / data.cdrTotal) * 100).toFixed(1)}%)</span> : ''}
                      </p>
                    </div>
                  ) : null
                } cursor={{ fill: 'hsl(var(--muted))', opacity: 0.25 }} />
                <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                  {data!.cdrByDestination.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Live Destinations — Active Calls</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Derived from callee number prefix · max over last 5 polls
          </p>
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.byDestination?.length) ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Waiting for active call data…</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, data!.byDestination.length * 38)}>
              <BarChart data={data!.byDestination} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <Tooltip content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="font-semibold">{label}</p>
                      <p style={{ color: payload[0]?.fill }}>Concurrent: <b>{payload[0]?.value}</b></p>
                    </div>
                  ) : null
                } cursor={{ fill: 'hsl(var(--muted))', opacity: 0.25 }} />
                <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                  {data!.byDestination.map((_, i) => (
                    <Cell key={i} fill={["#10b981","#06b6d4","#3b82f6","#8b5cf6","#f59e0b","#ef4444"][i % 6]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── CDR Breakout & Country Charts ────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* By Breakout — CDR */}
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold">By Breakout Type — CDR</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Call volume per breakout (FIXED / MOBILE / SPECIAL…) from CDR history
          </p>
          {isLoading ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.cdrByBreakout?.length) ? (
            <div className="h-56 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Waiting for CDR data…</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, data!.cdrByBreakout.length * 32)}>
              <BarChart data={data!.cdrByBreakout} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <Tooltip content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="font-semibold">{label}</p>
                      <p style={{ color: payload[0]?.fill }}>Calls: <b>{payload[0]?.value}</b></p>
                    </div>
                  ) : null
                } cursor={{ fill: 'hsl(var(--muted))', opacity: 0.25 }} />
                <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                  {data!.cdrByBreakout.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By Country — CDR */}
        <div className="bg-card border border-border/50 rounded-xl p-5 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold">By Country — CDR</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Top countries by call volume from CDR history
          </p>
          {isLoading ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground/50 text-sm">Loading…</div>
          ) : !(data?.cdrByCountry?.length) ? (
            <div className="h-56 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Waiting for CDR data…</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, data!.cdrByCountry.length * 32)}>
              <BarChart data={data!.cdrByCountry} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <Tooltip content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="font-semibold">{label}</p>
                      <p style={{ color: payload[0]?.fill }}>Calls: <b>{payload[0]?.value}</b></p>
                    </div>
                  ) : null
                } cursor={{ fill: 'hsl(var(--muted))', opacity: 0.25 }} />
                <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                  {data!.cdrByCountry.map((_, i) => (
                    <Cell key={i} fill={["#06b6d4","#10b981","#8b5cf6","#f59e0b","#ef4444","#3b82f6"][i % 6]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Destination Breakout Graphs ──────────────────────────────── */}
      <DestBreakoutSection />

      {/* ── KAM Management ────────────────────────────────────────────── */}
      {role !== 'viewer' && <div className="bg-card border border-violet-500/20 rounded-xl overflow-hidden shadow-lg shadow-black/5">
        <button
          onClick={() => setKamSectionOpen(o => !o)}
          className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors"
          data-testid="btn-toggle-kam-section"
        >
          <UserCheck className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold">KAM Overview — Key Account Managers</h2>
          {openAlerts.length > 0 && (
            <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-medium">
              {openAlerts.length} alert{openAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{kams.length} KAM{kams.length !== 1 ? 's' : ''}</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${kamSectionOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {kamSectionOpen && (
          <div className="border-t border-border/40 p-5 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                Assign KAMs to client accounts — they receive email alerts when traffic drops
              </p>
              <button
                data-testid="btn-add-kam"
                onClick={() => setShowKamDialog(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add KAM
              </button>
            </div>

            {kamsLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground/50 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading KAMs…
              </div>
            ) : kams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground/50">
                <UserCheck className="w-10 h-10 opacity-30" />
                <p className="text-sm">No KAMs configured yet</p>
                <button
                  onClick={() => setShowKamDialog(true)}
                  className="text-xs px-4 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors"
                >
                  Add your first KAM
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {kams.map(k => (
                  <KamCard
                    key={k.id}
                    kam={k}
                    liveClients={liveClients}
                    onEdit={setEditKam}
                    onDelete={id => deleteKamMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>}

      {/* ── Traffic Alerts Log ─────────────────────────────────────────── */}
      {role !== 'viewer' && <div className="bg-card border border-amber-500/20 rounded-xl overflow-hidden shadow-lg shadow-black/5">
        <button
          onClick={() => setAlertSectionOpen(o => !o)}
          className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors"
          data-testid="btn-toggle-alert-section"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold">Traffic Trend Alerts</h2>
          {openAlerts.length > 0 && (
            <span className="ml-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          )}
          <span className="ml-auto flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground/50">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500/70" />Gone (immediate)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500/70" />Dropped (&gt;50%)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500/70" />Declining trend (1h)</span>
            </span>
            <span className="text-xs text-muted-foreground">{recentAlerts.length} recent</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${alertSectionOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {alertSectionOpen && (
          <div className="border-t border-border/40">
            {recentAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground/50">
                <BellOff className="w-10 h-10 opacity-30" />
                <p className="text-sm">No traffic alerts yet</p>
                <p className="text-xs text-center max-w-xs">Alerts fire when traffic goes to zero (immediately), drops &gt;50% suddenly, or shows a sustained declining trend over 1 hour</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {recentAlerts.map(alert => {
                  const pct = alert.prevCalls && alert.prevCalls > 0
                    ? Math.round(((alert.prevCalls - (alert.currCalls ?? 0)) / alert.prevCalls) * 100)
                    : 100;
                  const isOpen = !alert.resolvedAt && alert.alertType !== 'traffic_restored';
                  const isDecline = alert.alertType === 'traffic_decreasing';
                  const rowBg = alert.alertType === 'traffic_gone'
                    ? 'bg-rose-500/5'
                    : isDecline
                      ? 'bg-violet-500/5'
                      : isOpen
                        ? 'bg-amber-500/5'
                        : '';
                  return (
                    <div
                      key={alert.id}
                      data-testid={`alert-row-${alert.id}`}
                      className={`flex items-center gap-4 px-5 py-3 ${rowBg}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <AlertTypeBadge type={alert.alertType} />
                          <span className="text-sm font-semibold">{alert.clientName}</span>
                          {isOpen && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full border ${isDecline ? 'bg-violet-500/15 border-violet-500/30 text-violet-400' : 'bg-amber-500/15 border-amber-500/30 text-amber-400'}`}>
                              {isDecline ? 'TRENDING DOWN' : 'OPEN'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          {isDecline ? (
                            <span className="text-violet-400/80">
                              60-min peak: {alert.prevCalls ?? 0} → now: {alert.currCalls ?? 0} (−{pct}%)
                            </span>
                          ) : (
                            <span>{alert.prevCalls ?? 0} → {alert.currCalls ?? 0} calls {alert.alertType !== 'traffic_restored' ? `(−${pct}%)` : '↑ recovered'}</span>
                          )}
                          {alert.triggeredAt && (
                            <span>{new Date(alert.triggeredAt).toLocaleString()}</span>
                          )}
                          {alert.emailSent ? (
                            <span className="flex items-center gap-1 text-emerald-400/80"><Mail className="w-3 h-3" /> Email sent</span>
                          ) : (
                            <span className="flex items-center gap-1 text-muted-foreground/40"><Mail className="w-3 h-3" /> No email</span>
                          )}
                          {alert.resolvedAt && (
                            <span className="text-emerald-400/70">Resolved {new Date(alert.resolvedAt).toLocaleTimeString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>}

      {/* ── MOS Quality Trend ─────────────────────────────────────── */}
      <MosTrendingSection />

      {/* ── Carrier Quality League ─────────────────────────────────── */}
      <CarrierQualitySection />

      {/* ── Traffic Anomaly Detector ───────────────────────────────── */}
      <TrafficAnomalySection />

      {/* Summary footer */}
      <div className="flex flex-wrap gap-4 p-4 bg-card/40 border border-border/40 rounded-xl text-xs text-muted-foreground">
        <span>Window: <strong className="text-foreground">{hours}h</strong></span>
        <span>Current live calls: <strong className="text-foreground">{data?.liveCount ?? 0}</strong></span>
        <span>Peak in window: <strong className="text-foreground">{data?.peakCount ?? 0}</strong></span>
        <span>CDR records: <strong className="text-foreground">{(data?.cdrTotal ?? 0).toLocaleString()}</strong></span>
        <span>Snapshots collected: <strong className="text-foreground">{data?.pointsCollected ?? 0}</strong></span>
        <span>KAMs: <strong className="text-foreground">{kams.length}</strong></span>
        <span className="ml-auto text-muted-foreground/50">Polled every 30 s · auto-refreshes every 30 s</span>
      </div>
    </div>
  );
}

// ── MOS Trending Section ──────────────────────────────────────────────────────
type MosHourly = {
  bucket: string;
  avgMos: number;
  sampleCount: number;
  goodPct: number;
  fairPct: number;
  poorPct: number;
};

function mosBadge(score: number) {
  if (score >= 4.0) return "text-emerald-400";
  if (score >= 3.5) return "text-yellow-400";
  return "text-red-400";
}

function MosTrendingSection() {
  const [daysBack, setDaysBack] = useState(7);
  const [collapsed, setCollapsed] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<MosHourly[]>({
    queryKey: ["/api/mos-trending", daysBack],
    queryFn: () => fetch(`/api/mos-trending?days=${daysBack}`).then(r => r.json()),
    refetchOnWindowFocus: false,
  });

  const rows = data ?? [];
  const latestMos = rows.length ? rows[rows.length - 1].avgMos : null;

  const chartData = rows.map(r => ({
    time: new Date(r.bucket).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' }),
    MOS: parseFloat(r.avgMos.toFixed(3)),
    Good: parseFloat(r.goodPct.toFixed(1)),
    Poor: parseFloat(r.poorPct.toFixed(1)),
  }));

  return (
    <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-lg shadow-black/5">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
        onClick={() => setCollapsed(c => !c)}
        data-testid="toggle-mos-section"
      >
        <Activity className="w-4 h-4 text-purple-400 shrink-0" />
        <div className="flex-1">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            Est. MOS Trends
            <InfoTooltipProvider>
              <InfoTooltip>
                <InfoTooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help hover:text-muted-foreground transition-colors" />
                </InfoTooltipTrigger>
                <InfoTooltipContent className="max-w-xs text-xs leading-relaxed">
                  <p className="font-semibold mb-1">Estimated MOS (CDR-based)</p>
                  <p>Derived from signalling delay (PDD/CDR data). Does not measure RTP media quality.</p>
                  <p className="mt-1 text-muted-foreground">RTP-based MOS is available in probe and simulation metrics.</p>
                </InfoTooltipContent>
              </InfoTooltip>
            </InfoTooltipProvider>
          </span>
          {latestMos !== null && (
            <span className={`ml-2 text-xs font-mono font-bold ${mosBadge(latestMos)}`}>
              Latest: {latestMos.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground" onClick={e => e.stopPropagation()}>
          {([7, 14, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setDaysBack(d)}
              className={`px-2 py-1 rounded transition-colors ${daysBack === d ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40'}`}
              data-testid={`mos-days-${d}`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-mos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
        <TrendingDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      </div>

      {!collapsed && (
        <div className="px-5 pb-5 pt-1 space-y-4">
          {isLoading ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground/50 text-sm">Loading Est. MOS data…</div>
          ) : rows.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
              <Activity className="w-6 h-6 opacity-40" />
              <span>No Est. MOS data yet — CDR enrichment populates this hourly</span>
            </div>
          ) : (
            <>
              {/* MOS Score Line Chart */}
              <div>
                <div className="text-xs text-muted-foreground mb-2">Est. MOS per hour — CDR-based signalling proxy (4.0+ = Excellent, 3.5+ = Good, &lt;3.5 = Poor)</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis domain={[1, 5]} tick={{ fontSize: 9, fill: '#6b7280' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => v.toFixed(3)}
                    />
                    <Line type="monotone" dataKey="MOS" stroke="#a78bfa" strokeWidth={2} dot={false} name="Est. MOS" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Good vs Poor % Bar Chart */}
              <div>
                <div className="text-xs text-muted-foreground mb-2">Good (≥3.5) vs Poor (&lt;3.0) call percentage per hour</div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={chartData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis unit="%" tick={{ fontSize: 9, fill: '#6b7280' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => `${v.toFixed(1)}%`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Good" fill="#10b981" radius={[2,2,0,0]} />
                    <Bar dataKey="Poor" fill="#ef4444" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Summary stats row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Est. MOS",   value: (rows.reduce((a,r) => a + r.avgMos, 0) / rows.length).toFixed(3), color: mosBadge(rows.reduce((a,r) => a + r.avgMos, 0) / rows.length) },
                  { label: "Good Calls", value: `${(rows.reduce((a,r) => a + r.goodPct, 0) / rows.length).toFixed(1)}%`, color: "text-emerald-400" },
                  { label: "Poor Calls", value: `${(rows.reduce((a,r) => a + r.poorPct, 0) / rows.length).toFixed(1)}%`, color: "text-red-400" },
                ].map(s => (
                  <div key={s.label} className="bg-muted/20 border border-border/40 rounded-lg p-3 text-center">
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Carrier Quality League Table ───────────────────────────────────────────────
type CarrierStat = {
  carrier: string;
  avgMos: number;
  callCount: number;
  goodPct: number;
  poorPct: number;
};

type QualityEvent = {
  id: number;
  windowStart: string;
  windowEnd: string;
  avgMos: number;
  carrier: string | null;
  sampleCount: number;
  createdAt: string;
};

function mosColor(mos: number) {
  if (mos >= 4.0) return "text-emerald-400";
  if (mos >= 3.5) return "text-yellow-400";
  return "text-red-400";
}

function mosBg(mos: number) {
  if (mos >= 4.0) return "bg-emerald-500/10 border-emerald-500/25";
  if (mos >= 3.5) return "bg-yellow-500/10 border-yellow-500/25";
  return "bg-red-500/10 border-red-500/25";
}

function CarrierQualitySection() {
  const [collapsed, setCollapsed] = useState(false);
  const [eventsCollapsed, setEventsCollapsed] = useState(false);

  const { data: carrierData, isLoading: cLoading, refetch: cRefetch, isFetching: cFetching } =
    useQuery<CarrierStat[]>({
      queryKey: ["/api/mos-carrier-stats"],
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

  const { data: eventsData, isLoading: eLoading, refetch: eRefetch, isFetching: eFetching } =
    useQuery<QualityEvent[]>({
      queryKey: ["/api/quality-events"],
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

  const carriers = carrierData ?? [];
  const events = eventsData ?? [];
  const worst = carriers.length ? carriers.reduce((a, b) => a.avgMos < b.avgMos ? a : b) : null;
  const best  = carriers.length ? carriers[0] : null;

  const chartData = carriers.slice(0, 12).map(c => ({
    name: c.carrier.length > 14 ? c.carrier.slice(0, 14) + "…" : c.carrier,
    MOS: c.avgMos,
    Good: c.goodPct,
    Poor: c.poorPct,
  }));

  return (
    <div className="space-y-3">
      {/* Carrier League Table */}
      <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-lg shadow-black/5">
        <div
          className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
          onClick={() => setCollapsed(c => !c)}
          data-testid="toggle-carrier-quality"
        >
          <Award className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-semibold">Carrier Quality League</span>
            {best && (
              <span className="ml-2 text-xs text-muted-foreground">
                Best: <span className="text-emerald-400 font-mono">{best.carrier} {best.avgMos.toFixed(2)}</span>
                {worst && worst.carrier !== best.carrier && (
                  <> · Worst: <span className="text-red-400 font-mono">{worst.carrier} {worst.avgMos.toFixed(2)}</span></>
                )}
              </span>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); cRefetch(); }}
            disabled={cFetching}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-carrier-quality"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cFetching ? "animate-spin" : ""}`} />
          </button>
          <TrendingDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </div>

        {!collapsed && (
          <div className="px-5 pb-5 pt-1 space-y-4">
            {cLoading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground/50 text-sm">Loading carrier stats…</div>
            ) : carriers.length === 0 ? (
              <div className="h-32 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
                <Gauge className="w-6 h-6 opacity-40" />
                <span>No carrier CDR data yet — populates as calls complete</span>
              </div>
            ) : (
              <>
                {/* MOS bar chart per carrier */}
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Est. MOS by carrier — signalling proxy from CDR/PDD, not RTP</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                      <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 9, fill: '#6b7280' }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} width={80} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number) => v.toFixed(2)}
                      />
                      <ReferenceLine x={3.5} stroke="#facc15" strokeDasharray="4 2" />
                      <ReferenceLine x={4.0} stroke="#10b981" strokeDasharray="4 2" />
                      <Bar dataKey="MOS" radius={[0, 3, 3, 0]}>
                        {chartData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.MOS >= 4.0 ? "#10b981" : entry.MOS >= 3.5 ? "#facc15" : "#ef4444"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* League table rows */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-5 text-xs text-muted-foreground px-3 py-1 font-medium">
                    <span className="col-span-2">Carrier</span>
                    <span className="text-right flex items-center justify-end gap-1">
                      Est. MOS
                      <InfoTooltipProvider>
                        <InfoTooltip>
                          <InfoTooltipTrigger asChild>
                            <Info className="w-3 h-3 cursor-help hover:text-foreground transition-colors" />
                          </InfoTooltipTrigger>
                          <InfoTooltipContent className="max-w-xs text-xs leading-relaxed" side="top">
                            <p className="font-semibold mb-1">Estimated MOS (CDR-based)</p>
                            <p>Derived from signalling delay (PDD/CDR data). Does not measure RTP media quality.</p>
                          </InfoTooltipContent>
                        </InfoTooltip>
                      </InfoTooltipProvider>
                    </span>
                    <span className="text-right">Good%</span>
                    <span className="text-right">Poor%</span>
                  </div>
                  {carriers.map((c, i) => (
                    <div
                      key={c.carrier}
                      className={`grid grid-cols-5 text-xs px-3 py-2 rounded-lg border items-center ${mosBg(c.avgMos)}`}
                      data-testid={`carrier-quality-row-${i}`}
                    >
                      <span className="col-span-2 font-medium truncate flex items-center gap-1.5">
                        <span className="text-muted-foreground text-[10px] font-mono w-4 shrink-0">#{i + 1}</span>
                        {c.carrier}
                      </span>
                      <span className={`text-right font-mono font-bold ${mosColor(c.avgMos)}`}>{c.avgMos.toFixed(2)}</span>
                      <span className="text-right text-emerald-400">{c.goodPct.toFixed(0)}%</span>
                      <span className="text-right text-red-400">{c.poorPct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Quality Events Log */}
      <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-lg shadow-black/5">
        <div
          className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
          onClick={() => setEventsCollapsed(c => !c)}
          data-testid="toggle-quality-events"
        >
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-semibold">Quality Events Log</span>
            {events.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {events.length} event{events.length !== 1 ? "s" : ""} · latest Est. MOS{" "}
                <span className={mosColor(events[0].avgMos)}>{events[0].avgMos.toFixed(2)}</span>
              </span>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); eRefetch(); }}
            disabled={eFetching}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-quality-events"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${eFetching ? "animate-spin" : ""}`} />
          </button>
          <TrendingDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${eventsCollapsed ? "-rotate-90" : ""}`} />
        </div>

        {!eventsCollapsed && (
          <div className="px-5 pb-5 pt-1">
            {eLoading ? (
              <div className="h-20 flex items-center justify-center text-muted-foreground/50 text-sm">Loading events…</div>
            ) : events.length === 0 ? (
              <div className="h-20 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
                <Check className="w-5 h-5 opacity-40 text-emerald-400" />
                <span>No quality degradation events in the last 30 days</span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                <div className="grid grid-cols-4 text-xs text-muted-foreground px-3 py-1 font-medium sticky top-0 bg-card z-10">
                  <span className="col-span-2">Window</span>
                  <span className="text-right">Est. MOS</span>
                  <span className="text-right">Samples</span>
                </div>
                {events.map(ev => (
                  <div
                    key={ev.id}
                    className="grid grid-cols-4 text-xs px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 items-center"
                    data-testid={`quality-event-${ev.id}`}
                  >
                    <span className="col-span-2 text-muted-foreground font-mono">
                      {new Date(ev.windowStart).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`text-right font-mono font-bold ${mosColor(ev.avgMos)}`}>{ev.avgMos.toFixed(2)}</span>
                    <span className="text-right text-muted-foreground">{ev.sampleCount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Traffic Anomaly Detector ───────────────────────────────────────────────────
type TrafficAnomalyRow = {
  id: number;
  detectedAt: string;
  concurrent: number;
  baselineAvg: number;
  baselineStdDev: number;
  sigmaMultiple: number;
  isBusinessHours: boolean;
  resolvedAt: string | null;
  notes: string | null;
};

type TrafficBaselineRow = {
  id: number;
  dayOfWeek: number;
  hour: number;
  avgConcurrent: number;
  stdDev: number;
  sampleCount: number;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function sigmaColor(sigma: number) {
  if (sigma >= 3.0) return "text-red-400";
  if (sigma >= 2.0) return "text-orange-400";
  return "text-yellow-400";
}

function TrafficAnomalySection() {
  const [collapsed, setCollapsed] = useState(false);
  const [heatmapCollapsed, setHeatmapCollapsed] = useState(false);

  const { data: anomaliesData, isLoading: aLoading, refetch: aRefetch, isFetching: aFetching } =
    useQuery<TrafficAnomalyRow[]>({
      queryKey: ["/api/traffic-anomalies"],
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

  const { data: baselinesData, isLoading: bLoading, refetch: bRefetch, isFetching: bFetching } =
    useQuery<TrafficBaselineRow[]>({
      queryKey: ["/api/traffic-baselines"],
      refetchInterval: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

  const anomalies = anomaliesData ?? [];
  const baselines = baselinesData ?? [];
  const openAnomalies = anomalies.filter(a => !a.resolvedAt);

  const baselineMap = new Map<string, TrafficBaselineRow>();
  for (const b of baselines) baselineMap.set(`${b.dayOfWeek}-${b.hour}`, b);
  const maxAvg = Math.max(...baselines.map(b => b.avgConcurrent), 1);

  const anomalyChart = anomalies.slice(0, 50).reverse().map(a => ({
    time: new Date(a.detectedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    Concurrent: a.concurrent,
    Baseline: Math.round(a.baselineAvg),
    Upper: Math.round(a.baselineAvg + 2 * a.baselineStdDev),
    sigma: a.sigmaMultiple,
  }));

  return (
    <div className="space-y-3">
      {/* Anomaly Timeline */}
      <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-lg shadow-black/5">
        <div
          className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
          onClick={() => setCollapsed(c => !c)}
          data-testid="toggle-traffic-anomaly"
        >
          <Zap className="w-4 h-4 text-yellow-400 shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-semibold">Traffic Anomaly Detector</span>
            {openAnomalies.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 border border-red-500/30 text-red-400">
                {openAnomalies.length} ACTIVE
              </span>
            )}
            {anomalies.length > 0 && openAnomalies.length === 0 && (
              <span className="ml-2 text-xs text-muted-foreground">{anomalies.length} historical · all resolved</span>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); aRefetch(); bRefetch(); }}
            disabled={aFetching || bFetching}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-anomalies"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(aFetching || bFetching) ? "animate-spin" : ""}`} />
          </button>
          <TrendingDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </div>

        {!collapsed && (
          <div className="px-5 pb-5 pt-1 space-y-4">
            {openAnomalies.length > 0 && (
              <div className="space-y-2">
                {openAnomalies.map(a => (
                  <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-red-400">
                        Active Anomaly — {a.sigmaMultiple.toFixed(1)}σ deviation
                        {a.isBusinessHours ? " (business hours)" : " (off-hours)"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{a.notes}</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(a.detectedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {aLoading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground/50 text-sm">Loading anomaly data…</div>
            ) : anomalyChart.length === 0 ? (
              <div className="h-32 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
                <BarChart2 className="w-6 h-6 opacity-40" />
                <span>No anomalies detected yet — baseline builds over 14 days</span>
              </div>
            ) : (
              <div>
                <div className="text-xs text-muted-foreground mb-2">
                  Concurrent calls at anomaly points vs 14-day baseline (shaded band = +2σ)
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={anomalyChart}>
                    <defs>
                      <linearGradient id="upperGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1c1c1e', border: '1px solid #2d2d30', borderRadius: 8, fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="Upper" stroke="rgba(59,130,246,0.3)" fill="url(#upperGrad)" name="2σ Upper" strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="Baseline" stroke="#6366f1" fill="none" strokeWidth={1.5} name="Baseline Avg" />
                    <Area type="monotone" dataKey="Concurrent" stroke="#ef4444" fill="none" strokeWidth={2} dot={{ fill: "#ef4444", r: 3 }} name="Actual" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {anomalies.length > 0 && (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                <div className="grid grid-cols-5 text-xs text-muted-foreground px-3 py-1 font-medium sticky top-0 bg-card z-10">
                  <span className="col-span-2">Detected</span>
                  <span className="text-right">Concurrent</span>
                  <span className="text-right">Sigma</span>
                  <span className="text-right">Status</span>
                </div>
                {anomalies.map(a => (
                  <div
                    key={a.id}
                    className={`grid grid-cols-5 text-xs px-3 py-2 rounded-lg border items-center ${a.resolvedAt ? "bg-muted/10 border-border/30" : "bg-red-500/10 border-red-500/20"}`}
                    data-testid={`anomaly-row-${a.id}`}
                  >
                    <span className="col-span-2 text-muted-foreground font-mono text-[10px]">
                      {new Date(a.detectedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {a.isBusinessHours && <span className="ml-1 text-[9px] text-blue-400">[biz]</span>}
                    </span>
                    <span className="text-right font-mono">{a.concurrent}</span>
                    <span className={`text-right font-mono font-bold ${sigmaColor(a.sigmaMultiple)}`}>{a.sigmaMultiple.toFixed(1)}σ</span>
                    <span className={`text-right ${a.resolvedAt ? "text-emerald-400" : "text-red-400"}`}>
                      {a.resolvedAt ? "Resolved" : "Active"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Baseline Heatmap */}
      <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-lg shadow-black/5">
        <div
          className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
          onClick={() => setHeatmapCollapsed(c => !c)}
          data-testid="toggle-baseline-heatmap"
        >
          <BarChart2 className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-semibold">14-Day Traffic Baseline Heatmap</span>
            {baselines.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">{baselines.length} time slots calibrated</span>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); bRefetch(); }}
            disabled={bFetching}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40 transition-colors disabled:opacity-50"
            data-testid="btn-refresh-baseline"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${bFetching ? "animate-spin" : ""}`} />
          </button>
          <TrendingDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${heatmapCollapsed ? "-rotate-90" : ""}`} />
        </div>

        {!heatmapCollapsed && (
          <div className="px-5 pb-5 pt-1">
            {bLoading ? (
              <div className="h-24 flex items-center justify-center text-muted-foreground/50 text-sm">Loading baseline…</div>
            ) : baselines.length === 0 ? (
              <div className="h-24 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 text-sm">
                <BarChart2 className="w-6 h-6 opacity-40" />
                <span>Baseline builds automatically — needs ~24h of traffic snapshots</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="text-xs text-muted-foreground mb-3">
                  Expected concurrent calls by day × hour (darker = more traffic). Hover for exact avg ± σ.
                </div>
                <div className="flex min-w-max">
                  <div className="w-10 shrink-0" />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="w-6 text-center text-[8px] text-muted-foreground/60 shrink-0">
                      {h % 6 === 0 ? `${h}h` : ""}
                    </div>
                  ))}
                </div>
                {DAY_LABELS.map((day, dow) => (
                  <div key={dow} className="flex min-w-max items-center mb-0.5">
                    <div className="w-10 text-[9px] text-muted-foreground font-medium shrink-0">{day}</div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const b = baselineMap.get(`${dow}-${h}`);
                      const intensity = b ? Math.min(b.avgConcurrent / maxAvg, 1) : 0;
                      const alpha = intensity * 0.85 + (intensity > 0 ? 0.1 : 0);
                      return (
                        <div
                          key={h}
                          title={b
                            ? `${day} ${h}:00 — avg ${b.avgConcurrent.toFixed(1)} ±${b.stdDev.toFixed(1)} (n=${b.sampleCount})`
                            : `${day} ${h}:00 — no data`}
                          className="w-6 h-5 rounded-sm shrink-0 mx-px cursor-help transition-opacity hover:opacity-80"
                          style={{ backgroundColor: intensity > 0 ? `rgba(99,102,241,${alpha})` : "rgba(75,85,99,0.1)" }}
                          data-testid={`heatmap-cell-${dow}-${h}`}
                        />
                      );
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="text-[9px] text-muted-foreground mr-1">Low</span>
                  {[0.1, 0.25, 0.45, 0.65, 0.85].map(v => (
                    <div key={v} className="w-5 h-3 rounded-sm" style={{ backgroundColor: `rgba(99,102,241,${v})` }} />
                  ))}
                  <span className="text-[9px] text-muted-foreground ml-1">High</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
