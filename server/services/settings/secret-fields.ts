/**
 * Settings secrets — one model for both halves of the contract.
 *
 * READ: `redactForRole` never lets a credential leave the server. Non-admins get null. Admins get a
 * presence indicator — the mask when a secret is configured, null when it is not — which is what
 * the settings form's `placeholder="••••••••"` inputs were designed around and what /api/switches
 * already does.
 *
 * WRITE: `stripUnchangedSecrets` drops any sensitive field that arrives as the mask or blank before
 * it can reach the database. This is not optional: the admin form is `useForm({ values: settings })`
 * and submits the WHOLE form, so whatever GET returns comes straight back through PATCH. Redact the
 * read side without this and the next Save stores the mask as the password; omit the value and it
 * stores ''. A genuinely new value is written, so rotation through the form still works. Blank
 * means keep — clearing a credential is an explicit operation, not a side effect of an empty box.
 *
 * DRIFT GUARD: the 2026-09-18 leak was a LIST that fell behind the TABLE — four credential columns
 * were added after it was written. `credentialShapedColumns` reads the live schema, and a test
 * asserts the list covers it, so the next column added cannot silently leak.
 */
import { getTableColumns } from 'drizzle-orm';
import { settings } from '../../../shared/schema';

export const SECRET_MASK = '••••••••';

/** Every settings column that holds a credential. Kept in sync with the schema by the drift guard. */
export const SETTINGS_SENSITIVE_FIELDS = [
  'portalPassword',
  'apiAdminPassword',
  'adminWebPassword',
  'alertGmailAppPass',
  'whatsappApiKey',
  'portalSessionToken',
  'metaAccessToken',
  'approvalExpirySlackWebhookUrl',
  // The four the drift guard caught on 2026-09-19 — added to the table after the list was written.
  'sippyRateAdminPass',
  'hlrApiKey',
  'hlrApiSecret',
  'invoiceSmtpPass',
] as const;

export type SensitiveField = (typeof SETTINGS_SENSITIVE_FIELDS)[number];

const SENSITIVE = new Set<string>(SETTINGS_SENSITIVE_FIELDS);

/**
 * Column names in the settings table whose NAME says they hold a credential. A public key is not a
 * secret and is excluded by name. This is the source of truth the sensitive list is checked against.
 */
export function credentialShapedColumns(): string[] {
  return Object.keys(getTableColumns(settings))
    .filter(n => /(pass|secret|token|apikey|webhook)/i.test(n) && !/public/i.test(n))
    .sort();
}

const isConfigured = (v: unknown) => v !== null && v !== undefined && String(v) !== '';

/** Redact a settings row for a caller's role. Never returns a plaintext secret to anyone. */
export function redactForRole<T extends Record<string, unknown>>(row: T, role: string | null | undefined): T {
  const out: Record<string, unknown> = { ...row };
  const admin = role === 'admin';
  for (const f of SENSITIVE) {
    if (!(f in out)) continue;
    out[f] = admin ? (isConfigured(out[f]) ? SECRET_MASK : null) : null;
  }
  return out as T;
}

/** Drop sensitive fields that arrive as the mask or blank, so an echo can never overwrite a secret. */
export function stripUnchangedSecrets<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const f of SENSITIVE) {
    if (!(f in out)) continue;
    const v = out[f];
    if (v === SECRET_MASK || v === '' || v === null || v === undefined) delete out[f];
  }
  return out as T;
}
