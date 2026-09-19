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
  /**
   * What the read established. `unavailable` means the tariff could not be READ — a reset, a
   * timeout, a fault — and is not a statement about its contents.
   *
   * Optional so a reader that only ever answered a boolean keeps working: absent, it is derived
   * from `confirmed`. A reader that can fail in transport MUST set it, or a dead connection is
   * reported as a tariff that lacks the rate — which is the defect this exists to prevent.
   */
  outcome?: 'confirmed' | 'absent' | 'unavailable';
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
  /**
   * The tariff could not be read, so this is NOT a failure — it is an unknown. The caller must
   * not treat it as evidence that nothing was applied, and must not try another write method on
   * the strength of it.
   */
  unverified: boolean;
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
        success: false, pageContradictedTariff: false, unverified: false,
        message: `Rate ${ctx.prefix} ${what} at ${ctx.rate}, but its billing increment is ${gotI1}/${gotIN} and the catalogue says ${wantI1}/${wantIN}. The price is right and the billing terms are not — treating this as a failure rather than a partial success.`,
      };
    }
    const intervalNote = intervalsChecked ? ` Increment ${gotI1}/${gotIN} confirmed.`
                       : (wantI1 !== undefined ? ` Increment NOT verified (the read-back did not report it).` : '');
    const lockNote = lock
      ? ` NOTE: Sippy's response carried a lock banner ("${lock}") but the tariff shows the rate — the banner was not the outcome.`
      : '';
    return {
      success: true, pageContradictedTariff: !!lock, unverified: false,
      message: `Rate ${ctx.prefix} ${what} at ${ctx.rate}${ctx.iRate ? ` (iRate=${ctx.iRate})` : ''}, confirmed by read-back.${intervalNote}${lockNote}`,
    };
  }

  // ── The tariff could not be READ ───────────────────────────────────────────
  // Before any sentence about what the tariff holds. A missing read-back and a read that failed
  // in transport are the same fact — we did not see the tariff — and neither licenses the
  // "does not show" wording below, nor another write method on the strength of it.
  if (readBack === null || readBack.outcome === 'unavailable') {
    const why = readBack === null ? 'no read-back was possible' : readBack.message;
    return {
      success: false, pageContradictedTariff: false, unverified: true,
      message: `Rate ${ctx.prefix}: the write was submitted to tariff ${ctx.tariffId} but could not be verified (${why}), so the outcome is UNVERIFIED. Read the tariff before writing to it again.`,
    };
  }

  // ── Not confirmed, and the tariff WAS read. The page now explains WHY ──────
  const tail = ` The tariff does not show ${ctx.prefix} at ${ctx.rate}; ${MUTATES_BEFORE_REPORTING}.`;

  if (page.isLoginPage) return { success: false, pageContradictedTariff: false, unverified: false, message: `Rate ${ctx.operation}: session rejected (login page returned).${tail}` };
  if (page.hasError)    return { success: false, pageContradictedTariff: false, unverified: false, message: `Rate ${ctx.operation} error: ${page.errorText?.trim() || 'Sippy returned an error response'}.${tail}` };
  if (lock)             return { success: false, pageContradictedTariff: false, unverified: false, message: `Tariff ${ctx.tariffId} is locked — ${lock}.${tail}` };

  // The page looked fine. It was not proof, and the tariff disagrees.
  return {
    success: false, unverified: false,
    pageContradictedTariff: page.statusCode === 200 && page.bodyLength > 5000,
    message: `Rate ${ctx.operation}: Sippy returned HTTP ${page.statusCode} (${page.bodyLength}B) with no error, but ${readBack.message}.${tail}`,
  };
}

/**
 * What the SA (immediate-change) path may conclude after a portal edit.
 *
 * THE RULE THE DEFECT BROKE. Sippy's edit form is `method="GET"`: the request that asks is the
 * request that changes, and `boundary.crossed` is set before it is sent. If the read-back that
 * follows cannot be performed, the edit's outcome is UNKNOWN — and an unknown outcome must not
 * send the caller on to the next write method, because the tariff we would upload into is one we
 * have just written and cannot see. Before this, every non-"locked" failure fell through to
 * getUploadToken + uploadBinaryFile, so a reset during the read-back produced a second mutation.
 *
 * `boundaryCrossed` is the discriminator, and it was already in scope: a portal edit that never
 * issued its GET — no rates-capable session, a refused login, the i_rate guard — is a proven
 * non-event, and must still fall through. Established absence is likewise unchanged: the tariff
 * was read, it does not hold the rate, and trying another method is the existing behaviour.
 */
export interface PortalEditInput {
  /** `classifyPortalWrite`'s verdict for the edit itself. */
  editSuccess: boolean;
  /** The edit's read-back established nothing. */
  unverified: boolean;
  /** A mutating GET was issued. False means the tariff is provably untouched. */
  boundaryCrossed: boolean;
  /** The page carried a tariff-lock banner. */
  locked: boolean;
  /** When the edit succeeded: what the follow-up verification established. */
  verifyOutcome?: 'confirmed' | 'absent' | 'unavailable';
  /** The message the edit (or its verification) produced. */
  message: string;
}

export interface PortalEditDecision {
  success: boolean;
  verificationResult: 'confirmed' | 'mismatch' | 'skip';
  /** Whether another write method (upload token, XML-RPC) may be attempted. */
  fallbackAllowed: boolean;
  /** True only when no mutating request was issued, so the tariff is provably untouched. */
  refusedBeforeWrite: boolean;
  message: string;
}

export function portalEditVerdict(input: PortalEditInput): PortalEditDecision {
  const { editSuccess, unverified, boundaryCrossed, locked, verifyOutcome, message } = input;
  const refusedBeforeWrite = !boundaryCrossed;

  // 1. Nothing was sent. Whatever went wrong, the tariff is untouched and the next method is safe.
  if (!boundaryCrossed) {
    return { success: false, verificationResult: 'skip', fallbackAllowed: true, refusedBeforeWrite: true, message };
  }

  // 2. A request WAS sent and nothing could be established about it. This is the gate.
  if (unverified || verifyOutcome === 'unavailable') {
    const why = verifyOutcome === 'unavailable' ? `the tariff could not be read back (${message})` : message;
    return {
      success: false, verificationResult: 'skip', fallbackAllowed: false, refusedBeforeWrite: false,
      message: `Portal edit was submitted and its outcome is UNKNOWN: ${why}. Read the tariff before writing to it again; no other write method was attempted.`,
    };
  }

  // 3. The edit was made and the tariff was read.
  if (editSuccess) {
    if (verifyOutcome === 'confirmed') {
      return { success: true, verificationResult: 'confirmed', fallbackAllowed: false, refusedBeforeWrite: false, message };
    }
    return {
      success: false, verificationResult: 'mismatch', fallbackAllowed: false, refusedBeforeWrite: false,
      message: `Portal edit returned success but the tariff does not hold the rate: ${message} — no bulk upload was started.`,
    };
  }

  // 4. A locked tariff accepts neither path; queueing an upload behind the lock is how jobs
  //    #37–#45 locked each other out one after another.
  if (locked) {
    return { success: false, verificationResult: 'skip', fallbackAllowed: false, refusedBeforeWrite: false, message };
  }

  // 5. The edit did not take and the tariff says so. Unchanged: try the other methods.
  return { success: false, verificationResult: 'mismatch', fallbackAllowed: true, refusedBeforeWrite: false, message };
}
