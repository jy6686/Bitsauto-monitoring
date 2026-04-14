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

export function lookupDialCode(number: string | number | null | undefined): DialMatch | null {
  if (!number || !_syncCache) return null;
  const digits = String(number).replace(/^\+/, '').replace(/\D/g, '');
  if (!digits) return null;
  for (const e of _syncCache) {
    if (digits.startsWith(e.c)) {
      return { code: e.c, country: e.k, breakout: e.b, destination: `${e.k} - ${e.b}` };
    }
  }
  return null;
}
