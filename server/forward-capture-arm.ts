/**
 * forward-capture-arm.ts — is unattended collection armed, and WHO says so?
 *
 * WHY THIS EXISTS. Arming lived in one place: `process.env.FORWARD_CAPTURE`,
 * read once at boot. Ten republishes were spent trying to arm it and every one
 * ended in `observe_only`, because on Replit a deployment's secrets are a
 * DIFFERENT store from the workspace Secrets the operator was editing — the
 * deployed process genuinely could not see the variable, and until 3c3b984b it
 * could not say so either.
 *
 * The variable was never the right control surface anyway:
 *   - it needs a republish to change, and a republish while a seed import is
 *     running is forbidden;
 *   - it is invisible to the operator running the platform, who has a UI;
 *   - it leaves no record of who armed it, when, or why — for a switch that
 *     turns on production data writes.
 *
 * So arming moves to the EXISTING audited mechanism, platform_feature_flags:
 * a row, a role gate, and prevState/changedBy/changedAt/reason already on the
 * table. Flip it and the next tick picks it up — no republish, and it survives
 * the Autoscale restarts that kill everything held in memory.
 *
 * THE ENV VAR STILL WORKS. Either source arms (OR, not "flag wins"). Two
 * reasons: a value already set in a deployment must not be silently disarmed by
 * shipping this, and a failed DB read must never take a running collector down.
 * The cost of OR is that turning the flag off does not disarm a process whose
 * ENV is armed — so `hint` says exactly that when the two disagree, by name.
 * An override you cannot see is the defect this module was written to remove.
 *
 * Pure: no DB, no env access, no clock. The caller reads both sources and hands
 * them in.
 */

/** Every spelling of "yes" a person might reasonably type. */
export const ACCEPTED_TRUTHY = ['on', 'true', '1', 'yes', 'enabled', 'armed'] as const;

export type ArmSource = 'flag' | 'env' | 'both' | 'none';

export interface ArmState {
  armed: boolean;
  /** Which source armed it — the operator's first question when it is wrong. */
  source: ArmSource;
  /** The raw env value, quoted, or why it was not seen. Never invented. */
  envValueSeen: string;
  /** The flag's state, or why it could not be read. `false` and `unreadable`
   *  are different facts and must not print the same. */
  flagValueSeen: string;
  /** Plain language, naming the next action rather than restating the state. */
  hint: string;
  /** Operating from a remembered flag value because the live read failed. */
  cacheUsable?: boolean;
  /** A remembered value existed but was too old to trust. */
  cacheExpired?: boolean;
  /** Age of the remembered value, ms. null when there is none. */
  cacheAgeMs?: number | null;
}

export function isTruthyEnv(raw: string | null | undefined): boolean {
  return (ACCEPTED_TRUTHY as readonly string[])
    .includes(String(raw ?? '').trim().toLowerCase());
}

export interface ArmInputs {
  /** `process.env.FORWARD_CAPTURE` verbatim — undefined means not present. */
  envRaw?: string | null;
  /** The flag row's `enabled`. null when there is no row to read. */
  flagEnabled?: boolean | null;
  /** Set when the flag could not be read at all (DB down, table missing).
   *  Distinct from "the row says false": one is a fact, one is ignorance. */
  flagError?: string | null;
  /** Set at boot, before any tick has read the flag. A THIRD state, distinct
   *  from both "off" and "unreadable": nothing has been asked yet. Measured
   *  2026-08-31 — the boot read failed every attempt while the tick read
   *  60s later succeeded first try, because boot contends with migrations
   *  and the schema check for one 25-connection pool. Reporting that as
   *  "Database unreadable" made a settled platform look broken for a minute
   *  after every republish, and sent two people hunting a database fault
   *  that did not exist. */
  flagPending?: boolean;
  /**
   * The last value successfully read from the flag, and when.
   *
   * MEASURED 2026-09-03. Materialisation ran at 02:27 and 03:46 — the process
   * was alive through the whole collection window — and forward capture
   * collected nothing, with 12 flag-read retries on the panel. The arm flag is
   * read at the start of every tick; when that read fails the state reports
   * observe_only, which is behaviourally identical to being disarmed. So a
   * database that blinks at 02:00 silently costs the night's collection, and
   * this file's own hint has been saying "a flag that cannot be read must
   * never be assumed off" while doing exactly that.
   *
   * A cached value fixes it in the honest direction: ignorance stops being
   * grounds to STOP something an operator deliberately started. It is not
   * grounds to start something either — see maxCacheAgeMs.
   */
  lastGoodFlag?:  boolean;
  lastGoodAtIso?: string;
  nowIso?:        string;
  /**
   * How long a cached arm state may be trusted. Default 24h.
   *
   * Without an expiry a multi-day database outage would leave the collector
   * running on configuration nobody can see or change — the operator's Disarm
   * button would appear to work and change nothing. An expiry converts a long
   * outage into a refusal, which is visible, rather than into silent
   * autonomy, which is not.
   */
  maxCacheAgeMs?: number;
}

