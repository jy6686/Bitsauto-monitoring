/**
 * billing-readiness.ts — which customers would be silently skipped tonight?
 *
 * THE FAILURE THIS EXISTS TO PREVENT, in one sentence: on 2026-08-31 invoice
 * C-2608-0009 billed asterisk and nobody else, and finding out why took a day
 * of tracing. The customers that were missing produced no error, no warning
 * and no row — they were simply absent, and absence is invisible to every
 * check that walks what it HAS.
 *
 * That is still true today, one layer along. Collection was decoupled from
 * invoice_schedules, so all 25 accounts now collect — but INVOICING still
 * starts only from an invoice_schedules row, and production holds two of
 * those, keyed to tariffs 2 and 7. asterisk is tariff 32. internal-ptcl and
 * internal-eritrea are absent entirely. So the three accounts that carry the
 * revenue have nothing that would ever start an invoice for them, and nothing
 * anywhere says so.
 *
 * DERIVED FROM THE COMPANY MASTER, NOT FROM A PARALLEL TABLE. Owner
 * requirement 2026-09-02, and it is the right call at 500 customers:
 * `companies.client_billing_cycle` already exists and is populated by the
 * wizard — the register records it as "UI-only", meaning nothing has ever
 * scheduled from it. A second table that must be kept in step with the
 * customer master is a table that WILL fall out of step, and every customer it
 * silently omits is unbilled revenue nobody is looking for.
 *
 * This module reports. It schedules nothing and writes nothing — the point is
 * to make the gap visible before the nightly run, not to fill it silently.
 *
 * Dependency-free; the period arithmetic is delegated to billing-periods.ts,
 * which already implements the Monday–Sunday week, the 1st-to-last-day month,
 * and the month-end split that outranks both.
 */
import { normalizeTerm, latestClosedPeriods, type BillingPeriod, type BillingTerm } from './billing-periods';

/** The company master fields billing depends on. */
export interface BillableCompany {
  id:            number;
  name:          string;
  /** Sippy account id — the canonical financial identity. */
  iAccount:      number | null;
  /** Local mirror of the tariff. Needed to RATE, not to collect. */
  iTariff:       string | null;
  /** companies.client_billing_cycle. */
  billingCycle:  string | null;
  /** Where an invoice would be sent. */
  invoiceEmail:  string | null;
  /** Whether the repository holds any traffic for this account in the window
   *  being judged. A customer with no account AND no traffic is dormant, not
   *  broken — and reporting the two identically is how a real gap gets lost
   *  in a list of test rows. */
  hasTraffic:    boolean;
}

export type ReadinessStatus =
  /** Everything needed to invoice is present. */
  | 'ready'
  /** Would be billable but cannot be — the list that matters. */
  | 'blocked'
  /** No account and no traffic. Test rows, prospects, closed customers. */
  | 'dormant';

export interface CompanyReadiness {
  id:       number;
  name:     string;
  status:   ReadinessStatus;
  term:     BillingTerm | null;
  /** Periods that have CLOSED and would be invoiced tonight. */
  duePeriods: BillingPeriod[];
  /** Every missing prerequisite, not just the first. An operator fixing one
   *  field at a time across 500 customers needs the whole list per customer. */
  blockers: string[];
  hasTraffic: boolean;
}

export interface ReadinessReport {
  asOf: string;
  companies: CompanyReadiness[];
  /** Blocked AND carrying traffic — unbilled revenue, worst case first. */
  urgent:  CompanyReadiness[];
  dueToday: CompanyReadiness[];
  summary: {
    total: number; ready: number; blocked: number; dormant: number;
    dueToday: number;
    /** Blocked customers that have traffic. Zero is the only acceptable value. */
    blockedWithTraffic: number;
    byTerm: Record<string, number>;
  };
}

/**
 * @param asOf YYYY-MM-DD, the day the nightly run executes. Periods ending
 *             before it are closed and therefore due.
 */
export function assessBillingReadiness(opts: {
  companies: BillableCompany[];
  asOf:      string;
}): ReadinessReport {
  const companies: CompanyReadiness[] = opts.companies.map(c => {
    const blockers: string[] = [];

    // Order matters: the FIRST blocker is the one to fix first, and an
    // account id is prerequisite to everything else.
    if (c.iAccount == null) {
      blockers.push('No Sippy account linked — nothing can be collected or invoiced.');
    }
    if (!c.billingCycle || !String(c.billingCycle).trim()) {
      blockers.push('No billing cycle set — the nightly run cannot know when this customer is due.');
    }
    if (!c.iTariff || !String(c.iTariff).trim()) {
      blockers.push('No local tariff mirror — calls collect but cannot be rated, certified or invoiced.');
    }
    if (!c.invoiceEmail || !String(c.invoiceEmail).trim()) {
      blockers.push('No billing email — an invoice could be generated but never delivered.');
    }

    // Dormant is NOT the same as blocked. A test row with no account and no
    // traffic is not a problem to solve; listing it beside a live customer
    // that is missing a tariff buries the one that costs money.
    const dormant = c.iAccount == null && !c.hasTraffic;
    const status: ReadinessStatus =
      dormant ? 'dormant' : blockers.length > 0 ? 'blocked' : 'ready';

    const term = c.billingCycle ? normalizeTerm(c.billingCycle) : null;
    // Only a customer that could actually be invoiced has due periods. Listing
    // periods for a blocked customer would imply work that cannot happen.
    const duePeriods = status === 'ready' && term ? latestClosedPeriods(term, opts.asOf) : [];

    return { id: c.id, name: c.name, status, term, duePeriods, blockers, hasTraffic: c.hasTraffic };
  });

  const byTerm: Record<string, number> = {};
  for (const c of companies) {
    const k = c.term ?? 'unset';
    byTerm[k] = (byTerm[k] ?? 0) + 1;
  }

  // Traffic first, then name — the ranking an operator works down.
  const urgent = companies
    .filter(c => c.status === 'blocked' && c.hasTraffic)
    .sort((a, b) => a.name.localeCompare(b.name));
  const dueToday = companies.filter(c => c.duePeriods.length > 0);

  return {
    asOf: opts.asOf,
    companies,
    urgent,
    dueToday,
    summary: {
      total: companies.length,
      ready:   companies.filter(c => c.status === 'ready').length,
      blocked: companies.filter(c => c.status === 'blocked').length,
      dormant: companies.filter(c => c.status === 'dormant').length,
      dueToday: dueToday.length,
      blockedWithTraffic: urgent.length,
      byTerm,
    },
  };
}
