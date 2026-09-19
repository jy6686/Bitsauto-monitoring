/**
 * group-plan.ts
 *
 * Which operations in a tariff lane may share ONE Sippy upload.
 *
 * The planner already puts every operation for a tariff into one serial lane. This splits that
 * lane into groups keyed on (upload verb, activation date): each group becomes one workbook, one
 * token, one upload, one poll, one read-back — instead of one of each per prefix, which is where
 * a five-prefix push spent five and a half minutes.
 *
 * WHY THE KEY IS EXACTLY THIS. A multi-row workbook has been proven on this switch only for rows
 * that would each have been an identical single-row upload: same verb, same activation (run #32,
 * 42 SA rows). Sippy's `A` and `SA` are not interchangeable — SA on an existing prefix silently
 * keeps the old activation date, so a future-dated row sent as SA goes live today. And a file
 * mixing verbs, or mixing dates under `A`, has a semantics nobody has observed. So the key is the
 * narrowest one that still makes Aura's five rows a single upload, and it deliberately refuses to
 * be looser. Expiration dates are per row and do not split groups: each row carries its own.
 *
 * The verb comes from `rateUploadAction`, the same function the single-row path uses, with the
 * same clock rule — so a row is grouped under the verb it would have been uploaded with alone.
 *
 * Pure: no I/O, and the clock is injectable so the tests do not depend on when they run.
 */
import type { RateOperation, TariffLane } from './batch-plan';
import { rateUploadAction, normaliseRateDate } from '../../sippy';

export interface OperationGroup {
  iTariff: number;
  action: 'A' | 'SA';
  /** Normalised "YYYY-MM-DD HH:MM:SS" for an A group; '' for SA (Sippy discards the date). */
  activation: string;
  /** In lane order. */
  operations: RateOperation[];
}

export interface GroupOptions {
  /** Injected clock for the A/SA decision. */
  now?: () => number;
}

/** The (verb, activation) an operation would be uploaded with on its own. */
export function groupKeyFor(op: RateOperation, opts: GroupOptions = {}): { action: 'A' | 'SA'; activation: string } {
  const norm = normaliseRateDate(op.effectiveFrom);
  const action = rateUploadAction(norm || undefined, undefined, opts.now);
  // SA discards whatever date it is given, so the date must not separate SA rows into different
  // uploads — that would cost round trips for no change in what the switch does.
  return { action, activation: action === 'A' ? norm : '' };
}

/**
 * Split a lane into groups. Groups appear in first-seen order; operations keep lane order within
 * a group. Every operation lands in exactly one group.
 */
export function groupLane(lane: TariffLane, opts: GroupOptions = {}): OperationGroup[] {
  const groups = new Map<string, OperationGroup>();
  for (const op of lane.operations) {
    const { action, activation } = groupKeyFor(op, opts);
    const key = `${action}|${activation}`;
    const g = groups.get(key);
    if (g) g.operations.push(op);
    else groups.set(key, { iTariff: lane.iTariff, action, activation, operations: [op] });
  }
  return [...groups.values()];
}