export const DEFAULT_ARM_CACHE_MS = 24 * 60 * 60 * 1000;

export function resolveArmState(inputs: ArmInputs): ArmState {
  const { envRaw, flagEnabled, flagError, flagPending } = inputs;

  const envArmed  = isTruthyEnv(envRaw);
  const envSet    = envRaw !== undefined && envRaw !== null;

  const envValueSeen = !envSet
    ? '(not set in this process)'
    : JSON.stringify(envRaw);

  // ── Cached arm state ───────────────────────────────────────────────────
  // Resolved BEFORE the armed decision, because the decision depends on it.
  // Applies ONLY when the live read failed and a previous read succeeded
  // recently: never when pending (nothing has been read yet) and never when
  // the read worked (a live value always beats a remembered one).
  const cacheMaxMs = inputs.maxCacheAgeMs ?? DEFAULT_ARM_CACHE_MS;
  const nowMs      = inputs.nowIso ? Date.parse(inputs.nowIso) : NaN;
  const goodMs     = inputs.lastGoodAtIso ? Date.parse(inputs.lastGoodAtIso) : NaN;
  const cacheAgeMs = Number.isFinite(nowMs) && Number.isFinite(goodMs) ? nowMs - goodMs : NaN;
  const haveCache  = !flagPending && !!flagError && typeof inputs.lastGoodFlag === 'boolean';
  // A negative age means the cache is stamped in the future — a clock problem,
  // not a usable memory. Refuse it rather than trusting arithmetic that has
  // already gone wrong.
  const cacheUsable  = haveCache && Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0 && cacheAgeMs <= cacheMaxMs;
  const cacheExpired = haveCache && Number.isFinite(cacheAgeMs) && cacheAgeMs > cacheMaxMs;

  // The live value wins whenever there is one. The cache only stands in for a
  // FAILED read, and only to keep a collector running that an operator armed —
  // never to start one.
  const flagArmed = flagEnabled === true || (cacheUsable && inputs.lastGoodFlag === true);

  const flagValueSeen = flagPending
    ? '(not read yet — the first scheduler tick reads it)'
    : cacheUsable
      ? `${inputs.lastGoodFlag} (cached — live read failed: ${flagError})`
      : cacheExpired
        ? `(could not read: ${flagError}; cached value expired after ${Math.round(cacheMaxMs / 3600000)}h)`
        : flagError
          ? `(could not read: ${flagError})`
          : flagEnabled == null
            ? '(no flag row — migration 085 registers it)'
            : String(flagEnabled);

  const armed  = flagArmed || envArmed;
  const source: ArmSource = flagArmed && envArmed ? 'both'
    : flagArmed ? 'flag'
    : envArmed  ? 'env'
    : 'none';

  return { armed, source, envValueSeen, flagValueSeen, cacheUsable, cacheExpired,
    cacheAgeMs: Number.isFinite(cacheAgeMs) ? cacheAgeMs : null,
    hint: hintFor({
      armed, source, envSet, envArmed, flagEnabled, flagError, flagPending, envValueSeen,
      cacheUsable, cacheExpired, lastGoodAtIso: inputs.lastGoodAtIso, cacheMaxMs,
    }) };
}

