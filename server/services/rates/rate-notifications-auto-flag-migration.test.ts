/**
 * Migration 526 registers the automatic-delivery flag, OFF.
 *
 * The drain reads platform_feature_flags.rate_notifications_auto; the audited flag route only
 * UPDATES and 404s on a missing row; flag rows are born only by migration (520 is the
 * precedent). So this migration is what makes the flag enable-able through the attributed
 * path — and it must create the row FALSE, because the first enabled drain delivers everything
 * already owed, not merely the next push.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_NOTIFICATIONS_AUTO_FLAG } from './rate-notification-auto';

const MIG_DIR = join(__dirname, '..', '..', '..', 'migrations');
const FILE = '526_rate_notifications_auto_flag.sql';
const SQL = readFileSync(join(MIG_DIR, FILE), 'utf8');
/** SQL with `--` comment lines removed, so an assertion cannot be satisfied by prose. */
const CODE = SQL.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

describe('migration 526', () => {
  it('is uniquely numbered', () => {
    const at526 = readdirSync(MIG_DIR).filter(f => /^526_/.test(f));
    expect(at526).toEqual([FILE]);
  });

  it('inserts the exact key the drain reads — the two cannot drift', () => {
    expect(RATE_NOTIFICATIONS_AUTO_FLAG).toBe('rate_notifications_auto');
    expect(CODE).toMatch(/INSERT INTO platform_feature_flags \(key, enabled, owner_role, reason\)/);
    expect(CODE).toMatch(/'rate_notifications_auto',\s*\n?\s*FALSE/);
  });

  /** THE RULE. A migration may register the flag; it may never enable it. */
  it('creates the row FALSE and nowhere sets it TRUE', () => {
    expect(CODE).not.toMatch(/enabled\s*=\s*TRUE/i);
    expect(CODE).not.toMatch(/'rate_notifications_auto',\s*\n?\s*TRUE/i);
    // The only TRUE permitted is the presence probe's `SELECT TRUE INTO present`.
    const trues = (CODE.match(/\bTRUE\b/gi) ?? []).length;
    const probes = (CODE.match(/SELECT TRUE INTO present/g) ?? []).length;
    expect(trues).toBe(probes);
    expect(CODE).not.toMatch(/UPDATE platform_feature_flags/i);
  });

  it('is idempotent — re-running does not touch an existing row', () => {
    expect(CODE).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });

  it('verifies its own effect and fails loudly if the row is absent', () => {
    expect(CODE).toMatch(/SELECT TRUE INTO present FROM platform_feature_flags WHERE key = 'rate_notifications_auto'/);
    expect(CODE).toMatch(/RAISE EXCEPTION 'rate_notifications_auto flag was not registered'/);
  });

  it('runs in a transaction, like 520', () => {
    expect(CODE.trim()).toMatch(/^BEGIN;/);
    expect(CODE.trim()).toMatch(/COMMIT;$/);
  });

  it('names an owner role the flags route can attribute to', () => {
    expect(CODE).toMatch(/'admin'/);
  });
});
