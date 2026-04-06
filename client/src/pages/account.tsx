import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import {
  User, Mail, Phone, Building2, Globe, Bell, Clock,
  Save, Loader2, CheckCircle2, Shield,
} from "lucide-react";
import type { UserConfig } from "@shared/schema";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const DEPARTMENTS = [
  "Network Operations (NOC)",
  "Technical Support",
  "Finance & Billing",
  "Sales",
  "Management",
  "Engineering",
  "QA / Testing",
  "Other",
];

const REPORT_RANGES = [
  "Last 15 min",
  "Last 30 min",
  "Last 1 hr",
  "Last 3 hr",
  "Last 6 hr",
  "Last 12 hr",
  "Last 24 hr",
  "Today",
  "Yesterday",
  "This week",
  "This month",
];

const ROLE_META: Record<string, { label: string; color: string; desc: string }> = {
  admin:      { label: "Admin",      color: "text-rose-400 bg-rose-500/10 border-rose-500/30",    desc: "Full system access including settings and team management." },
  management: { label: "Management", color: "text-amber-400 bg-amber-500/10 border-amber-500/30", desc: "Access to dashboard, calls, alerts, reports, and client profiles." },
  viewer:     { label: "Viewer",     color: "text-blue-400 bg-blue-500/10 border-blue-500/30",    desc: "Read-only access to dashboard and active calls." },
};

function Field({ label, hint, icon: Icon, children }: {
  label: string;
  hint?: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = "w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all";

export default function AccountPage() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<UserConfig>({
    queryKey: ["/api/user/config"],
  });

  const [form, setForm] = useState<Partial<UserConfig>>({});
  const [saved, setSaved] = useState(false);

  // Populate form once config loads
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const set = (k: keyof UserConfig, v: any) => {
    setForm(f => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const mutation = useMutation({
    mutationFn: (data: Partial<UserConfig>) => apiRequest("PATCH", "/api/user/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const roleMeta = ROLE_META[role] ?? ROLE_META.viewer;

  const displayInitials = (() => {
    const fn = form.displayName || user?.firstName || "";
    const ln = user?.lastName || "";
    return ((fn[0] || "") + (ln[0] || "")).toUpperCase() || user?.email?.[0]?.toUpperCase() || "?";
  })();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading profile…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">My Account</h2>
        <p className="text-muted-foreground mt-1">
          Configure your personal profile and preferences. These settings only affect your account.
        </p>
      </div>

      {/* Profile card */}
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-5">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500/30 to-violet-500/30 flex items-center justify-center text-2xl font-bold text-blue-300 flex-shrink-0">
          {displayInitials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-lg">
            {form.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Unnamed User"}
          </p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border", roleMeta.color)}>
              <Shield className="w-3 h-3" />
              {roleMeta.label}
            </span>
            {form.department && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full border border-border/50">
                {form.department}
              </span>
            )}
            {form.phone && (
              <span className="text-xs text-muted-foreground font-mono">📞 {form.phone}</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground hidden sm:block">
          <p className="font-medium text-foreground/60">{roleMeta.label} Access</p>
          <p className="mt-0.5 max-w-[180px]">{roleMeta.desc}</p>
        </div>
      </div>

      {/* Form */}
      <form
        onSubmit={e => { e.preventDefault(); mutation.mutate(form); }}
        className="space-y-6"
      >
        {/* ── Identity ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              Identity & Contact
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">

            <Field label="Display Name" icon={User} hint="Overrides your Replit name in the sidebar">
              <input
                data-testid="input-display-name"
                value={form.displayName || ""}
                onChange={e => set("displayName", e.target.value)}
                placeholder={[user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Your name"}
                className={inputCls}
              />
            </Field>

            <Field label="Login Email" icon={Mail}>
              <input
                value={user?.email || "—"}
                readOnly
                className={cn(inputCls, "opacity-50 cursor-not-allowed")}
              />
            </Field>

            <Field label="Notification Email" icon={Bell} hint="Where alert emails are sent (defaults to login email)">
              <input
                data-testid="input-notification-email"
                type="email"
                value={form.notificationEmail || ""}
                onChange={e => set("notificationEmail", e.target.value)}
                placeholder={user?.email || "alerts@example.com"}
                className={inputCls}
              />
            </Field>

            <Field label="Phone / Extension" icon={Phone} hint="Your direct number or SIP extension">
              <input
                data-testid="input-phone"
                type="tel"
                value={form.phone || ""}
                onChange={e => set("phone", e.target.value)}
                placeholder="+1 555 000 0000 or ext. 2001"
                className={inputCls}
              />
            </Field>

          </div>
        </div>

        {/* ── Organisation ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              Organisation
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">

            <Field label="Department" icon={Building2}>
              <select
                data-testid="select-department"
                value={form.department || ""}
                onChange={e => set("department", e.target.value)}
                className={inputCls}
              >
                <option value="">— Select department —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>

            <Field label="Time Zone" icon={Globe} hint="Used to display timestamps in your local time">
              <select
                data-testid="select-timezone"
                value={form.timezone || "UTC"}
                onChange={e => set("timezone", e.target.value)}
                className={inputCls}
              >
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Bio / Role Description" icon={User} hint="Short description shown to admins on the Team page">
                <textarea
                  data-testid="input-bio"
                  value={form.bio || ""}
                  onChange={e => set("bio", e.target.value)}
                  rows={3}
                  placeholder="e.g. Senior NOC engineer, responsible for APAC call quality monitoring…"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                />
              </Field>
            </div>

          </div>
        </div>

        {/* ── Preferences ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Report Preferences
            </h3>
          </div>
          <div className="p-6">
            <Field label="Default Report Time Range" icon={Clock} hint="Pre-selected range when you open the ASR/ACD Reports page">
              <select
                data-testid="select-default-report-range"
                value={form.defaultReportRange || "Last 3 hr"}
                onChange={e => set("defaultReportRange", e.target.value)}
                className={cn(inputCls, "max-w-xs")}
              >
                {REPORT_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {/* ── System info (read-only) ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              Account Information
            </h3>
          </div>
          <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            {[
              { label: "User ID",       value: user?.id?.slice(0, 12) + "…" },
              { label: "Access Role",   value: roleMeta.label },
              { label: "Member Since",  value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—" },
              { label: "Last Config Update", value: form.updatedAt ? new Date(form.updatedAt).toLocaleString() : "Never" },
            ].map(item => (
              <div key={item.label}>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="font-medium mt-0.5 truncate">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            data-testid="button-save-account"
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Saved
            </span>
          )}
          {mutation.isError && (
            <span className="text-sm text-rose-400">Failed to save — please try again.</span>
          )}
        </div>
      </form>
    </div>
  );
}
