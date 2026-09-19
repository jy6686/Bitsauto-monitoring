/**
 * The settings routes' contract with the secret model — asserted against source.
 *
 * secret-fields.test.ts proves the model. This pins the three things a reviewer could undo in one
 * edit and reopen the leak: the GET must redact on EVERY branch (the admin branch used to return the
 * raw row), the PATCH must strip echoed secrets BEFORE persisting and must not return the written
 * row in plaintext, and the inline list that drifted must not come back as a second source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SRC = strip(readFileSync(join(__dirname, '..', '..', 'routes.ts'), 'utf8'));

const GET = (() => {
  const at = SRC.indexOf('app.get(api.settings.get.path');
  expect(at, 'settings GET must exist').toBeGreaterThan(-1);
  return SRC.slice(at, SRC.indexOf('app.patch(api.settings.update.path', at));
})();

const PATCH = (() => {
  const at = SRC.indexOf('app.patch(api.settings.update.path');
  expect(at, 'settings PATCH must exist').toBeGreaterThan(-1);
  return SRC.slice(at, SRC.indexOf('app.post(api.settings.resetSimulation.path', at));
})();

describe('GET /api/settings — no branch returns the raw row', () => {
  it('redacts by role on the single response path', () => {
    expect(GET).toContain('res.json(redactForRole(settings as any, role))');
  });

  it('has no unredacted res.json(settings) left — the admin branch that leaked', () => {
    expect(GET).not.toMatch(/res\.json\(settings\)/);
  });

  it('has no role branch that bypasses redaction', () => {
    expect(GET).not.toContain("if (role !== 'admin')");
  });
});

describe('PATCH /api/settings — echoed secrets are stripped before they can be stored', () => {
  it('strips BEFORE updateSettings, and updateSettings receives the stripped object', () => {
    const stripAt  = PATCH.indexOf('stripUnchangedSecrets(input');
    const updateAt = PATCH.indexOf('storage.updateSettings(cleaned');
    expect(stripAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(stripAt);
    expect(PATCH).not.toContain('storage.updateSettings(input');
  });

  it('does not return the written row in plaintext', () => {
    expect(PATCH).toContain("res.json(redactForRole(updated as any, 'admin'))");
    expect(PATCH).not.toMatch(/res\.json\(updated\)/);
  });

  it('audits the fields actually written, not the echoed secrets', () => {
    expect(PATCH).toContain('changedFields: Object.keys(cleaned)');
  });
});

describe('one source of truth', () => {
  it('the inline SETTINGS_SENSITIVE_FIELDS list is gone from routes.ts', () => {
    expect(SRC).not.toContain('const SETTINGS_SENSITIVE_FIELDS = [');
  });
});
