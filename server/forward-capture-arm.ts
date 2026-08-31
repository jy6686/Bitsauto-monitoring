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
}

export function resolveArmState(inputs: ArmInputs): ArmState {
  const { envRaw, flagEnabled, flagError } = inputs;

  const envArmed  = isTruthyEnv(envRaw);
  const envSet    = envRaw !== undefined && envRaw !== null;
  const flagArmed = flagEnabled === true;

  const envValueSeen = !envSet
    ? '(not set in this process)'
    : JSON.stringify(envRaw);

  const flagValueSeen = flagError
    ? `(could not read: ${flagError})`
    : flagEnabled == null
      ? '(no flag row — migration 085 registers it)'
      : String(flagEnabled);

  const armed  = flagArmed || envArmed;
  const source: ArmSource = flagArmed && envArmed ? 'both'
    : flagArmed ? 'flag'
    : envArmed  ? 'env'
    : 'none';

  return { armed, source, envValueSeen, flagValueSeen, hint: hintFor({
    armed, source, envSet, envArmed, flagEnabled, flagError, envValueSeen,
  }) };
}

function hintFor(s: {
  armed: boolean; source: ArmSource; envSet: boolean; envArmed: boolean;
  flagEnabled?: boolean | null; flagError?: string | null; envValueSeen: string;
}): string {
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
