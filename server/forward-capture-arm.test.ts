import { describe, it, expect } from 'vitest';
import { resolveArmState, isTruthyEnv, ACCEPTED_TRUTHY } from './forward-capture-arm';

describe('isTruthyEnv — a person typing a boolean should not have to guess the word', () => {
  it('accepts every reasonable spelling, any case, with whitespace', () => {
    for (const v of ACCEPTED_TRUTHY) {
      expect(isTruthyEnv(v)).toBe(true);
      expect(isTruthyEnv(v.toUpperCase())).toBe(true);
      expect(isTruthyEnv(`  ${v}  `)).toBe(true);
    }
  });

  it('rejects absence, emptiness and near-misses', () => {
    expect(isTruthyEnv(undefined)).toBe(false);
    expect(isTruthyEnv(null)).toBe(false);
    expect(isTruthyEnv('')).toBe(false);
    expect(isTruthyEnv('off')).toBe(false);
    expect(isTruthyEnv('false')).toBe(false);
    // The typo case the endpoint now surfaces rather than swallowing.
    expect(isTruthyEnv('enabledd')).toBe(false);
    expect(isTruthyEnv('onn')).toBe(false);
  });
});

describe('the production state, measured 2026-08-31T18:29Z', () => {
  /**
   * Verbatim from GET /api/finance/forward-capture against the deployment after
   * the tenth republish. The env var was set — in the workspace, which the
   * deployed process cannot see.
   */
  const PROD = { envRaw: undefined, flagEnabled: null as boolean | null };

  it('is not armed, and says the flag row is what is missing', () => {
    const s = resolveArmState(PROD);
    expect(s.armed).toBe(false);
    expect(s.source).toBe('none');
    expect(s.envValueSeen).toBe('(not set in this process)');
    expect(s.flagValueSeen).toContain('no flag row');
  });

  it('names the Replit deployment-vs-workspace split, and offers the way round it', () => {
    const s = resolveArmState({ envRaw: undefined, flagEnabled: false });
    expect(s.hint).toContain('deployment secrets are a separate store');
    expect(s.hint).toContain('/api/platform/flags/forward_capture');
    // The point of the flag: it must not send the operator back to a republish.
    expect(s.hint).toContain('WITHOUT a republish');
  });
});

describe('resolveArmState — either source arms', () => {
  it('arms on the flag alone, with no env var anywhere', () => {
    const s = resolveArmState({ envRaw: undefined, flagEnabled: true });
    expect(s.armed).toBe(true);
    expect(s.source).toBe('flag');
  });

  it('still arms on the env var alone — shipping this disarms nothing', () => {
    // The compatibility guarantee. A deployment already carrying FORWARD_CAPTURE=on
    // must not go dark because a flag row defaulting to false now exists.
    const s = resolveArmState({ envRaw: 'on', flagEnabled: false });
    expect(s.armed).toBe(true);
    expect(s.source).toBe('env');
  });

  it('reports both when both agree', () => {
    const s = resolveArmState({ envRaw: 'true', flagEnabled: true });
    expect(s.armed).toBe(true);
    expect(s.source).toBe('both');
    expect(s.hint).toContain('Disarming needs');
  });

  it('is not armed when neither source says so', () => {
    expect(resolveArmState({ envRaw: 'off', flagEnabled: false }).armed).toBe(false);
    expect(resolveArmState({}).armed).toBe(false);
  });
});

describe('the override must be visible — the whole point of the module', () => {
  /**
   * The one genuine hazard of OR: an operator turns the flag off, expects
   * collection to stop, and it does not. That is only dangerous if it is
   * silent, so the state must say it in words, naming both the source and the
   * fix.
   */
  it('says plainly that the flag is off and the ENVIRONMENT is arming it', () => {
    const s = resolveArmState({ envRaw: 'on', flagEnabled: false });
    expect(s.hint).toContain('ARMED BY THE ENVIRONMENT');
    expect(s.hint).toContain('will NOT disarm');
    expect(s.hint).toContain('unset the deployment variable');
  });

  it('does not cry override when the flag is the thing arming it', () => {
    expect(resolveArmState({ envRaw: undefined, flagEnabled: true }).hint)
      .not.toContain('ARMED BY THE ENVIRONMENT');
  });
});

describe('an unreadable flag is not a flag that is off', () => {
  /**
   * A DB read that fails must never be reported as "the flag is off" — that is
   * a verdict the process has no evidence for, and it is exactly the class of
   * silent substitution this platform removes everywhere else.
   */
  it('distinguishes could-not-read from false', () => {
    const err = resolveArmState({ flagError: 'connection terminated' });
    const off = resolveArmState({ flagEnabled: false });
    expect(err.flagValueSeen).toContain('could not read');
    expect(err.flagValueSeen).toContain('connection terminated');
    expect(off.flagValueSeen).toBe('false');
    expect(err.flagValueSeen).not.toBe(off.flagValueSeen);
  });

  it('says the read failed rather than asserting a state', () => {
    const s = resolveArmState({ flagError: 'relation does not exist' });
    expect(s.hint).toContain('could NOT be read');
    expect(s.hint).toContain('must never be assumed off');
  });

  it('does not arm on a failed read', () => {
    // Fail closed: ignorance is not permission to write production data.
    expect(resolveArmState({ flagError: 'timeout' }).armed).toBe(false);
  });

  it('does NOT disarm a process the environment had already armed', () => {
    // Fail open in the other direction: a DB blip must not stop a collector
    // that an operator deliberately armed through the environment.
    const s = resolveArmState({ envRaw: 'on', flagError: 'timeout' });
    expect(s.armed).toBe(true);
    expect(s.source).toBe('env');
  });
});

describe('it reports the observation, not just the decision', () => {
  it('quotes the exact unusable value rather than calling it unset', () => {
    // The defect 3c3b984b fixed, kept under test: these two were once
    // indistinguishable from outside.
    const typo   = resolveArmState({ envRaw: 'enabledd' });
    const absent = resolveArmState({ envRaw: undefined });
    expect(typo.envValueSeen).toBe('"enabledd"');
    expect(typo.hint).toContain('not one of');
    expect(absent.envValueSeen).toBe('(not set in this process)');
    expect(typo.hint).not.toBe(absent.hint);
  });

  it('does not mistake an empty string for an absent variable', () => {
    // FORWARD_CAPTURE= (set, blank) is a configuration mistake worth naming,
    // and it is NOT the same as never having been set.
    const blank = resolveArmState({ envRaw: '' });
    expect(blank.armed).toBe(false);
    expect(blank.envValueSeen).toBe('""');
    expect(blank.hint).toContain('not one of');
  });
});
