/**
 * Safely parse a query-string value to an integer.
 *
 * Returns `defaultVal` when the value is absent, empty, or non-numeric (NaN).
 * Optionally clamps the result to [min, max].
 *
 * Usage:
 *   parseQueryInt(req.query.limit, 100, { min: 1, max: 500 })
 *   parseQueryInt(req.query.offset, 0,   { min: 0 })
 */
export function parseQueryInt(
  value: unknown,
  defaultVal: number,
  opts?: { min?: number; max?: number },
): number {
  const n = parseInt(String(value ?? ''), 10);
  if (isNaN(n)) return defaultVal;
  if (opts?.min !== undefined && n < opts.min) return opts.min;
  if (opts?.max !== undefined && n > opts.max) return opts.max;
  return n;
}

/**
 * Safely parse a query-string value to a float.
 *
 * Returns `defaultVal` when the value is absent, empty, or non-numeric (NaN).
 * Optionally clamps the result to [min, max].
 */
export function parseQueryFloat(
  value: unknown,
  defaultVal: number,
  opts?: { min?: number; max?: number },
): number {
  const n = parseFloat(String(value ?? ''));
  if (isNaN(n)) return defaultVal;
  if (opts?.min !== undefined && n < opts.min) return opts.min;
  if (opts?.max !== undefined && n > opts.max) return opts.max;
  return n;
}
