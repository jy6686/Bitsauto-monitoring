/**
 * Identity timeline — CAP-023 §11.
 *
 * One row per point in the call path, for both halves of identity, with the
 * transformation between each pair named.
 *
 * The design decision that matters: the path is a FIXED list, so stages we
 * cannot observe appear as rows rather than being absent. A timeline that
 * silently ends at Sippy reads like the call ended at Sippy. A timeline whose
 * last three rows say "not observed" tells the operator exactly how far the
 * evidence reaches — which is the question they are actually asking when they
 * look at it.
 *
 * CAP-021 L3: derived from stored comparisons, recomputable, never the source
 * of truth.
 */

import type { CliComparison, CliEvidenceLevel, CliObservation } from './cli.js';
import type { CldComparison, CldObservation } from './cld.js';

/** The canonical path. Every call has all of these, observed or not. */
export const IDENTITY_PATH = [
  { stage: 'Requested',       level: 'O1' as const, reachable: true  },
  { stage: 'Asterisk egress', level: 'O2' as const, reachable: true  },
  { stage: 'Sippy ingress',   level: 'O2' as const, reachable: true  },
  { stage: 'Vendor',          level: 'O3' as const, reachable: false },
  { stage: 'Carrier',         level: 'O3' as const, reachable: false },
  { stage: 'Handset',         level: 'O4' as const, reachable: false },
] as const;

export interface IdentityStageRow {
  stage: string;
  evidenceLevel: CliEvidenceLevel;
  observed: boolean;
  cli: { value: string | null; observation: CliObservation | null; note: string | null };
  cld: { value: string | null; observation: CldObservation | null; note: string | null };
  /** Set when this stage changed a value relative to the previous observed one. */
  transformation: string | null;
}

export interface IdentityTimeline {
  stages: IdentityStageRow[];
  /**
   * The furthest point any observation reached. Everything beyond it is
   * unverified — this single value is what makes attribution questions
   * answerable without guessing.
   */
  observationCeiling: CliEvidenceLevel | null;
  observedStages: string[];
  unobservedStages: string[];
}

export interface BuildTimelineInput {
  requestedCli: string | null;
  requestedCld: string | null;
  cli: CliComparison[];
  cld: CldComparison[];
  /** Named stage each CLI comparison belongs to (CliComparison has no stage). */
  cliStages?: string[];
}

const LEVEL_ORDER: CliEvidenceLevel[] = ['O1', 'O2', 'O3', 'O4'];

export function buildIdentityTimeline(input: BuildTimelineInput): IdentityTimeline {
  const { requestedCli, requestedCld, cli, cld, cliStages } = input;

  // CLI comparisons carry an evidence level but not a stage name, because a CLI
  // observation is defined by where it was captured. Callers may name them; if
  // they do not, fall back to the first path stage at that level.
  const cliByStage = new Map<string, CliComparison>();
  cli.forEach((c, i) => {
    const named = cliStages?.[i]
      ?? IDENTITY_PATH.find(p => p.level === c.evidenceLevel)?.stage
      ?? c.evidenceLevel;
    cliByStage.set(named, c);
  });

  const cldByStage = new Map<string, CldComparison>();
  for (const c of cld) cldByStage.set(c.stage, c);

  const stages: IdentityStageRow[] = [];
  let lastCli: string | null = null;
  let lastCld: string | null = null;

  for (const point of IDENTITY_PATH) {
    const isRequest = point.stage === 'Requested';
    const cliHit = cliByStage.get(point.stage);
    const cldHit = cldByStage.get(point.stage);

    const cliValue = isRequest
      ? requestedCli
      : cliHit && cliHit.observation !== 'UNKNOWN'
        ? (cliHit.observed?.input ?? null)
        : null;

    const cldValue = isRequest
      ? requestedCld
      : cldHit && cldHit.observation !== 'UNKNOWN'
        ? cldHit.observed
        : null;

    const observed = isRequest || cliValue != null || cldValue != null;

    // Name the change relative to the last value we actually saw.
    const changes: string[] = [];
    if (!isRequest && cliValue != null && lastCli != null && cliValue !== lastCli) {
      changes.push(`CLI ${lastCli} → ${cliValue}`);
    }
    if (!isRequest && cldValue != null && lastCld != null && cldValue !== lastCld) {
      changes.push(`CLD ${lastCld} → ${cldValue}`);
    }

    stages.push({
      stage: point.stage,
      evidenceLevel: point.level,
      observed,
      cli: {
        value: cliValue,
        observation: isRequest ? null : (cliHit?.observation ?? null),
        note: isRequest ? null : (cliHit && cliHit.observation !== 'UNKNOWN' ? cliHit.reason : null),
      },
      cld: {
        value: cldValue,
        observation: isRequest ? null : (cldHit?.observation ?? null),
        note: isRequest ? null : (cldHit && cldHit.observation !== 'UNKNOWN' ? cldHit.reason : null),
      },
      transformation: changes.length ? changes.join('; ') : null,
    });

    if (cliValue != null) lastCli = cliValue;
    if (cldValue != null) lastCld = cldValue;
  }

  const observedStages = stages.filter(s => s.observed).map(s => s.stage);
  const unobservedStages = stages.filter(s => !s.observed).map(s => s.stage);

  // The ceiling ignores O1: knowing what we asked for is not an observation of
  // anything that happened.
  const observedLevels = stages
    .filter(s => s.observed && s.evidenceLevel !== 'O1')
    .map(s => s.evidenceLevel);
  const observationCeiling = observedLevels.length
    ? observedLevels.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a))
    : null;

  return { stages, observationCeiling, observedStages, unobservedStages };
}

/** True when evidence reaches at least `level`. The basis of every attribution answer. */
export function reaches(t: IdentityTimeline, level: CliEvidenceLevel): boolean {
  if (!t.observationCeiling) return false;
  return LEVEL_ORDER.indexOf(t.observationCeiling) >= LEVEL_ORDER.indexOf(level);
}
