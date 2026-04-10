/**
 * UTC date utilities — all display and input handling is UTC (GMT+00).
 * Never use date-fns format() or browser-local Date methods for display.
 */

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Format a Date in UTC using the given named pattern. */
export function formatUTC(d: Date | number | string, pattern: string): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';

  const Y  = String(dt.getUTCFullYear());
  const Mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const D2 = String(dt.getUTCDate()).padStart(2, '0');
  const D1 = String(dt.getUTCDate());
  const H  = String(dt.getUTCHours()).padStart(2, '0');
  const Mi = String(dt.getUTCMinutes()).padStart(2, '0');
  const S  = String(dt.getUTCSeconds()).padStart(2, '0');
  const Mon = MONTHS_SHORT[dt.getUTCMonth()];

  return pattern
    .replace("yyyy-MM-dd'T'HH:mm",      `${Y}-${Mo}-${D2}T${H}:${Mi}`)
    .replace('yyyyMMdd_HHmmss',          `${Y}${Mo}${D2}_${H}${Mi}${S}`)
    .replace('yyyyMMdd_HHmm',            `${Y}${Mo}${D2}_${H}${Mi}`)
    .replace('dd MMM yyyy HH:mm:ss',     `${D2} ${Mon} ${Y} ${H}:${Mi}:${S}`)
    .replace('dd MMM yyyy HH:mm',        `${D2} ${Mon} ${Y} ${H}:${Mi}`)
    .replace('MMM d, yyyy HH:mm:ss',     `${Mon} ${D1}, ${Y} ${H}:${Mi}:${S}`)
    .replace('MMM d, yyyy HH:mm',        `${Mon} ${D1}, ${Y} ${H}:${Mi}`)
    .replace('d MMM HH:mm:ss',           `${D1} ${Mon} ${H}:${Mi}:${S}`)
    .replace('d MMM HH:mm',              `${D1} ${Mon} ${H}:${Mi}`)
    .replace('MMM d, HH:mm:ss',          `${Mon} ${D1}, ${H}:${Mi}:${S}`)
    .replace('MMM d, HH:mm',             `${Mon} ${D1}, ${H}:${Mi}`)
    .replace('HH:mm:ss',                 `${H}:${Mi}:${S}`)
    .replace('HH:mm',                    `${H}:${Mi}`)
    .replace('mm:ss',                    `${Mi}:${S}`);
}

/**
 * Convert a Date to a "datetime-local" input string in UTC.
 * e.g. 2026-04-10T14:30
 */
export function toUTCDateInput(d: Date): string {
  return d.toISOString().slice(0, 16);
}

/**
 * Convert a datetime-local input value (treated as UTC) to a Sippy date string.
 * Sippy format: "MM/DD/YYYY HH:MM:SS"
 * The input string like "2026-04-10T14:30" is interpreted as UTC.
 */
export function toSippyDateUTC(localDt: string): string {
  if (!localDt) return '';
  const d = new Date(localDt.length === 16 ? localDt + ':00Z' : localDt + 'Z');
  if (isNaN(d.getTime())) return localDt;
  const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd  = String(d.getUTCDate()).padStart(2, '0');
  const yy  = d.getUTCFullYear();
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:${min}:00`;
}

/** Get start of day in UTC (00:00:00.000 UTC) */
export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Get end of day in UTC (23:59:59.999 UTC) */
export function endOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Get start of week (Monday) in UTC */
export function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun, 1=Mon
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday;
}

/** Get end of week (Sunday) in UTC */
export function endOfWeekUTC(d: Date): Date {
  const start = startOfWeekUTC(d);
  return new Date(start.getTime() + 6 * 86400000 + 86399999);
}

/** Get start of month in UTC */
export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Get end of month in UTC */
export function endOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

/** Subtract N minutes from a date */
export function subMinutesUTC(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 60000);
}

/** Subtract N hours from a date */
export function subHoursUTC(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 3600000);
}

/** Subtract N days (UTC day boundary) from a date */
export function subDaysUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** Subtract N weeks from a date */
export function subWeeksUTC(d: Date, n: number): Date {
  return subDaysUTC(d, n * 7);
}

/** Subtract N months from a date */
export function subMonthsUTC(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, d.getUTCDate()));
}
