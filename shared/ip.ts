/**
 * ip.ts — one IPv4 validator, shared by the wizard, the create-company endpoint and the
 * Add IP endpoint.
 *
 * WHY SHARED. There were three copies of this regex: one in company-create.tsx, one in
 * POST /api/client-ip-requests, and none at all in POST /api/companies — which is how
 * 1.2.3.09 reached the database through the wizard's own submit path and only failed
 * twelve authentication rules later, as "Parameter remote_ip has incorrect format". Three
 * copies of a rule is three chances for them to disagree; the missing fourth is worse.
 *
 * WHY LEADING ZEROS ARE REJECTED. 1.2.3.09 passes a naive octet check. Historically a
 * leading zero means octal, so 1.2.3.010 is 1.2.3.8 to one parser and 1.2.3.10 to another.
 * Strict parsers refuse the whole form rather than choose, and Sippy is one of them. We
 * refuse it too, and say what to write instead — the correction is always unambiguous.
 *
 * ONE PROBLEM PER ADDRESS, named. "Invalid IP address" sends an operator back to the field
 * to guess; "octets must be 0-255" does not.
 */

export type IpProblem =
  | 'empty'
  | 'non-numeric'
  | 'octet-count'
  | 'leading-zero'
  | 'octet-range'
  | 'cidr';

export interface IpCheck {
  ok: boolean;
  /** The input, trimmed. Echoed back so callers can name the offending value. */
  value: string;
  /** What is wrong, for callers that want to branch rather than print. */
  problem?: IpProblem;
  /** Operator-facing sentence. Ends with a full stop; safe to render as-is. */
  message?: string;
  /** For 'leading-zero' only: the same address written correctly. */
  suggestion?: string;
}

/**
 * Split a free-text field into candidate addresses. Newline, comma or semicolon — an
 * operator pasting an interconnect form should not have to reformat it first.
 */
export function parseIpList(raw: string): string[] {
  return String(raw ?? '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
}

/** Validate one address, optionally with a /nn suffix. */
export function checkIpv4(raw: string): IpCheck {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, value, problem: 'empty', message: 'An IP address is required.' };

  const slash = value.indexOf('/');
  const addr  = slash === -1 ? value : value.slice(0, slash);
  const mask  = slash === -1 ? null  : value.slice(slash + 1);

  if (mask !== null && !(/^\d{1,2}$/.test(mask) && Number(mask) <= 32)) {
    return { ok: false, value, problem: 'cidr', message: 'The prefix length after "/" must be a number from 0 to 32.' };
  }

  const octets = addr.split('.');
  if (octets.some(o => !/^\d+$/.test(o))) {
    return { ok: false, value, problem: 'non-numeric', message: 'Only numeric IPv4 addresses are allowed — letters and symbols are not.' };
  }
  if (octets.length !== 4) {
    return { ok: false, value, problem: 'octet-count', message: `An IPv4 address must have exactly four octets — this has ${octets.length}.` };
  }
  // Checked before range, deliberately: 1.2.3.09 is in range and still wrong, and the
  // leading-zero message is the one that tells the operator what to type.
  if (octets.some(o => /^0\d/.test(o))) {
    const suggestion = octets.map(o => String(Number(o))).join('.') + (mask !== null ? `/${mask}` : '');
    return { ok: false, value, problem: 'leading-zero', suggestion,
             message: `Leading zeros are not allowed. Write ${suggestion} instead.` };
  }
  if (octets.some(o => Number(o) > 255)) {
    return { ok: false, value, problem: 'octet-range', message: 'Each octet must be between 0 and 255.' };
  }
  return { ok: true, value };
}

/**
 * Validate a whole field. Returns only the addresses that are wrong, each with its
 * 1-based position, so the caller can point at line 2 rather than condemn the field.
 */
export function checkIpList(raw: string | string[]): { ips: string[]; invalid: (IpCheck & { line: number })[] } {
  const ips = Array.isArray(raw)
    ? raw.map(v => String(v ?? '').trim()).filter(Boolean)
    : parseIpList(raw);
  const invalid = ips
    .map((ip, i) => ({ ...checkIpv4(ip), line: i + 1 }))
    .filter(c => !c.ok);
  return { ips, invalid };
}
