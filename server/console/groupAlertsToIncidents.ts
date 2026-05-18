
// ── Unified Operations Console — Incident Grouping Engine ────────────────────
// Pure deterministic function: no DB calls, no side effects, fully testable.
// V1 rules: same entity + 10-minute time window + overlapping severity signals.
// Phase 2 can replace this function without touching the console UI.

export type ConsoleSeverity = "critical" | "warning" | "info";

export interface ConsoleAlert {
  id: number;
  type: string;
  severity: string;
  message: string;
  vendor: string | null;
  connection: string | null;
  resolved: boolean;
  createdAt: Date | string;
}

export interface ConsoleTicket {
  id: number;
  subject: string;
  status: string;
  accountId: number | null;
  createdAt: Date | string;
}

export interface ConsoleIncident {
  id: string;
  entity: string;          // vendor/connection name or "System-wide"
  entityKey: string;       // normalised key for grouping
  severity: ConsoleSeverity;
  title: string;
  alerts: ConsoleAlert[];
  linkedTicketId?: number;
  linkedTicketSubject?: string;
  startedAt: Date;
  lastSeenAt: Date;
  resolved: boolean;       // true only when ALL grouped alerts are resolved
  estimatedImpactPerHr: number | null;  // $/ hr from CDR cost proxy
}

// Severity order for escalation (higher = more severe)
const SEV_ORDER: Record<string, number> = { critical: 3, warning: 2, info: 1 };

function maxSev(a: ConsoleSeverity, b: string): ConsoleSeverity {
  return (SEV_ORDER[b] ?? 0) > (SEV_ORDER[a] ?? 0) ? (b as ConsoleSeverity) : a;
}

function normaliseEntity(alert: ConsoleAlert): string {
  return (alert.vendor ?? alert.connection ?? "").toLowerCase().trim() || "__system__";
}

function entityLabel(key: string): string {
  return key === "__system__" ? "System-wide" : key;
}

// Translate alert types into operator-readable incident titles
const INCIDENT_TITLE_MAP: Record<string, string> = {
  high_jitter:         "Voice Quality Degradation",
  poor_mos:            "Voice Quality Degradation",
  mos_drop:            "Voice Quality Degradation",
  packet_loss:         "Network Quality Degradation",
  high_packet_loss:    "Network Quality Degradation",
  rtp_timeout:         "Media Connectivity Issue",
  asr_drop:            "Call Completion Degradation",
  asr_degradation:     "Call Completion Degradation",
  pdd_spike:           "Elevated Call Setup Delay",
  high_pdd:            "Elevated Call Setup Delay",
  capacity:            "Elevated Traffic Conditions",
  routing:             "Routing Adjustment",
  blacklist:           "Security Event",
  fas:                 "Fraud Event Detected",
};

function incidentTitle(alerts: ConsoleAlert[]): string {
  const types = Array.from(new Set(alerts.map(a => a.type.toLowerCase())));
  // Use the most severe / most common type label
  for (const key of Object.keys(INCIDENT_TITLE_MAP)) {
    if (types.some(t => t.includes(key) || key.includes(t))) return INCIDENT_TITLE_MAP[key];
  }
  return "Service Condition Detected";
}

// ── Revenue impact proxy ──────────────────────────────────────────────────────
interface CdrRow { vendor?: string; cost?: number | string; duration?: number | string; startTime?: string | number; }

export function estimateIncidentImpact(
  entityKey: string,
  cdrs: CdrRow[],
): number | null {
  if (cdrs.length === 0) return null;
  // Filter to matching entity CDRs (recent 1 hour)
  const cutoff = Date.now() - 3_600_000;
  const relevant = cdrs.filter(c => {
    const ts = c.startTime
      ? (typeof c.startTime === "number" ? c.startTime * 1000 : new Date(c.startTime as string).getTime())
      : 0;
    const vendorMatch = entityKey === "__system__" || (c.vendor ?? "").toLowerCase().includes(entityKey);
    return ts >= cutoff && vendorMatch;
  });
  if (relevant.length === 0) return null;
  const totalCost = relevant.reduce((s, c) => s + (parseFloat(String(c.cost ?? 0)) || 0), 0);
  const totalMin  = relevant.reduce((s, c) => s + (parseFloat(String(c.duration ?? 0)) || 0), 0) / 60;
  if (totalMin < 1) return null;
  const ratePerMin = totalCost / totalMin;
  return parseFloat((ratePerMin * 60).toFixed(2));  // $/hr
}

// ── Core grouping function ────────────────────────────────────────────────────
const WINDOW_MS = 10 * 60 * 1000; // 10-minute grouping window

export function groupAlertsToIncidents(
  alerts: ConsoleAlert[],
  tickets: ConsoleTicket[],
  cdrs: CdrRow[] = [],
): ConsoleIncident[] {
  if (alerts.length === 0) return [];

  // Sort alerts oldest-first for window calculation
  const sorted = [...alerts].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Build entity → alert buckets with 10-minute window merging
  const buckets: Map<string, ConsoleAlert[][]> = new Map();

  for (const alert of sorted) {
    const key = normaliseEntity(alert);
    if (!buckets.has(key)) buckets.set(key, []);
    const entityBuckets = buckets.get(key)!;
    const alertTime = new Date(alert.createdAt).getTime();

    // Try to add to an existing open window
    let merged = false;
    for (const bucket of entityBuckets) {
      const lastTime = new Date(bucket[bucket.length - 1].createdAt).getTime();
      if (alertTime - lastTime <= WINDOW_MS) {
        bucket.push(alert);
        merged = true;
        break;
      }
    }
    if (!merged) entityBuckets.push([alert]);
  }

  const incidents: ConsoleIncident[] = [];

  for (const [entityKey, windows] of buckets.entries()) {
    for (const window of windows) {
      if (window.length === 0) continue;

      const startedAt  = new Date(window[0].createdAt);
      const lastSeenAt = new Date(window[window.length - 1].createdAt);
      const resolved   = window.every(a => a.resolved);

      // Escalate severity to highest in group
      let severity: ConsoleSeverity = "info";
      for (const a of window) severity = maxSev(severity, a.severity);

      // Link open ticket for same entity (by vendor name fuzzy match)
      const label = entityLabel(entityKey);
      const linkedTicket = tickets.find(t =>
        t.status !== "resolved" &&
        (entityKey === "__system__" || t.subject.toLowerCase().includes(entityKey))
      );

      const impact = estimateIncidentImpact(entityKey, cdrs);

      const id = `${entityKey}-${startedAt.getTime()}`;
      incidents.push({
        id,
        entity: label,
        entityKey,
        severity,
        title: incidentTitle(window),
        alerts: window,
        linkedTicketId:      linkedTicket?.id,
        linkedTicketSubject: linkedTicket?.subject,
        startedAt,
        lastSeenAt,
        resolved,
        estimatedImpactPerHr: impact,
      });
    }
  }

  // Sort: critical first, then warning, then info; within each group newest last-seen first
  return incidents.sort((a, b) => {
    const sd = (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0);
    if (sd !== 0) return sd;
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  });
}
