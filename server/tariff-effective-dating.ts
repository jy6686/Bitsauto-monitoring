/**
 * tariff-effective-dating.ts
 *
 * Which tariff version priced a call. Kept dependency-free so the rule can be
 * pinned by tests without a database.
 *
 * The rule this replaced was a live defect: resolution keyed off when a version
 * was RECORDED, so a rate added after a call could never price that call. An
 * unrated call therefore stayed unrated no matter what rate coverage was
 * supplied afterwards — the ordinary remedy for an unpriceable call was
 * structurally impossible.
 */

/** A tariff version as far as effective-date resolution is concerned. */
export interface DatedTariffVersion {
  effectiveFrom?: Date | string | null;
  effectiveTo?:   Date | string | null;
  createdAt?:     Date | string | null;
}

/**
 * Resolution is by EFFECTIVE DATE — when the rates applied — not by when the
 * version was recorded.
 *
 * effectiveFrom falls back to createdAt when absent, which is precisely the old
 * behaviour, so every call already rated resolves to the version it did before
 * (migration 074 stamps the column explicitly for the same reason). Only
 * versions deliberately backdated from here on change any outcome.
 */
export function selectTariffVersion<T extends DatedTariffVersion>(
  versions: T[],
  callTime: Date,
): T | null {
  const from = (v: T) => {
    const raw = v.effectiveFrom ?? v.createdAt;
    return raw ? new Date(raw as any) : null;
  };

  const candidates = (versions ?? []).filter(v => {
    const f = from(v);
    if (!f || isNaN(f.getTime()) || f > callTime) return false;
    // A version with an end date does not price calls after it.
    const to = v.effectiveTo ? new Date(v.effectiveTo as any) : null;
    return !to || isNaN(to.getTime()) || to >= callTime;
  });

  if (!candidates.length) return null;

  // Latest effective date wins. Where two versions share one — a correction to
  // an already-backdated period — the one recorded most recently wins, so the
  // newer correction supersedes the older.
  candidates.sort((a, b) => {
    const d = (from(b)?.getTime() ?? 0) - (from(a)?.getTime() ?? 0);
    if (d !== 0) return d;
    return new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime();
  });

  return candidates[0];
}
