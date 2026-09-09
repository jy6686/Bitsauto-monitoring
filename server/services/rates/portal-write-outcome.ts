/**
 * portal-write-outcome.ts
 *
 * Decides whether a Sippy portal rate write succeeded.
 *
 * WHY THIS IS ITS OWN FUNCTION. Sippy's rate form is `method="GET"`, so the request that asks
 * IS the request that changes. By the time there is a response to inspect, the tariff has
 * already moved or it has not — the page can never be the proof. Job #43 showed the cost: the
 * response carried a lock banner, the code reported "this rate was not applied", and the
 * tariff HAD been rewritten. An operator was told nothing happened while a rate was destroyed.
 *
 * So the tariff read-back is authoritative and the page is demoted to explaining a negative.
 * A lock banner over a confirmed read-back is reported as SUCCESS, with the banner quoted, so
 * the contradiction is visible rather than silently resolved in either direction.
 */

export interface PortalReadBack {
  confirmed: boolean;
  message: string;
  foundRate?: number;
  /** Present only when the reader could supply them; undefined means "not checked". */
  foundInterval1?: number;
  foundIntervalN?: number;
}

export interface PortalPageSignals {
  isLoginPage: boolean;
  hasError: boolean;
  errorText?: string | null;
  /** Text of the lock banner if one was present, else null. */
  lockBanner?: string | null;
  statusCode: number;
  bodyLength: number;
}

export interface PortalWriteContext {
  operation: 'add' | 'edit';
  tariffId: number | string;
  prefix: string;
  rate: number;
  iRate?: number;
  expectedInterval1?: number;
  expectedIntervalN?: number;
}

export interface PortalWriteOutcome {
  success: boolean;
  message: string;
  /** True when the page said one thing and the tariff another — worth surfacing either way. */
  pageContradictedTariff: boolean;
}

/** Appended to every negative, because on this path a failure does not prove nothing changed. */
const MUTATES_BEFORE_REPORTING =
  'read it back before retrying, because this path mutates before it can report';

export function classifyPortalWrite(
  ctx: PortalWriteContext,
  page: PortalPageSignals,
  readBack: PortalReadBack | null,
): PortalWriteOutcome {
  const what = `${ctx.operation === 'add' ? 'added to' : 'updated in'} tariff ${ctx.tariffId}`;
  const lock = page.lockBanner ?? null;

  // ── The tariff decides ──────────────────────────────────────────────────────
  if (readBack?.confirmed) {
    // Intervals are checked only when the reader supplied them. Silence is not agreement:
    // an unchecked interval must not read as a verified one.
    const wantI1 = ctx.expectedInterval1, wantIN = ctx.expectedIntervalN;
    const gotI1  = readBack.foundInterval1, gotIN = readBack.foundIntervalN;
    const intervalsChecked = wantI1 !== undefined && wantIN !== undefined
                          && gotI1  !== undefined && gotIN  !== undefined;
    if (intervalsChecked && (gotI1 !== wantI1 || gotIN !== wantIN)) {
      return {
        success: false, pageContradictedTariff: false,
        message: `Rate ${ctx.prefix} ${what} at ${ctx.rate}, but its billing increment is ${gotI1}/${gotIN} and the catalogue says ${wantI1}/${wantIN}. The price is right and the billing terms are not — treating this as a failure rather than a partial success.`,
      };
    }
    const intervalNote = intervalsChecked ? ` Increment ${gotI1}/${gotIN} confirmed.`
                       : (wantI1 !== undefined ? ` Increment NOT verified (the read-back did not report it).` : '');
    const lockNote = lock
      ? ` NOTE: Sippy's response carried a lock banner ("${lock}") but the tariff shows the rate — the banner was not the outcome.`
      : '';
    return {
      success: true, pageContradictedTariff: !!lock,
      message: `Rate ${ctx.prefix} ${what} at ${ctx.rate}${ctx.iRate ? ` (iRate=${ctx.iRate})` : ''}, confirmed by read-back.${intervalNote}${lockNote}`,
    };
  }

  // ── Not confirmed. The page now explains WHY, and only that ────────────────
  const tail = ` The tariff does not show ${ctx.prefix} at ${ctx.rate}; ${MUTATES_BEFORE_REPORTING}.`;

  if (readBack === null) {
    return {
      success: false, pageContradictedTariff: false,
      message: `Rate ${ctx.prefix}: the write was submitted to tariff ${ctx.tariffId} but could not be verified — no read-back was possible, so the outcome is UNVERIFIED. Check the tariff before retrying.`,
    };
  }
  if (page.isLoginPage) return { success: false, pageContradictedTariff: false, message: `Rate ${ctx.operation}: session rejected (login page returned).${tail}` };
  if (page.hasError)    return { success: false, pageContradictedTariff: false, message: `Rate ${ctx.operation} error: ${page.errorText?.trim() || 'Sippy returned an error response'}.${tail}` };
  if (lock)             return { success: false, pageContradictedTariff: false, message: `Tariff ${ctx.tariffId} is locked — ${lock}.${tail}` };

  // The page looked fine. It was not proof, and the tariff disagrees.
  return {
    success: false,
    pageContradictedTariff: page.statusCode === 200 && page.bodyLength > 5000,
    message: `Rate ${ctx.operation}: Sippy returned HTTP ${page.statusCode} (${page.bodyLength}B) with no error, but ${readBack.message}.${tail}`,
  };
}
