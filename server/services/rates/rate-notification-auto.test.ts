/**
 * The automatic drain, proven without a database or SMTP.
 *
 * Everything the drain decides — whether to run, what to hand the worker, what to do when
 * something breaks — is injected, so each rule is pinned here on its own. The worker's own
 * behaviour (recipients, rendering, marking sent/failed) is proven in
 * rate-notification-worker.test.ts and is not restated.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  shouldAutoDeliver, buildRateNotificationSender, runAutoDrain,
  RATE_NOTIFICATIONS_AUTO_FLAG, MAX_DELIVERY_ATTEMPTS, DRAIN_LIMIT, RATE_NOTIFICATION_FROM,
  type AutoDrainDeps,
} from './rate-notification-auto';

describe('the flag decides, and only a literal true enables', () => {
  /**
   * THE RULE THAT MUST NOT DRIFT. A missing row is the shipped state and means OFF. "We could
   * not read the flag" must never read as "on" — that is the fail-open every other guard here
   * refuses.
   */
  it('absent → off', () => {
    expect(shouldAutoDeliver(undefined)).toBe(false);
    expect(shouldAutoDeliver(null)).toBe(false);
    expect(shouldAutoDeliver({})).toBe(false);
  });

  it('false → off', () => {
    expect(shouldAutoDeliver({ enabled: false })).toBe(false);
  });

  it('truthy-but-not-true → off: no string "true", no 1', () => {
    expect(shouldAutoDeliver({ enabled: 'true' })).toBe(false);
    expect(shouldAutoDeliver({ enabled: 1 })).toBe(false);
  });

  it('true → on', () => {
    expect(shouldAutoDeliver({ enabled: true })).toBe(true);
  });

  it('the flag key and the cap are what the design says', () => {
    expect(RATE_NOTIFICATIONS_AUTO_FLAG).toBe('rate_notifications_auto');
    expect(MAX_DELIVERY_ATTEMPTS).toBe(5);
    expect(DRAIN_LIMIT).toBeGreaterThan(0);
  });
});

describe('the sender wraps the platform transport with the rates identity', () => {
  const msg = (attachment: any) => ({
    to: 'ops@customer.example, rates@customer.example', subject: 'Rates', html: '<p>x</p>', attachment,
  });

  it('with an attachment → the attachment transport, stamped From Ichibaan Rates', async () => {
    const withAttachment = vi.fn(async () => ({ ok: true }));
    const plain          = vi.fn(async () => ({ ok: true }));
    const send = buildRateNotificationSender({ withAttachment, plain });
    const att = { filename: 'logo.png', content: Buffer.from('x'), contentType: 'image/png', cid: 'logo' };
    await send(msg(att));
    expect(withAttachment).toHaveBeenCalledOnce();
    expect(plain).not.toHaveBeenCalled();
    expect(withAttachment.mock.calls[0][0]).toMatchObject({
      to: 'ops@customer.example, rates@customer.example', subject: 'Rates', html: '<p>x</p>',
      fromName: 'Ichibaan Rates', fromAddress: 'pricing@ichibaanlogic.com', attachment: att,
    });
  });

  it('without an attachment → the plain transport, same identity', async () => {
    const withAttachment = vi.fn(async () => ({ ok: true }));
    const plain          = vi.fn(async () => ({ ok: true }));
    const send = buildRateNotificationSender({ withAttachment, plain });
    await send(msg(null));
    expect(plain).toHaveBeenCalledOnce();
    expect(withAttachment).not.toHaveBeenCalled();
    expect(plain.mock.calls[0][0]).toMatchObject(RATE_NOTIFICATION_FROM);
  });

  it('returns the transport\'s result unchanged, success or failure', async () => {
    const send = buildRateNotificationSender({
      withAttachment: async () => ({ ok: false, error: 'SMTP 421' }),
      plain:          async () => ({ ok: true }),
    });
    expect(await send(msg({ filename: 'a', content: 'b', contentType: 'c', cid: 'd' }))).toEqual({ ok: false, error: 'SMTP 421' });
    expect(await send(msg(null))).toEqual({ ok: true });
  });

  /** Customer-facing mail must not go out as the platform. */
  it('the identity is the one the manual rate-sheet path already uses', () => {
    expect(RATE_NOTIFICATION_FROM).toEqual({ fromName: 'Ichibaan Rates', fromAddress: 'pricing@ichibaanlogic.com' });
  });
});

