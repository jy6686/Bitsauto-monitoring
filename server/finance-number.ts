/**
 * finance-number.ts — a missing number is not zero.
 *
 * WHY THIS EXISTS. Four separate defects in this platform have now had the
 * identical shape: a consumer reads a field name the producer does not write,
 * the read yields `undefined`, a `|| 0` or `?? 0` turns that into a number, and
 * a financial figure renders as $0.00 with no error anywhere.
 *
 *   Finance Cockpit    read `totalRevenue`     row had `totalSell`       $0
 *   Margin Alerts      read `marginDeltaUsd`   row had `amountUsd`       $0
 *   Health Dashboard   read `date`             table had `report_date`   "never"
 *   Live Invoice       read `amount`           table had `reproducedCost` $0.00 x362
 *
 * None threw. None logged. Each produced a convincing, precisely-formatted,
 * entirely wrong number — which is worse than a stack trace, because a stack
 * trace gets fixed the same day and a plausible zero gets believed.
 *
 * ── The distinction the language erases ────────────────────────────────────
 * `Number(x) || 0` maps five materially different situations onto one output:
 *
 *   the row is missing entirely          -> 0
 *   the field name does not exist        -> 0     <- every defect above
 *   the field exists and is SQL NULL     -> 0
 *   the field is "" or " " or []         -> 0     <- Number("") === 0
 *   the field is a real, measured zero   -> 0     <- the only honest one
 *
 * Only the last is a fact about money. The other four are facts about the
 * program, and finance code needs to tell them apart. `numeric` columns come
 * back from pg as strings, so "0.00" is also a real zero and must parse.
 *
 * ── How to choose ──────────────────────────────────────────────────────────
 * The right reaction differs by path, so this module does not pick one:
 *
 *   requireNumber   throws. For invoice generation and anything that writes a
 *                   figure a customer will be asked to pay. A missing invoice
 *                   is a bad day; a wrong invoice is a lost account.
 *   readNumber      returns a verdict. For callers that want to decide.
 *   numberOrDash    renders "—". For dashboards and previews, where crashing
 *                   the page helps nobody but a silent zero is a lie.
 *   assertFields    checks a whole contract at once and names EVERY missing
 *                   field. The invoice renderer was wrong about five; finding
 *                   them one exception at a time would have taken five rounds.
 *
 * Pure: no DB, no clock, no I/O.
 */

export type FieldFault =
  /** The row itself was null, undefined, or not an object. */
  | 'row-missing'
  /** The key is not present on the row at all — a producer/consumer mismatch. */
  | 'field-absent'
  /** The key exists and is explicitly null — legitimately unknown. */
  | 'field-null'
  /** The key exists and holds something that is not a number: "", " ", [], {}. */
  | 'not-numeric';

export interface FieldRead {
  /** True only when a real number was found. */
  ok: boolean;
  /** The number, or null when it could not be read. Never a substituted zero. */
  value: number | null;
  fault: FieldFault | null;
  /** Fully qualified, e.g. "invoice_line_items.amount". */
  path: string;
  /** One sentence naming what was found instead. */
  detail: string;
}

/** Thrown by `requireNumber` and `assertFields`. Carries the paths. */
export class MissingFinanceFieldError extends Error {
  readonly reads: FieldRead[];
  constructor(message: string, reads: FieldRead[]) {
    super(message);
    this.name = 'MissingFinanceFieldError';
    this.reads = reads;
  }
}

/**
 * Collects faults instead of throwing, so a page can report "3 figures could
 * not be read" rather than printing three zeros. Pass one through a render and
 * check it at the end.
 */
export class FieldFaultCollector {
  readonly faults: FieldRead[] = [];
  record(read: FieldRead): FieldRead {
    if (!read.ok) this.faults.push(read);
    return read;
  }
  get ok(): boolean { return this.faults.length === 0; }
  /** Distinct paths that failed, in first-seen order. */
  get paths(): string[] {
    return [...new Set(this.faults.map(f => f.path))];
  }
  summary(): string {
    if (this.ok) return 'All fields read.';
    const byFault = new Map<FieldFault, number>();
    for (const f of this.faults) byFault.set(f.fault!, (byFault.get(f.fault!) ?? 0) + 1);
    const counts = [...byFault].map(([k, n]) => `${n} ${k}`).join(', ');
    return `${this.faults.length} unreadable field(s) across ${this.paths.length} path(s): ` +
           `${counts}. Paths: ${this.paths.join(', ')}.`;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === 'object') return `an object with keys [${Object.keys(v as object).join(', ')}]`;
  return `${typeof v} ${String(v)}`;
}

/**
 * Read one numeric field, reporting WHY when it cannot be read.
 *
 * `table` is the qualifier for the message — the table, view or DTO the row
 * came from. It is required rather than optional because the whole value of
 * this module is a message that names where to look, and an optional argument
 * would be omitted exactly when someone is in a hurry.
 */
