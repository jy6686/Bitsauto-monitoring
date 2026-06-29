/**
 * Prefix Expression Engine
 * Normalizes vendor prefix cells into individual digit strings.
 *
 * Supported vendor cell formats:
 *   "1264"               -> ["1264"]
 *   "24945;24946"        -> ["24945","24946"]
 *   "917530-917531"      -> ["917530","917531"]
 *   "916000-916207"      -> ["916000","916001",...,"916207"]
 *   multiline cells      -> split by newline first, then above rules
 */

const MAX_RANGE_EXPAND = 10_000;

export interface ParsedPrefix {
  prefix: string;
  source: string;    // original expression token
  method: 'literal' | 'range' | 'list';
  warnings?: string[];
}

function expandHyphen(start: string, end: string, source: string): ParsedPrefix[] {
  const s = parseInt(start, 10);
  const e = parseInt(end, 10);
  const warnings: string[] = [];
  if (isNaN(s) || isNaN(e) || e < s) {
    return [{ prefix: start, source, method: 'literal', warnings: ['invalid_hyphen'] }];
  }
  if (e - s > MAX_RANGE_EXPAND) {
    warnings.push('large_range_capped');
    return [
      { prefix: start, source, method: 'range', warnings },
      { prefix: end,   source, method: 'range', warnings },
    ];
  }
  const len = start.length;
  const out: ParsedPrefix[] = [];
  for (let i = s; i <= e; i++) {
    out.push({ prefix: String(i).padStart(len, '0'), source, method: 'range' });
  }
  return out;
}

export function parsePrefixExpression(
  raw: string | null | undefined,
  mode: 'single' | 'semicolon' | 'comma' | 'mixed' = 'mixed',
): ParsedPrefix[] {
  if (!raw) return [];
  const seen = new Map<string, ParsedPrefix>();
  const lines = String(raw).split(/[\n\r]+/);
  for (const line of lines) {
    const tokens = mode === 'single' ? [line] : line.split(/[;,\uff1b\uff0c]/);
    for (const tok of tokens) {
      const t = tok.trim();
      if (!t) continue;
      const hm = t.match(/^(\d+)-(\d+)$/);
      if (hm && mode !== 'single') {
        for (const p of expandHyphen(hm[1], hm[2], t)) {
          if (!seen.has(p.prefix)) seen.set(p.prefix, p);
        }
      } else {
        const cleaned = t.replace(/[^\d]/g, '');
        if (cleaned.length >= 2 && cleaned.length <= 16) {
          if (!seen.has(cleaned)) seen.set(cleaned, { prefix: cleaned, source: t, method: 'literal' });
        }
      }
    }
  }
  return Array.from(seen.values());
}

export function detectPrefixMode(samples: string[]): 'single' | 'mixed' | 'comma' {
  for (const s of samples.slice(0, 30)) {
    if (/[;\uff1b]/.test(s) || /\d-\d/.test(s)) return 'mixed';
    if (/[,\uff0c]/.test(s)) return 'comma';
  }
  return 'single';
}
