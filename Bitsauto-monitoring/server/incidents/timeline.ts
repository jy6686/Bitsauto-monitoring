
// ── Incident Timeline Builder ─────────────────────────────────────────────────
// Purely derived — no manual logic. Merges three event streams:
//   1. Alert timestamps (raw signals)
//   2. Lifecycle transition events (operator interventions)
//   3. Action records (typed operator actions)
// All events are sorted chronologically, then relative offsets from T0 computed.

export type TimelineEventKind =
  | "incident_created"
  | "alert"
  | "state_transition"
  | "action"
  | "resolved";

export interface TimelineEvent {
  id:       string;
  kind:     TimelineEventKind;
  ts:       Date;
  offsetMs: number;    // ms from incident startedAt (T0)
  label:    string;    // human-readable one-liner
  detail?:  string;    // optional extra context
  actor?:   string;
  severity?: string;
}

// ── Input types ───────────────────────────────────────────────────────────────

interface TlAlert {
  id: number; type: string; severity: string; createdAt: Date | string;
}

interface TlLifecycleEvent {
  id: number; fromState: string | null; toState: string; actor: string | null;
  note: string | null; createdAt: Date | string;
}

interface TlAction {
  id: string; type: string; actor: string; note?: string | null;
  timestamp: Date | string;
}

// ── Label helpers ─────────────────────────────────────────────────────────────

const STATE_ACTION_LABEL: Record<string, string> = {
  "active":        "Incident opened",
  "acknowledged":  "Acknowledged by operator",
  "investigating": "Investigation started",
  "mitigating":    "Mitigation in progress",
  "resolved":      "Incident resolved",
};

const ACTION_LABEL: Record<string, string> = {
  acknowledge:   "Acknowledged",
  investigate:   "Investigation started",
  mitigate:      "Mitigation action recorded",
  resolve:       "Marked resolved",
  ticket:        "Support ticket created",
  note:          "Operator note added",
};

function alertLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) + " signal detected";
}

function offsetLabel(ms: number): string {
  if (ms < 60_000)  return `T+${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `T+${Math.round(ms / 60_000)}m`;
  return `T+${Math.round(ms / 3_600_000)}h`;
}

// ── Core builder ──────────────────────────────────────────────────────────────

export function buildTimeline(params: {
  startedAt: Date;
  alerts: TlAlert[];
  lifecycleEvents: TlLifecycleEvent[];
  actions: TlAction[];
}): TimelineEvent[] {
  const { startedAt, alerts, lifecycleEvents, actions } = params;
  const t0 = startedAt.getTime();
  const events: TimelineEvent[] = [];

  // T0: incident created
  events.push({
    id:       "created",
    kind:     "incident_created",
    ts:       startedAt,
    offsetMs: 0,
    label:    "Incident created",
    detail:   "First alert signal detected",
  });

  // Alert signals
  for (const a of alerts) {
    const ts = new Date(a.createdAt);
    events.push({
      id:       `alert-${a.id}`,
      kind:     "alert",
      ts,
      offsetMs: ts.getTime() - t0,
      label:    alertLabel(a.type),
      severity: a.severity,
    });
  }

  // Lifecycle transitions
  for (const e of lifecycleEvents) {
    const ts = new Date(e.createdAt);
    events.push({
      id:       `lc-${e.id}`,
      kind:     e.toState === "resolved" ? "resolved" : "state_transition",
      ts,
      offsetMs: ts.getTime() - t0,
      label:    STATE_ACTION_LABEL[e.toState] ?? `State → ${e.toState}`,
      detail:   e.note ?? undefined,
      actor:    e.actor ?? undefined,
    });
  }

  // Operator actions
  for (const a of actions) {
    const ts = new Date(a.timestamp);
    events.push({
      id:       `action-${a.id}`,
      kind:     "action",
      ts,
      offsetMs: ts.getTime() - t0,
      label:    ACTION_LABEL[a.type] ?? `Action: ${a.type}`,
      detail:   a.note ?? undefined,
      actor:    a.actor,
    });
  }

  // Sort chronologically (negative offsets clamped to 0 for display)
  events.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // Recompute offsets (some early alerts may predate the computed startedAt by ms-level rounding)
  return events.map(e => ({
    ...e,
    offsetMs: Math.max(0, e.ts.getTime() - t0),
  }));
}

export { offsetLabel };
