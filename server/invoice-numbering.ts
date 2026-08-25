/**
 * invoice-numbering.ts
 *
 * One invoice number scheme, configured in the company profile.
 *
 * An audit found three generation sites minting numbers in two incompatible
 * formats (C-YYMM-NNNN and INV-NNNNN) from one shared global count(*)+1 —
 * race-prone, gap-producing, and unconstrained in the database. This module
 * replaces all three derivations:
 *
 *   - The FORMAT comes from settings (invoice_number_format, tokens
 *     {PREFIX} {YYYY} {YY} {MM} {SEQ:n}), defaulting to the dominant existing
 *     series '{PREFIX}-{YY}{MM}-{SEQ:4}' with prefix 'C' so unconfigured
 *     numbering reproduces today's numbers exactly.
 *   - The SEQUENCE is per-prefix and monotonic: next = max existing sequence
 *     in the series + 1, regardless of month. Date tokens change with the
 *     calendar; the sequence never resets, so the series stays gap-free and
 *     two months can never collide.
 *   - UNIQUENESS is enforced by the database (unique index, migration 076);
 *     the allocator retries on conflict rather than trusting a count.
 *
 * Pure: no imports, so the rendering and sequence rules are pinned by tests.
 * DB glue lives in invoice-numbering-alloc.ts.
 */

export const DEFAULT_FORMAT = '{PREFIX}-{YY}{MM}-{SEQ:4}';
export const DEFAULT_PREFIX = 'C';

export interface NumberingConfig {
  format: string;
  prefix: string;
}

type Token =
  | { kind: 'lit'; text: string }
  | { kind: 'PREFIX' }
  | { kind: 'YYYY' }
  | { kind: 'YY' }
  | { kind: 'MM' }
  | { kind: 'SEQ'; pad: number };

const TOKEN_RE = /\{(PREFIX|YYYY|YY|MM|SEQ:(\d{1,2}))\}/g;

function tokenize(format: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of format.matchAll(TOKEN_RE)) {
    if (m.index! > last) out.push({ kind: 'lit', text: format.slice(last, m.index) });
    const name = m[1];
    if (name.startsWith('SEQ:')) out.push({ kind: 'SEQ', pad: Math.min(Number(m[2]), 12) || 1 });
    else out.push({ kind: name as 'PREFIX' | 'YYYY' | 'YY' | 'MM' });
    last = m.index! + m[0].length;
  }
  if (last < format.length) out.push({ kind: 'lit', text: format.slice(last) });
  return out;
}

/**
 * Settings → effective config. A format without a {SEQ:n} token could only
 * ever mint one number, so it is treated as invalid and the default applies —
 * generation must not be blockable by a typo in configuration.
 */
export function resolveNumberingConfig(s?: {
  invoiceNumberFormat?: string | null;
  invoiceNumberPrefix?: string | null;
} | null): NumberingConfig {
  const rawFormat = String(s?.invoiceNumberFormat ?? '').trim();
  const rawPrefix = String(s?.invoiceNumberPrefix ?? '').trim();
  const format = rawFormat && /\{SEQ:\d{1,2}\}/.test(rawFormat) ? rawFormat : DEFAULT_FORMAT;
  const prefix = rawPrefix || DEFAULT_PREFIX;
  return { format, prefix };
}

export function renderInvoiceNumber(cfg: NumberingConfig, date: Date, seq: number): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return tokenize(cfg.format).map((t) => {
    switch (t.kind) {
      case 'lit':    return t.text;
      case 'PREFIX': return cfg.prefix;
      case 'YYYY':   return yyyy;
      case 'YY':     return yyyy.slice(2);
      case 'MM':     return mm;
      case 'SEQ':    return String(seq).padStart(t.pad, '0');
    }
  }).join('');
}

/**
 * The literal the whole series starts with — everything up to the first
 * calendar or sequence token. Used as a cheap LIKE filter before the regex.
 */
export function literalHead(cfg: NumberingConfig): string {
  let head = '';
  for (const t of tokenize(cfg.format)) {
    if (t.kind === 'lit') head += t.text;
    else if (t.kind === 'PREFIX') head += cfg.prefix;
    else break;
  }
  return head;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex matching every number this config could EVER have minted — calendar
 * tokens wildcarded, sequence captured — so the next sequence continues the
 * series across month boundaries instead of resetting or colliding.
 */
export function seriesMatcher(cfg: NumberingConfig): RegExp {
  const body = tokenize(cfg.format).map((t) => {
    switch (t.kind) {
      case 'lit':    return escapeRe(t.text);
      case 'PREFIX': return escapeRe(cfg.prefix);
      case 'YYYY':   return '\\d{4}';
      case 'YY':     return '\\d{2}';
      case 'MM':     return '\\d{2}';
      // A sequence that outgrew its padding still belongs to the series.
      case 'SEQ':    return `(\\d{${t.pad},})`;
    }
  }).join('');
  return new RegExp(`^${body}$`);
}

/** Next sequence for the series: max over existing numbers + 1, floor 1. */
export function nextSeqFromNumbers(cfg: NumberingConfig, numbers: readonly string[]): number {
  const re = seriesMatcher(cfg);
  let max = 0;
  for (const n of numbers) {
    const m = re.exec(String(n));
    if (m?.[1]) {
      const v = parseInt(m[1], 10);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return max + 1;
}
