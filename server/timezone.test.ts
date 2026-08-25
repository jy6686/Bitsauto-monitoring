/**
 * Timezone resolution — pinned against the production crash.
 *
 * "GMT+00:00 | UTC" reached Intl.DateTimeFormat from a company record and threw
 * RangeError, which escaped to the React error boundary and took the whole
 * Invoices page down. Every legacy label the wizards could have stored is
 * covered here, and the last test is the crash itself: the resolver's output
 * must always be something Intl accepts.
 */

import { describe, it, expect } from 'vitest';
import { toIanaTimeZone, timeZoneLabel, TIMEZONE_OPTIONS } from '@shared/timezone';

/** Exactly what the wizards stored as VALUES before the fix. */
const LEGACY_STORED = [
  'GMT+00:00 | UTC', 'GMT+01:00 | London', 'GMT+02:00 | Cairo',
  'GMT+03:00 | Riyadh', 'GMT+04:00 | Dubai', 'GMT+05:00 | Karachi',
  'GMT+05:30 | Mumbai', 'GMT+06:00 | Dhaka', 'GMT+07:00 | Bangkok',
  'GMT+08:00 | Singapore', 'GMT+09:00 | Tokyo', 'GMT-05:00 | New York',
  'GMT-08:00 | Los Angeles',
];

describe('toIanaTimeZone', () => {
  it('resolves the exact string that crashed production', () => {
    expect(toIanaTimeZone('GMT+00:00 | UTC')).toBe('UTC');
  });

  it('resolves every legacy label the wizards could have stored', () => {
    expect(LEGACY_STORED.map(toIanaTimeZone)).toEqual([
      'UTC', 'Europe/London', 'Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai',
      'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok',
      'Asia/Singapore', 'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles',
    ]);
  });

  it('passes through identifiers that are already valid', () => {
    expect(toIanaTimeZone('UTC')).toBe('UTC');
    expect(toIanaTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(toIanaTimeZone('America/New_York')).toBe('America/New_York');
  });

  it('falls back to UTC rather than throwing, for anything unrecognised', () => {
    // A wrong hour offset is cosmetic; a page that will not render is an outage.
    for (const junk of ['', '   ', 'GMT+00:00', 'UTC+0', 'Mars/Olympus', 'null', '|', 'GMT+99:00 | Nowhere']) {
      expect(toIanaTimeZone(junk)).toBe('UTC');
    }
    expect(toIanaTimeZone(null)).toBe('UTC');
    expect(toIanaTimeZone(undefined)).toBe('UTC');
  });

  it('never returns a value Intl would reject — the crash cannot recur', () => {
    const inputs = [...LEGACY_STORED, 'UTC', 'Asia/Karachi', '', 'garbage', null, undefined,
                    'GMT+00:00', '  Europe/London  ', 'KARACHI', 'gmt+05:00 | karachi'];
    for (const input of inputs) {
      const tz = toIanaTimeZone(input as any);
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0)))
        .not.toThrow();
    }
  });

  it('is case-insensitive about the city half', () => {
    expect(toIanaTimeZone('GMT+05:00 | KARACHI')).toBe('Asia/Karachi');
    expect(toIanaTimeZone('gmt+05:00 | karachi')).toBe('Asia/Karachi');
  });

  it('handles offset forms by what Intl actually accepts, not by guesswork', () => {
    // Intl accepts "+05:00" as an offset zone but rejects "GMT+05:00".
    // The accepted one passes through: rewriting a valid, unambiguous offset
    // to UTC would silently move a customer's clock five hours, which is worse
    // than the DST blindness an offset zone carries. The rejected one cannot
    // be guessed at safely, so it falls back.
    expect(toIanaTimeZone('+05:00')).toBe('+05:00');
    expect(toIanaTimeZone('GMT+05:00')).toBe('UTC');
  });
});

describe('timeZoneLabel', () => {
  it('renders a human label without ever being fed back to Intl', () => {
    expect(timeZoneLabel('UTC')).toBe('GMT+00:00 (UTC)');
    expect(timeZoneLabel('Asia/Karachi')).toBe('Karachi (Asia)');
    expect(timeZoneLabel('America/New_York')).toBe('New York (America)');
  });

  it('survives the legacy values too', () => {
    expect(timeZoneLabel('GMT+00:00 | UTC')).toBe('GMT+00:00 (UTC)');
    expect(timeZoneLabel(null)).toBe('GMT+00:00 (UTC)');
  });
});

describe('TIMEZONE_OPTIONS', () => {
  it('every option VALUE is a usable identifier, not a label', () => {
    // The original defect in one assertion: the picker must store what Intl
    // accepts, and show the label separately.
    for (const opt of TIMEZONE_OPTIONS) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: opt.value })).not.toThrow();
      expect(toIanaTimeZone(opt.value)).toBe(opt.value);
    }
  });
});
