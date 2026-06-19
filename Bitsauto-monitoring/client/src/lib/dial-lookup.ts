interface DialMatch {
  code: string;
  country: string;
  breakout: string;
  destination: string;
}

interface RawEntry { c: string; k: string; b: string; }

let _cache: RawEntry[] | null = null;
let _loading = false;
let _callbacks: ((entries: RawEntry[]) => void)[] = [];

async function loadEntries(): Promise<RawEntry[]> {
  if (_cache) return _cache;
  if (_loading) {
    return new Promise(resolve => _callbacks.push(resolve));
  }
  _loading = true;
  try {
    const res = await fetch('/api/dial-codes');
    _cache = await res.json() as RawEntry[];
    _callbacks.forEach(cb => cb(_cache!));
    _callbacks = [];
    return _cache;
  } catch {
    _loading = false;
    return [];
  }
}

// Synchronous lookup — only works after preload() has been called
let _syncCache: RawEntry[] | null = null;

export async function preloadDialCodes(): Promise<void> {
  _syncCache = await loadEntries();
}

function searchEntries(digits: string, cache: RawEntry[]): DialMatch | null {
  for (const e of cache) {
    if (digits.startsWith(e.c)) {
      return { code: e.c, country: e.k, breakout: e.b, destination: `${e.k} - ${e.b}` };
    }
  }
  return null;
}

export function lookupDialCode(number: string | number | null | undefined): DialMatch | null {
  if (!number || !_syncCache) return null;
  const digits = String(number).replace(/^\+/, '').replace(/\D/g, '');
  if (!digits) return null;

  const primary = searchEntries(digits, _syncCache);
  if (primary) return primary;

  // No direct match — Sippy may prepend a route-prefix "1" to non-NANP numbers.
  // Since this DB contains no NANP entries, strip "1" for any 11+ digit number and retry.
  if (digits.startsWith('1') && digits.length >= 11) {
    const alt = searchEntries(digits.slice(1), _syncCache);
    if (alt) return alt;
  }
  return null;
}
