/**
 * prefix-resolver.ts — Sippy prefix → commercial destination.
 *
 * The reverse of the Send Rate picker, and deliberately a shared service rather than an
 * endpoint bolted to one screen: Rate Analysis, Push History, vendor comparison and margin
 * reports all ask the same question, and four copies of prefix resolution would drift.
 *
 * ── Why longest match, not equality ───────────────────────────────────────────────────
 * Sippy holds whatever was ever pushed. An equality lookup labels anything else with a bare
 * number, and the catalogue is a prefix tree, not a lookup table: `923` and `9231` both exist
 * and both are correct answers to different questions. `9231234567` belongs to `9231`, never
 * to `923`, and never to whichever row a database happens to return first.
 *
 * ── The trunk digit ───────────────────────────────────────────────────────────────────
 * A rate in Sippy carries the product's trunk digit (1=FC, 2=BC, 6=SB, 7=SC); the catalogue
 * does not. `19231` and `9231` are the same destination asked about from two places, so both
 * resolve, and the answer reports which reading was used rather than silently picking one.
 *
 * ── Why "legacy only" is its own answer ───────────────────────────────────────────────
 * A prefix that resolves in the OLD catalogue but not the new one is not unknown — it is a
 * rate left over from before the cutover, and that distinction is the migration's own
 * progress measure. Collapsing it into "unknown" would discard the number that says how far
 * along the cutover is.
 */
import { db } from '../../db';
import { sql } from 'drizzle-orm';

export type MatchType = 'exact' | 'longest_match' | 'legacy_only' | 'unknown';

export interface ResolvedPrefix {
  query: string;
  match: MatchType;
  destinationId: number | null;
  destination: string | null;
  matchedPrefix: string | null;
  /** true when the trunk digit had to be removed for this to resolve. */
  trunkStripped: boolean;
  trunkDigit: string | null;
  versionLabel: string | null;
  /** Populated only for legacy_only — what the OLD catalogue calls it. */
  legacyName?: string | null;
}

const TRUNK_DIGITS = new Set(['1', '2', '6', '7']);
const rows = (r: any) => (r as any).rows ?? [];

/** Longest approved prefix in the ACTIVE version that is a prefix of `candidate`. */
async function longest(candidate: string) {
  const r = await db.execute(sql`
    SELECT p.prefix, p.destination_id, d.name, v.label
      FROM commercial_destination_prefixes p
      JOIN commercial_destinations d ON d.id = p.destination_id
      JOIN catalogue_versions v      ON v.id = d.version_id AND v.status = 'active'
     WHERE d.approval_status = 'approved'
       AND ${candidate} LIKE p.prefix || '%'
     ORDER BY length(p.prefix) DESC
     LIMIT 1`);
  return rows(r)[0] ?? null;
}

export async function resolvePrefix(raw: string): Promise<ResolvedPrefix> {
  const query = String(raw ?? '').trim().replace(/^\+/, '');
  const base: ResolvedPrefix = {
    query, match: 'unknown', destinationId: null, destination: null,
    matchedPrefix: null, trunkStripped: false, trunkDigit: null, versionLabel: null,
  };
  if (!/^[0-9]+$/.test(query)) return base;

  // As given first. A catalogue prefix that happens to start with 1 must not be mistaken for
  // a trunk digit — `1` is North America, and stripping it would resolve US traffic to
  // whatever `` matches.
  const candidates: Array<{ value: string; stripped: boolean; trunk: string | null }> = [
    { value: query, stripped: false, trunk: null },
  ];
  if (query.length > 1 && TRUNK_DIGITS.has(query[0]))
    candidates.push({ value: query.slice(1), stripped: true, trunk: query[0] });

  for (const c of candidates) {
    const hit = await longest(c.value);
    if (!hit) continue;
    return {
      ...base,
      match: hit.prefix === c.value ? 'exact' : 'longest_match',
      destinationId: hit.destination_id,
      destination: hit.name,
      matchedPrefix: hit.prefix,
      trunkStripped: c.stripped,
      trunkDigit: c.trunk,
      versionLabel: hit.label,
    };
  }

  // Nothing in the commercial catalogue. Ask the legacy one before answering "unknown", so a
  // pre-cutover rate is reported as what it is rather than as an orphan.
  for (const c of candidates) {
    try {
      const l = rows(await db.execute(sql`
        SELECT name, dial_prefix FROM destinations
         WHERE dial_prefix IS NOT NULL AND ltrim(dial_prefix, '+') = ${c.value}
         LIMIT 1`))[0];
      if (l) return { ...base, match: 'legacy_only', matchedPrefix: l.dial_prefix,
                      trunkStripped: c.stripped, trunkDigit: c.trunk, legacyName: l.name };
    } catch { /* legacy table absent on a fresh database — then it is simply unknown */ }
  }
  return base;
}
