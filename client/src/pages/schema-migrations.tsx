/**
 * schema-migrations.tsx — admin diagnostics for the startup migration runner.
 *
 * Migrations are applied by runFileMigrations() at every startup, against whatever
 * DATABASE_URL the application is actually using. This page shows what that runner
 * found, so an operator never has to grep logs to answer "did production get 044?"
 * or "does the database match the repository?".
 *
 * Three states matter here and each is called out rather than folded into a count:
 *
 *   PENDING  — a file exists that the database has no record of. Normal only
 *              between a deploy and the restart that applies it.
 *   DRIFT    — an applied file has changed on disk. The database and the repository
 *              disagree about what was applied. The runner does NOT re-run it; a
 *              human decides which is right.
 *   MISSING  — the ledger names a file that is no longer in the repository.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Database, CheckCircle2, AlertTriangle, XCircle, Clock, FileWarning, Layers, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface LedgerRow {
  filename: string;
  checksum: string | null;
  appliedAt: string | null;
  durationMs: number | null;
  baselined: boolean;
  missingFromDisk: boolean;
  driftedTo: string | null;
}

interface Drift { file: string; recorded: string; actual: string }

interface BaselineResult {
  label: string;
  ok: boolean;
  severity: "fatal" | "warn";
  remedy: string;
}

interface LedgerResponse {
  rows: LedgerRow[];
  pending: string[];
  drift: Drift[];
  migrationsDir: string | null;
  baselineThrough: number;
  runnerVersion: number;
  currentMigration: number | null;
  baseline: BaselineResult[];
  lastRun: {
    applied: string[];
    baselined: number;
    failed: { file: string; error: string } | null;
    skipped: boolean;
    baselineInvalid: boolean;
  } | null;
}

/** Label/value pair for the runner summary — reads cleanly in a screenshot. */
function Fact({ label, value, tone = "neutral" }: {
  label: string; value: string | number; tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const tones = {
    ok: "text-emerald-400", warn: "text-amber-400",
    bad: "text-red-400", neutral: "text-slate-200",
  };
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("text-lg font-semibold mt-0.5", tones[tone])}>{value}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: {
  icon: any; label: string; value: string | number;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  const tones = {
    ok:      "border-emerald-500/30 bg-emerald-500/5  text-emerald-400",
    warn:    "border-amber-500/30   bg-amber-500/5    text-amber-400",
    bad:     "border-red-500/30     bg-red-500/5      text-red-400",
    neutral: "border-slate-700      bg-slate-800/40   text-slate-300",
  };
  return (
    <div className={cn("rounded-lg border p-4 flex items-center gap-3", tones[tone])}>
      <Icon className="h-5 w-5 shrink-0" />
      <div>
        <div className="text-2xl font-semibold leading-none">{value}</div>
        <div className="text-xs text-slate-400 mt-1">{label}</div>
      </div>
    </div>
  );
}

export default function SchemaMigrationsPage() {
  const { data, isLoading, error } = useQuery<LedgerResponse>({
    queryKey: ["/api/admin/migrations"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="p-8 text-slate-400">Reading the migration ledger…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-red-400">
          Could not read the migration ledger: {(error as any)?.message ?? "unknown error"}
        </div>
      </div>
    );
  }

  const applied = data.rows.filter(r => !r.baselined);
  const baselined = data.rows.filter(r => r.baselined);
  const failed = data.lastRun?.failed ?? null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
          <Database className="h-5 w-5" /> Schema Migrations
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Applied at startup against the database this application is connected to.
          Files numbered {String(data.baselineThrough).padStart(3, "0")} and below are
          treated as history — recorded, never executed.
        </p>
      </div>

      {/* Runner summary — everything needed to interpret a screenshot of this page. */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-3">
        <div className="text-xs font-medium text-slate-400 mb-3">Migration Runner</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Fact label="Baseline through" value={String(data.baselineThrough).padStart(3, "0")} />
          <Fact label="Current migration"
            value={data.currentMigration != null ? String(data.currentMigration).padStart(3, "0") : "—"} />
          <Fact label="Applied" value={applied.length} tone="ok" />
          <Fact label="Pending" value={data.pending.length}
            tone={data.pending.length ? "warn" : "neutral"} />
          <Fact label="Failed" value={failed ? 1 : 0} tone={failed ? "bad" : "neutral"} />
          <Fact label="Runner version" value={data.runnerVersion} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={CheckCircle2} label="Applied by the runner" value={applied.length} tone="ok" />
        <StatCard icon={Layers} label="Baselined (history)" value={baselined.length} tone="neutral" />
        <StatCard icon={Clock} label="Pending"
          value={data.pending.length} tone={data.pending.length ? "warn" : "neutral"} />
        <StatCard icon={AlertTriangle} label="Modified after apply"
          value={data.drift.length} tone={data.drift.length ? "bad" : "neutral"} />
      </div>

      {/* Baseline validation — the runner asserts 001–NNN are already present.
          These checks are the evidence for that claim, passes included. */}
      {data.baseline.length > 0 && (
        <div className={cn(
          "rounded-lg border p-4",
          data.baseline.some(b => !b.ok && b.severity === "fatal")
            ? "border-red-500/40 bg-red-500/5"
            : data.baseline.some(b => !b.ok)
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-slate-700 bg-slate-800/40",
        )}>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <ShieldCheck className="h-4 w-4" /> Baseline validation
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Migrations {String(data.baselineThrough).padStart(3, "0")} and below are recorded
            without being executed. These checks test whether that assumption actually holds
            for this database.
          </p>
          <ul className="mt-3 space-y-2">
            {data.baseline.map(b => (
              <li key={b.label} className="flex items-start gap-2 text-sm">
                {b.ok
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  : b.severity === "fatal"
                    ? <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    : <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />}
                <div>
                  <span className={b.ok ? "text-slate-300" : "text-slate-100"}>{b.label}</span>
                  {!b.ok && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      {b.severity === "fatal" ? "Halts the runner. " : "Does not halt the runner. "}
                      {b.remedy}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 text-red-400 font-medium">
            <XCircle className="h-4 w-4" /> Last startup halted at {failed.file}
          </div>
          <p className="text-sm text-slate-300 mt-2 font-mono">{failed.error}</p>
          <p className="text-xs text-slate-400 mt-2">
            Every migration after this one was skipped — the schema is behind the repository.
            Fix the file and restart; the runner resumes from here.
          </p>
        </div>
      )}

      {data.drift.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-medium">
            <AlertTriangle className="h-4 w-4" /> Modified after apply
          </div>
          <p className="text-xs text-slate-400">
            <strong className="text-slate-300">Someone changed an already-applied migration.</strong>{" "}
            The runner did not re-run these — a changed migration is not automatically safe to
            replay. Either the edit belongs in a new migration, or the file on disk has been
            corrupted. Compare the two checksums against version control to tell which.
          </p>
          {data.drift.map(d => (
            <div key={d.file} className="rounded border border-slate-700 bg-slate-900/60 p-3 text-sm">
              <div className="font-mono text-slate-200">{d.file}</div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                <div>
                  <div className="text-slate-500">Expected (recorded when applied)</div>
                  <div className="font-mono text-slate-300">{d.recorded}</div>
                </div>
                <div>
                  <div className="text-slate-500">Actual (file on disk now)</div>
                  <div className="font-mono text-amber-400">{d.actual}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.pending.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-amber-400 font-medium">
            <Clock className="h-4 w-4" /> Pending — will apply on the next restart
          </div>
          <ul className="mt-2 space-y-1">
            {data.pending.map(f => (
              <li key={f} className="font-mono text-sm text-slate-300">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {data.migrationsDir === null && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-amber-400 text-sm flex items-center gap-2">
          <FileWarning className="h-4 w-4" />
          No migrations directory was found at runtime — the runner applied nothing this boot.
        </div>
      )}

      <div className="rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60 text-slate-400 text-xs">
            <tr>
              <th className="text-left font-medium px-4 py-2">Migration</th>
              <th className="text-left font-medium px-4 py-2">State</th>
              <th className="text-left font-medium px-4 py-2">Applied</th>
              <th className="text-right font-medium px-4 py-2">Duration</th>
              <th className="text-left font-medium px-4 py-2">Checksum</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.filename} className="border-t border-slate-800">
                <td className="px-4 py-2 font-mono text-slate-200">{r.filename}</td>
                <td className="px-4 py-2">
                  {r.driftedTo ? (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-400">modified</Badge>
                  ) : r.missingFromDisk ? (
                    <Badge variant="outline" className="border-slate-600 text-slate-400">missing from disk</Badge>
                  ) : r.baselined ? (
                    <Badge variant="outline" className="border-slate-600 text-slate-400">baselined</Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">applied</Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-400">
                  {r.appliedAt ? format(new Date(r.appliedAt), "yyyy-MM-dd HH:mm") : "—"}
                </td>
                <td className="px-4 py-2 text-right text-slate-400">
                  {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.checksum ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
