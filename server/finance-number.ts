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
  /** The key holds an array, object or boolean — a number was never there. */
  | 'wrong-type'
  /** The key holds a scalar that will not parse: "", " ", "abc", NaN. */
  | 'not-numeric';

/** Who fixes a fault of this kind, and whether it should wake anyone. */
export type FaultOwner = 'engineering' | 'finance' | 'none';

/**
 * How bad, independent of who fixes it and whether it pages.
 *
 * `alert` is a boolean and answers "raise or stay quiet". Severity is the
 * ordering, so a health page can rank Critical → High → Medium → Info instead
 * of showing one undifferentiated alerting bucket. The two are related but not
 * the same axis: everything except `field-null` alerts, yet those four are not
 * equally urgent.
 */
export type FaultSeverity = 'critical' | 'high' | 'medium' | 'info';

/** Sort order. Higher is worse. */
export const SEVERITY_RANK: Record<FaultSeverity, number> =
  { critical: 3, high: 2, medium: 1, info: 0 };

export interface FaultPolicy {
  owner: FaultOwner;
  /**
   * Whether a health check should raise on this. False for `field-null`,
   * which is a legitimate data state — a nullable column being null is not an
   * incident, and alerting on it is how a finance alert becomes background
   * noise that nobody reads when a real one arrives.
   */
  alert: boolean;
  severity: FaultSeverity;
  meaning: string;
}

/**
 * The operational meaning of each fault, in one place.
 *
 * The four kinds are genuinely different severities and a single "N faults"
 * number conflates them. This table is what lets a health endpoint alert on
 * the code defects and stay quiet about the data states, without every caller
 * reinventing that judgement.
 */
export const FAULT_POLICY: Record<FieldFault, FaultPolicy> = {
  'row-missing': {
    owner: 'engineering', alert: true, severity: 'critical',
    meaning: 'A query returned nothing where a row was required. Code or query defect. ' +
             'Critical because every field on that row is unreadable, not just one.',
  },
  'field-absent': {
    owner: 'engineering', alert: true, severity: 'critical',
    meaning: 'Producer and consumer disagree about the column name. Schema mismatch. ' +
             'Critical because it is silent, total and affects every row alike — all four ' +
             'production defects this module was built for were this.',
  },
  'field-null': {
    owner: 'none', alert: false, severity: 'info',
    meaning: 'A nullable column is null. Legitimate data state; usually no action.',
  },
  'wrong-type': {
    owner: 'engineering', alert: true, severity: 'high',
    meaning: 'An array, object or boolean where a number belongs. Bad payload shape. ' +
             'High rather than critical: the field exists and is being written, so the ' +
             'contract holds and the defect is narrower than a name mismatch.',
  },
  'not-numeric': {
    owner: 'finance', alert: true, severity: 'medium',
    meaning: 'A value that should be numeric will not parse. Data quality; needs Finance ' +
             'to say what the figure should be, and Engineering to find how it got there. ' +
             'Medium because the field exists, holds the right type family, and the fault ' +
             'is usually confined to particular rows rather than the whole read.',
  },
};

/**
 * The verdict of one read — a structured diagnostic, not a message.
 *
 * Every fact a consumer might want is its own field. An API response, a UI
 * banner, a log line and an automated contract check all read the SAME object;
 * none of them parses `detail`, which exists only for humans. The first
 * version of this interface put the row's available keys inside `detail`,
 * which quietly recreated the problem the module was written to solve.
 *
 * JSON-safe throughout: no Errors, no undefined, no cycles.
 */
export interface FieldRead {
  /** True only when a real number was found. */
  ok: boolean;
  /** The number, or null when it could not be read. Never a substituted zero. */
  value: number | null;
  fault: FieldFault | null;
  /** The field name alone, for grouping and equality checks. */
  field: string;
  /** The table, view or DTO alone. */
  table: string;
  /** Fully qualified, e.g. "invoice_line_items.amount". For messages. */
  path: string;
  /**
   * The keys the row actually has. Populated on `field-absent`, which is the
   * fault where it is diagnostic; empty otherwise, so a 362-row loop does not
   * carry the same column list 362 times.
   */
  availableFields: string[];
  /** Near-misses from `availableFields`. Structured, not embedded in prose. */
  suggestions: string[];
  /** What was found instead. null on success and on `field-absent`. */
  received: { type: string; preview: string } | null;
  /** One sentence for a human. Never parse this. */
  detail: string;
}

