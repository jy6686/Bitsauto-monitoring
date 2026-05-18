
// ── Incident Lifecycle State Machine ─────────────────────────────────────────
// Pure audit-safe transition logic. No DB calls — state persistence is the
// caller's responsibility. Every transition emits a typed event for the
// timeline builder to consume.

export type IncidentState =
  | "active"
  | "acknowledged"
  | "investigating"
  | "mitigating"
  | "resolved";

export interface IncidentTransitionEvent {
  incidentId: number;
  fromState: IncidentState;
  toState: IncidentState;
  actor: string;
  note?: string;
  timestamp: Date;
}

// Allowed transitions matrix — audit-safe rules
// Rule: no direct jump to resolved from active (prevents silent auto-resolution)
// Rule: resolved is terminal except for explicit reopen (resolved → active)
const ALLOWED: Record<IncidentState, IncidentState[]> = {
  active:        ["acknowledged", "investigating"],
  acknowledged:  ["investigating", "mitigating"],
  investigating: ["mitigating", "resolved"],
  mitigating:    ["resolved"],
  resolved:      ["active"], // reopen only — must be explicit
};

export function validateTransition(from: IncidentState, to: IncidentState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: IncidentState): IncidentState[] {
  return ALLOWED[from] ?? [];
}

export function applyTransition(params: {
  incidentId: number;
  fromState: IncidentState;
  toState: IncidentState;
  actor: string;
  note?: string;
}): IncidentTransitionEvent {
  const { incidentId, fromState, toState, actor, note } = params;
  if (!validateTransition(fromState, toState)) {
    throw new Error(
      `Invalid transition: ${fromState} → ${toState}. ` +
      `Allowed from ${fromState}: [${ALLOWED[fromState]?.join(", ") ?? "none"}]`,
    );
  }
  return { incidentId, fromState, toState, actor, note, timestamp: new Date() };
}

export function isTerminal(state: IncidentState): boolean {
  // resolved is terminal — only reopen breaks it
  return state === "resolved";
}

export function isReopen(from: IncidentState, to: IncidentState): boolean {
  return from === "resolved" && to === "active";
}

// Human-readable labels for UI
export const STATE_LABELS: Record<IncidentState, string> = {
  active:        "Active",
  acknowledged:  "Acknowledged",
  investigating: "Investigating",
  mitigating:    "Mitigating",
  resolved:      "Resolved",
};

export const STATE_COLORS: Record<IncidentState, string> = {
  active:        "text-red-400 border-red-500/30 bg-red-500/10",
  acknowledged:  "text-amber-400 border-amber-500/30 bg-amber-500/10",
  investigating: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  mitigating:    "text-purple-400 border-purple-500/30 bg-purple-500/10",
  resolved:      "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
};
