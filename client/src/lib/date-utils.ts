/**
 * Date utilities — UTC baseline with optional timezone-aware variants.
 * formatInTz / toTzDateInput / tzDateToUTC / toSippyDateTz are TZ-aware.
 * All UTC functions remain unchanged for backwards compatibility.
 */

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Timezone-aware helpers ────────────────────────────────────────────────────

/**
 * Format a Date in a given IANA timezone using named patterns.
 * Falls back to formatUTC when tz === 'UTC'.
 */
export function formatInTz(d: Date | number | string, pattern: string, tz: string): string {
  if (!tz || tz === 'UTC') return formatUTC(d, pattern);
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(dt);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';

  const Y   = get('year');
  const Mo  = get('month');
  const D2  = get('day');
  const D1  = String(parseInt(D2, 10));
  const H   = get('hour') === '24' ? '00' : get('hour');
  const Mi  = get('minute');
  const S   = get('second');
  const Mon = MONTHS_SHORT[parseInt(Mo, 10) - 1] ?? '';

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
 * Convert a UTC Date to a "datetime-local" input string expressed in the given timezone.
 * e.g. a UTC Date for 13:00 UTC with tz="America/New_York" → "2026-04-15T09:00"
 */
export function toTzDateInput(d: Date, tz: string): string {
  if (!tz || tz === 'UTC') return toUTCDateInput(d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  const H = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${H}:${get('minute')}`;
}

/**
 * Interpret a "datetime-local" input string as being in the given timezone and return
 * the corresponding UTC Date.
 * e.g. "2026-04-15T09:00" in "America/New_York" → Date for 13:00 UTC (UTC-4 in April)
 */
export function tzDateToUTC(localDtStr: string, tz: string): Date {
  if (!tz || tz === 'UTC') {
    return new Date(localDtStr.length === 16 ? localDtStr + ':00Z' : localDtStr + 'Z');
  }
  // "toLocaleString offset" trick: find the UTC time whose TZ representation equals localDtStr
  const asIfUTC = new Date(localDtStr.length === 16 ? localDtStr + ':00Z' : localDtStr + 'Z');
  const tzStr  = asIfUTC.toLocaleString('en-US', { timeZone: tz });
  const tzDate = new Date(tzStr);
  const offset = asIfUTC.getTime() - tzDate.getTime();
  return new Date(asIfUTC.getTime() + offset);
}

/**
 * Convert a "datetime-local" input (interpreted in the given timezone) to Sippy's
 * date format "MM/DD/YYYY HH:MM:SS" (which Sippy always treats as UTC).
 */
export function toSippyDateTz(localDt: string, tz: string): string {
  if (!localDt) return '';
  if (!tz || tz === 'UTC') return toSippyDateUTC(localDt);
  const utc = tzDateToUTC(localDt, tz);
  if (isNaN(utc.getTime())) return localDt;
  const mm  = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd  = String(utc.getUTCDate()).padStart(2, '0');
  const yy  = utc.getUTCFullYear();
  const hh  = String(utc.getUTCHours()).padStart(2, '0');
  const min = String(utc.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:${min}:00`;
}

// ── UTC helpers (unchanged) ──────────────────────────────────────────────────

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