/**
 * Thrown by `requireNumber` and `assertFields`.
 *
 * Carries the structured reads, so a catch block never has to parse
 * `e.message` to find out which field was wrong. `toJSON()` puts the same
 * shape into an API response as the collector produces, so a caller that
 * catches and a caller that collects report identically.
 */
export class MissingFinanceFieldError extends Error {
  readonly reads: FieldRead[];
  constructor(message: string, reads: FieldRead[]) {
    super(message);
    this.name = 'MissingFinanceFieldError';
    this.reads = reads;
  }
  toJSON(): FaultReport {
    return reportFaults(this.reads);
  }
}

/** One unreadable path, with its occurrence count and diagnostics. */
export interface FaultGroup {
  path: string;
  table: string;
  field: string;
  fault: FieldFault;
  occurrences: number;
  /** From FAULT_POLICY — carried on the group so a dashboard can route it. */
  owner: FaultOwner;
  /** Whether this group should raise. False only for `field-null`. */
  alert: boolean;
  /** From FAULT_POLICY — lets a page rank rather than only filter. */
  severity: FaultSeverity;
  availableFields: string[];
  suggestions: string[];
  /** One example of what was found. null when the field was simply absent. */
  received: { type: string; preview: string } | null;
  detail: string;
}

/** What an API response, a UI banner, a log line or a health check consumes. */
export interface FaultReport {
  /** True when nothing failed at all, including non-alerting faults. */
  ok: boolean;
  faultCount: number;
  /** Grouped by path so 362 identical faults are one row carrying a count. */
  groups: FaultGroup[];
  /** Counts by fault kind. */
  byFault: Record<string, number>;
  /** Counts by who fixes it, for routing rather than triage. */
  byOwner: Record<FaultOwner, number>;
  /** Counts by severity, for a health page that ranks rather than filters. */
  bySeverity: Record<FaultSeverity, number>;
  /** The worst severity present, or null when nothing failed. The top line. */
  worstSeverity: FaultSeverity | null;
  /**
   * Faults that should raise an alert — everything except `field-null`.
   *
   * THIS is the number a health check reads, not `faultCount`. A nullable
   * column being null is not an incident, and a monitor that pages on it
   * trains people to ignore the channel.
   */
  alertable: number;
  /** True when nothing alertable happened. May be true while `ok` is false. */
  quiet: boolean;
  summary: string;
}

/**
 * Group failed reads into a report.
 *
 * Grouped deliberately: the invoice renderer produced 362 identical faults,
 * and a consumer wants "invoice_line_items.amount is absent, 362 times" rather
 * than 362 copies of the same column list.
 */
