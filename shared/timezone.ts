/**
 * timezone.ts
 *
 * One job: never hand a display label to Intl.
 *
 * The company wizards stored their dropdown LABELS as the stored value —
 * "GMT+00:00 | UTC", "GMT+05:00 | Karachi". Those are not IANA zone
 * identifiers, so the moment one reached Intl.DateTimeFormat it threw
 * RangeError, and because the call sites were unguarded the exception
 * escaped to the React error boundary and took the whole Invoices page down.
 * A customer-facing screen died over a dropdown value.
 *
 * Two different things had been conflated:
 *
 *   identifier   what Intl accepts        "UTC", "Asia/Karachi"
 *   label        what a human reads       "GMT+00:00 (UTC)"
 *
 * This module keeps them apart and, critically, NEVER throws: an unrecognised
 * value resolves to UTC. A billing screen showing the wrong hour offset is a
 * cosmetic defect; a billing screen that will not render is an outage.
 */

/** Legacy wizard labels → IANA identifiers. */
const LEGACY_LABELS: Record<string, string> = {
  'utc':          'UTC',
  'london':       'Europe/London',
  'cairo':        'Africa/Cairo',
  'riyadh':       'Asia/Riyadh',
  'dubai':        'Asia/Dubai',
  'karachi':      'Asia/Karachi',
  'mumbai':       'Asia/Kolkata',
  'delhi':        'Asia/Kolkata',
  'dhaka':        'Asia/Dhaka',
  'bangkok':      'Asia/Bangkok',
  'singapore':    'Asia/Singapore',
  'tokyo':        'Asia/Tokyo',
  'hong kong':    'Asia/Hong_Kong',
  'new york':     'America/New_York',
  'los angeles':  'America/Los_Angeles',
  'chicago':      'America/Chicago',
  'sydney':       'Australia/Sydney',
};

/** Does Intl actually accept this identifier? The only authority worth asking. */
function isUsable(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

/**
 * Resolve any stored timezone value to an identifier Intl will accept.
 * Returns 'UTC' for anything unrecognised — never throws, never returns a
 * value that would throw downstream.
 */
export function toIanaTimeZone(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'UTC';

  // Already a usable identifier ("UTC", "Asia/Karachi").
  if (isUsable(raw)) return raw;

  // Legacy label: "GMT+05:00 | Karachi" — the city sits after the pipe.
  // Note Intl accepts a bare "+05:00" as an offset zone (handled above) but
  // rejects "GMT+05:00". Offset zones are passed through rather than rewritten
  // to UTC: they ignore daylight saving, but silently moving a customer's
  // clock by five hours would be the worse failure.
  const afterPipe = raw.includes('|') ? raw.split('|').pop()!.trim() : raw;
  const mapped = LEGACY_LABELS[afterPipe.toLowerCase()];
  if (mapped && isUsable(mapped)) return mapped;

  const whole = LEGACY_LABELS[raw.toLowerCase()];
  if (whole && isUsable(whole)) return whole;

  return 'UTC';
}

/** Human-facing label for an identifier: "Asia/Karachi" → "Karachi (Asia)". */
export function timeZoneLabel(value: string | null | undefined): string {
  const tz = toIanaTimeZone(value);
  if (tz === 'UTC') return 'GMT+00:00 (UTC)';
  const [region, city] = tz.split('/');
  return city ? `${city.replace(/_/g, ' ')} (${region})` : tz;
}

/**
 * Options for a timezone picker: the value is what gets STORED, the label is
 * what gets shown. Storing the label is the mistake that caused the outage.
 */
export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'UTC',                 label: 'GMT+00:00 (UTC)' },
  { value: 'Europe/London',       label: 'London' },
  { value: 'Africa/Cairo',        label: 'Cairo' },
  { value: 'Asia/Riyadh',         label: 'Riyadh' },
  { value: 'Asia/Dubai',          label: 'Dubai' },
  { value: 'Asia/Karachi',        label: 'Karachi' },
  { value: 'Asia/Kolkata',        label: 'Mumbai / Delhi' },
  { value: 'Asia/Dhaka',          label: 'Dhaka' },
  { value: 'Asia/Bangkok',        label: 'Bangkok' },
  { value: 'Asia/Singapore',      label: 'Singapore' },
  { value: 'Asia/Tokyo',          label: 'Tokyo' },
  { value: 'America/New_York',    label: 'New York' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
];
