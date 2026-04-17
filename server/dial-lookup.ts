import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface DialMatch {
  code: string;
  country: string;
  breakout: string;
  destination: string;
  trunkClass?: string;      // routing class label (First Class / Business Class / Bravo / Charlie)
  trunkPrefix?: string;     // the leading class digit that was stripped ('1'|'2'|'6'|'7')
}

// Routing class prefixes: the first digit of the CLD encodes the service class.
// Strip it to reveal the real E.164 country code.
const TRUNK_CLASS_MAP: Record<string, string> = {
  '1': 'First Class Wholesale',
  '2': 'Business Class Wholesale',
  '6': 'Special Bravo',
  '7': 'Special Charlie',
};

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

  // Try direct match first (handles genuine E.164 numbers without class prefix)
  const primary = searchEntries(digits, entries);
  if (primary) return primary;

  // Class-prefix stripping:
  // The first digit of the CLD encodes the Sippy routing/service class:
  //   1 → First Class Wholesale
  //   2 → Business Class Wholesale
  //   6 → Special Bravo
  //   7 → Special Charlie
  // Numbers with these prefixes are 11+ digits; stripping the first digit reveals
  // the real E.164 country code.  (e.g. "1923..." → strip → "923..." = Pakistan +92)
  const leadDigit = digits.charAt(0);
  if (leadDigit in TRUNK_CLASS_MAP && digits.length >= 11) {
    const stripped = digits.slice(1);
    const alt = searchEntries(stripped, entries);
    if (alt) {
      return {
        ...alt,
        trunkClass:  TRUNK_CLASS_MAP[leadDigit],
        trunkPrefix: leadDigit,
      };
    }
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
