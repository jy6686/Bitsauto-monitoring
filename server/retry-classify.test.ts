import { describe, it, expect } from 'vitest';
import {
  classifyRetry, summariseRetries, computeEfficiency, CAUSE_LABEL,
  type RetryCause,
} from './retry-classify';

describe('the order of the rules is the substance', () => {
  it('reads 401 as authentication, not as a generic client error', () => {
    // A credential problem filed under "4xx" is true and useless: nobody is
    // dispatched by it.
    expect(classifyRetry('Request failed with status code 401')).toBe('auth');
    expect(classifyRetry('HTTP 403 Forbidden')).toBe('auth');
    expect(classifyRetry('sippy: invalid credentials for user billing')).toBe('auth');
  });

  it('reads 429 as a rate limit, not as a client error', () => {
    expect(classifyRetry('429 Too Many Requests')).toBe('rate_limit');
    expect(classifyRetry('slow down — throttled by the switch')).toBe('rate_limit');
  });

  it('reads ETIMEDOUT as a timeout, not merely as a socket fault', () => {
    // Both readings are correct; only one tells an operator what happened.
    expect(classifyRetry('connect ETIMEDOUT 104.245.246.110:443')).toBe('timeout');
    expect(classifyRetry('Connection terminated due to connection timeout')).toBe('timeout');
    expect(classifyRetry('AbortError: The operation was aborted')).toBe('timeout');
  });

  it('reads a POOL timeout as database, not as a switch timeout', () => {
    // Measured in production 2026-09-04: this exact string was the forward
    // capture tick's lastTickError, alongside 17 flag-read retries — the same
    // pool. The generic /timeout/ rule would have filed it under
    // "Switch / network" and sent someone to the switch.
    expect(classifyRetry('timeout exceeded when trying to connect')).toBe('database');
    expect(classifyRetry('remaining connection slots are reserved')).toBe('database');
    // A genuine switch timeout must still read as one.
    expect(classifyRetry('connect ETIMEDOUT 104.245.246.110:443')).toBe('timeout');
    expect(classifyRetry('Sippy did not respond, request timed out')).toBe('timeout');
  });

  it('reads a pg connection fault as DATABASE, not as network', () => {
    // "Connection terminated" looks like a socket problem and points at our
    // own pool. Filing it under network sends someone to the wrong system.
    expect(classifyRetry('Connection terminated unexpectedly')).toBe('database');
    expect(classifyRetry('relation "cdr_repository" does not exist')).toBe('database');
    expect(classifyRetry('sorry, too many clients already')).toBe('database');
  });

  it('separates real network faults', () => {
    expect(classifyRetry('ECONNREFUSED 10.0.0.4:8443')).toBe('network');
    expect(classifyRetry('socket hang up')).toBe('network');
    expect(classifyRetry('getaddrinfo ENOTFOUND switch.internal')).toBe('network');
  });

  it('separates switch 5xx from a switch in-band fault', () => {
    // An HTTP 500 means the call did not complete. A fault means it arrived
    // and was rejected. Different investigations.
    expect(classifyRetry('502 Bad Gateway')).toBe('server_error');
    expect(classifyRetry('Service Unavailable (503)')).toBe('server_error');
    expect(classifyRetry('XML-RPC fault: faultCode 1, faultString Auth')).toBe('auth');
    expect(classifyRetry('<fault><value>bad request</value></fault>')).toBe('switch_fault');
  });

  it('keeps the bare-auth token narrow, as its comment claims', () => {
    // The rule adds \bauth\b so an XML-RPC faultString of just "Auth" is
    // read as a credential problem. The comment claims the boundary stops it
    // matching neighbouring words; that claim is pinned here rather than
    // trusted.
    expect(classifyRetry('faultString: Auth')).toBe('auth');
    expect(classifyRetry('AUTHENTICATION failed')).toBe('auth');
    for (const m of ['author unknown', 'oauth token expired', 'authorship']) {
      expect(classifyRetry(m)).not.toBe('auth');
    }
    // "authorization required" DOES read as auth, via `unauthor`? No — it has
    // no "unauthor". It reads as unknown, which is the honest answer for a
    // string this module has no rule for.
    expect(classifyRetry('authorization required')).toBe('unknown');
  });

  it('recognises the platform refusing to run at all', () => {
    // Not a switch problem in any sense — we declined to make the call.
    expect(classifyRetry(
      'CDR fetch DID NOT RUN — the XML-RPC circuit breaker is open.')).toBe('circuit_open');
  });

  it('does not let the DID-NOT-RUN prefix swallow the no-credentials case', () => {
    // Both refusals share a prefix. One is a breaker, the other is missing
    // configuration, and they are fixed by different people.
    expect(classifyRetry(
      'CDR fetch DID NOT RUN — no XML-RPC credentials are configured (Settings → Sippy Connection).'))
      .toBe('auth');
  });

  it('needs HTTP context before reading a bare 50x as a switch error', () => {
    // The fetch layer's own messages carry pagination offsets. A naked
    // \b500\b filed every "offset=500" under a switch fault.
    expect(classifyRetry('page fetched at offset=500, 0 rows')).toBe('unknown');
    expect(classifyRetry('slice 12: 504 rows after filter')).toBe('unknown');
    expect(classifyRetry('HTTP 500')).toBe('server_error');
    expect(classifyRetry('status code 502')).toBe('server_error');
    expect(classifyRetry('503 Service Unavailable')).toBe('server_error');
    expect(classifyRetry('500 Internal Server Error')).toBe('server_error');
  });
});

