
// ── Root Cause Heuristic Engine ───────────────────────────────────────────────
// Deterministic V1 — no ML. Pure function over alert signals.
// Three locked rules, executed in order, with additive confidence scoring.

export type RootCauseEntityType = "vendor" | "connection" | "account" | "system";

export interface RootCause {
  entityType: RootCauseEntityType;
  entityId: string;
  entityLabel: string;
  confidence: number;    // 0–100
  reason: string;
  primarySignal: string; // the alert type that triggered root cause
}

interface RootCauseAlert {
  id: number;
  type: string;
  severity: string;
  vendor: string | null;
  connection: string | null;
  createdAt: Date | string;
}

// KPI signals that indicate network-layer root cause (high weight)
const HIGH_WEIGHT_SIGNALS = new Set([
  "asr_drop", "asr_degradation", "rtp_timeout", "packet_loss",
  "high_packet_loss", "mos_drop", "poor_mos",
]);

// Signals that indicate capacity / routing cause (medium weight)
const MEDIUM_WEIGHT_SIGNALS = new Set([
  "pdd_spike", "high_pdd", "high_jitter", "capacity",
]);

function signalWeight(type: string): number {
  const t = type.toLowerCase();
  if (HIGH_WEIGHT_SIGNALS.has(t))   return 30;
  if (MEDIUM_WEIGHT_SIGNALS.has(t)) return 15;
  return 5;
}

export function inferRootCause(alerts: RootCauseAlert[]): RootCause | null {
  if (alerts.length === 0) return null;

  // ── Rule 1: Earliest severe signal wins (temporal anchor) ─────────────────
  const sorted = [...alerts].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const earliest = sorted.find(a => a.severity === "critical") ?? sorted[0];

  // ── Rule 2: Blast radius — score each entity by signal volume ─────────────
  const entityScores = new Map<string, {
    label: string; type: RootCauseEntityType;
    score: number; signals: string[];
  }>();

  for (const a of alerts) {
    const vendor     = a.vendor?.trim() || null;
    const connection = a.connection?.trim() || null;

    // Vendor score
    if (vendor) {
      const key = `vendor::${vendor}`;
      const e = entityScores.get(key) ?? { label: vendor, type: "vendor", score: 0, signals: [] };
      e.score   += signalWeight(a.type) + (a.severity === "critical" ? 20 : 0);
      e.signals.push(a.type);
      entityScores.set(key, e);
    }

    // Connection score
    if (connection) {
      const key = `connection::${connection}`;
      const e = entityScores.get(key) ?? { label: connection, type: "connection", score: 0, signals: [] };
      e.score   += signalWeight(a.type) + (a.severity === "critical" ? 15 : 0);
      e.signals.push(a.type);
      entityScores.set(key, e);
    }

    // System-wide fallback
    if (!vendor && !connection) {
      const key = "system::global";
      const e = entityScores.get(key) ?? { label: "System-wide", type: "system", score: 0, signals: [] };
      e.score   += signalWeight(a.type);
      e.signals.push(a.type);
      entityScores.set(key, e);
    }
  }

  // ── Rule 3: KPI correlation — bonus for ASR + RTP + MOS triple ───────────
  const types = new Set(alerts.map(a => a.type.toLowerCase()));
  const hasAsrDrop  = types.has("asr_drop")   || types.has("asr_degradation");
  const hasRtpFail  = types.has("rtp_timeout") || types.has("packet_loss") || types.has("high_packet_loss");
  const hasMosDrop  = types.has("mos_drop")    || types.has("poor_mos");
  const tripleBonus = (hasAsrDrop && hasRtpFail && hasMosDrop) ? 25
                    : (hasAsrDrop && (hasRtpFail || hasMosDrop)) ? 12 : 0;

  // Apply correlation bonus to leading vendor/connection
  if (tripleBonus > 0) {
    for (const [, e] of entityScores) {
      if (e.type === "vendor" || e.type === "connection") e.score += tripleBonus;
    }
  }

  // ── Pick winner ────────────────────────────────────────────────────────────
  const ranked = Array.from(entityScores.entries()).sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0) return null;

  const [winnerKey, winner] = ranked[0];
  const entityId = winnerKey.split("::")[1];

  // Confidence: 0–100, capped
  const maxPossible = alerts.length * 50; // theoretical max if all signals on one entity
  const confidence  = Math.min(100, Math.round((winner.score / Math.max(maxPossible, 1)) * 100 + 20));

  // Human-readable reason
  const signalSummary = Array.from(new Set(winner.signals))
    .slice(0, 3)
    .map(s => s.replace(/_/g, " "))
    .join(", ");

  const reason = tripleBonus > 0
    ? `ASR + RTP + voice quality triple degradation on ${winner.label}`
    : `${alerts.length} signal${alerts.length !== 1 ? "s" : ""} (${signalSummary}) concentrated on ${winner.label}`;

  return {
    entityType:    winner.type,
    entityId,
    entityLabel:   winner.label,
    confidence:    Math.min(confidence, 95), // cap at 95 — never claim 100% deterministically
    reason,
    primarySignal: earliest.type,
  };
}
