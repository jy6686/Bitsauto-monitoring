/**
 * Default-rate template: the wide sheet a commercial team edits, and the long rows
 * product_rates stores.
 *
 * WHY WIDE IN, LONG OUT
 * product_rates is normalised — one row per (product, destination), which is right for
 * querying and wrong for pricing. A commercial decision is "what do we charge for
 * Pakistan Ufone across our four tiers", which is one line with four numbers, not four
 * lines. Asking an operator to enter 128 normalised rows, each carrying a product id they
 * should never see, invites exactly the errors this module rejects: a destination priced
 * on three tiers, the same prefix entered twice, a rate typed into the wrong column.
 *
 *   prefix,destination,FC,BC,SB,SC          →   (FC, 92, 0.0450)
 *   92,Pakistan Fixed,0.0450,0.0400,...          (BC, 92, 0.0400)  ...
 *
 * VERSIONING, NOT OVERWRITING. An import never edits existing rows. It writes a new
 * generation with its own effectiveFrom and closes the previous one the day before, so
 * what a customer was quoted last quarter stays answerable. product_rates was built
 * effective-dated for this; an importer that UPDATEd in place would throw that away.
 *
 * DELIBERATELY IMPORTS NOTHING FROM THE APP — same rule as rate-matrix.ts. server/db.ts
 * throws at module load without DATABASE_URL, and the parsing and validation here are
 * precisely what needs to be testable without a database.
 */

/** A product the template has a column for. Passed in so this module needs no db. */
export interface TemplateProduct {
  id: number;
  /** Column header in the sheet: FC, BC, SB, SC. */
  code: string;
  name: string;
}

export interface TemplateRow {
  prefix: string;
  destination: string | null;
  /** productCode → rate. A missing entry is a gap; 0 is a real price. */
  prices: Record<string, number>;
  /** Product codes explicitly marked `n/a` — not sold here, so not a missing price. */
  notOffered: Set<string>;
  /** 1-based line number in the source file, for error messages an operator can act on. */
  line: number;
}

export interface ExpandedRate {
  productId: number;
  productCode: string;
  prefix: string;
  destination: string | null;
  rate: number;
}

export interface TemplateIssue {
  line: number | null;
  severity: 'error' | 'warning';
  message: string;
}

const FIXED_COLUMNS = ['prefix', 'destination'] as const;

/**
 * Split one CSV line, honouring double quotes.
 *
 * Destination names in this dataset contain commas — "PAKISTAN MOBILE ZONG, LDI" and the
 * like — so a naive split on ',' silently shifts every price one column left, pricing
 * Ufone at Zong's rate. Cheaper to handle here than to debug from a customer's invoice.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/**
 * Produce the sheet the commercial team fills in.
 *
 * Destinations are supplied by the caller (from the existing default card, or from
 * whatever is already in product_rates) so the operator edits prices rather than retyping
 * 32 prefixes — the retyping is where prefixes get transposed.
 */
export const NOT_OFFERED = 'n/a';

