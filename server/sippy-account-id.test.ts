import { describe, it, expect } from 'vitest';
import { extractAccountId, identityCoverage } from './sippy-account-id';

describe('extractAccountId — the id the scraper was deleting', () => {
  it('reads i_account from an account link', () => {
    expect(extractAccountId('<a href="/c1/account_info.php?i_account=315">Acct. asterisk</a>')).toBe(315);
  });

  it('reads it from a link with other parameters around it', () => {
    expect(extractAccountId(
      '<a href="/c1/customer_reports.php?startDate=24-08-2026&i_account=588&caller=0_0">internal-ptcl</a>',
    )).toBe(588);
  });

  it('reads i_customer and account_id forms', () => {
    expect(extractAccountId('<a href="customer_info.php?i_customer=42">X</a>')).toBe(42);
    expect(extractAccountId('<a href="/x?account_id=7">X</a>')).toBe(7);
  });

  it('reads a path-segment form', () => {
    expect(extractAccountId('<a href="/accounts/315">X</a>')).toBe(315);
    expect(extractAccountId('<a href="/account/77/detail">X</a>')).toBe(77);
  });

  it('distinguishes the two accounts that collide by name', () => {
    // The exact production hazard: same name, different case, different money.
    const a = extractAccountId('<a href="?i_account=76">Internal-ptcl</a>');
    const b = extractAccountId('<a href="?i_account=588">internal-ptcl</a>');
    expect(a).toBe(76);
    expect(b).toBe(588);
    expect(a).not.toBe(b);
  });
});

describe('it refuses to guess', () => {
  /**
   * A "any number in the href" pattern would match a page number, a date or a
   * currency id and look entirely plausible. Nothing is worse in a financial
   * identity than a wrong id that parses cleanly.
   */
  it('returns null for a link with no account identifier', () => {
    expect(extractAccountId('<a href="/c1/report.php?page=2&sort=3">Acct. asterisk</a>')).toBeNull();
    expect(extractAccountId('<a href="/c1/summary.php?year=2026">X</a>')).toBeNull();
  });

  it('returns null for a plain-text cell', () => {
    expect(extractAccountId('Acct. asterisk')).toBeNull();
    expect(extractAccountId('')).toBeNull();
    expect(extractAccountId(null)).toBeNull();
    expect(extractAccountId(undefined)).toBeNull();
  });

  /** Account 0 is not an account — a parsed zero means the pattern misfired. */
  it('rejects a zero id', () => {
    expect(extractAccountId('<a href="?i_account=0">X</a>')).toBeNull();
  });

  /**
   * The parameter patterns are anchored on `?` or `&`, so a parameter that
   * merely CONTAINS the substring does not match. Worth a test: a looser
   * pattern would bind a customer to a number lifted out of an unrelated
   * field, and a wrong id that parses cleanly is the worst possible outcome
   * for a financial identity.
   */
  it('is not fooled by a parameter that merely contains the name', () => {
    expect(extractAccountId('<a href="?not_i_account_really=5">X</a>')).toBeNull();
    expect(extractAccountId('<a href="?xi_account=5">X</a>')).toBeNull();
  });
});

describe('identityCoverage — announce when the identity source disappears', () => {
  /**
   * If the portal markup changes and ids stop arriving, certification must SAY
   * its identity source is gone — not fall back to names and keep producing
   * verdicts that look exactly like the correct ones.
   */
  it('reports full coverage', () => {
    const c = identityCoverage([{ iAccount: 315 }, { iAccount: 588 }]);
    expect(c).toEqual({ total: 2, identified: 2, pct: 100, complete: true });
  });

  it('reports partial coverage as incomplete', () => {
    const c = identityCoverage([{ iAccount: 315 }, { iAccount: null }, {}]);
    expect(c.identified).toBe(1);
    expect(c.pct).toBe(33.3);
    expect(c.complete).toBe(false);
  });

  it('treats zero and negative ids as unidentified', () => {
    expect(identityCoverage([{ iAccount: 0 }, { iAccount: -1 }]).identified).toBe(0);
  });

  it('does not call an empty set incomplete', () => {
    // Nothing to identify is not an identity failure.
    expect(identityCoverage([])).toEqual({ total: 0, identified: 0, pct: 100, complete: false });
  });
});