function hintFor(s: {
  armed: boolean; source: ArmSource; envSet: boolean; envArmed: boolean;
  flagEnabled?: boolean | null; flagError?: string | null; flagPending?: boolean;
  envValueSeen: string;
  cacheUsable?: boolean; cacheExpired?: boolean;
  lastGoodAtIso?: string; cacheMaxMs?: number;
}): string {
  // Cached state is reported BEFORE anything else: an operator seeing "Armed"
  // is entitled to know the platform is running on a remembered value rather
  // than a current one, and when it was last confirmed.
  if (s.cacheUsable) {
    return `Operating from a CACHED arm state — the live flag read is failing ` +
           `(${s.flagError}). Last successful read ${s.lastGoodAtIso ?? 'unknown'}. ` +
           'Collection continues on the last value an operator set, because a failed read is ' +
           'not a decision to stop. Fix the database read: after ' +
           `${Math.round((s.cacheMaxMs ?? 0) / 3600000)}h the cached value expires and ` +
           'collection stops until the flag can be read again.';
  }
  if (s.cacheExpired) {
    return `Observing only. The flag has not been readable for over ` +
           `${Math.round((s.cacheMaxMs ?? 0) / 3600000)}h (${s.flagError}), so the remembered ` +
           'arm state has expired. Running indefinitely on configuration nobody can see or ' +
           'change is worse than stopping — fix the read, then re-arm.';
  }
  if (s.armed) {
    // The disagreement case is the one worth spelling out: an operator who
    // turns the flag off and sees collection continue would otherwise be back
    // to guessing, which is where this whole thread started.
    if (s.source === 'env' && s.flagEnabled === false) {
      return 'ARMED BY THE ENVIRONMENT, not by the flag. The forward_capture flag is OFF, ' +
             `but FORWARD_CAPTURE=${s.envValueSeen} in this process arms it anyway. Turning the ` +
             'flag off will NOT disarm this deployment — unset the deployment variable and ' +
             'republish, or accept that the environment is the control here.';
    }
    if (s.source === 'both') {
      return 'Armed — both the forward_capture flag and FORWARD_CAPTURE agree. Disarming needs ' +
             'BOTH: turn the flag off AND unset the deployment variable.';
    }
    if (s.source === 'env') {
      return `Armed by FORWARD_CAPTURE=${s.envValueSeen}. The forward_capture flag is the ` +
             'preferred control — it needs no republish and records who changed it.';
    }
    return 'Armed by the forward_capture flag. PATCH /api/platform/flags/forward_capture ' +
           '{"enabled":false,"reason":"…"} disarms it at the next tick — no republish.';
  }

  // Not armed. Lead with the action, and never with an instruction that has
  // already failed ten times.
  const flagFix = 'Arm it WITHOUT a republish: PATCH /api/platform/flags/forward_capture ' +
                  '{"enabled":true,"reason":"…"} as admin. Takes effect within one tick (10 min).';

  if (s.flagPending) {
    return 'Starting up — the flag has not been read yet. The first scheduler tick reads it about ' +
           'a minute after boot and this will then say whether it is on or off. ' +
           (s.envSet && !s.envArmed
             ? `(FORWARD_CAPTURE is ${s.envValueSeen}, which is not an accepted value.)`
             : '');
  }
  if (s.flagError) {
    return `Observing only, and the forward_capture flag could NOT be read (${s.flagError}) — so ` +
           'this says nothing about whether it is set. Fix the read first; a flag that cannot be ' +
           'read must never be assumed off. ' +
           (s.envSet ? `FORWARD_CAPTURE is ${s.envValueSeen}, which is not an accepted value.` : '');
  }
  if (s.envSet && !s.envArmed) {
    return `Observing only. The flag is off, and FORWARD_CAPTURE is set to ${s.envValueSeen}, ` +
           `which is not one of: ${ACCEPTED_TRUTHY.join(', ')}. ${flagFix}`;
  }
  return 'Observing only. The flag is off and this PROCESS cannot see FORWARD_CAPTURE — on ' +
         'Replit, deployment secrets are a separate store from workspace Secrets, which is why ' +
         `setting it in the workspace never reached here. ${flagFix}`;
}
