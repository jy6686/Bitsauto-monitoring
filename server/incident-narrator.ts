/**
 * Incident Narrator — deterministic narrative + root-cause timeline generator.
 * Reads incident signals from DB and produces:
 *   • narrative  — 3–5 sentence plain-English summary
 *   • timeline   — chronological event list (JSON array)
 * Both are stored back on the ai_ops_incidents row.
 */

import { db } from './db';
import { aiOpsEvents, aiOpsIncidents, carrierQualityScores } from '../shared/schema';
import { eq, desc, gte, and } from 'drizzle-orm';

interface TimelineEntry {
  ts: string;
  event: string;
  type: 'signal' | 'score_drop' | 'escalation' | 'resolution';
}

function fmtTime(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function carrierFromEntity(entity: string | null): string | null {
  if (!entity) return null;
  if (entity.startsWith('carrier:')) return entity.slice(8);
  return entity;
}

export async function narrateIncident(incidentId: number): Promise<void> {
  try {
    const [incident] = await db
      .select()
      .from(aiOpsIncidents)
      .where(eq(aiOpsIncidents.id, incidentId));

    if (!incident) return;

    const windowStart = new Date(incident.startTime.getTime() - 5 * 60 * 1000);
    const carrier = carrierFromEntity(incident.entity);

    // Fetch contributing signals in the incident window
    const signals = await db
      .select()
      .from(aiOpsEvents)
      .where(gte(aiOpsEvents.createdAt, windowStart))
      .orderBy(aiOpsEvents.createdAt);

    // Filter to incident-relevant signals
    const relevant = signals.filter(s => {
      if (incident.entity && s.entity === incident.entity) return true;
      if (carrier && s.entity === `carrier:${carrier}`) return true;
      if (incident.entity && s.message?.toLowerCase().includes(carrier?.toLowerCase() ?? '__NOMATCH__')) return true;
      return false;
    });

    // Also fetch recent carrier score if available
    let carrierScore: { stabilityScore: number | null; trend: string | null; rollingAsr: number | null; avgPddMs: number | null } | null = null;
    if (carrier) {
      const scores = await db
        .select()
        .from(carrierQualityScores)
        .where(eq(carrierQualityScores.carrierName, carrier))
        .orderBy(desc(carrierQualityScores.lastComputedAt))
        .limit(1);
      if (scores.length > 0) {
        carrierScore = {
          stabilityScore: scores[0].stabilityScore,
          trend: scores[0].trend,
          rollingAsr: scores[0].rollingAsr,
          avgPddMs: scores[0].avgPddMs,
        };
      }
    }

    // ── Build timeline ──────────────────────────────────────────────────────────
    const timeline: TimelineEntry[] = [];

    // Incident open
    timeline.push({
      ts: fmtTime(incident.startTime),
      event: `Incident opened — ${incident.signalsCount} initial signal${incident.signalsCount === 1 ? '' : 's'} correlated`,
      type: 'signal',
    });

    // Signal events in chronological order (deduplicated by type + minute)
    const seen = new Set<string>();
    for (const sig of relevant) {
      const minuteKey = `${sig.type}-${new Date(sig.createdAt).toISOString().slice(0, 16)}`;
      if (seen.has(minuteKey)) continue;
      seen.add(minuteKey);

      const label = sig.type === 'SYNTHETIC_FAILURE'
        ? `Synthetic test failure detected${sig.value ? ` (SIP ${sig.value})` : ''}`
        : sig.type === 'ROUTE_DEGRADATION_SIGNAL'
        ? `Route degradation signal — stability score ${sig.value ?? 'low'}`
        : sig.type === 'HIGH_PDD'
        ? `High PDD detected${sig.value ? ` (${sig.value})` : ''}`
        : sig.type === 'CARRIER_INCIDENT'
        ? `Cross-campaign carrier incident grouped`
        : sig.type === 'INFRA_FAILURE'
        ? `Infrastructure failure (excluded from ASR)`
        : sig.message ?? sig.type;

      timeline.push({ ts: fmtTime(sig.createdAt), event: label, type: 'signal' });
    }

    // Score-based event
    if (carrierScore?.stabilityScore != null) {
      const score = carrierScore.stabilityScore;
      const scoreLabel = score < 40
        ? `Carrier stability score critically low: ${score.toFixed(0)}/100`
        : score < 60
        ? `Carrier stability degraded: ${score.toFixed(0)}/100`
        : `Carrier stability score: ${score.toFixed(0)}/100`;
      timeline.push({ ts: fmtTime(incident.lastSeen), event: scoreLabel, type: 'score_drop' });
    }

    // Resolution
    if (incident.status === 'resolved') {
      timeline.push({
        ts: fmtTime(incident.lastSeen),
        event: 'Incident marked resolved',
        type: 'resolution',
      });
    } else {
      const openMinutes = Math.round((Date.now() - incident.startTime.getTime()) / 60000);
      if (openMinutes >= 30) {
        timeline.push({
          ts: fmtTime(new Date()),
          event: `Incident open for ${openMinutes} minutes — severity escalation may apply`,
          type: 'escalation',
        });
      }
    }

    // Sort timeline by ts string (HH:MM format — stable within a session)
    timeline.sort((a, b) => a.ts.localeCompare(b.ts));

    // ── Build narrative ─────────────────────────────────────────────────────────
    const parts: string[] = [];

    // Opening sentence
    const carrierLabel = carrier ?? incident.entity ?? 'Unknown entity';
    const severityLabel = incident.severity === 'critical' ? 'critical' : incident.severity === 'high' ? 'high-severity' : 'medium-severity';
    parts.push(`A ${severityLabel} incident was detected involving ${carrierLabel}.`);

    // Signal summary
    if (relevant.length > 0) {
      const synthFails = relevant.filter(s => s.type === 'SYNTHETIC_FAILURE').length;
      const campaigns  = new Set(relevant.filter(s => s.linkedExecId).map(s => s.linkedExecId)).size;
      if (synthFails > 0) {
        parts.push(`${synthFails} synthetic test failure${synthFails === 1 ? '' : 's'} detected${campaigns > 1 ? ` across ${campaigns} campaigns` : ''}.`);
      }
    } else {
      parts.push(`${incident.signalsCount} correlated signal${incident.signalsCount === 1 ? '' : 's'} contributed to this incident.`);
    }

    // Carrier quality sentence
    if (carrierScore) {
      const { stabilityScore, trend, rollingAsr, avgPddMs } = carrierScore;
      const scorePart = stabilityScore != null ? `Stability score: ${stabilityScore.toFixed(0)}/100` : '';
      const asrPart   = rollingAsr != null ? `, ASR: ${rollingAsr.toFixed(1)}%` : '';
      const pddPart   = avgPddMs  != null ? `, Avg PDD: ${(avgPddMs / 1000).toFixed(2)}s` : '';
      const trendPart = trend ? ` (${trend})` : '';
      if (scorePart) parts.push(`${scorePart}${asrPart}${pddPart}${trendPart}.`);
    }

    // Confidence sentence
    const avgConfidence = relevant.length > 0
      ? relevant.reduce((s, e) => s + (Number(e.confidence) || 0.5), 0) / relevant.length
      : 0.5;
    parts.push(`System confidence: ${(avgConfidence * 100).toFixed(0)}%.`);

    // Status sentence
    if (incident.status === 'resolved') {
      parts.push('This incident has been resolved.');
    } else {
      parts.push('The incident is currently active. Monitor carrier scores and synthetic test results for recovery.');
    }

    const narrative = parts.join(' ');

    // ── Persist ─────────────────────────────────────────────────────────────────
    await db
      .update(aiOpsIncidents)
      .set({ narrative, timelineJson: JSON.stringify(timeline) })
      .where(eq(aiOpsIncidents.id, incidentId));

  } catch (e: any) {
    console.warn(`[incident-narrator] Failed for incident ${incidentId}:`, e.message);
  }
}

/** Narrate all incidents that don't yet have a narrative, or whose lastSeen changed recently. */
export async function narrateAll(): Promise<void> {
  const incidents = await db.select().from(aiOpsIncidents).orderBy(desc(aiOpsIncidents.lastSeen)).limit(50);
  await Promise.all(incidents.map(i => narrateIncident(i.id)));
}
