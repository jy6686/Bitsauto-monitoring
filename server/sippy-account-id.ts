/**
 * sippy-account-id.ts — recovering the account id the scraper throws away.
 *
 * Owner rule, 2026-08-31: **the Sippy account id is the canonical financial
 * identity. Display names are for the UI and are never used to reconcile
 * money.**
 *
 * The evidence for it is already in production: `Internal-ptcl` is account 76
 * and `internal-ptcl` is account 588 — different customers whose names differ
 * only in case. Matching them by name merges two customers' money into one
 * line and reports the merge as agreement. Names also change; account ids do
 * not.
 *
 * `SippyAccountStatRow` carried only a name, so the reference could not be
 * keyed by id. But the id was never missing from the SOURCE — the portal
 * renders each account as a link, and `scrapeAsrAcdRows` strips every tag from
 * the cell before reading it:
 *
 *     const cellText = td[1].replace(/<[^>]+>/g, '')…
 *
 * The href is deleted one line before the name is kept. This module reads it
 * first.
 *
 * Several href shapes are accepted because the portal's own URLs are not
 * consistent across pages (the Customer Summary uses one form, account views
 * another). What is NOT done is guessing: an unrecognised cell returns null,
 * and a row without an id is reported as unidentified rather than matched on
 * its name. A financial control that cannot name the party must say so.
 *
 * Dependency-free so the patterns are pinned by tests.
 */

/**
 * Patterns, most specific first. Each must capture the id in group 1.
 *
 * Deliberately anchored on the parameter or path segment rather than "any
 * number in the href" — a bare-number match would happily return a page
 * number, a timestamp, or a currency id and look completely plausible.
 */
const PATTERNS: RegExp[] = [
  // THE REAL ONE, measured from production 2026-08-31:
  //   <a href="accounts.php?action=edit&account=588">Acct. internal-ptcl</a>
  // The parameter is `account`, not `i_account` — which is exactly why the four
  // patterns guessed below it returned 0% coverage. Measured beats reasoned.
  /[?&]account=(\d+)/i,
  /[?&]i_account=(\d+)/i,          // …/account_info.php?i_account=315
  /[?&]i_customer=(\d+)/i,         // …/customer_info.php?i_customer=42
  /[?&]account_id=(\d+)/i,
  /\/accounts?\/(\d+)(?!\d)/i,     // …/accounts/315 — terminator may be a quote
];

/**
 * A VENDOR row's identity is a PAIR, not a single id. Production markup:
 *
 *   <a href="vendors.php?action=edit&i_vendor=13">asterisk(in)</a>/
 *   <a href="connections.php?i_connection=10&action=edit&i_vendor=13">asterisk(PTCL)(2060)</a>
 *
 * One vendor carries many connections and the money is per connection, so
 * `i_vendor` alone would merge them — the same defect as matching customers by
 * name, one level down. Both halves or neither.
 */
export function extractVendorIdentity(cellHtml: string | null | undefined): {
  iVendor: number | null; iConnection: number | null;
} {
  const num = (re: RegExp) => {
    const m = re.exec(cellHtml ?? '');
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  return {
    iVendor:     num(/[?&]i_vendor=(\d+)/i),
    iConnection: num(/[?&]i_connection=(\d+)/i),
  };
}

/**
 * Pull the account id out of a table cell's RAW HTML — call before tags are
 * stripped. Returns null when no recognised identifier is present.
 */
export function extractAccountId(cellHtml: string | null | undefined): number | null {
  if (!cellHtml) return null;
  for (const re of PATTERNS) {
    const m = re.exec(cellHtml);
    if (m) {
      const n = Number(m[1]);
      // 0 is not an account. A parsed zero means the pattern matched something
      // that was not an id, and returning it would key a customer to nothing.
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * True when a set of scraped rows can be reconciled at all.
 *
 * Reported rather than assumed: if the portal markup changes and the ids stop
 * arriving, certification must announce that its identity source has gone —
 * not quietly fall back to names and carry on producing verdicts that look
 * exactly like the correct ones.
 */
export function identityCoverage(
  rows: Array<{ iAccount?: number | null; iVendor?: number | null; iConnection?: number | null }>,
): { total: number; identified: number; pct: number; complete: boolean } {
  const total = rows.length;
  // A row is identified by an ACCOUNT id (client side) or by a complete
  // VENDOR+CONNECTION pair (vendor side). Half a pair is not an identity.
  const identified = rows.filter(r =>
    (typeof r.iAccount === 'number' && r.iAccount > 0) ||
    (typeof r.iVendor === 'number' && r.iVendor > 0 &&
     typeof r.iConnection === 'number' && r.iConnection > 0),
  ).length;
  return {
    total, identified,
    pct: total === 0 ? 100 : Math.round((identified / total) * 1000) / 10,
    complete: total > 0 && identified === total,
  };
}