describe('runAutoDrain', () => {
  const workerDeps = { db: {} as any, send: async () => ({ ok: true }) };
  const okReport = { attempted: 2, sent: 2, failed: 0, blocked: [], disabled: false };

  function deps(over: Partial<AutoDrainDeps>): AutoDrainDeps {
    return { readFlag: async () => null, deliver: vi.fn(async () => okReport), workerDeps, log: () => {}, ...over };
  }

  it('flag absent: the worker is never called, and the outcome says so', async () => {
    const deliver = vi.fn(async () => okReport);
    const out = await runAutoDrain(deps({ readFlag: async () => null, deliver }), 'push');
    expect(deliver).not.toHaveBeenCalled();
    expect(out).toEqual({ reason: 'push', enabled: false, report: null });
  });

  it('flag false: same', async () => {
    const deliver = vi.fn(async () => okReport);
    const out = await runAutoDrain(deps({ readFlag: async () => ({ enabled: false }), deliver }), 'boot');
    expect(deliver).not.toHaveBeenCalled();
    expect(out.enabled).toBe(false);
  });

  /**
   * When on, the worker is told enabled:true (its own second act), given the injected deps, and
   * capped. Every one of those three is a way the drain could be wired and still do nothing, or
   * do too much.
   */
  it('flag true: the worker runs once with enabled:true, the injected deps, and the cap', async () => {
    const deliver = vi.fn(async () => okReport);
    const out = await runAutoDrain(deps({ readFlag: async () => ({ enabled: true }), deliver }), 'push');
    expect(deliver).toHaveBeenCalledOnce();
    const [passedDeps, opts] = deliver.mock.calls[0] as any[];
    expect(passedDeps).toBe(workerDeps);
    expect(opts).toEqual({ enabled: true, limit: DRAIN_LIMIT, maxAttempts: MAX_DELIVERY_ATTEMPTS });
    expect(out).toEqual({ reason: 'push', enabled: true, report: okReport });
  });

  /** NEVER THROWS. The push's control flow is not the notification's to interrupt. */
  it('an unreadable flag is reported, not thrown, and nothing is sent', async () => {
    const deliver = vi.fn(async () => okReport);
    const out = await runAutoDrain(deps({ readFlag: async () => { throw new Error('db down'); }, deliver }), 'boot');
    expect(deliver).not.toHaveBeenCalled();
    expect(out).toMatchObject({ enabled: false, report: null, error: 'db down' });
  });

  it('a worker that throws is reported, not thrown', async () => {
    const out = await runAutoDrain(deps({
      readFlag: async () => ({ enabled: true }),
      deliver:  vi.fn(async () => { throw new Error('transport exploded'); }),
    }), 'push');
    expect(out).toMatchObject({ report: null, error: 'transport exploded' });
  });

  it('logs the reason and the outcome, so the deployment logs can be grepped for it', async () => {
    const lines: string[] = [];
    await runAutoDrain(deps({ readFlag: async () => ({ enabled: true }), log: l => lines.push(l) }), 'push');
    await runAutoDrain(deps({ readFlag: async () => null, log: l => lines.push(l) }), 'boot');
    expect(lines[0]).toMatch(/^\[rate-notify\] push: attempted 2, sent 2, failed 0/);
    expect(lines[1]).toMatch(/^\[rate-notify\] boot: automatic delivery is OFF/);
  });
});