describe('unknown is a real bucket, not a dustbin', () => {
  it('classifies an unrecognised message as unknown rather than guessing', () => {
    expect(classifyRetry('the flux capacitor disagreed')).toBe('unknown');
  });

  it('treats empty and missing messages as unknown', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(classifyRetry(v as any)).toBe('unknown');
    }
  });

  it('flags a distribution that is mostly unclassified as a finding about US', () => {
    // If `unknown` dominates, that is a defect in this module's rules. It must
    // not read as a fact about the switch.
    const d = summariseRetries(['weird one', 'another weird', 'timeout']);
    expect(d.dominant!.cause).toBe('unknown');
    expect(d.mostlyUnclassified).toBe(true);
    // And it keeps a sample, so it can be understood without the logs.
    expect(d.causes.find(c => c.cause === 'unknown')!.sample).toBe('weird one');
  });

  it('does not flag a healthy distribution', () => {
    const d = summariseRetries(['ETIMEDOUT', 'ETIMEDOUT', 'unknown thing']);
    expect(d.dominant!.cause).toBe('timeout');
    expect(d.mostlyUnclassified).toBe(false);
  });
});

describe('the distribution', () => {
  /**
   * A plausible shape for the 2026-09-03 run: 66 retries dominated by
   * timeouts, which is what ~2.7 minutes a slice looks like.
   */
  const RUN = [
    ...Array(28).fill('connect ETIMEDOUT 104.245.246.110:443'),
    ...Array(9).fill('500 Internal Server Error'),
    ...Array(3).fill('429 Too Many Requests'),
    ...Array(1).fill('something new'),
  ];

  it('orders by count and names an owner for each cause', () => {
    const d = summariseRetries(RUN);
    expect(d.total).toBe(41);
    expect(d.causes.map(c => c.cause)).toEqual(['timeout', 'server_error', 'rate_limit', 'unknown']);
    expect(d.causes[0].count).toBe(28);
    expect(d.causes[0].owner).toBe('Switch / network');
    expect(d.dominant!.label).toBe('Timeout');
  });

  it('omits causes that did not occur rather than listing zeros', () => {
    // A column of zeros reads as a checklist somebody verified. These were
    // simply never seen.
    const d = summariseRetries(RUN);
    expect(d.causes.map(c => c.cause)).not.toContain('auth');
    expect(d.causes.map(c => c.cause)).not.toContain('database');
  });

  it('handles no retries at all', () => {
    const d = summariseRetries([]);
    expect(d.total).toBe(0);
    expect(d.causes).toEqual([]);
    expect(d.dominant).toBeNull();
    expect(d.mostlyUnclassified).toBe(false);
  });

  it('gives every cause a human label', () => {
    const causes: RetryCause[] = ['timeout', 'network', 'auth', 'rate_limit',
      'server_error', 'switch_fault', 'database', 'circuit_open', 'unknown'];
    for (const c of causes) expect(CAUSE_LABEL[c]).toBeTruthy();
  });
});

describe('efficiency', () => {
  it('turns 1h30m into a diagnosis', () => {
    // "1h30m" is not a diagnosis. "39m working, 51m waiting, 43% productive"
    // says the job was mostly NOT working, which points at the switch rather
    // than at the size of the account.
    const e = computeEfficiency(90 * 60_000, 51 * 60_000);
    expect(e.percent).toBe(43);
    expect(e.summary).toContain('39m working');
    expect(e.summary).toContain('51m waiting');
    expect(e.summary).toContain('43% productive');
  });

  it('reports a clean run as fully productive', () => {
    const e = computeEfficiency(69_000, 0);
    expect(e.percent).toBe(100);
    expect(e.waitingMs).toBe(0);
  });

  it('clamps backoff that exceeds elapsed rather than going negative', () => {
    // Backoff larger than elapsed means the accounting is wrong; a negative
    // "working" figure would be a worse lie than a zero.
    const e = computeEfficiency(1000, 5000);
    expect(e.workingMs).toBe(0);
    expect(e.waitingMs).toBe(1000);
    expect(e.percent).toBe(0);
  });

  it('says nothing rather than dividing by zero', () => {
    const e = computeEfficiency(0, 0);
    expect(e.ratio).toBeNull();
    expect(e.percent).toBeNull();
    expect(e.summary).toContain('No time elapsed');
  });

  it('treats negative inputs as zero', () => {
    const e = computeEfficiency(-5, -5);
    expect(e.elapsedMs).toBe(0);
    expect(e.waitingMs).toBe(0);
  });
});