export function buildTemplateCsv(
  destinations: Array<{ prefix: string; destination?: string | null }>,
  products: TemplateProduct[],
  /** `${prefix}|${productCode}` pairs the business actually sells. Omit to offer every
   *  product on every row. Cells outside it are pre-filled `n/a` — a destination sold on
   *  two products out of four should not read as two missing prices. */
  offered?: Set<string>,
): string {
  const header = [...FIXED_COLUMNS, ...products.map(p => p.code)].join(',');
  const q = (s: string) => (s.includes(',') || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = destinations.map(d => [
    q(d.prefix),
    q(d.destination ?? ''),
    ...products.map(p => (!offered || offered.has(`${d.prefix}|${p.code}`)) ? '' : NOT_OFFERED),
  ].join(','));
  return [header, ...lines].join('\n') + '\n';
}

/** Parse the sheet. Structural problems only — pricing rules are validate()'s job. */
export function parseTemplateCsv(csv: string, products: TemplateProduct[]): {
  rows: TemplateRow[];
  issues: TemplateIssue[];
} {
  const issues: TemplateIssue[] = [];
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) {
    return { rows: [], issues: [{ line: null, severity: 'error', message: 'File is empty.' }] };
  }

  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  const prefixIdx = header.indexOf('prefix');
  const destIdx   = header.indexOf('destination');
  if (prefixIdx < 0) {
    return { rows: [], issues: [{ line: 1, severity: 'error', message: 'No "prefix" column. Download a fresh template rather than editing the header.' }] };
  }

  // Map each product to its column. A product with no column is reported once, here,
  // rather than as 32 identical "missing price" errors further down.
  const colFor = new Map<string, number>();
  for (const p of products) {
    const i = header.indexOf(p.code.toLowerCase());
    if (i < 0) {
      issues.push({ line: 1, severity: 'error', message: `No column for product ${p.code} (${p.name}). Every active product needs a price column, or customers carry it unpriced.` });
    } else {
      colFor.set(p.code, i);
    }
  }

  const rows: TemplateRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const line = i + 1;
    const prefix = (cells[prefixIdx] ?? '').trim();
    if (!prefix) {
      issues.push({ line, severity: 'error', message: 'Row has no prefix.' });
      continue;
    }
    if (!/^[0-9]+$/.test(prefix)) {
      issues.push({ line, severity: 'error', message: `Prefix "${prefix}" is not digits. A "+" or a space here becomes a destination Sippy never matches.` });
      continue;
    }

    const prices: Record<string, number> = {};
    const notOffered = new Set<string>();
    for (const [code, idx] of colFor) {
      const raw = (cells[idx] ?? '').trim();
      if (raw === '') continue;                       // gap — validate() decides if it matters
      // 'n/a' means the business does not sell this destination on this product. Distinct
      // from blank: blank is a price someone forgot, n/a is a deliberate absence.
      if (raw.toLowerCase() === NOT_OFFERED) { notOffered.add(code); continue; }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        issues.push({ line, severity: 'error', message: `${code} price "${raw}" is not a number.` });
        continue;
      }
      if (n < 0) {
        issues.push({ line, severity: 'error', message: `${code} price ${n} is negative.` });
        continue;
      }
      prices[code] = n;
    }
    rows.push({
      prefix,
      destination: destIdx >= 0 ? ((cells[destIdx] ?? '').trim() || null) : null,
      prices,
      notOffered,
      line,
    });
  }

  return { rows, issues };
}

/**
 * Pricing rules. Everything that would produce a wrong bill rather than a parse failure.
 *
 * A rate of 0 is accepted — free destinations are a real commercial arrangement — but
 * flagged as a warning, because a blank cell and a deliberate zero look identical in a
 * spreadsheet and only one of them is intended.
 */
export function validateTemplate(rows: TemplateRow[], products: TemplateProduct[]): TemplateIssue[] {
  const issues: TemplateIssue[] = [];

  if (!rows.length) {
    issues.push({ line: null, severity: 'error', message: 'No priced rows. Importing this would leave product_rates empty.' });
    return issues;
  }

  const seen = new Map<string, number>();
  for (const r of rows) {
    const first = seen.get(r.prefix);
    if (first !== undefined) {
      // Which of the two wins depends on insert order — silently, and differently on a
      // re-import. Refuse rather than pick.
      issues.push({ line: r.line, severity: 'error', message: `Prefix ${r.prefix} appears again (first on line ${first}). Two prices for one destination; which applies would depend on insert order.` });
      continue;
    }
    seen.set(r.prefix, r.line);

    for (const p of products) {
      if (r.notOffered.has(p.code)) continue;   // deliberately not sold — nothing to price
      const v = r.prices[p.code];
      if (v === undefined) {
        issues.push({ line: r.line, severity: 'error', message: `${r.prefix} has no ${p.code} price — a customer on ${p.name} would carry this destination unpriced.` });
      } else if (v === 0) {
        issues.push({ line: r.line, severity: 'warning', message: `${r.prefix} is priced 0 on ${p.code}. Intended, or an empty cell?` });
      }
    }
  }
  return issues;
}

/** Fan the wide sheet out into the normalised rows product_rates stores. */
export function expandTemplate(rows: TemplateRow[], products: TemplateProduct[]): ExpandedRate[] {
  const out: ExpandedRate[] = [];
  for (const r of rows) {
    for (const p of products) {
      const rate = r.prices[p.code];
      if (rate === undefined) continue;   // validate() has already objected
      out.push({ productId: p.id, productCode: p.code, prefix: r.prefix, destination: r.destination, rate });
    }
  }
  return out;
}

/** The day before `effectiveFrom` — the expiry stamped on the generation being replaced. */
export function previousDay(effectiveFrom: string): string {
  const d = new Date(`${effectiveFrom}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`previousDay: "${effectiveFrom}" is not YYYY-MM-DD`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
