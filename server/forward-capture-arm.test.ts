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

describe('not-yet-read is a third state, not "off" and not "broken"', () => {
  /**
   * Measured 2026-08-31: the BOOT read failed all three attempts across ~16s
   * while the tick read 60s later succeeded on its first, every time — boot
   * contends with two migration runners and the schema check for one
   * 25-connection pool. Reporting that as "Database unreadable" made a healthy
   * platform look broken for a minute after every republish and sent two
   * people hunting a database fault that did not exist.
   */
  it('says pending rather than off or unreadable', () => {
    const s = resolveArmState({ envRaw: undefined, flagPending: true });
    expect(s.armed).toBe(false);
    expect(s.flagValueSeen).toContain('not read yet');
    expect(s.flagValueSeen).not.toContain('could not read');
    expect(s.hint).toContain('Starting up');
    expect(s.hint).toContain('first scheduler tick');
  });

  it('never claims a database problem while pending', () => {
    const s = resolveArmState({ flagPending: true });
    expect(s.hint).not.toContain('could NOT be read');
    expect(s.hint).not.toContain('must never be assumed off');
  });

  it('still reports an env var that is armed, or unusable, while pending', () => {
    // Pending is about the FLAG. What the process can already see about the
    // environment is knowable at boot and must not be withheld.
    expect(resolveArmState({ envRaw: 'on', flagPending: true }).armed).toBe(true);
    expect(resolveArmState({ envRaw: 'on', flagPending: true }).source).toBe('env');
    expect(resolveArmState({ envRaw: 'nope', flagPending: true }).hint).toContain('"nope"');
  });

  it('does not let a real read failure be reported as pending', () => {
    // If both are somehow set, pending must not mask a genuine fault... and it
    // does here, so the caller must never pass both. Documented by test rather
    // than left to be discovered: pending WINS, so it is only ever set at boot
    // where no read was attempted.
    const s = resolveArmState({ flagPending: true, flagError: 'timeout' });
    expect(s.flagValueSeen).toContain('not read yet');
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

/**
 * Cached arm state.
 *
 * The night of 2026-09-03 is the specification: the process was alive
 * (materialisation ran 02:27 and 03:46), the operator had armed collection
 * days earlier, the flag read failed 12 times, and nothing was collected.
 * Every case below is written from that night rather than from the API.
 */
describe('cached arm state', () => {
  const HOUR = 3_600_000;
  const now  = '2026-09-03T02:27:00Z';

  it('keeps collecting when the read fails and the last good value was armed', () => {
    const s = resolveArmState({
      flagError: 'timeout exceeded when trying to connect',
      lastGoodFlag: true, lastGoodAtIso: '2026-09-03T01:57:00Z', nowIso: now,
    });
    // The night this was written for.
    expect(s.armed).toBe(true);
    expect(s.source).toBe('flag');
    expect(s.cacheUsable).toBe(true);
    expect(s.flagValueSeen).toContain('cached');
    // The operator must be told it is remembered, not current.
    expect(s.hint).toContain('CACHED');
    expect(s.hint).toContain('2026-09-03T01:57:00Z');
  });

  it('does not START collection from a cached FALSE', () => {
    // Symmetry matters: the cache carries the operator's last decision, and
    // "off" is as much a decision as "on".
    const s = resolveArmState({
      flagError: 'connection refused',
      lastGoodFlag: false, lastGoodAtIso: '2026-09-03T01:57:00Z', nowIso: now,
    });
    expect(s.armed).toBe(false);
    expect(s.cacheUsable).toBe(true);          // the cache APPLIED …
    expect(s.flagValueSeen).toContain('false'); // … and it said off.
  });

  it('refuses a cached value older than the expiry', () => {
    const s = resolveArmState({
      flagError: 'connection refused',
      lastGoodFlag: true,
      lastGoodAtIso: '2026-09-01T01:00:00Z',   // 49h before now
      nowIso: now,
    });
    expect(s.armed).toBe(false);
    expect(s.cacheExpired).toBe(true);
    expect(s.cacheUsable).toBe(false);
    expect(s.hint).toContain('expired');
  });

  it('honours a custom expiry at both sides of the boundary', () => {
    const base = { flagError: 'down', lastGoodFlag: true, nowIso: now, maxCacheAgeMs: 6 * HOUR };
    const inside  = resolveArmState({ ...base, lastGoodAtIso: '2026-09-02T20:27:00Z' }); // exactly 6h
    const outside = resolveArmState({ ...base, lastGoodAtIso: '2026-09-02T20:26:00Z' }); // 6h 1m
    expect(inside.armed).toBe(true);
    expect(outside.armed).toBe(false);
  });

  it('fails safe when there has NEVER been a successful read', () => {
    // A process that has just started and cannot reach the database knows
    // nothing about the operator's intent, and must not invent one.
    const s = resolveArmState({ flagError: 'connection refused', nowIso: now });
    expect(s.armed).toBe(false);
    expect(s.cacheUsable).toBe(false);
    expect(s.cacheExpired).toBe(false);
  });

  it('never uses the cache while the flag is merely PENDING', () => {
    // Pending is "not asked yet", not "asked and failed". A cache surviving a
    // restart must not pre-empt the first real read one tick later.
    const s = resolveArmState({
      flagPending: true, flagError: 'boot read failed',
      lastGoodFlag: true, lastGoodAtIso: '2026-09-03T01:57:00Z', nowIso: now,
    });
    expect(s.cacheUsable).toBe(false);
    expect(s.armed).toBe(false);
    expect(s.hint).toContain('Starting up');
  });

  it('prefers a successful live read over the cache, in both directions', () => {
    const disarmed = resolveArmState({
      flagEnabled: false, lastGoodFlag: true,
      lastGoodAtIso: '2026-09-03T01:57:00Z', nowIso: now,
    });
    // The operator disarmed it; a remembered "true" must not resurrect it.
    expect(disarmed.armed).toBe(false);
    expect(disarmed.cacheUsable).toBe(false);
    expect(disarmed.flagValueSeen).toBe('false');

    const armed = resolveArmState({
      flagEnabled: true, lastGoodFlag: false,
      lastGoodAtIso: '2026-09-03T01:57:00Z', nowIso: now,
    });
    expect(armed.armed).toBe(true);
    expect(armed.flagValueSeen).toBe('true');
  });

  it('refuses a cache stamped in the future', () => {
    // Clock skew between a restarted container and the database has produced
    // negative ages before. A negative age is a broken clock, not a fresh
    // memory, and trusting it would make the expiry unenforceable.
    const s = resolveArmState({
      flagError: 'down', lastGoodFlag: true,
      lastGoodAtIso: '2026-09-03T09:00:00Z', nowIso: now,
    });
    expect(s.armed).toBe(false);
    expect(s.cacheUsable).toBe(false);
  });

  it('reports the age so staleness is visible, not just usable/expired', () => {
    const s = resolveArmState({
      flagError: 'down', lastGoodFlag: true,
      lastGoodAtIso: '2026-09-03T01:27:00Z', nowIso: now,
    });
    expect(s.cacheAgeMs).toBe(HOUR);
  });

  it('leaves every non-cache case exactly as it was', () => {
    // The cache is additive. A caller that passes none of the new fields must
    // get byte-identical behaviour, because those callers are the ones running
    // in production right now.
    for (const inputs of [
      { flagEnabled: true }, { flagEnabled: false }, { flagEnabled: null },
      { flagError: 'x' }, { flagPending: true }, { envRaw: 'on' }, { envRaw: 'nope' },
    ]) {
      const s = resolveArmState(inputs);
      expect(s.cacheUsable).toBe(false);
      expect(s.cacheExpired).toBe(false);
      expect(s.cacheAgeMs).toBeNull();
    }
  });
});