export function readNumber(row: unknown, field: string, table: string): FieldRead {
  const path = `${table}.${field}`;
  const fail = (fault: FieldFault, detail: string): FieldRead =>
    ({ ok: false, value: null, fault, path, detail });

  if (row === null || row === undefined || typeof row !== 'object') {
    return fail('row-missing', `No row to read ${path} from — got ${describe(row)}.`);
  }

  const obj = row as Record<string, unknown>;

  // The defect class. `undefined` from a drizzle row means the key was never
  // written: a SQL NULL comes back as null, not undefined.
  if (!(field in obj) || obj[field] === undefined) {
    const keys = Object.keys(obj);
    const near = keys.filter(k => k.toLowerCase().includes(field.toLowerCase().slice(0, 4)));
    return fail('field-absent',
      `${path} does not exist on the row. Available: [${keys.join(', ')}]` +
      (near.length ? `. Did you mean ${near.join(' or ')}?` : '') + '.');
  }

  const raw = obj[field];

  if (raw === null) {
    return fail('field-null', `${path} is null — present, but no value recorded.`);
  }

  // Number("") and Number(" ") and Number([]) are all 0. Guard before coercing:
  // these are the coercions that manufacture money out of nothing.
  if (typeof raw === 'string' && raw.trim() === '') {
    return fail('not-numeric', `${path} is an empty string, which coerces to 0 but means nothing.`);
  }
  if (typeof raw === 'boolean' || Array.isArray(raw) || typeof raw === 'object') {
    return fail('not-numeric', `${path} holds ${describe(raw)}, not a number.`);
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fail('not-numeric', `${path} holds ${describe(raw)}, which is not a finite number.`);
  }

  return { ok: true, value: n, fault: null, path, detail: `${path} = ${n}` };
}

/**
 * Read a field or throw. For paths that produce a figure a customer pays.
 *
 * A missing invoice is recoverable in an afternoon. An invoice billing $0.00
 * for 362 calls, or $16.52 where the tariff says $0.28, is a commercial event.
 */
export function requireNumber(row: unknown, field: string, table: string): number {
  const read = readNumber(row, field, table);
  if (!read.ok) throw new MissingFinanceFieldError(read.detail, [read]);
  return read.value!;
}

/**
 * Every field of a contract at once, so one round names all the breakage.
 *
 * The invoice renderer read five fields that did not exist. Discovering that
 * one exception at a time is five deploys; this reports it once.
 */
export function checkFields(row: unknown, fields: readonly string[], table: string): FieldRead[] {
  return fields.map(f => readNumber(row, f, table));
}

/** `checkFields`, but throws a single error naming every failure. */
export function assertFields(row: unknown, fields: readonly string[], table: string): void {
  const bad = checkFields(row, fields, table).filter(r => !r.ok);
  if (!bad.length) return;
  throw new MissingFinanceFieldError(
    `${bad.length} of ${fields.length} required field(s) unreadable on ${table}: ` +
    bad.map(b => `${b.path} (${b.fault})`).join('; ') + '. ' + bad[0].detail,
    bad,
  );
}

export interface DisplayOptions {
  /** Decimal places. Default 2. */
  dp?: number;
  /** What to print when the value cannot be read. Default "—". */
  placeholder?: string;
  /** Records the fault so the caller can report it. */
  collector?: FieldFaultCollector;
  /** Called on any fault — wire to the logger on reporting paths. */
  onFault?: (read: FieldRead) => void;
}

/**
 * Format for display, printing a placeholder rather than a fabricated zero.
 *
 * The point is that an operator can SEE the difference. "0.00" and "—" occupy
 * the same column and mean opposite things: one is a measurement, the other is
 * the absence of one. Every defect in the header of this file would have been
 * visible on first render had the column shown a dash.
 */
export function numberOrDash(
  row: unknown, field: string, table: string, opts: DisplayOptions = {},
): string {
  const read = readNumber(row, field, table);
  opts.collector?.record(read);
  if (!read.ok) {
    opts.onFault?.(read);
    return opts.placeholder ?? '—';
  }
  return read.value!.toFixed(opts.dp ?? 2);
}

/**
 * Sum a field across rows, refusing to treat an unreadable row as zero.
 *
 * A total is where silent zeros do the most damage: they do not merely omit a
 * row, they assert that the row contributed nothing. `strict` (the default)
 * throws on the first unreadable row; pass false to sum what is readable and
 * report the rest through the collector.
 */
export function sumField(
  rows: readonly unknown[], field: string, table: string,
  opts: { strict?: boolean; collector?: FieldFaultCollector } = {},
): number {
  const strict = opts.strict ?? true;
  let total = 0;
  for (const row of rows) {
    const read = readNumber(row, field, table);
    opts.collector?.record(read);
    if (read.ok) { total += read.value!; continue; }
    if (strict) throw new MissingFinanceFieldError(read.detail, [read]);
  }
  return total;
}