export function reportFaults(reads: readonly FieldRead[]): FaultReport {
  const bad = reads.filter(r => !r.ok);
  const groups = new Map<string, FaultGroup>();
  const byFault: Record<string, number> = {};
  const byOwner: Record<FaultOwner, number> = { engineering: 0, finance: 0, none: 0 };
  const bySeverity: Record<FaultSeverity, number> = { critical: 0, high: 0, medium: 0, info: 0 };
  let alertable = 0;

  for (const r of bad) {
    const policy = FAULT_POLICY[r.fault!];
    byFault[r.fault!] = (byFault[r.fault!] ?? 0) + 1;
    byOwner[policy.owner]++;
    bySeverity[policy.severity]++;
    if (policy.alert) alertable++;

    const key = `${r.path}|${r.fault}`;
    const existing = groups.get(key);
    if (existing) { existing.occurrences++; continue; }
    groups.set(key, {
      path: r.path, table: r.table, field: r.field, fault: r.fault!,
      occurrences: 1,
      owner: policy.owner,
      alert: policy.alert,
      severity: policy.severity,
      availableFields: r.availableFields,
      suggestions: r.suggestions,
      received: r.received,
      detail: r.detail,
    });
  }

  // Severity first, then volume. This subsumes the older alertable-first sort
  // — field-null is the only non-alerting kind and also the only `info` — and
  // orders the alerting kinds among themselves, which alert alone could not.
  // One missing column still outranks a thousand legitimate nulls.
  const list = [...groups.values()].sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.occurrences - a.occurrences);

  const worstSeverity = list.length ? list[0].severity : null;

  return {
    ok: bad.length === 0,
    faultCount: bad.length,
    groups: list,
    byFault, byOwner, bySeverity, worstSeverity, alertable,
    quiet: alertable === 0,
    summary: bad.length === 0
      ? 'All fields read.'
      : `${bad.length} unreadable field(s) across ${list.length} path(s)` +
        (alertable === 0
          ? ' — all of them legitimate null data states, none alertable'
          : `, ${alertable} alertable, worst ${worstSeverity}`) + ': ' +
        Object.entries(byFault).map(([k, n]) => `${n} ${k}`).join(', ') +
        `. Paths: ${list.map(g => g.path).join(', ')}.`,
  };
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
  /**
   * The structured report. This is what belongs in an API response — a banner
   * built from `summary()` alone forces the next consumer to parse English.
   */
  report(): FaultReport { return reportFaults(this.faults); }
  toJSON(): FaultReport { return this.report(); }
  summary(): string { return this.report().summary; }
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
  const base = { field, table, path, availableFields: [] as string[], suggestions: [] as string[] };

  const fail = (
    fault: FieldFault, detail: string,
    extra: Partial<FieldRead> = {},
  ): FieldRead => ({ ok: false, value: null, fault, ...base, received: null, detail, ...extra });

  if (row === null || row === undefined || typeof row !== 'object') {
    return fail('row-missing', `No row to read ${path} from — got ${describe(row)}.`,
      { received: typed(row) });
  }

  const obj = row as Record<string, unknown>;

  // The defect class. `undefined` from a drizzle row means the key was never
  // written: a SQL NULL comes back as null, not undefined.
  if (!(field in obj) || obj[field] === undefined) {
    const keys = Object.keys(obj);
    const near = nearMisses(field, keys);
    return fail('field-absent',
      `${path} does not exist on the row. Available: [${keys.join(', ')}]` +
      (near.length ? `. Did you mean ${near.join(' or ')}?` : '') + '.',
      { availableFields: keys, suggestions: near });
  }

  const raw = obj[field];

  if (raw === null) {
    return fail('field-null', `${path} is null — present, but no value recorded.`,
      { received: { type: 'null', preview: 'null' } });
  }

  // Number("") and Number(" ") and Number([]) are all 0. Guard before coercing:
  // these are the coercions that manufacture money out of nothing.
  if (typeof raw === 'string' && raw.trim() === '') {
    return fail('not-numeric', `${path} is an empty string, which coerces to 0 but means nothing.`,
      { received: typed(raw) });
  }
  // Structurally wrong, as distinct from unparseable. An array where a number
  // belongs is a payload defect and belongs to Engineering; the string "abc"
  // in a cost column is a data-quality question and needs Finance to say what
  // the figure should have been. Same silent zero, different people.
  if (typeof raw === 'boolean' || Array.isArray(raw) || typeof raw === 'object') {
    return fail('wrong-type', `${path} holds ${describe(raw)}, not a number.`,
      { received: typed(raw) });
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fail('not-numeric', `${path} holds ${describe(raw)}, which is not a finite number.`,
      { received: typed(raw) });
  }

  return { ok: true, value: n, fault: null, ...base, received: null, detail: `${path} = ${n}` };
}

/**
 * Candidate names, best first.
 *
 * Ranked by shared leading characters rather than filtered by a fixed stem: a
 * blunt four-character stem offers `totalBuy` for `totalSales`, which is
 * true and useless. Ordering by agreement puts `totalSell` first, so
 * `suggestions[0]` is worth reading. Four characters remains the floor — below
 * that the "match" is coincidence.
 */
function nearMisses(field: string, keys: readonly string[]): string[] {
  const f = field.toLowerCase();
  const scored = keys
    .map(k => ({ k, n: sharedPrefix(f, k.toLowerCase()) }))
    .filter(x => x.n >= 4)
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  return scored.map(x => x.k);
}

function sharedPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/** A JSON-safe description of what was found, for structured consumers. */
function typed(v: unknown): { type: string; preview: string } {
  const type =
    v === null ? 'null' :
    Array.isArray(v) ? 'array' :
    typeof v;
  let preview: string;
  try {
    preview = typeof v === 'string' ? JSON.stringify(v) : String(v);
  } catch { preview = '(unprintable)'; }
  return { type, preview: preview.length > 120 ? preview.slice(0, 117) + '...' : preview };
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
