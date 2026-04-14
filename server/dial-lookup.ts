import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface DialMatch {
  code: string;
  country: string;
  breakout: string;
  destination: string;
}

interface RawEntry { c: string; k: string; b: string; }

let _entries: RawEntry[] | null = null;

function getEntries(): RawEntry[] {
  if (_entries) return _entries;
  const filePath = join(process.cwd(), 'server', 'dial-codes.json');
  _entries = JSON.parse(readFileSync(filePath, 'utf8')) as RawEntry[];
  return _entries;
}

function searchEntries(digits: string, entries: RawEntry[]): DialMatch | null {
  for (const e of entries) {
    if (digits.startsWith(e.c)) {
      return { code: e.c, country: e.k, breakout: e.b, destination: `${e.k} - ${e.b}` };
    }
  }
  return null;
}

export function lookupDialCode(number: string | number | null | undefined): DialMatch | null {
  if (!number) return null;
  const digits = String(number).replace(/^\+/, '').replace(/\D/g, '');
  if (!digits) return null;
  const entries = getEntries();

  const primary = searchEntries(digits, entries);
  if (primary) return primary;

  // No direct match — Sippy may have prepended a route-prefix "1" (NANP-style) to any
  // non-NANP destination. Since this lookup DB contains no NANP entries, strip the
  // leading "1" for any 11+ digit number starting with "1" and retry.
  if (digits.startsWith('1') && digits.length >= 11) {
    const alt = searchEntries(digits.slice(1), entries);
    if (alt) return alt;
  }
  return null;
}

export function lookupMany(numbers: (string | number | null | undefined)[]): (DialMatch | null)[] {
  return numbers.map(n => lookupDialCode(n));
}

export function getDestinationStats(numbers: (string | number | null | undefined)[]): {
  byCountry: Record<string, number>;
  byBreakout: Record<string, number>;
  byDestination: Record<string, number>;
  resolved: number;
  unresolved: number;
} {
  const byCountry: Record<string, number> = {};
  const byBreakout: Record<string, number> = {};
  const byDestination: Record<string, number> = {};
  let resolved = 0;
  let unresolved = 0;

  for (const n of numbers) {
    const match = lookupDialCode(n);
    if (match) {
      resolved++;
      byCountry[match.country] = (byCountry[match.country] || 0) + 1;
      byBreakout[match.breakout] = (byBreakout[match.breakout] || 0) + 1;
      byDestination[match.destination] = (byDestination[match.destination] || 0) + 1;
    } else {
      unresolved++;
    }
  }
  return { byCountry, byBreakout, byDestination, resolved, unresolved };
}
