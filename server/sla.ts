
// ── SLA Reporting Module ──────────────────────────────────────────────────────
// Editorial safety layer: translates internal signals into client-safe language.
// All output must be suitable for executive-level client reporting.

// ── Grade Thresholds (single source of truth) ─────────────────────────────────
export const SLA_THRESHOLDS = {
  asr:          { excellent: 80, good: 70, fair: 55 },
  ner:          { excellent: 95, good: 90, fair: 80 },
  mos:          { excellent: 4.1, good: 3.8, fair: 3.4 },
  pdd:          { excellent: 2,   good: 4,   fair: 6   }, // lower = better
  availability: { excellent: 99.9, good: 99.5, fair: 98.0 },
};

export type SlaGrade = 'Excellent' | 'Good' | 'Fair' | 'Attention Required';

export function slaGrade(value: number, metric: keyof typeof SLA_THRESHOLDS): SlaGrade {
  const t = SLA_THRESHOLDS[metric];
  if (metric === 'pdd') {
    if (value <= t.excellent) return 'Excellent';
    if (value <= t.good)      return 'Good';
    if (value <= t.fair)      return 'Fair';
    return 'Attention Required';
  }
  if (value >= t.excellent) return 'Excellent';
  if (value >= t.good)      return 'Good';
  if (value >= t.fair)      return 'Fair';
  return 'Attention Required';
}

// ── Incident Translation Layer ────────────────────────────────────────────────
// RULE: Never pass raw alert text, SIP codes, vendor names, or route IDs to clients.
const INCIDENT_TRANSLATIONS: Record<string, string> = {
  asr_drop:           'Temporary call completion degradation',
  asr_degradation:    'Temporary call completion degradation',
  mos_drop:           'Temporary voice quality degradation',
  poor_mos:           'Temporary voice quality degradation',
  pdd_spike:          'Elevated call setup delay',
  high_pdd:           'Elevated call setup delay',
  rtp_timeout:        'Temporary media connectivity issue',
  packet_loss:        'Intermittent network quality degradation',
  high_jitter:        'Temporary voice quality degradation',
  high_packet_loss:   'Intermittent network quality degradation',
  capacity:           'Elevated traffic conditions',
  routing:            'Traffic optimization applied',
  failover:           'Traffic optimization applied',
  blacklist:          'Security measure applied',
  fas:                'Fraud protection measure applied',
  irsf:               'Fraud protection measure applied',
  simbox:             'Fraud protection measure applied',
};

export function summarizeIncident(alert: { type?: string; severity?: string }): string {
  const raw = (alert.type ?? '').toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  // Exact match first, then prefix/contains match
  if (INCIDENT_TRANSLATIONS[raw]) return INCIDENT_TRANSLATIONS[raw];
  const partialKey = Object.keys(INCIDENT_TRANSLATIONS).find(k => raw.includes(k) || k.includes(raw));
  return partialKey ? INCIDENT_TRANSLATIONS[partialKey] : 'Temporary service condition';
}

// ── Input Types ───────────────────────────────────────────────────────────────
export interface SlaCdr {
  duration?: number;
  result?: string | number;
  country?: string;
  startTime?: string;
  cost?: number;
  pdd?: number;
}

export interface SlaTicket {
  id: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  status: string;
}

export interface SlaTicketMessage {
  ticketId: number;
  author: string;
  createdAt: string | Date;
}

export interface SlaAlert {
  type?: string;
  severity?: string;
  message?: string;
  resolved?: boolean;
  createdAt?: string | Date;
  resolvedAt?: string | Date;
}

// ── Output Types ──────────────────────────────────────────────────────────────
export interface SlaSummary {
  period: string;
  generatedAt: string;
  kpis: {
    asr: number;          asrGrade: SlaGrade;
    ner: number;          nerGrade: SlaGrade;
    mos: number;          mosGrade: SlaGrade;
    acd: number;
    pdd: number;          pddGrade: SlaGrade;
    totalCalls: number;
    connectedCalls: number;
  };
  incidents: Array<{
    date: string;
    summary: string;
    severity: 'High' | 'Medium';
    resolved: boolean;
    resolutionMinutes: number | null;
  }>;
  destinations: Array<{
    name: string;
    calls: number;
    asr: number;
    grade: SlaGrade;
  }>;
  support: {
    total: number;
    resolved: number;
    resolutionPct: number;
    avgFirstResponseMinutes: number | null;  // null until first operator reply exists
    avgResolutionMinutes: number | null;     // null until resolved
  };
}

