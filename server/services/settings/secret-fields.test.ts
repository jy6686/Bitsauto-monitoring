/**
 * Settings secrets — the redaction model, pinned.
 *
 * On 2026-09-18 GET /api/settings was found handing the live Sippy rate-admin password to any
 * authenticated user: the sensitive-field LIST had drifted from the settings TABLE (four
 * credential columns added after the list was written), and the admin branch returned the raw
 * object regardless. Worse, the admin UI round-trips whatever GET returns straight back through
 * PATCH, so redacting the read side alone would write the redaction into the database as the
 * password. Read redaction and write-side stripping are therefore ONE contract, and this file
 * pins both halves plus the guard that stops the list drifting again.
 */
import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SENSITIVE_FIELDS,
  SECRET_MASK,
  credentialShapedColumns,
  redactForRole,
  stripUnchangedSecrets,
} from './secret-fields';

// ── 1. Drift guard: the list must cover every credential-shaped column in the schema ───────────

describe('drift guard — every credential-shaped settings column is in the sensitive list', () => {
  it('names any column the schema has that the list does not (this is how the 2026-09-18 leak happened)', () => {
    const inSchema = credentialShapedColumns();
    const listed = new Set<string>(SETTINGS_SENSITIVE_FIELDS);
    const missing = inSchema.filter(c => !listed.has(c));
    expect(missing, `credential-shaped columns missing from SETTINGS_SENSITIVE_FIELDS: ${missing.join(', ')}`).toEqual([]);
  });

  it('the schema scan finds the known secrets and does NOT flag the public key', () => {
    const cols = credentialShapedColumns();
    for (const must of ['sippyRateAdminPass', 'hlrApiKey', 'hlrApiSecret', 'invoiceSmtpPass', 'portalPassword', 'metaAccessToken']) {
      expect(cols, must).toContain(must);
    }
    expect(cols).not.toContain('metaFlowsPublicKey'); // a public key is not a secret
  });
});

// ── 2. Read side ─────────────────────────────────────────────────────────────────────────────

// Exhaustive: every one of the twelve sensitive columns is present, so the non-admin assertion is
// literal across the whole list rather than only the fields a partial fixture happened to carry.
const row = {
  id: 1,
  portalUrl: 'https://switch.example',
  portalUsername: 'ssp-root',
  portalPassword: 'p0rtal',
  apiAdminPassword: 'ap1',
  adminWebPassword: 'w3b',
  sippyRateAdminUser: 'rate-admin',
  sippyRateAdminPass: 'r4te',
  hlrApiKey: 'hlrkey',
  hlrApiSecret: 'hlrsec',
  invoiceSmtpPass: 'smtp',
  whatsappApiKey: 'wa-key',
  portalSessionToken: 'sess',
  approvalExpirySlackWebhookUrl: 'https://hooks.slack/x',
  alertGmailAppPass: null,          // configured: no
  metaAccessToken: '',              // configured: no (blank)
  simulationEnabled: true,
};
const PLAINTEXTS = ['p0rtal', 'ap1', 'w3b', 'r4te', 'hlrkey', 'hlrsec', 'smtp', 'wa-key', 'sess', 'https://hooks.slack/x'];

describe('redactForRole — non-admin', () => {
  it('nulls EVERY sensitive field, including the four that used to leak', () => {
    const out = redactForRole(row, 'management') as any;
    for (const f of SETTINGS_SENSITIVE_FIELDS) expect(out[f], f).toBeNull();
  });

  it('leaves non-sensitive fields untouched', () => {
    const out = redactForRole(row, 'management') as any;
    expect(out.portalUrl).toBe('https://switch.example');
    expect(out.portalUsername).toBe('ssp-root');
    expect(out.sippyRateAdminUser).toBe('rate-admin');
    expect(out.simulationEnabled).toBe(true);
  });
});

describe('redactForRole — admin', () => {
  it('never returns a plaintext secret', () => {
    const out = redactForRole(row, 'admin') as any;
    for (const f of SETTINGS_SENSITIVE_FIELDS) expect(PLAINTEXTS, f).not.toContain(out[f]);
  });

  it('shows the mask as a presence indicator when a secret is configured', () => {
    const out = redactForRole(row, 'admin') as any;
    expect(out.sippyRateAdminPass).toBe(SECRET_MASK);
    expect(out.portalPassword).toBe(SECRET_MASK);
  });

  it('shows null when a secret is not configured (null or blank)', () => {
    const out = redactForRole(row, 'admin') as any;
    expect(out.alertGmailAppPass).toBeNull();
    expect(out.metaAccessToken).toBeNull();
  });

  it('leaves non-sensitive fields untouched', () => {
    const out = redactForRole(row, 'admin') as any;
    expect(out.portalUrl).toBe('https://switch.example');
    expect(out.sippyRateAdminUser).toBe('rate-admin');
  });
});

// ── 3. Write side ────────────────────────────────────────────────────────────────────────────

describe('stripUnchangedSecrets — what the UI echoes back must never become the stored value', () => {
  it('drops a sensitive field that arrives as the mask (the admin form re-sending what GET showed)', () => {
    const out = stripUnchangedSecrets({ sippyRateAdminPass: SECRET_MASK, portalUrl: 'x' });
    expect('sippyRateAdminPass' in out).toBe(false);
    expect(out.portalUrl).toBe('x');
  });

  it("drops a sensitive field that arrives as '' — blank means keep, so a save cannot wipe a credential", () => {
    const out = stripUnchangedSecrets({ apiAdminPassword: '', hlrApiSecret: '' });
    expect('apiAdminPassword' in out).toBe(false);
    expect('hlrApiSecret' in out).toBe(false);
  });

  it('KEEPS a genuinely new secret value — rotation through the form still works', () => {
    const out = stripUnchangedSecrets({ sippyRateAdminPass: 'brand-new-secret' });
    expect(out.sippyRateAdminPass).toBe('brand-new-secret');
  });

  it("does not touch a NON-sensitive field that is '' — blank-means-keep applies to secrets only", () => {
    const out = stripUnchangedSecrets({ portalUrl: '', simulationEnabled: false });
    expect(out.portalUrl).toBe('');
    expect(out.simulationEnabled).toBe(false);
  });

  it('leaves absent fields absent', () => {
    const out = stripUnchangedSecrets({ portalUrl: 'x' });
    expect('portalPassword' in out).toBe(false);
  });
});
