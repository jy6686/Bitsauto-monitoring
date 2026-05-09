/**
 * Routing Suggestions Engine
 * Reads live carrier quality scores and generates operator-facing routing
 * recommendations. Suggestions are inserted into routing_suggestions table
 * with status='pending' for operator approval/rejection/snooze.
 */

import { db } from './db';
import { carrierQualityScores, routingSuggestions } from '../shared/schema';
import { desc, gte, eq, and } from 'drizzle-orm';

interface SuggestionDraft {
  carrierName: string;
  entity: string;
  currentScore: number;
  suggestedAction: string;
  reason: string;
  confidence: number;
}

function buildSuggestions(scores: typeof carrierQualityScores.$inferSelect[]): SuggestionDraft[] {
  const drafts: SuggestionDraft[] = [];

  for (const s of scores) {
    const score = s.stabilityScore ?? 100;
    const asr   = s.rollingAsr    ?? 100;
    const trend = s.trend         ?? 'stable';
    const pdd   = s.avgPddMs      ?? 0;

    // Critical degradation — deprioritise immediately
    if (score < 35 || (score < 50 && trend === 'degrading')) {
      const openMinutes = Math.round((Date.now() - new Date(s.lastComputedAt).getTime()) / 60000);
      const durationNote = openMinutes >= 30
        ? ` Degradation has persisted for ${openMinutes} minutes.`
        : '';
      drafts.push({
        carrierName:     s.carrierName,
        entity:          `carrier:${s.carrierName}`,
        currentScore:    score,
        suggestedAction: `Reduce ${s.carrierName} routing priority by 20%`,
        reason:          `Stability score is critically low at ${score.toFixed(0)}/100 with a ${trend} trend.` +
                         (asr < 60 ? ` Rolling ASR: ${asr.toFixed(1)}%.` : '') +
                         durationNote,
        confidence: score < 35 ? 0.92 : 0.78,
      });
      continue;
    }

    // Moderate degradation — reduce priority
    if (score < 55 && trend !== 'improving') {
      drafts.push({
        carrierName:     s.carrierName,
        entity:          `carrier:${s.carrierName}`,
        currentScore:    score,
        suggestedAction: `Reduce ${s.carrierName} routing priority by 10%`,
        reason:          `Stability score ${score.toFixed(0)}/100 is below the 55-point threshold with a ${trend} trend.` +
                         (pdd > 3000 ? ` Average PDD is elevated at ${(pdd / 1000).toFixed(2)}s.` : ''),
        confidence: 0.65,
      });
      continue;
    }

    // High PDD — flag for investigation
    if (pdd > 4000 && score < 70) {
      drafts.push({
        carrierName:     s.carrierName,
        entity:          `carrier:${s.carrierName}`,
        currentScore:    score,
        suggestedAction: `Investigate ${s.carrierName} for routing delay — consider failover`,
        reason:          `Average PDD is ${(pdd / 1000).toFixed(2)}s, exceeding the 4s threshold. Stability score: ${score.toFixed(0)}/100.`,
        confidence: 0.60,
      });
      continue;
    }

    // Strong recovery — suggest re-enabling
    if (score > 80 && trend === 'improving' && asr > 75) {
      drafts.push({
        carrierName:     s.carrierName,
        entity:          `carrier:${s.carrierName}`,
        currentScore:    score,
        suggestedAction: `Consider restoring ${s.carrierName} to full priority`,
        reason:          `Carrier has recovered — stability ${score.toFixed(0)}/100, ASR ${asr.toFixed(1)}%, trend: improving.`,
        confidence: 0.70,
      });
    }
  }

  return drafts;
}

export async function runRoutingSuggestionsEngine(): Promise<{ generated: number; skipped: number }> {
  try {
    // Get latest scores per carrier (deduplicated by carrierName)
    const allScores = await db
      .select()
      .from(carrierQualityScores)
      .orderBy(desc(carrierQualityScores.lastComputedAt));

    const latestByCarrier = new Map<string, typeof carrierQualityScores.$inferSelect>();
    for (const row of allScores) {
      if (!latestByCarrier.has(row.carrierName)) latestByCarrier.set(row.carrierName, row);
    }

    const drafts = buildSuggestions([...latestByCarrier.values()]);
    if (drafts.length === 0) return { generated: 0, skipped: 0 };

    // Check for existing pending suggestions for the same carrier (deduplicate within 2h)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const existing = await db
      .select()
      .from(routingSuggestions)
      .where(and(eq(routingSuggestions.status, 'pending'), gte(routingSuggestions.createdAt, twoHoursAgo)));

    const existingCarriers = new Set(existing.map(e => e.carrierName));

    let generated = 0;
    let skipped   = 0;
    for (const draft of drafts) {
      if (existingCarriers.has(draft.carrierName)) { skipped++; continue; }
      await db.insert(routingSuggestions).values({
        carrierName:     draft.carrierName,
        entity:          draft.entity,
        currentScore:    draft.currentScore,
        suggestedAction: draft.suggestedAction,
        reason:          draft.reason,
        confidence:      draft.confidence,
        status:          'pending',
      });
      generated++;
    }

    console.log(`[routing-suggestions] Generated ${generated} suggestions, ${skipped} skipped (dedup).`);
    return { generated, skipped };
  } catch (e: any) {
    console.warn('[routing-suggestions] Engine error:', e.message);
    return { generated: 0, skipped: 0 };
  }
}