// ── MOS Proxy (PDD-based) ─────────────────────────────────────────────────────
function estimateMOS(pddSec: number): number {
  if (pddSec <= 1.5) return 4.4;
  if (pddSec <= 3.0) return 4.1;
  if (pddSec <= 5.0) return 3.8;
  if (pddSec <= 8.0) return 3.4;
  return 3.0;
}

// ── Core Computation ──────────────────────────────────────────────────────────
export function computeSlaSummary(params: {
  cdrs: SlaCdr[];
  tickets: SlaTicket[];
  ticketMessages: SlaTicketMessage[];
  alerts: SlaAlert[];
  period: string;
}): SlaSummary {
  const { cdrs, tickets, ticketMessages, alerts, period } = params;

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const total     = cdrs.length;
  const connected = cdrs.filter(c => (c.duration ?? 0) > 0);
  const asr       = total > 0 ? Math.round((connected.length / total) * 100) : 0;

  const acd = connected.length > 0
    ? Math.round(connected.reduce((s, c) => s + (c.duration ?? 0), 0) / connected.length)
    : 0;

  // NER (simplified): treat connected + short-duration answered as network-delivered
  const ner = asr; // V1 proxy; refined when per-code CDR data available

  // MOS: PDD-based estimate
  const avgPddSec = connected.length > 0
    ? connected.reduce((s, c) => s + (c.pdd ?? 2.0), 0) / connected.length
    : 2.0;
  const mos = parseFloat(estimateMOS(avgPddSec).toFixed(2));
  const pdd = parseFloat(avgPddSec.toFixed(2));

  // ── Incidents ────────────────────────────────────────────────────────────────
  const incidents = alerts
    .filter(a => a.createdAt)
    .slice(0, 20)
    .map(a => {
      const created   = new Date(a.createdAt as string);
      const resolvedAt = a.resolvedAt ? new Date(a.resolvedAt as string) : null;
      const resolutionMinutes = resolvedAt
        ? Math.max(0, Math.round((resolvedAt.getTime() - created.getTime()) / 60_000))
        : null;
      return {
        date:              created.toISOString().slice(0, 10),
        summary:           summarizeIncident(a),
        severity:          (a.severity === 'critical' ? 'High' : 'Medium') as 'High' | 'Medium',
        resolved:          !!a.resolved,
        resolutionMinutes,
      };
    });

  // ── Destinations ─────────────────────────────────────────────────────────────
  const destMap = new Map<string, { total: number; conn: number }>();
  for (const c of cdrs) {
    const dest = c.country ?? 'Other';
    const e = destMap.get(dest) ?? { total: 0, conn: 0 };
    e.total++;
    if ((c.duration ?? 0) > 0) e.conn++;
    destMap.set(dest, e);
  }
  const destinations = Array.from(destMap.entries())
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([name, v]) => {
      const destAsr = Math.round((v.conn / v.total) * 100);
      return { name, calls: v.total, asr: destAsr, grade: slaGrade(destAsr, 'asr') };
    });

  // ── Support Responsiveness ────────────────────────────────────────────────────
  const resolvedTickets = tickets.filter(t => t.status === 'resolved');
  const firstResponses: number[] = [];
  const resolutionTimes: number[] = [];

  for (const t of tickets) {
    const ticketCreated = new Date(t.createdAt as string).getTime();
    const msgs = ticketMessages.filter(m => m.ticketId === t.id);
    const firstOp = msgs.find(m => m.author === 'operator');
    if (firstOp) {
      const ms = new Date(firstOp.createdAt as string).getTime() - ticketCreated;
      if (ms >= 0) firstResponses.push(Math.round(ms / 60_000));
    }
    if (t.status === 'resolved') {
      const ms = new Date(t.updatedAt as string).getTime() - ticketCreated;
      if (ms >= 0) resolutionTimes.push(Math.round(ms / 60_000));
    }
  }

  const avg = (arr: number[]) => arr.length > 0
    ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    : null;

  return {
    period,
    generatedAt: new Date().toISOString(),
    kpis: {
      asr, asrGrade: slaGrade(asr, 'asr'),
      ner, nerGrade: slaGrade(ner, 'ner'),
      mos, mosGrade: slaGrade(mos, 'mos'),
      acd,
      pdd, pddGrade: slaGrade(pdd, 'pdd'),
      totalCalls:     total,
      connectedCalls: connected.length,
    },
    incidents,
    destinations,
    support: {
      total:                    tickets.length,
      resolved:                 resolvedTickets.length,
      resolutionPct:            tickets.length > 0
        ? Math.round((resolvedTickets.length / tickets.length) * 100)
        : 100,
      avgFirstResponseMinutes:  avg(firstResponses),
      avgResolutionMinutes:     avg(resolutionTimes),
    },
  };
}
